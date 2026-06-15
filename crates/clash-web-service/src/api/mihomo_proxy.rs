use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use clash_web_utils::AppError;
use futures_util::StreamExt;

use crate::state::AppState;

const MAX_PROXY_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const ALLOWED_PROXY_PATHS: &[&str] = &[
    "configs",
    "connections",
    "delay",
    "dns",
    "group",
    "logs",
    "memory",
    "proxies",
    "providers",
    "rules",
    "traffic",
    "version",
];

fn validate_proxy_path(path: &str) -> Result<(), AppError> {
    let first = path
        .split('/')
        .next()
        .filter(|segment| !segment.is_empty())
        .ok_or_else(|| AppError::BadRequest("proxy path is required".to_string()))?;

    if ALLOWED_PROXY_PATHS.contains(&first) {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "proxy path is not allowed".to_string(),
        ))
    }
}

async fn do_proxy(
    state: &AppState,
    method: reqwest::Method,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<Response, AppError> {
    validate_proxy_path(path.trim_start_matches('/'))?;
    let resp = state
        .mihomo
        .proxy_request(method, path, body)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let status =
        StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let content_type = resp.headers().get(header::CONTENT_TYPE).cloned();
    let mut body = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Internal(e.to_string()))?;
        if body.len() + chunk.len() > MAX_PROXY_RESPONSE_BYTES {
            return Err(AppError::Internal(
                "proxy response is too large".to_string(),
            ));
        }
        body.extend_from_slice(&chunk);
    }
    let mut headers = HeaderMap::new();
    if let Some(content_type) = content_type {
        headers.insert(header::CONTENT_TYPE, content_type);
    }

    Ok((status, headers, body).into_response())
}

#[derive(serde::Deserialize)]
pub struct SelectProxyRequest {
    pub name: String,
}

pub async fn proxy_root_get(
    State(state): State<AppState>,
    req: axum::extract::Request,
) -> Result<Response, AppError> {
    let query = req
        .uri()
        .query()
        .map(|q| format!("?{}", q))
        .unwrap_or_default();
    let mihomo_path = format!("/proxies{}", query);
    do_proxy(&state, reqwest::Method::GET, &mihomo_path, None).await
}

pub async fn proxy_get(
    State(state): State<AppState>,
    Path(path): Path<String>,
    req: axum::extract::Request,
) -> Result<Response, AppError> {
    let query = req
        .uri()
        .query()
        .map(|q| format!("?{}", q))
        .unwrap_or_default();
    let mihomo_path = format!("/{}{}", path, query);
    do_proxy(&state, reqwest::Method::GET, &mihomo_path, None).await
}

pub async fn proxy_post(
    State(state): State<AppState>,
    Path(path): Path<String>,
    body: Option<Json<serde_json::Value>>,
) -> Result<Response, AppError> {
    let mihomo_path = format!("/{}", path);
    do_proxy(
        &state,
        reqwest::Method::POST,
        &mihomo_path,
        body.map(|b| b.0),
    )
    .await
}

pub async fn proxy_patch(
    State(state): State<AppState>,
    Path(path): Path<String>,
    body: Option<Json<serde_json::Value>>,
) -> Result<Response, AppError> {
    let mihomo_path = format!("/{}", path);
    do_proxy(
        &state,
        reqwest::Method::PATCH,
        &mihomo_path,
        body.map(|b| b.0),
    )
    .await
}

pub async fn proxy_put(
    State(state): State<AppState>,
    Path(path): Path<String>,
    body: Option<Json<serde_json::Value>>,
) -> Result<Response, AppError> {
    if let Some(group) = path.strip_prefix("proxies/") {
        let body =
            body.ok_or_else(|| AppError::BadRequest("proxy name is required".to_string()))?;
        let request: SelectProxyRequest = serde_json::from_value(body.0)
            .map_err(|e| AppError::BadRequest(format!("invalid proxy selection body: {}", e)))?;
        let result = state
            .mihomo
            .select_proxy(group, &request.name)
            .await
            .map_err(|e| AppError::BadRequest(e.to_string()))?;
        return Ok((StatusCode::OK, Json(result)).into_response());
    }

    let mihomo_path = format!("/{}", path);
    do_proxy(
        &state,
        reqwest::Method::PUT,
        &mihomo_path,
        body.map(|b| b.0),
    )
    .await
}

pub async fn proxy_delete(
    State(state): State<AppState>,
    Path(path): Path<String>,
) -> Result<Response, AppError> {
    let mihomo_path = format!("/{}", path);
    do_proxy(&state, reqwest::Method::DELETE, &mihomo_path, None).await
}
