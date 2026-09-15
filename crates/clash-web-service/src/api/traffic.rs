use axum::{
    Json,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    extract::{Path, Query, State},
    response::IntoResponse,
};
use clash_web_utils::AppError;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::Value;

use crate::state::AppState;

const MAX_STREAM_CHUNK_BYTES: usize = 64 * 1024;
const MAX_STREAM_LINE_BYTES: usize = 16 * 1024;

pub async fn ws_traffic(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    let client = state.mihomo.clone();
    Ok(ws.on_upgrade(move |socket| proxy_stream(socket, client, "/traffic".into())))
}

pub async fn ws_memory(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
) -> Result<impl IntoResponse, AppError> {
    let client = state.mihomo.clone();
    Ok(ws.on_upgrade(move |socket| proxy_stream(socket, client, "/memory".into())))
}

#[derive(Deserialize)]
pub struct LogParams {
    level: Option<String>,
}

pub async fn ws_logs(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
    Query(params): Query<LogParams>,
) -> Result<impl IntoResponse, AppError> {
    let client = state.mihomo.clone();
    let level = params.level.unwrap_or_else(|| "info".to_string());
    let path = format!("/logs?level={}", level);
    Ok(ws.on_upgrade(move |socket| proxy_stream(socket, client, path)))
}

async fn proxy_stream(
    socket: WebSocket,
    client: std::sync::Arc<clash_web_core::MihomoClient>,
    path: String,
) {
    let (mut sender, mut receiver) = socket.split();

    // Telemetry emits every second. Logs may legitimately wait indefinitely
    // for their first matching event before sending the response headers.
    let stream_result = if matches!(path.as_str(), "/traffic" | "/memory") {
        tokio::time::timeout(std::time::Duration::from_secs(10), client.get_stream(&path)).await
    } else {
        Ok(client.get_stream(&path).await)
    };
    let resp = match stream_result {
        Ok(Ok(r)) => r,
        Ok(Err(error)) => {
            tracing::warn!(%path, %error, "Failed to connect to mihomo stream");
            return;
        }
        Err(_) => {
            tracing::warn!(%path, "Timed out connecting to mihomo stream");
            return;
        }
    };
    if !resp.status().is_success() {
        tracing::warn!(%path, status = %resp.status(), "mihomo rejected stream request");
        return;
    }

    let byte_stream = resp.bytes_stream();
    let mut stream = Box::pin(byte_stream);

    let mut send_task = tokio::spawn(async move {
        let mut buffer = Vec::<u8>::new();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    if bytes.len() > MAX_STREAM_CHUNK_BYTES {
                        break;
                    }
                    buffer.extend_from_slice(&bytes);
                    while let Some(newline_index) = buffer.iter().position(|byte| *byte == b'\n') {
                        let line = buffer.drain(..=newline_index).collect::<Vec<_>>();
                        let line = line.strip_suffix(b"\n").unwrap_or(&line);
                        let line = line.strip_suffix(b"\r").unwrap_or(line);
                        if line.len() > MAX_STREAM_LINE_BYTES {
                            continue;
                        }
                        if !line.starts_with(b"{") {
                            continue;
                        }
                        let Ok(text) = std::str::from_utf8(line) else {
                            continue;
                        };
                        if sender
                            .send(Message::Text(text.to_string().into()))
                            .await
                            .is_err()
                        {
                            return;
                        }
                    }
                    if buffer.len() > MAX_STREAM_LINE_BYTES {
                        buffer.clear();
                    }
                }
                Err(_) => break,
            }
        }
    });

    let mut recv_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            if msg.is_err() {
                break;
            }
        }
    });

    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }
}

pub async fn get_connections(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let resp = state
        .mihomo
        .proxy_request(reqwest::Method::GET, "/connections", None)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let body: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(body))
}

pub async fn close_connection(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let resp = state
        .mihomo
        .proxy_request(
            reqwest::Method::DELETE,
            &format!("/connections/{}", id),
            None,
        )
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let text = resp
        .text()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let body: Value = if text.is_empty() {
        serde_json::json!({ "ok": true })
    } else {
        serde_json::from_str(&text).map_err(|e| AppError::Internal(e.to_string()))?
    };
    Ok(Json(body))
}

pub async fn close_all_connections(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let resp = state
        .mihomo
        .proxy_request(reqwest::Method::DELETE, "/connections", None)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let text = resp
        .text()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let body: Value = if text.is_empty() {
        serde_json::json!({ "ok": true })
    } else {
        serde_json::from_str(&text).map_err(|e| AppError::Internal(e.to_string()))?
    };
    Ok(Json(body))
}
