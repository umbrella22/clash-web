use axum::{Json, extract::State};
use clash_web_core::preferences::UserPreferences;
use clash_web_utils::AppError;
use serde_json::json;

use crate::state::AppState;

pub async fn get_preferences(
    State(state): State<AppState>,
) -> Result<Json<UserPreferences>, AppError> {
    let preferences = state
        .preferences
        .read()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(preferences))
}

pub async fn save_preferences(
    State(state): State<AppState>,
    Json(body): Json<UserPreferences>,
) -> Result<Json<UserPreferences>, AppError> {
    let preferences = state
        .preferences
        .save(&body)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(preferences))
}

pub async fn restore_default_preferences(
    State(state): State<AppState>,
) -> Result<Json<UserPreferences>, AppError> {
    let preferences = state
        .preferences
        .restore_default()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(preferences))
}

pub async fn get_proxy_environment(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let configs = state
        .mihomo
        .get_configs()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to get mihomo config: {}", e)))?;
    Ok(Json(build_proxy_environment(&configs)))
}

fn build_proxy_environment(configs: &serde_json::Value) -> serde_json::Value {
    let host = "127.0.0.1";
    let Some(port) = proxy_environment_port(configs) else {
        return json!({
            "available": false,
            "reason": "runtime config does not expose mixed-port, port, or socks-port",
        });
    };
    let proxy_url = format!("http://{}:{}", host, port);
    let no_proxy = "localhost,127.0.0.1,::1";
    let export = format!(
        "export http_proxy={proxy_url}\nexport https_proxy={proxy_url}\nexport all_proxy={proxy_url}\nexport HTTP_PROXY={proxy_url}\nexport HTTPS_PROXY={proxy_url}\nexport ALL_PROXY={proxy_url}\nexport no_proxy={no_proxy}\nexport NO_PROXY={no_proxy}"
    );
    let unset =
        "unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY no_proxy NO_PROXY";

    json!({
        "available": true,
        "host": host,
        "port": port,
        "proxy_url": proxy_url,
        "no_proxy": no_proxy,
        "shell": {
            "export": export,
            "unset": unset,
        },
    })
}

fn proxy_environment_port(configs: &serde_json::Value) -> Option<u64> {
    configs
        .get("mixed-port")
        .and_then(|value| value.as_u64())
        .or_else(|| configs.get("port").and_then(|value| value.as_u64()))
        .or_else(|| configs.get("socks-port").and_then(|value| value.as_u64()))
}

#[cfg(test)]
mod tests {
    use super::build_proxy_environment;
    use serde_json::json;

    #[test]
    fn proxy_environment_uses_runtime_ports() {
        let environment = build_proxy_environment(&json!({
            "mixed-port": 7897,
            "port": 7890,
        }));

        assert_eq!(environment["available"], true);
        assert_eq!(environment["port"], 7897);
        assert_eq!(environment["proxy_url"], "http://127.0.0.1:7897");
        assert!(
            environment["shell"]["export"]
                .as_str()
                .unwrap()
                .contains("http_proxy=http://127.0.0.1:7897")
        );
    }

    #[test]
    fn proxy_environment_reports_missing_ports() {
        let environment = build_proxy_environment(&json!({
            "mode": "rule",
        }));

        assert_eq!(environment["available"], false);
        assert!(
            environment["reason"]
                .as_str()
                .unwrap()
                .contains("mixed-port")
        );
    }
}
