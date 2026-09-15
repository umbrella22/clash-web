use axum::{Json, extract::State};
use clash_web_utils::AppError;
use serde::Deserialize;
use serde_json::json;

use crate::state::AppState;

pub async fn get_system_proxy(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let config = state
        .mihomo
        .get_configs()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let mixed_port = config
        .get("mixed-port")
        .and_then(|v| v.as_u64())
        .unwrap_or(7890);
    let allow_lan = config
        .get("allow-lan")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let current = get_gnome_proxy_settings().await;
    let enabled = current.mode == "manual"
        && current.http.as_deref() == Some(&format!("127.0.0.1:{}", mixed_port));

    Ok(Json(json!({
        "enabled": enabled,
        "mixed_port": mixed_port,
        "allow_lan": allow_lan,
        "current_http": current.http,
        "current_socks": current.socks,
        "current_mode": current.mode,
    })))
}

#[derive(Deserialize)]
pub struct SetSystemProxyRequest {
    pub enabled: bool,
}

pub async fn set_system_proxy(
    State(state): State<AppState>,
    Json(body): Json<SetSystemProxyRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let config = state
        .mihomo
        .get_configs()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let mixed_port = config
        .get("mixed-port")
        .and_then(|v| v.as_u64())
        .unwrap_or(7890);
    let proxy_addr = format!("127.0.0.1:{}", mixed_port);

    if body.enabled {
        set_gnome_proxy(&proxy_addr)
            .await
            .map_err(|e| AppError::Internal(format!("Failed to set system proxy: {}", e)))?;
    } else {
        unset_gnome_proxy()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to unset system proxy: {}", e)))?;
    }

    Ok(Json(json!({
        "success": true,
        "enabled": body.enabled,
        "proxy": if body.enabled { proxy_addr } else { String::new() },
    })))
}

pub async fn get_tun_mode(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let config = state
        .mihomo
        .get_configs()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let tun = config.get("tun").cloned().unwrap_or(json!({}));
    let enabled = tun.get("enable").and_then(|v| v.as_bool()).unwrap_or(false);
    let stack = tun
        .get("stack")
        .and_then(|v| v.as_str())
        .unwrap_or("mixed")
        .to_ascii_lowercase();

    Ok(Json(json!({
        "enabled": enabled,
        "stack": stack,
    })))
}

#[derive(Deserialize)]
pub struct SetTunRequest {
    pub enabled: bool,
    #[serde(default = "default_stack")]
    pub stack: String,
}

fn default_stack() -> String {
    "mixed".to_string()
}

pub async fn set_tun_mode(
    State(state): State<AppState>,
    Json(body): Json<SetTunRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let stack = body.stack.to_ascii_lowercase();
    if !["mixed", "gvisor", "system"].contains(&stack.as_str()) {
        return Err(AppError::BadRequest("Invalid TUN stack".to_string()));
    }

    let mut tun_config = json!({
        "enable": body.enabled,
        "stack": stack,
    });
    if body.enabled {
        // Creating a TUN device alone does not route host traffic through it.
        tun_config["auto-route"] = json!(true);
        tun_config["auto-detect-interface"] = json!(true);
        tun_config["dns-hijack"] = json!(["any:53", "tcp://any:53"]);
    }

    state
        .mihomo
        .patch_configs(json!({ "tun": tun_config }))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // mihomo can return 204 even when creating the TUN listener fails.
    let config = state
        .mihomo
        .get_configs()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if config.pointer("/tun/enable").and_then(|v| v.as_bool()) != Some(body.enabled) {
        return Err(AppError::BadRequest(
            "TUN state did not change. On Linux, check that /dev/net/tun exists and mihomo has CAP_NET_ADMIN and CAP_NET_RAW; inspect journalctl -u mihomo.service for the startup error."
                .to_string(),
        ));
    }

    Ok(Json(json!({
        "success": true,
        "enabled": body.enabled,
        "stack": stack,
    })))
}

struct ProxySettings {
    mode: String,
    http: Option<String>,
    socks: Option<String>,
}

async fn get_gnome_proxy_settings() -> ProxySettings {
    let mode = gsettings_get("org.gnome.system.proxy", "mode").await;
    let http = gsettings_get("org.gnome.system.proxy.http", "host").await;
    let http_port = gsettings_get("org.gnome.system.proxy.http", "port").await;
    let socks = gsettings_get("org.gnome.system.proxy.socks", "host").await;
    let socks_port = gsettings_get("org.gnome.system.proxy.socks", "port").await;

    let http_addr = match (http, http_port) {
        (Some(h), Some(p)) => Some(format!("{}:{}", h, p)),
        _ => None,
    };
    let socks_addr = match (socks, socks_port) {
        (Some(h), Some(p)) => Some(format!("{}:{}", h, p)),
        _ => None,
    };

    ProxySettings {
        mode: mode.unwrap_or_else(|| "none".to_string()),
        http: http_addr,
        socks: socks_addr,
    }
}

async fn set_gnome_proxy(proxy_addr: &str) -> anyhow::Result<()> {
    let (host, port_str) = proxy_addr
        .rsplit_once(':')
        .ok_or_else(|| anyhow::anyhow!("Invalid proxy address"))?;
    let port: i32 = port_str.parse()?;

    gsettings_set("org.gnome.system.proxy", "mode", "'manual'").await?;
    gsettings_set(
        "org.gnome.system.proxy.http",
        "host",
        &format!("'{}'", host),
    )
    .await?;
    gsettings_set("org.gnome.system.proxy.http", "port", &port.to_string()).await?;
    gsettings_set(
        "org.gnome.system.proxy.https",
        "host",
        &format!("'{}'", host),
    )
    .await?;
    gsettings_set("org.gnome.system.proxy.https", "port", &port.to_string()).await?;
    gsettings_set(
        "org.gnome.system.proxy.socks",
        "host",
        &format!("'{}'", host),
    )
    .await?;
    gsettings_set("org.gnome.system.proxy.socks", "port", &port.to_string()).await?;
    Ok(())
}

