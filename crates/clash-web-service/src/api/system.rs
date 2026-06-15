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
    let stack = tun.get("stack").and_then(|v| v.as_str()).unwrap_or("mixed");

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
    let tun_config = json!({
        "enable": body.enabled,
        "stack": body.stack,
    });

    state
        .mihomo
        .patch_configs(json!({ "tun": tun_config }))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(json!({
        "success": true,
        "enabled": body.enabled,
        "stack": body.stack,
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
