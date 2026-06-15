use axum::{Json, extract::State};
use clash_web_core::DnsConfigManager;
use clash_web_core::enhance::apply_dns_config;
use clash_web_utils::AppError;
use serde::Deserialize;
use serde_json::json;

use crate::state::AppState;

#[derive(Deserialize)]
pub struct DnsConfigRequest {
    pub content: String,
}

async fn apply_runtime_config(state: &AppState, runtime_config: String) -> Result<(), AppError> {
    state
        .profiles
        .write_active_runtime_config(&runtime_config)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to write runtime config: {}", e)))?;
    let service_config_path = state
        .profiles
        .service_config_path()
        .to_string_lossy()
        .to_string();

    let resp = state
        .mihomo
        .proxy_request(
            reqwest::Method::PUT,
            "/configs?force=true",
            Some(json!({ "path": service_config_path })),
        )
        .await
        .map_err(|e| AppError::Internal(format!("Failed to apply config: {}", e)))?;

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let message = if body.trim().is_empty() {
            format!("mihomo rejected config with status {}", status)
        } else {
            format!("mihomo rejected config with status {}: {}", status, body)
        };
        return Err(AppError::BadRequest(message));
    }

    Ok(())
}

pub async fn get_dns_config(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let content = state
        .dns
        .read()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(json!({ "content": content })))
}

pub async fn save_dns_config(
    State(state): State<AppState>,
    Json(body): Json<DnsConfigRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    state
        .dns
        .save(&body.content)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(json!({ "success": true })))
}

pub async fn validate_dns_config(
    Json(body): Json<DnsConfigRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    DnsConfigManager::validate(&body.content).map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(json!({ "valid": true })))
}

pub async fn apply_dns_config_handler(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let dns_config = state
        .dns
        .read()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    let runtime_config = match state.profiles.get_active().await {
        Some(profile) => state
            .profiles
            .read_runtime_config(&profile.uid)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?,
        None => {
            let current =
                state.mihomo.get_configs().await.map_err(|e| {
                    AppError::Internal(format!("Failed to get mihomo config: {}", e))
                })?;
            serde_yaml::to_string(&current).map_err(|e| AppError::Internal(e.to_string()))?
        }
    };
    let runtime_config = apply_dns_config(&runtime_config, &dns_config)
        .map_err(|e| AppError::BadRequest(e.to_string()))?;

    apply_runtime_config(&state, runtime_config).await?;
    Ok(Json(json!({ "success": true })))
}

pub async fn restore_default_dns_config(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let content = state
        .dns
        .restore_default()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(json!({ "content": content })))
}