async fn unset_gnome_proxy() -> anyhow::Result<()> {
    gsettings_set("org.gnome.system.proxy", "mode", "'none'").await?;
    Ok(())
}

async fn gsettings_get(schema: &str, key: &str) -> Option<String> {
    let output = tokio::process::Command::new("gsettings")
        .args(["get", schema, key])
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let val = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let cleaned = val.trim_matches('\'').trim_matches('"').trim().to_string();
    if cleaned.is_empty() || cleaned == "''" || cleaned == "\"\"" {
        return None;
    }
    Some(cleaned)
}

async fn gsettings_set(schema: &str, key: &str, value: &str) -> anyhow::Result<()> {
    let output = tokio::process::Command::new("gsettings")
        .args(["set", schema, key, value])
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("gsettings set failed: {}", stderr);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Router, http::StatusCode, routing::get};
    use clash_web_core::AppConfig;
    use serde_json::Value;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    #[derive(Clone)]
    struct FakeTun {
        config: Arc<Mutex<Value>>,
        patches: Arc<Mutex<Vec<Value>>>,
        can_create_device: bool,
    }

    async fn tun_state(
        can_create_device: bool,
    ) -> (AppState, FakeTun, tokio::task::JoinHandle<()>) {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let fake = FakeTun {
            config: Arc::new(Mutex::new(json!({
                "tun": { "enable": false, "stack": "Mixed", "device": "custom-tun" }
            }))),
            patches: Arc::new(Mutex::new(Vec::new())),
            can_create_device,
        };
        let app =
            Router::new()
                .route(
                    "/configs",
                    get(|State(fake): State<FakeTun>| async move {
                        Json(fake.config.lock().await.clone())
                    })
                    .patch(
                        |State(fake): State<FakeTun>, Json(body): Json<Value>| async move {
                            fake.patches.lock().await.push(body.clone());
                            let mut config = fake.config.lock().await;
                            for (key, value) in body["tun"].as_object().unwrap() {
                                config["tun"][key] = value.clone();
                            }
                            if !fake.can_create_device {
                                config["tun"]["enable"] = json!(false);
                            }
                            StatusCode::NO_CONTENT
                        },
                    ),
                )
                .with_state(fake.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let mut config = AppConfig::default();
        config.mihomo.api_url = format!("http://{address}");
        config.mihomo.config_dir = std::env::temp_dir()
            .join(format!("clash-web-tun-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .into_owned();
        let state = AppState::new(config, None).await.unwrap();
        (state, fake, server)
    }

    #[tokio::test]
    async fn enabling_tun_routes_host_traffic_and_hijacks_udp_and_tcp_dns() {
        let (state, fake, server) = tun_state(true).await;
        assert_eq!(
            get_tun_mode(State(state.clone())).await.unwrap().0["stack"],
            "mixed"
        );

        let result = set_tun_mode(
            State(state.clone()),
            Json(SetTunRequest {
                enabled: true,
                stack: "gvisor".into(),
            }),
        )
        .await
        .unwrap();

        assert_eq!(result.0["enabled"], true);
        let config = fake.config.lock().await;
        assert_eq!(config["tun"]["auto-route"], true);
        assert_eq!(config["tun"]["auto-detect-interface"], true);
        assert_eq!(
            config["tun"]["dns-hijack"],
            json!(["any:53", "tcp://any:53"])
        );
        assert_eq!(config["tun"]["device"], "custom-tun");
        assert_eq!(config["tun"]["stack"], "gvisor");
        drop(config);
        server.abort();
        std::fs::remove_dir_all(&state.config.mihomo.config_dir).unwrap();
    }

    #[tokio::test]
    async fn reports_failure_when_mihomo_accepts_patch_but_cannot_create_tun() {
        let (state, _, server) = tun_state(false).await;
        let result = set_tun_mode(
            State(state.clone()),
            Json(SetTunRequest {
                enabled: true,
                stack: "mixed".into(),
            }),
        )
        .await;

        assert!(
            matches!(result, Err(AppError::BadRequest(ref message)) if message.contains("CAP_NET_ADMIN"))
        );
        server.abort();
        std::fs::remove_dir_all(&state.config.mihomo.config_dir).unwrap();
    }

    #[tokio::test]
    async fn disabling_tun_does_not_overwrite_routing_and_invalid_stack_is_rejected() {
        let (state, fake, server) = tun_state(true).await;
        let result = set_tun_mode(
            State(state.clone()),
            Json(SetTunRequest {
                enabled: false,
                stack: "system".into(),
            }),
        )
        .await
        .unwrap();
        assert_eq!(result.0["enabled"], false);
        assert_eq!(
            fake.patches.lock().await.as_slice(),
            &[json!({
                "tun": { "enable": false, "stack": "system" }
            })]
        );

        let result = set_tun_mode(
            State(state.clone()),
            Json(SetTunRequest {
                enabled: true,
                stack: "invalid".into(),
            }),
        )
        .await;
        assert!(matches!(result, Err(AppError::BadRequest(_))));
        assert_eq!(fake.patches.lock().await.len(), 1);
        server.abort();
        std::fs::remove_dir_all(&state.config.mihomo.config_dir).unwrap();
    }
}
