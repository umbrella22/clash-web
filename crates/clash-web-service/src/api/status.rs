use axum::{Json, extract::State};
use clash_web_core::mihomo::{get_service_status, systemctl};
use clash_web_utils::AppError;
use serde_json::json;

use crate::state::AppState;

fn systemctl_error(action: &str, stderr: &[u8]) -> AppError {
    let stderr = String::from_utf8_lossy(stderr);
    let hint = if stderr.contains("Interactive authentication required") {
        "clash-web service user is not authorized to manage mihomo.service. Install the packaged polkit rule or run the service with proper systemd permissions."
    } else if stderr.contains("Unit mihomo.service could not be found")
        || stderr.contains("not-found")
    {
        "mihomo.service is not installed. Install the Debian package service files or create the mihomo systemd unit first."
    } else {
        "check systemctl status mihomo.service and journalctl -u mihomo.service for details."
    };
    AppError::Internal(
        format!(
            "Failed to {} mihomo: {}{}",
            action,
            stderr,
            if stderr.trim().is_empty() { "" } else { " " }
        ) + hint,
    )
}

pub async fn get_status(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let svc_status = get_service_status("mihomo").await;
    let version = state.mihomo.get_version().await;
    let mihomo_api_alive = version.is_ok();
    let version_info = version.ok().or_else(|| {
        state.installer.detect().version.map(|version| {
            json!({
                "version": version,
                "meta": true,
            })
        })
    });
    let mihomo_running = svc_status.running || mihomo_api_alive;

    Ok(Json(json!({
        "mihomo_running": mihomo_running,
        "mihomo_api_alive": mihomo_api_alive,
        "service_active": svc_status.running,
        "pid": svc_status.pid,
        "uptime_secs": svc_status.uptime_secs,
        "version": version_info,
        "server": {
            "host": state.config.server.host,
            "port": state.config.server.port,
        },
    })))
}

pub async fn start_mihomo(
    State(_state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let output = systemctl("start", "mihomo")
        .await
        .map_err(|e| AppError::Internal(format!("Failed to start mihomo: {}", e)))?;
    if output.status.success() {
        Ok(Json(
            json!({ "success": true, "message": "mihomo started" }),
        ))
    } else {
        Err(systemctl_error("start", &output.stderr))
    }
}

pub async fn stop_mihomo(
    State(_state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let output = systemctl("stop", "mihomo")
        .await
        .map_err(|e| AppError::Internal(format!("Failed to stop mihomo: {}", e)))?;
    if output.status.success() {
        Ok(Json(
            json!({ "success": true, "message": "mihomo stopped" }),
        ))
    } else {
        Err(systemctl_error("stop", &output.stderr))
    }
}

pub async fn restart_mihomo(
    State(_state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let output = systemctl("restart", "mihomo")
        .await
        .map_err(|e| AppError::Internal(format!("Failed to restart mihomo: {}", e)))?;
    if output.status.success() {
        Ok(Json(
            json!({ "success": true, "message": "mihomo restarted" }),
        ))
    } else {
        Err(systemctl_error("restart", &output.stderr))
    }
}

pub async fn get_mode(State(state): State<AppState>) -> Result<Json<serde_json::Value>, AppError> {
    let configs = state
        .mihomo
        .get_configs()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to get mode: {}", e)))?;
    let mode = configs
        .get("mode")
        .and_then(|m| m.as_str())
        .unwrap_or("rule");
    Ok(Json(json!({ "mode": mode })))
}

#[derive(serde::Deserialize)]
pub struct ModeRequest {
    pub mode: String,
}

pub async fn put_mode(
    State(state): State<AppState>,
    Json(body): Json<ModeRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let valid_modes = ["rule", "global", "direct"];
    if !valid_modes.contains(&body.mode.as_str()) {
        return Err(AppError::BadRequest(format!(
            "Invalid mode: {}. Must be one of: rule, global, direct",
            body.mode
        )));
    }
    state
        .mihomo
        .patch_configs(serde_json::json!({ "mode": body.mode }))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(json!({ "mode": body.mode })))
}

pub async fn get_runtime_config(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let config = state
        .mihomo
        .get_configs()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to get mihomo config: {}", e)))?;
    Ok(Json(config))
}

pub async fn get_runtime_config_yaml(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let config = state
        .mihomo
        .get_configs()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to get mihomo config: {}", e)))?;
    let content = serde_yaml::to_string(&config).map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(json!({ "content": content })))
}

pub async fn patch_runtime_config(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    let result = state
        .mihomo
        .patch_configs(body)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(result))
}
