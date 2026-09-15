use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::process::Output;
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MihomoVersion {
    pub version: String,
    pub meta: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MihomoServiceStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub uptime_secs: Option<u64>,
    pub description: String,
}

pub struct MihomoClient {
    base_url: String,
    secret: String,
    client: reqwest::Client,
}

impl MihomoClient {
    pub fn new(base_url: &str, secret: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            secret: secret.to_string(),
            client: reqwest::Client::new(),
        }
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.client.request(method, &url);
        if !self.secret.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", self.secret));
        }
        req
    }

    fn request_segments(
        &self,
        method: reqwest::Method,
        segments: &[&str],
        query: Option<&str>,
    ) -> Result<reqwest::RequestBuilder> {
        let mut url = Url::parse(&self.base_url)?;
        {
            let mut path_segments = url
                .path_segments_mut()
                .map_err(|_| anyhow::anyhow!("mihomo base url cannot be a base"))?;
            path_segments.pop_if_empty();
            for segment in segments {
                path_segments.push(segment);
            }
        }
        url.set_query(query);

        let mut req = self.client.request(method, url);
        if !self.secret.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", self.secret));
        }
        Ok(req)
    }

    pub async fn get_version(&self) -> Result<serde_json::Value> {
        let resp = self
            .request(reqwest::Method::GET, "/version")
            .send()
            .await?
            .error_for_status()?;
        let version: serde_json::Value = resp.json().await?;
        Ok(version)
    }

    pub async fn get_configs(&self) -> Result<serde_json::Value> {
        let resp = self
            .request(reqwest::Method::GET, "/configs")
            .send()
            .await?
            .error_for_status()?;
        let configs: serde_json::Value = resp.json().await?;
        Ok(configs)
    }

    pub async fn patch_configs(&self, body: serde_json::Value) -> Result<serde_json::Value> {
        let resp = self
            .request(reqwest::Method::PATCH, "/configs")
            .json(&body)
            .send()
            .await?;
        Ok(json_or_empty(resp).await?)
    }

    pub async fn select_proxy(&self, group: &str, name: &str) -> Result<serde_json::Value> {
        let resp = self
            .request_segments(reqwest::Method::PUT, &["proxies", group], None)?
            .json(&serde_json::json!({ "name": name }))
            .send()
            .await?;
        Ok(json_or_empty(resp).await?)
    }

    pub async fn get_proxies(&self) -> Result<serde_json::Value> {
        let resp = self
            .request(reqwest::Method::GET, "/proxies")
            .send()
            .await?;
        let proxies: serde_json::Value = resp.json().await?;
        Ok(proxies)
    }

    pub async fn proxy_request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<reqwest::Response> {
        let mut req = self.request(method, path);
        if let Some(b) = body {
            req = req.json(&b);
        }
        let resp = req.send().await?;
        Ok(resp)
    }

    pub async fn get_traffic_stream(&self) -> Result<reqwest::Response> {
        let resp = self
            .request(reqwest::Method::GET, "/traffic")
            .send()
            .await?;
        Ok(resp)
    }

    pub async fn get_memory_stream(&self) -> Result<reqwest::Response> {
        let resp = self.request(reqwest::Method::GET, "/memory").send().await?;
        Ok(resp)
    }

    pub async fn get_stream(&self, path: &str) -> Result<reqwest::Response> {
        let resp = self.request(reqwest::Method::GET, path).send().await?;
        Ok(resp)
    }

    pub async fn is_alive(&self) -> bool {
        self.get_version().await.is_ok()
    }
}

async fn json_or_empty(resp: reqwest::Response) -> Result<serde_json::Value> {
    let status = resp.status();
    let bytes = resp.bytes().await?;

    if !status.is_success() {
        let message = if bytes.is_empty() {
            format!("mihomo request failed with status {}", status)
        } else {
            let body = String::from_utf8_lossy(&bytes);
            format!("mihomo request failed with status {}: {}", status, body)
        };
        anyhow::bail!(message);
    }

    if bytes.is_empty() {
        return Ok(serde_json::json!({ "success": true }));
    }

    Ok(serde_json::from_slice(&bytes)?)
}

pub async fn systemctl(action: &str, service: &str) -> Result<Output> {
    let output = tokio::process::Command::new("systemctl")
        .args([action, service])
        .output()
        .await?;
    Ok(output)
}

pub async fn get_service_status(service: &str) -> MihomoServiceStatus {
    let output = tokio::process::Command::new("systemctl")
        .args(["show", service, "--property=ActiveState,MainPID,ActiveEnterTimestamp,ActiveEnterTimestampMonotonic,Description"])
        .output()
        .await;

    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let mut running = false;
            let mut pid: Option<u32> = None;
            let mut uptime_secs: Option<u64> = None;
            let mut active_enter_monotonic_usec: Option<u64> = None;
            let mut description = String::new();

            for line in stdout.lines() {
                if let Some(val) = line.strip_prefix("ActiveState=") {
                    running = val == "active";
                } else if let Some(val) = line.strip_prefix("MainPID=") {
                    pid = val.parse().ok().filter(|p: &u32| *p > 0);
                } else if let Some(val) = line.strip_prefix("ActiveEnterTimestamp=") {
                    uptime_secs = parse_systemd_timestamp(val);
                } else if let Some(val) = line.strip_prefix("ActiveEnterTimestampMonotonic=") {
                    active_enter_monotonic_usec = val.parse().ok().filter(|value: &u64| *value > 0);
                } else if let Some(val) = line.strip_prefix("Description=") {
                    description = val.to_string();
                }
            }

            if let Some(entered_usec) = active_enter_monotonic_usec {
                uptime_secs = uptime_from_monotonic(entered_usec).or(uptime_secs);
            }

            MihomoServiceStatus {
                running,
                pid,
                uptime_secs,
                description,
            }
        }
        _ => MihomoServiceStatus {
            running: false,
            pid: None,
            uptime_secs: None,
            description: "Unable to get service status".to_string(),
        },
    }
}

fn parse_systemd_timestamp(ts: &str) -> Option<u64> {
    if ts.trim().is_empty() || ts == "n/a" {
        return None;
    }
    let entered = chrono::DateTime::parse_from_str(ts.trim(), "%a %Y-%m-%d %H:%M:%S %Z").ok()?;
    let now = chrono::Utc::now();
    let secs = now
        .signed_duration_since(entered.with_timezone(&chrono::Utc))
        .num_seconds();
    Some(secs.max(0) as u64)
}

fn uptime_from_monotonic(active_enter_usec: u64) -> Option<u64> {
    let uptime_content = std::fs::read_to_string("/proc/uptime").ok()?;
    let uptime_secs = uptime_content
        .split_whitespace()
        .next()?
        .parse::<f64>()
        .ok()?;
    let uptime_usec = (uptime_secs * 1_000_000.0) as u64;
    uptime_usec
        .checked_sub(active_enter_usec)
        .map(|value| value / 1_000_000)
}
