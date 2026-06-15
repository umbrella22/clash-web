use crate::profile::SubscriptionInfo;
use anyhow::Result;
use base64::{Engine as _, engine::general_purpose};
use futures_util::StreamExt;
use reqwest::header::HeaderMap;
use serde_json::Value as JsonValue;
use serde_yaml::{Mapping, Number, Sequence, Value};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::time::Duration;
use url::Url;

pub const MAX_SUBSCRIPTION_SIZE: usize = 2 * 1024 * 1024;

#[derive(Clone)]
pub struct SubscriptionDownloadOptions {
    pub allow_private_hosts: bool,
    pub timeout_secs: Option<u64>,
    pub skip_cert_verify: bool,
    pub proxy: Option<String>,
    pub request_headers: HashMap<String, String>,
    pub retry_count: u32,
    pub retry_interval_secs: u64,
}

impl Default for SubscriptionDownloadOptions {
    fn default() -> Self {
        Self {
            allow_private_hosts: false,
            timeout_secs: None,
            skip_cert_verify: false,
            proxy: None,
            request_headers: HashMap::new(),
            retry_count: 0,
            retry_interval_secs: 0,
        }
    }
}

pub async fn download_subscription(
    url: &str,
    user_agent: Option<&str>,
) -> Result<SubscriptionDownloadResult> {
    download_subscription_with_options(url, user_agent, SubscriptionDownloadOptions::default())
        .await
}

pub async fn download_subscription_with_options(
    url: &str,
    user_agent: Option<&str>,
    options: SubscriptionDownloadOptions,
) -> Result<SubscriptionDownloadResult> {
    validate_subscription_url(url, options.clone())?;

    let timeout_secs = options.timeout_secs.unwrap_or(30);
    let redirect_options = options.clone();
    let mut client_builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(timeout_secs))
        .danger_accept_invalid_certs(options.skip_cert_verify)
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 5 {
                attempt.error("too many subscription redirects")
            } else if validate_subscription_url(attempt.url().as_str(), redirect_options.clone())
                .is_err()
            {
                attempt.error("subscription redirect target is not allowed")
            } else {
                attempt.follow()
            }
        }));
    if let Some(proxy) = options.proxy.as_deref() {
        client_builder = client_builder.proxy(reqwest::Proxy::all(proxy)?);
    }
    let client = client_builder.build()?;
    let max_attempts = options.retry_count.saturating_add(1);
    let mut attempts = 0;
    let mut last_error = None;

    while attempts < max_attempts {
        attempts += 1;
        match download_subscription_once(&client, url, user_agent, &options.request_headers).await {
            Ok(mut result) => {
                result.attempts = attempts;
                return Ok(result);
            }
            Err(error) => {
                last_error = Some(error);
                if attempts < max_attempts && options.retry_interval_secs > 0 {
                    tokio::time::sleep(Duration::from_secs(options.retry_interval_secs)).await;
                }
            }
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Subscription download failed")))
}

async fn download_subscription_once(
    client: &reqwest::Client,
    url: &str,
    user_agent: Option<&str>,
    request_headers: &HashMap<String, String>,
) -> Result<SubscriptionDownloadResult> {
    let mut req = client.get(url);
    for (name, value) in request_headers {
        req = req.header(name, value);
    }
    if let Some(ua) = user_agent {
        req = req.header("User-Agent", ua);
    } else {
        req = req.header("User-Agent", "clash-web/0.1.0");
    }

    let resp = req.send().await?.error_for_status()?;
    let http_status = resp.status().as_u16();
    let headers = resp.headers().clone();
    if let Some(length) = resp.content_length() {
        if length > MAX_SUBSCRIPTION_SIZE as u64 {
            anyhow::bail!("Subscription response exceeds size limit");
        }
    }

    let mut content = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if content.len() + chunk.len() > MAX_SUBSCRIPTION_SIZE {
            anyhow::bail!("Subscription response exceeds size limit");
        }
        content.extend_from_slice(&chunk);
    }

    let downloaded_bytes = content.len() as u64;
    let content = String::from_utf8(content)?;
    let content = normalize_subscription_content(&content)?;

    let subscription_info = parse_subscription_info(&headers);

    Ok(SubscriptionDownloadResult {
        content,
        subscription_info,
        http_status,
        downloaded_bytes,
        attempts: 1,
    })
}

fn normalize_subscription_content(content: &str) -> Result<String> {
    let trimmed = content.trim_start_matches('\u{feff}').trim();
    if trimmed.is_empty() {
        anyhow::bail!("Subscription content is empty");
    }

    if let Some(normalized) = normalize_yaml_subscription(trimmed)? {
        return Ok(normalized);
    }

    if let Some(decoded) = try_decode_base64_text(trimmed) {
        let decoded = decoded.trim();
        if let Some(normalized) = normalize_yaml_subscription(decoded)? {
            return Ok(normalized);
        }

        if let Ok(normalized) = normalize_uri_subscription(decoded) {
            return Ok(normalized);
        }
    }

    if let Ok(normalized) = normalize_uri_subscription(trimmed) {
        return Ok(normalized);
    }

    anyhow::bail!("Unsupported subscription format: expected Mihomo YAML or share links")
}

fn normalize_yaml_subscription(content: &str) -> Result<Option<String>> {
    let mut value: Value = match serde_yaml::from_str(content) {
        Ok(value) => value,
        Err(_) => return Ok(None),
    };

    let Some(root) = value.as_mapping_mut() else {
        return Ok(None);
    };

    let has_known_keys = [
        "proxies",
        "proxy-groups",
        "proxy-providers",
        "rules",
        "mixed-port",
        "port",
        "dns",
        "mode",
    ]
    .iter()
    .any(|key| root.contains_key(Value::String((*key).to_string())));
    if !has_known_keys {
        return Ok(None);
    }

    let proxy_names = read_proxy_names(root);
    if !proxy_names.is_empty() && !root.contains_key(Value::String("proxy-groups".to_string())) {
        root.insert(
            Value::String("proxy-groups".to_string()),
            build_default_proxy_groups(&proxy_names),
        );
    }

    if !proxy_names.is_empty() && !root.contains_key(Value::String("rules".to_string())) {
        root.insert(
            Value::String("rules".to_string()),
            Value::Sequence(vec![Value::String("MATCH,PROXY".to_string())]),
        );
    }

    if !proxy_names.is_empty() && !root.contains_key(Value::String("mode".to_string())) {
        root.insert(
            Value::String("mode".to_string()),
            Value::String("rule".to_string()),
        );
    }

    Ok(Some(serde_yaml::to_string(&value)?))
}

fn read_proxy_names(root: &Mapping) -> Vec<String> {
    root.get(Value::String("proxies".to_string()))
        .and_then(Value::as_sequence)
        .into_iter()
        .flatten()
        .filter_map(|proxy| proxy.as_mapping())
        .filter_map(|proxy| {
            proxy
                .get(Value::String("name".to_string()))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .collect()
}

fn normalize_uri_subscription(content: &str) -> Result<String> {
    let mut proxies = Vec::new();

    for (index, raw_line) in content.lines().enumerate() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
            continue;
        }

        proxies.extend(parse_share_link(line, index + 1)?);
    }

    if proxies.is_empty() {
        anyhow::bail!("No supported share links found in subscription");
    }

    let proxy_names = proxies
        .iter()
        .filter_map(Value::as_mapping)
        .filter_map(|proxy| {
            proxy
                .get(Value::String("name".to_string()))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .collect::<Vec<_>>();

    let mut root = Mapping::new();
    root.insert(
        Value::String("mixed-port".to_string()),
        Value::Number(Number::from(7890)),
    );
    root.insert(Value::String("allow-lan".to_string()), Value::Bool(false));
    root.insert(
        Value::String("mode".to_string()),
        Value::String("rule".to_string()),
    );
    root.insert(
        Value::String("log-level".to_string()),
        Value::String("info".to_string()),
    );
    root.insert(
        Value::String("proxies".to_string()),
        Value::Sequence(proxies),
    );
    root.insert(
        Value::String("proxy-groups".to_string()),
        build_default_proxy_groups(&proxy_names),
    );
    root.insert(
        Value::String("rules".to_string()),
        Value::Sequence(vec![Value::String("MATCH,PROXY".to_string())]),
    );

    Ok(serde_yaml::to_string(&Value::Mapping(root))?)
}

fn build_default_proxy_groups(proxy_names: &[String]) -> Value {
    let proxies = proxy_names
        .iter()
        .cloned()
        .map(Value::String)
        .collect::<Sequence>();

    let mut select = Mapping::new();
    select.insert(
        Value::String("name".to_string()),
        Value::String("PROXY".to_string()),
    );
    select.insert(
        Value::String("type".to_string()),
        Value::String("select".to_string()),
    );
    select.insert(
        Value::String("proxies".to_string()),
        Value::Sequence(proxies.clone()),
    );

    let mut auto = Mapping::new();
    auto.insert(
        Value::String("name".to_string()),
        Value::String("AUTO".to_string()),
    );
    auto.insert(
        Value::String("type".to_string()),
        Value::String("url-test".to_string()),
    );
    auto.insert(
        Value::String("proxies".to_string()),
        Value::Sequence(proxies),
    );
    auto.insert(
        Value::String("url".to_string()),
        Value::String("https://www.gstatic.com/generate_204".to_string()),
    );
    auto.insert(
        Value::String("interval".to_string()),
        Value::Number(Number::from(300)),
    );
    auto.insert(
        Value::String("tolerance".to_string()),
        Value::Number(Number::from(50)),
    );

    Value::Sequence(vec![Value::Mapping(select), Value::Mapping(auto)])
}

fn parse_share_link(line: &str, index: usize) -> Result<Vec<Value>> {
    if line.starts_with("vmess://") {
        return Ok(vec![parse_vmess_link(line, index)?]);
    }
    if line.starts_with("ss://") {
        return Ok(vec![parse_ss_link(line, index)?]);
    }
    if line.starts_with("ssr://") {
        return Ok(vec![parse_ssr_link(line, index)?]);
    }
    if line.starts_with("socks://")
        || line.starts_with("socks5://")
        || line.starts_with("socks5h://")
    {
        return Ok(vec![parse_socks_link(line, index)?]);
    }
    if line.starts_with("http://") || line.starts_with("https://") {
        return Ok(vec![parse_http_proxy_link(line, index)?]);
    }
    if line.starts_with("trojan://") {
        return Ok(vec![parse_trojan_or_vless_link(line, "trojan", index)?]);
    }
    if line.starts_with("vless://") {
        return Ok(vec![parse_trojan_or_vless_link(line, "vless", index)?]);
    }
    if line.starts_with("hysteria://") {
        return Ok(vec![parse_hysteria_link(line, index)?]);
    }
    if line.starts_with("hysteria2://") || line.starts_with("hy2://") {
        return Ok(vec![parse_hysteria2_link(line, index)?]);
    }
    if line.starts_with("tuic://") {
        return Ok(vec![parse_tuic_link(line, index)?]);
    }
    if line.starts_with("anytls://") {
        return Ok(vec![parse_anytls_link(line, index)?]);
    }
    if line.starts_with("mierus://") || line.starts_with("mieru://") {
        return parse_mieru_link(line, index);
    }

    Ok(Vec::new())
}

fn parse_vmess_link(link: &str, index: usize) -> Result<Value> {
    let payload = link.trim_start_matches("vmess://");
    if let Some(decoded) = decode_base64_text(payload)
        && decoded.trim_start().starts_with('{')
    {
        return parse_vmess_json_config(decoded.trim(), index);
    }

    parse_vmess_aead_link(link, index)
}

fn parse_vmess_json_config(decoded: &str, index: usize) -> Result<Value> {
    let data: JsonValue = serde_json::from_str(decoded)
        .map_err(|e| anyhow::anyhow!("Invalid vmess JSON at line {}: {}", index, e))?;

    let server = json_string(&data, "add")
        .ok_or_else(|| anyhow::anyhow!("vmess server is missing at line {}", index))?;
    let port = json_u16(&data, "port")
        .ok_or_else(|| anyhow::anyhow!("vmess port is missing at line {}", index))?;
    let uuid = json_string(&data, "id")
        .ok_or_else(|| anyhow::anyhow!("vmess uuid is missing at line {}", index))?;
    let name = json_string(&data, "ps").unwrap_or_else(|| format!("vmess-{}", index));

    let mut proxy = Mapping::new();
    insert_string(&mut proxy, "name", name);
    insert_string(&mut proxy, "type", "vmess");
    insert_string(&mut proxy, "server", server);
    insert_number(&mut proxy, "port", port.into());
    insert_string(&mut proxy, "uuid", uuid);
    insert_number(
        &mut proxy,
        "alterId",
        json_u64(&data, "aid").unwrap_or(0).into(),
    );
    insert_string(
        &mut proxy,
        "cipher",
        json_string(&data, "scy").unwrap_or_else(|| "auto".to_string()),
    );
    insert_bool(&mut proxy, "udp", true);

    let network = json_string(&data, "net").unwrap_or_else(|| "tcp".to_string());
    if network != "tcp" {
        insert_string(&mut proxy, "network", network.clone());
    }

    let tls = matches!(json_string(&data, "tls").as_deref(), Some("tls"));
    if tls {
        insert_bool(&mut proxy, "tls", true);
    }

    if let Some(server_name) = json_string(&data, "sni").or_else(|| json_string(&data, "host")) {
        insert_string(&mut proxy, "servername", server_name);
    }

    if let Some(skip_verify) = json_string(&data, "allowInsecure").map(|value| is_truthy(&value)) {
        insert_bool(&mut proxy, "skip-cert-verify", skip_verify);
    }

    apply_network_options(
        &mut proxy,
        &network,
        json_string(&data, "host"),
        json_string(&data, "path"),
        json_string(&data, "path"),
    );

    Ok(Value::Mapping(proxy))
}

fn parse_vmess_aead_link(link: &str, index: usize) -> Result<Value> {
    let url = Url::parse(link)
        .map_err(|e| anyhow::anyhow!("Invalid vmess link at line {}: {}", index, e))?;
    let host = url
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("Missing vmess host at line {}", index))?;
    let port = url
        .port()
        .ok_or_else(|| anyhow::anyhow!("Missing vmess port at line {}", index))?;
    if url.username().is_empty() {
        anyhow::bail!("Missing vmess uuid at line {}", index);
    }

    let query = url.query_pairs().collect::<Vec<_>>();
    let network = query_value(&query, "type")
        .or_else(|| query_value(&query, "net"))
        .unwrap_or_else(|| "tcp".to_string());

    let mut proxy = Mapping::new();
    insert_string(
        &mut proxy,
        "name",
        url.fragment()
            .filter(|name| !name.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| format!("vmess-{}", index)),
    );
    insert_string(&mut proxy, "type", "vmess");
    insert_string(&mut proxy, "server", host.to_string());
    insert_number(&mut proxy, "port", port.into());
    insert_string(&mut proxy, "uuid", url.username().to_string());
    insert_number(&mut proxy, "alterId", 0);
    insert_string(
        &mut proxy,
        "cipher",
        query_value(&query, "encryption").unwrap_or_else(|| "auto".to_string()),
    );
    insert_bool(&mut proxy, "udp", true);

    if network != "tcp" {
        insert_string(&mut proxy, "network", network.clone());
    }

    if matches!(
        query_value(&query, "security").as_deref(),
        Some("tls" | "reality")
    ) {
        insert_bool(&mut proxy, "tls", true);
    }

    if let Some(server_name) = query_value(&query, "sni").or_else(|| query_value(&query, "host")) {
        insert_string(&mut proxy, "servername", server_name);
    }

    if let Some(skip_verify) =
        query_value(&query, "allowInsecure").or_else(|| query_value(&query, "insecure"))
    {
        insert_bool(&mut proxy, "skip-cert-verify", is_truthy(&skip_verify));
    }

    if let Some(fingerprint) = query_value(&query, "fp") {
        insert_string(&mut proxy, "client-fingerprint", fingerprint);
    }

    if let Some(fingerprint) =
        query_value(&query, "pcs").or_else(|| query_value(&query, "pinSHA256"))
    {
        insert_string(&mut proxy, "fingerprint", fingerprint);
    }

    if matches!(query_value(&query, "security").as_deref(), Some("reality")) {
        if let Some(public_key) = query_value(&query, "pbk") {
            let mut reality_opts = Mapping::new();
            insert_string(&mut reality_opts, "public-key", public_key);
            if let Some(short_id) = query_value(&query, "sid") {
                insert_string(&mut reality_opts, "short-id", short_id);
            }
            proxy.insert(
                Value::String("reality-opts".to_string()),
                Value::Mapping(reality_opts),
            );
        }
    }

    if let Some(fingerprint) = query_value(&query, "packetEncoding") {
        match fingerprint.as_str() {
            "packetaddr" | "packet" => insert_bool(&mut proxy, "packet-addr", true),
            "xudp" => insert_bool(&mut proxy, "xudp", true),
            _ => {}
        }
    }

    let alpn = query_values(&query, "alpn");
    if !alpn.is_empty() {
        insert_string_list(&mut proxy, "alpn", alpn);
    }

    apply_network_options(
        &mut proxy,
        &network,
        query_value(&query, "host"),
        query_value(&query, "path"),
        query_value(&query, "serviceName").or_else(|| query_value(&query, "service-name")),
    );

    Ok(Value::Mapping(proxy))
}

fn parse_ss_link(link: &str, index: usize) -> Result<Value> {
    let (body, name) = split_name(link);
    let encoded = body.trim_start_matches("ss://");
    let (main, query) = split_query(encoded);

    let mut proxy = Mapping::new();
    insert_string(
        &mut proxy,
        "name",
        name.unwrap_or_else(|| format!("ss-{}", index)),
    );
    insert_string(&mut proxy, "type", "ss");
    insert_bool(&mut proxy, "udp", true);

    if let Ok(url) = Url::parse(body) {
        if !url.username().is_empty() {
            if let Some(host) = url.host_str() {
                let credentials = decode_base64_text(url.username())
                    .unwrap_or_else(|| url.username().to_string());
                let (cipher, password) = credentials
                    .split_once(':')
                    .ok_or_else(|| anyhow::anyhow!("Invalid ss credentials at line {}", index))?;
                insert_string(&mut proxy, "server", host.to_string());
                insert_number(
                    &mut proxy,
                    "port",
                    url.port()
                        .ok_or_else(|| anyhow::anyhow!("Missing ss port at line {}", index))?
                        .into(),
                );
                insert_string(&mut proxy, "cipher", cipher.to_string());
                insert_string(&mut proxy, "password", password.to_string());
                apply_ss_plugin(
                    &mut proxy,
                    url.query_pairs()
                        .find(|(k, _)| k == "plugin")
                        .map(|(_, v)| v.into_owned()),
                );
                return Ok(Value::Mapping(proxy));
            }
        }
    }

    let decoded = decode_base64_text(main)
        .ok_or_else(|| anyhow::anyhow!("Invalid ss link at line {}", index))?;
    let (userinfo, host_port) = decoded
        .rsplit_once('@')
        .ok_or_else(|| anyhow::anyhow!("Invalid ss server info at line {}", index))?;
    let (cipher, password) = userinfo
        .split_once(':')
        .ok_or_else(|| anyhow::anyhow!("Invalid ss method/password at line {}", index))?;
    let (server, port) = host_port
        .rsplit_once(':')
        .ok_or_else(|| anyhow::anyhow!("Invalid ss host/port at line {}", index))?;

    insert_string(&mut proxy, "server", server.to_string());
    insert_number(
        &mut proxy,
        "port",
        port.parse::<u16>()
            .map_err(|_| anyhow::anyhow!("Invalid ss port at line {}", index))?
            .into(),
    );
    insert_string(&mut proxy, "cipher", cipher.to_string());
    insert_string(&mut proxy, "password", password.to_string());
    apply_ss_plugin(&mut proxy, query_parameter(query, "plugin"));

    Ok(Value::Mapping(proxy))
}

fn parse_ssr_link(link: &str, index: usize) -> Result<Value> {
    let payload = link.trim_start_matches("ssr://");
    let decoded = decode_base64_text(payload)
        .ok_or_else(|| anyhow::anyhow!("Invalid ssr link at line {}", index))?;
    let (main, query) = decoded
        .split_once("/?")
        .map(|(main, query)| (main, Some(query)))
        .or_else(|| {
            decoded
                .split_once('?')
                .map(|(main, query)| (main, Some(query)))
        })
        .unwrap_or((decoded.as_str(), None));
    let parts = main.split(':').collect::<Vec<_>>();
    if parts.len() != 6 {
        anyhow::bail!("Invalid ssr payload at line {}", index);
    }

    let password = decode_base64_text(parts[5]).unwrap_or_else(|| parts[5].to_string());
    let name = query_parameter(query, "remarks")
        .and_then(|value| decode_base64_text(&value))
        .unwrap_or_else(|| format!("ssr-{}", index));

    let mut proxy = Mapping::new();
    insert_string(&mut proxy, "name", name);
    insert_string(&mut proxy, "type", "ssr");
    insert_string(&mut proxy, "server", parts[0].to_string());
    insert_number(
        &mut proxy,
        "port",
        parts[1]
            .parse::<u16>()
            .map_err(|_| anyhow::anyhow!("Invalid ssr port at line {}", index))?
            .into(),
    );
    insert_string(&mut proxy, "protocol", parts[2].to_string());
    insert_string(&mut proxy, "cipher", parts[3].to_string());
    insert_string(&mut proxy, "obfs", parts[4].to_string());
    insert_string(&mut proxy, "password", password);
    insert_bool(&mut proxy, "udp", true);

    if let Some(value) =
        query_parameter(query, "obfsparam").and_then(|value| decode_base64_text(&value))
    {
        insert_string(&mut proxy, "obfs-param", value);
    }
    if let Some(value) =
        query_parameter(query, "protoparam").and_then(|value| decode_base64_text(&value))
    {
        insert_string(&mut proxy, "protocol-param", value);
    }

    Ok(Value::Mapping(proxy))
}

fn parse_socks_link(link: &str, index: usize) -> Result<Value> {
    let url = Url::parse(link)
        .map_err(|e| anyhow::anyhow!("Invalid socks link at line {}: {}", index, e))?;
    let host = url
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("Missing socks host at line {}", index))?;
    let port = url
        .port()
        .ok_or_else(|| anyhow::anyhow!("Missing socks port at line {}", index))?;

    let mut proxy = Mapping::new();
    insert_string(&mut proxy, "name", name_from_url(&url, "socks5", index));
    insert_string(&mut proxy, "type", "socks5");
    insert_string(&mut proxy, "server", host.to_string());
    insert_number(&mut proxy, "port", port.into());

    apply_proxy_auth(&mut proxy, &url);

    Ok(Value::Mapping(proxy))
}

fn parse_http_proxy_link(link: &str, index: usize) -> Result<Value> {
    let url = Url::parse(link)
        .map_err(|e| anyhow::anyhow!("Invalid http proxy link at line {}: {}", index, e))?;
    let host = url
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("Missing http proxy host at line {}", index))?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| anyhow::anyhow!("Missing http proxy port at line {}", index))?;

    let mut proxy = Mapping::new();
    insert_string(&mut proxy, "name", name_from_url(&url, "http", index));
    insert_string(&mut proxy, "type", "http");
    insert_string(&mut proxy, "server", host.to_string());
    insert_number(&mut proxy, "port", port.into());
    apply_proxy_auth(&mut proxy, &url);

    if url.scheme() == "https" {
        insert_bool(&mut proxy, "tls", true);
        insert_bool(&mut proxy, "skip-cert-verify", true);
    }

    Ok(Value::Mapping(proxy))
}

fn parse_hysteria_link(link: &str, index: usize) -> Result<Value> {
    let url = Url::parse(link)
        .map_err(|e| anyhow::anyhow!("Invalid hysteria link at line {}: {}", index, e))?;
    let host = url
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("Missing hysteria host at line {}", index))?;
    let port = url
        .port()
        .ok_or_else(|| anyhow::anyhow!("Missing hysteria port at line {}", index))?;
    let query = url.query_pairs().collect::<Vec<_>>();

    let mut proxy = Mapping::new();
    insert_string(&mut proxy, "name", name_from_url(&url, "hysteria", index));
    insert_string(&mut proxy, "type", "hysteria");
    insert_string(&mut proxy, "server", host.to_string());
    insert_number(&mut proxy, "port", port.into());

    if let Some(value) = query_value(&query, "peer").or_else(|| query_value(&query, "sni")) {
        insert_string(&mut proxy, "sni", value);
    }
    if let Some(value) = query_value(&query, "auth") {
        insert_string(&mut proxy, "auth-str", value);
    }
    if let Some(value) = query_value(&query, "obfs") {
        insert_string(&mut proxy, "obfs", value);
    }
    if let Some(value) = query_value(&query, "protocol") {
        insert_string(&mut proxy, "protocol", value);
    }
    if let Some(value) = query_value(&query, "up").or_else(|| query_value(&query, "upmbps")) {
        insert_string(&mut proxy, "up", value);
    }
    if let Some(value) = query_value(&query, "down").or_else(|| query_value(&query, "downmbps")) {
        insert_string(&mut proxy, "down", value);
    }
    if let Some(value) = query_value(&query, "insecure") {
        insert_bool(&mut proxy, "skip-cert-verify", is_truthy(&value));
    }

    let alpn = query_values(&query, "alpn");
    if !alpn.is_empty() {
        insert_string_list(&mut proxy, "alpn", alpn);
    }

    Ok(Value::Mapping(proxy))
}

fn parse_hysteria2_link(link: &str, index: usize) -> Result<Value> {
    let url = Url::parse(link)
        .map_err(|e| anyhow::anyhow!("Invalid hysteria2 link at line {}: {}", index, e))?;
    let host = url
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("Missing hysteria2 host at line {}", index))?;
    let port = url.port().unwrap_or(443);
    let query = url.query_pairs().collect::<Vec<_>>();

    if url.username().is_empty() {
        anyhow::bail!("Missing hysteria2 password at line {}", index);
    }

    let mut proxy = Mapping::new();
    insert_string(&mut proxy, "name", name_from_url(&url, "hysteria2", index));
    insert_string(&mut proxy, "type", "hysteria2");
    insert_string(&mut proxy, "server", host.to_string());
    insert_number(&mut proxy, "port", port.into());
    insert_string(&mut proxy, "password", url.username().to_string());

    if let Some(value) = query_value(&query, "sni") {
        insert_string(&mut proxy, "sni", value);
    }
    if let Some(value) = query_value(&query, "obfs") {
        insert_string(&mut proxy, "obfs", value);
    }
    if let Some(value) = query_value(&query, "obfs-password") {
        insert_string(&mut proxy, "obfs-password", value);
    }
    if let Some(value) = query_value(&query, "pinSHA256") {
        insert_string(&mut proxy, "fingerprint", value);
    }
    if let Some(value) = query_value(&query, "up") {
        insert_string(&mut proxy, "up", value);
    }
    if let Some(value) = query_value(&query, "down") {
        insert_string(&mut proxy, "down", value);
    }
    if let Some(value) = query_value(&query, "insecure") {
        insert_bool(&mut proxy, "skip-cert-verify", is_truthy(&value));
    }

    let alpn = query_values(&query, "alpn");
    if !alpn.is_empty() {
        insert_string_list(&mut proxy, "alpn", alpn);
    }

    Ok(Value::Mapping(proxy))
}

fn parse_tuic_link(link: &str, index: usize) -> Result<Value> {
    let url = Url::parse(link)
        .map_err(|e| anyhow::anyhow!("Invalid tuic link at line {}: {}", index, e))?;
    let host = url
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("Missing tuic host at line {}", index))?;
    let port = url
        .port()
        .ok_or_else(|| anyhow::anyhow!("Missing tuic port at line {}", index))?;
    let query = url.query_pairs().collect::<Vec<_>>();

    let mut proxy = Mapping::new();
    insert_string(&mut proxy, "name", name_from_url(&url, "tuic", index));
    insert_string(&mut proxy, "type", "tuic");
    insert_string(&mut proxy, "server", host.to_string());
    insert_number(&mut proxy, "port", port.into());
    insert_bool(&mut proxy, "udp", true);

    if let Some(password) = url.password() {
        insert_string(&mut proxy, "uuid", url.username().to_string());
        insert_string(&mut proxy, "password", password.to_string());
    } else if !url.username().is_empty() {
        insert_string(&mut proxy, "token", url.username().to_string());
    } else {
        anyhow::bail!("Missing tuic credentials at line {}", index);
    }

    if let Some(value) = query_value(&query, "congestion_control") {
        insert_string(&mut proxy, "congestion-controller", value);
    }
    if let Some(value) = query_value(&query, "udp_relay_mode") {
        insert_string(&mut proxy, "udp-relay-mode", value);
    }
    if let Some(value) = query_value(&query, "sni") {
        insert_string(&mut proxy, "sni", value);
    }
    if let Some(value) = query_value(&query, "disable_sni") {
        insert_bool(&mut proxy, "disable-sni", is_truthy(&value));
    }
    if let Some(value) =
        query_value(&query, "insecure").or_else(|| query_value(&query, "allowInsecure"))
    {
        insert_bool(&mut proxy, "skip-cert-verify", is_truthy(&value));
    }
    if let Some(value) = query_value(&query, "fp") {
        insert_string(&mut proxy, "fingerprint", value);
    }

    let alpn = query_values(&query, "alpn");
    if !alpn.is_empty() {
        insert_string_list(&mut proxy, "alpn", alpn);
    }

    Ok(Value::Mapping(proxy))
}

fn parse_anytls_link(link: &str, index: usize) -> Result<Value> {
    let url = Url::parse(link)
        .map_err(|e| anyhow::anyhow!("Invalid anytls link at line {}: {}", index, e))?;
    let host = url
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("Missing anytls host at line {}", index))?;
    let port = url
        .port()
        .ok_or_else(|| anyhow::anyhow!("Missing anytls port at line {}", index))?;
    let query = url.query_pairs().collect::<Vec<_>>();
    let password = url
        .password()
        .map(ToOwned::to_owned)
        .or_else(|| (!url.username().is_empty()).then(|| url.username().to_string()))
        .ok_or_else(|| anyhow::anyhow!("Missing anytls password at line {}", index))?;

    let mut proxy = Mapping::new();
    insert_string(&mut proxy, "name", name_from_url(&url, "anytls", index));
    insert_string(&mut proxy, "type", "anytls");
    insert_string(&mut proxy, "server", host.to_string());
    insert_number(&mut proxy, "port", port.into());
    insert_string(&mut proxy, "password", password);
    insert_bool(&mut proxy, "udp", true);

    if let Some(value) = query_value(&query, "sni") {
        insert_string(&mut proxy, "sni", value);
    }
    if let Some(value) = query_value(&query, "hpkp") {
        insert_string(&mut proxy, "fingerprint", value);
    }
    if let Some(value) = query_value(&query, "fp") {
        insert_string(&mut proxy, "client-fingerprint", value);
    }
    if let Some(value) = query_value(&query, "insecure") {
        insert_bool(&mut proxy, "skip-cert-verify", is_truthy(&value));
    }

    Ok(Value::Mapping(proxy))
}

fn parse_mieru_link(link: &str, index: usize) -> Result<Vec<Value>> {
    let url = Url::parse(link)
        .map_err(|e| anyhow::anyhow!("Invalid mieru link at line {}: {}", index, e))?;
    let host = url
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("Missing mieru host at line {}", index))?;
    if url.username().is_empty() {
        anyhow::bail!("Missing mieru username at line {}", index);
    }
    let query = url.query_pairs().collect::<Vec<_>>();
    let mut proxies = Vec::new();
    let base_name = url
        .fragment()
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| query_value(&query, "profile"))
        .unwrap_or_else(|| format!("mieru-{}", index));
    let protocols = query_values(&query, "protocol");
    let ports = query_values(&query, "port");

    if !ports.is_empty() && ports.len() == protocols.len() {
        for (entry_index, (port, protocol)) in
            ports.into_iter().zip(protocols.into_iter()).enumerate()
        {
            let mut proxy = Mapping::new();
            insert_string(
                &mut proxy,
                "name",
                format!("{}-{}", base_name, entry_index + 1),
            );
            insert_string(&mut proxy, "type", "mieru");
            insert_string(&mut proxy, "server", host.to_string());
            insert_string(&mut proxy, "username", url.username().to_string());
            insert_string(
                &mut proxy,
                "password",
                url.password().unwrap_or_default().to_string(),
            );
            insert_number(
                &mut proxy,
                "port",
                port.parse::<u16>()
                    .map_err(|_| anyhow::anyhow!("Invalid mieru port at line {}", index))?
                    .into(),
            );
            insert_string(&mut proxy, "transport", protocol);
            insert_bool(&mut proxy, "udp", true);
            if let Some(value) = query_value(&query, "multiplexing") {
                insert_string(&mut proxy, "multiplexing", value);
            }
            if let Some(value) = query_value(&query, "handshake-mode") {
                insert_string(&mut proxy, "handshake-mode", value);
            }
            if let Some(value) = query_value(&query, "traffic-pattern") {
                insert_string(&mut proxy, "traffic-pattern", value);
            }
            proxies.push(Value::Mapping(proxy));
        }
    } else if let Some(port_range) = query_value(&query, "port-range") {
        let mut proxy = Mapping::new();
        insert_string(&mut proxy, "name", base_name);
        insert_string(&mut proxy, "type", "mieru");
        insert_string(&mut proxy, "server", host.to_string());
        insert_string(&mut proxy, "username", url.username().to_string());
        insert_string(
            &mut proxy,
            "password",
            url.password().unwrap_or_default().to_string(),
        );
        insert_string(&mut proxy, "port-range", port_range);
        insert_string(
            &mut proxy,
            "transport",
            query_value(&query, "protocol").unwrap_or_else(|| "TCP".to_string()),
        );
        insert_bool(&mut proxy, "udp", true);
        proxies.push(Value::Mapping(proxy));
    } else {
        anyhow::bail!("Missing mieru port/protocol mapping at line {}", index);
    }

    Ok(proxies)
}

fn name_from_url(url: &Url, fallback_prefix: &str, index: usize) -> String {
    url.fragment()
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("{}-{}", fallback_prefix, index))
}

fn apply_proxy_auth(proxy: &mut Mapping, url: &Url) {
    let username = url.username();
    if username.is_empty() {
        return;
    }

    if let Some(password) = url.password() {
        insert_string(proxy, "username", username.to_string());
        insert_string(proxy, "password", password.to_string());
        return;
    }

    let decoded = decode_base64_text(username).unwrap_or_else(|| username.to_string());
    if let Some((auth_user, auth_password)) = decoded.split_once(':') {
        insert_string(proxy, "username", auth_user.to_string());
        insert_string(proxy, "password", auth_password.to_string());
    } else {
        insert_string(proxy, "username", decoded);
    }
}

fn parse_trojan_or_vless_link(link: &str, proxy_type: &str, index: usize) -> Result<Value> {
    let url = Url::parse(link)
        .map_err(|e| anyhow::anyhow!("Invalid {} link at line {}: {}", proxy_type, index, e))?;
    let host = url
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("Missing {} host at line {}", proxy_type, index))?;
    let port = url
        .port()
        .ok_or_else(|| anyhow::anyhow!("Missing {} port at line {}", proxy_type, index))?;
    let name = url
        .fragment()
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("{}-{}", proxy_type, index));

    let query = url.query_pairs().collect::<Vec<_>>();
    let network = query_value(&query, "type").unwrap_or_else(|| "tcp".to_string());
    let security = query_value(&query, "security");

    let mut proxy = Mapping::new();
    insert_string(&mut proxy, "name", name);
    insert_string(&mut proxy, "type", proxy_type.to_string());
    insert_string(&mut proxy, "server", host.to_string());
    insert_number(&mut proxy, "port", port.into());
    insert_bool(&mut proxy, "udp", true);

    match proxy_type {
        "trojan" => {
            insert_string(&mut proxy, "password", url.username().to_string());
            insert_bool(
                &mut proxy,
                "tls",
                !matches!(security.as_deref(), Some("none")),
            );
        }
        "vless" => {
            insert_string(&mut proxy, "uuid", url.username().to_string());
            insert_string(
                &mut proxy,
                "cipher",
                query_value(&query, "encryption").unwrap_or_else(|| "none".to_string()),
            );
            if matches!(security.as_deref(), Some("tls" | "reality")) {
                insert_bool(&mut proxy, "tls", true);
            }
        }
        _ => {}
    }

    if network != "tcp" {
        insert_string(&mut proxy, "network", network.clone());
    }

    if let Some(server_name) = query_value(&query, "sni").or_else(|| query_value(&query, "peer")) {
        insert_string(&mut proxy, "servername", server_name);
    }

    if let Some(skip_verify) =
        query_value(&query, "allowInsecure").or_else(|| query_value(&query, "insecure"))
    {
        insert_bool(&mut proxy, "skip-cert-verify", is_truthy(&skip_verify));
    }

    if let Some(fingerprint) = query_value(&query, "fp") {
        insert_string(&mut proxy, "client-fingerprint", fingerprint);
    }

    if let Some(fingerprint) =
        query_value(&query, "pcs").or_else(|| query_value(&query, "pinSHA256"))
    {
        insert_string(&mut proxy, "fingerprint", fingerprint);
    }

    if matches!(security.as_deref(), Some("reality")) {
        let mut reality_opts = Mapping::new();
        if let Some(public_key) = query_value(&query, "pbk") {
            insert_string(&mut reality_opts, "public-key", public_key);
        }
        if let Some(short_id) = query_value(&query, "sid") {
            insert_string(&mut reality_opts, "short-id", short_id);
        }
        if !reality_opts.is_empty() {
            proxy.insert(
                Value::String("reality-opts".to_string()),
                Value::Mapping(reality_opts),
            );
        }
        if let Some(fingerprint) = query_value(&query, "fp") {
            insert_string(&mut proxy, "client-fingerprint", fingerprint);
        }
    }

    if proxy_type == "vless" {
        if let Some(value) = query_value(&query, "flow") {
            insert_string(&mut proxy, "flow", value);
        }
        if let Some(value) = query_value(&query, "packetEncoding") {
            match value.as_str() {
                "packetaddr" | "packet" => insert_bool(&mut proxy, "packet-addr", true),
                "xudp" => insert_bool(&mut proxy, "xudp", true),
                _ => {}
            }
        }
    }

    let alpn = query_values(&query, "alpn");
    if !alpn.is_empty() {
        insert_string_list(&mut proxy, "alpn", alpn);
    }

    apply_network_options(
        &mut proxy,
        &network,
        query_value(&query, "host").or_else(|| query_value(&query, "headerType")),
        query_value(&query, "path"),
        query_value(&query, "serviceName").or_else(|| query_value(&query, "service-name")),
    );

    Ok(Value::Mapping(proxy))
}

fn apply_ss_plugin(proxy: &mut Mapping, plugin: Option<String>) {
    let Some(plugin) = plugin.filter(|value| !value.is_empty()) else {
        return;
    };

    let mut parts = plugin.split(';');
    let Some(plugin_name) = parts.next().filter(|value| !value.is_empty()) else {
        return;
    };

    insert_string(proxy, "plugin", plugin_name.to_string());
    let mut opts = Mapping::new();
    for part in parts {
        let Some((key, value)) = part.split_once('=') else {
            continue;
        };
        insert_string(&mut opts, key.to_string(), value.to_string());
    }
    if !opts.is_empty() {
        proxy.insert(
            Value::String("plugin-opts".to_string()),
            Value::Mapping(opts),
        );
    }
}

fn apply_network_options(
    proxy: &mut Mapping,
    network: &str,
    host: Option<String>,
    path: Option<String>,
    service_name: Option<String>,
) {
    match network {
        "ws" => {
            let mut ws_opts = Mapping::new();
            if let Some(path) = path.filter(|value| !value.is_empty()) {
                insert_string(&mut ws_opts, "path", path);
            }
            if let Some(host) = host.filter(|value| !value.is_empty()) {
                let mut headers = Mapping::new();
                insert_string(&mut headers, "Host", host);
                ws_opts.insert(
                    Value::String("headers".to_string()),
                    Value::Mapping(headers),
                );
            }
            if !ws_opts.is_empty() {
                proxy.insert(
                    Value::String("ws-opts".to_string()),
                    Value::Mapping(ws_opts),
                );
            }
        }
        "grpc" => {
            if let Some(service_name) = service_name.filter(|value| !value.is_empty()) {
                let mut grpc_opts = Mapping::new();
                insert_string(&mut grpc_opts, "grpc-service-name", service_name);
                proxy.insert(
                    Value::String("grpc-opts".to_string()),
                    Value::Mapping(grpc_opts),
                );
            }
        }
        "h2" | "http" => {
            let mut http_opts = Mapping::new();
            if let Some(host) = host.filter(|value| !value.is_empty()) {
                http_opts.insert(
                    Value::String("host".to_string()),
                    Value::Sequence(vec![Value::String(host)]),
                );
            }
            if let Some(path) = path.filter(|value| !value.is_empty()) {
                http_opts.insert(
                    Value::String("path".to_string()),
                    Value::Sequence(vec![Value::String(path)]),
                );
            }
            if !http_opts.is_empty() {
                proxy.insert(
                    Value::String("http-opts".to_string()),
                    Value::Mapping(http_opts),
                );
            }
        }
        _ => {}
    }
}

fn try_decode_base64_text(content: &str) -> Option<String> {
    if content.contains("://") {
        return None;
    }

    let compact = content
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>();
    decode_base64_text(&compact)
}

fn decode_base64_text(content: &str) -> Option<String> {
    [
        &general_purpose::STANDARD,
        &general_purpose::STANDARD_NO_PAD,
        &general_purpose::URL_SAFE,
        &general_purpose::URL_SAFE_NO_PAD,
    ]
    .iter()
    .find_map(|engine| engine.decode(content).ok())
    .and_then(|bytes| String::from_utf8(bytes).ok())
}

fn split_name(link: &str) -> (&str, Option<String>) {
    match link.split_once('#') {
        Some((body, name)) if !name.is_empty() => (body, Some(name.to_string())),
        Some((body, _)) => (body, None),
        None => (link, None),
    }
}

fn split_query(value: &str) -> (&str, Option<&str>) {
    match value.split_once('?') {
        Some((body, query)) => (body, Some(query)),
        None => (value, None),
    }
}

fn query_parameter(query: Option<&str>, key: &str) -> Option<String> {
    query.and_then(|query| {
        url::form_urlencoded::parse(query.as_bytes())
            .find(|(query_key, _)| query_key == key)
            .map(|(_, value)| value.into_owned())
    })
}

fn query_value(
    query: &[(std::borrow::Cow<'_, str>, std::borrow::Cow<'_, str>)],
    key: &str,
) -> Option<String> {
    query
        .iter()
        .find(|(query_key, _)| query_key == key)
        .map(|(_, value)| value.to_string())
}

fn query_values(
    query: &[(std::borrow::Cow<'_, str>, std::borrow::Cow<'_, str>)],
    key: &str,
) -> Vec<String> {
    query
        .iter()
        .filter(|(query_key, _)| query_key == key)
        .flat_map(|(_, value)| value.split(','))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn insert_string<K: Into<String>, V: Into<String>>(mapping: &mut Mapping, key: K, value: V) {
    mapping.insert(Value::String(key.into()), Value::String(value.into()));
}

fn insert_string_list<K: Into<String>>(mapping: &mut Mapping, key: K, values: Vec<String>) {
    mapping.insert(
        Value::String(key.into()),
        Value::Sequence(values.into_iter().map(Value::String).collect()),
    );
}

fn insert_bool<K: Into<String>>(mapping: &mut Mapping, key: K, value: bool) {
    mapping.insert(Value::String(key.into()), Value::Bool(value));
}

fn insert_number<K: Into<String>>(mapping: &mut Mapping, key: K, value: u64) {
    mapping.insert(
        Value::String(key.into()),
        Value::Number(Number::from(value)),
    );
}

fn json_string(value: &JsonValue, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(JsonValue::as_str)
        .map(ToOwned::to_owned)
}

fn json_u16(value: &JsonValue, key: &str) -> Option<u16> {
    value
        .get(key)
        .and_then(|raw| raw.as_u64().or_else(|| raw.as_str()?.parse().ok()))
        .and_then(|number| u16::try_from(number).ok())
}

fn json_u64(value: &JsonValue, key: &str) -> Option<u64> {
    value
        .get(key)
        .and_then(|raw| raw.as_u64().or_else(|| raw.as_str()?.parse().ok()))
}

fn is_truthy(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn validate_subscription_url(url: &str, options: SubscriptionDownloadOptions) -> Result<()> {
    let parsed = Url::parse(url)?;
    if !matches!(parsed.scheme(), "http" | "https") {
        anyhow::bail!("Subscription URL scheme is not allowed");
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("Subscription URL host is required"))?;

    if !options.allow_private_hosts
        && (host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost"))
    {
        anyhow::bail!("Subscription URL host is not allowed");
    }

    if !options.allow_private_hosts
        && let Ok(ip) = host.parse::<IpAddr>()
    {
        if is_private_ip(ip) {
            anyhow::bail!("Subscription URL host is not allowed");
        }
    }

    Ok(())
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip == Ipv4Addr::UNSPECIFIED
        }
        IpAddr::V6(ip) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || matches!(ip.segments()[0] & 0xfe00, 0xfc00)
                || matches!(ip.segments()[0] & 0xffc0, 0xfe80)
                || ip == Ipv6Addr::LOCALHOST
        }
    }
}

fn parse_subscription_info(headers: &HeaderMap) -> Option<SubscriptionInfo> {
    let header_val = headers
        .get("subscription-userinfo")
        .or_else(|| headers.get("Subscription-Userinfo"))
        .and_then(|v| v.to_str().ok())?;

    let mut upload = 0i64;
    let mut download = 0i64;
    let mut total = 0i64;
    let mut expire = None;

    for part in header_val.split(';') {
        let part = part.trim();
        if let Some(val) = part.strip_prefix("upload=") {
            upload = val.parse().unwrap_or(0);
        } else if let Some(val) = part.strip_prefix("download=") {
            download = val.parse().unwrap_or(0);
        } else if let Some(val) = part.strip_prefix("total=") {
            total = val.parse().unwrap_or(0);
        } else if let Some(val) = part.strip_prefix("expire=") {
            let exp: i64 = val.parse().unwrap_or(0);
            if exp > 0 {
                expire = Some(exp);
            }
        }
    }

    Some(SubscriptionInfo {
        upload,
        download,
        total,
        expire,
    })
}

pub struct SubscriptionDownloadResult {
    pub content: String,
    pub subscription_info: Option<SubscriptionInfo>,
    pub http_status: u16,
    pub downloaded_bytes: u64,
    pub attempts: u32,
}

#[cfg(test)]
mod tests {
    use super::{
        SubscriptionDownloadOptions, normalize_subscription_content, validate_subscription_url,
    };
    use base64::{Engine as _, engine::general_purpose};
    use serde_yaml::Value;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    fn strict_options() -> SubscriptionDownloadOptions {
        SubscriptionDownloadOptions {
            allow_private_hosts: false,
            ..Default::default()
        }
    }

    #[test]
    fn rejects_private_subscription_targets() {
        assert!(validate_subscription_url("http://127.0.0.1/sub.yaml", strict_options()).is_err());
        assert!(validate_subscription_url("http://10.0.0.1/sub.yaml", strict_options()).is_err());
        assert!(validate_subscription_url("http://localhost/sub.yaml", strict_options()).is_err());
        assert!(validate_subscription_url("file:///etc/passwd", strict_options()).is_err());
    }

    #[test]
    fn allows_public_http_subscription_targets() {
        assert!(
            validate_subscription_url("https://example.com/sub.yaml", strict_options()).is_ok()
        );
        assert!(
            validate_subscription_url("http://203.0.113.10/sub.yaml", strict_options()).is_err()
        );
    }

    #[test]
    fn default_rejects_private_subscription_targets() {
        assert!(
            validate_subscription_url("http://127.0.0.1/sub.yaml", Default::default()).is_err()
        );
    }

    #[tokio::test]
    async fn rejects_streamed_subscription_over_size_limit() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let body = "a".repeat(super::MAX_SUBSCRIPTION_SIZE + 1);
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            tokio::io::AsyncWriteExt::write_all(&mut stream, response.as_bytes())
                .await
                .unwrap();
        });

        let result = super::download_subscription_with_options(
            &format!("http://{}/sub.yaml", addr),
            None,
            SubscriptionDownloadOptions {
                allow_private_hosts: true,
                ..Default::default()
            },
        )
        .await;

        assert!(result.is_err());
    }

    #[tokio::test]
    async fn retries_subscription_download_and_sends_headers() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&requests);

        tokio::spawn(async move {
            for attempt in 1..=2 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut buffer = vec![0; 2048];
                let size = tokio::io::AsyncReadExt::read(&mut stream, &mut buffer)
                    .await
                    .unwrap();
                captured
                    .lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&buffer[..size]).to_string());

                let response = if attempt == 1 {
                    "HTTP/1.1 500 Internal Server Error\r\ncontent-length: 0\r\n\r\n".to_string()
                } else {
                    let body = "proxies: []\nrules:\n  - MATCH,DIRECT\n";
                    format!(
                        "HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: {}\r\n\r\n{}",
                        body.len(),
                        body
                    )
                };
                tokio::io::AsyncWriteExt::write_all(&mut stream, response.as_bytes())
                    .await
                    .unwrap();
            }
        });

        let mut request_headers = HashMap::new();
        request_headers.insert("X-Subscription-Token".to_string(), "secret".to_string());

        let result = super::download_subscription_with_options(
            &format!("http://{}/sub.yaml", addr),
            Some("Custom-UA"),
            SubscriptionDownloadOptions {
                allow_private_hosts: true,
                request_headers,
                retry_count: 1,
                retry_interval_secs: 0,
                ..Default::default()
            },
        )
        .await
        .unwrap();

        assert_eq!(result.attempts, 2);
        assert_eq!(result.http_status, 200);
        let requests = requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[0].contains("x-subscription-token: secret"));
        assert!(requests[1].contains("user-agent: Custom-UA"));
    }

    #[test]
    fn injects_default_proxy_groups_for_yaml_proxy_list() {
        let normalized = normalize_subscription_content(
            "proxies:\n  - name: HK\n    type: ss\n    server: 1.1.1.1\n    port: 443\n    cipher: aes-128-gcm\n    password: pass\n",
        )
        .unwrap();
        let yaml: Value = serde_yaml::from_str(&normalized).unwrap();

        let groups = yaml["proxy-groups"].as_sequence().unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0]["name"].as_str().unwrap(), "PROXY");
        assert_eq!(yaml["rules"][0].as_str().unwrap(), "MATCH,PROXY");
    }

    #[test]
    fn preserves_yaml_subscription_with_existing_select_groups() {
        let normalized = normalize_subscription_content(
            r#"
mixed-port: 7890
mode: rule
proxies:
  - name: HK
    type: vmess
    server: example.com
    port: 443
    uuid: 123e4567-e89b-12d3-a456-426614174000
    alterId: 0
    cipher: auto
  - name: JP
    type: trojan
    server: example.net
    port: 443
    password: pass
proxy-groups:
  - name: 拓扑门topman8848.com
    type: select
    proxies:
      - 自动选择
      - 故障转移
      - HK
      - JP
  - name: 自动选择
    type: url-test
    proxies:
      - HK
      - JP
    url: https://www.gstatic.com/generate_204
    interval: 300
  - name: 故障转移
    type: fallback
    proxies:
      - HK
      - JP
    url: https://www.gstatic.com/generate_204
    interval: 300
rules:
  - MATCH,拓扑门topman8848.com
"#,
        )
        .unwrap();
        let yaml: Value = serde_yaml::from_str(&normalized).unwrap();

        let groups = yaml["proxy-groups"].as_sequence().unwrap();
        assert_eq!(groups.len(), 3);
        assert_eq!(groups[0]["type"].as_str().unwrap(), "select");
        assert_eq!(groups[0]["proxies"].as_sequence().unwrap().len(), 4);
        assert_eq!(yaml["proxies"].as_sequence().unwrap().len(), 2);
    }

    #[test]
    fn converts_base64_share_links_to_mihomo_yaml() {
        let subscription = "ss://YWVzLTEyOC1nY206cGFzc0AxLjEuMS4xOjQ0Mw==#HK";
        let encoded = general_purpose::STANDARD.encode(subscription);
        let normalized = normalize_subscription_content(&encoded).unwrap();
        let yaml: Value = serde_yaml::from_str(&normalized).unwrap();

        assert_eq!(yaml["proxies"][0]["name"].as_str().unwrap(), "HK");
        assert_eq!(yaml["proxies"][0]["type"].as_str().unwrap(), "ss");
        assert_eq!(yaml["proxy-groups"][0]["name"].as_str().unwrap(), "PROXY");
    }

    #[test]
    fn converts_ssr_links_to_mihomo_yaml() {
        let remarks = general_purpose::URL_SAFE_NO_PAD.encode("SSR-HK");
        let password = general_purpose::URL_SAFE_NO_PAD.encode("secret");
        let payload = format!(
            "example.com:443:origin:aes-128-gcm:plain:{}?remarks={}",
            password, remarks
        );
        let link = format!("ssr://{}", general_purpose::URL_SAFE_NO_PAD.encode(payload));
        let yaml: Value =
            serde_yaml::from_str(&normalize_subscription_content(&link).unwrap()).unwrap();

        assert_eq!(yaml["proxies"][0]["type"].as_str().unwrap(), "ssr");
        assert_eq!(yaml["proxies"][0]["name"].as_str().unwrap(), "SSR-HK");
        assert_eq!(
            yaml["proxies"][0]["server"].as_str().unwrap(),
            "example.com"
        );
    }

    #[test]
    fn converts_vmess_aead_links_to_mihomo_yaml() {
        let link = "vmess://123e4567-e89b-12d3-a456-426614174000@example.com:443?security=tls&type=ws&host=cdn.example.com&path=%2Fws&fp=chrome#VMess";
        let yaml: Value =
            serde_yaml::from_str(&normalize_subscription_content(link).unwrap()).unwrap();

        assert_eq!(yaml["proxies"][0]["type"].as_str().unwrap(), "vmess");
        assert_eq!(yaml["proxies"][0]["network"].as_str().unwrap(), "ws");
        assert_eq!(
            yaml["proxies"][0]["ws-opts"]["path"].as_str().unwrap(),
            "/ws"
        );
        assert_eq!(
            yaml["proxies"][0]["client-fingerprint"].as_str().unwrap(),
            "chrome"
        );
    }

    #[test]
    fn converts_hy2_and_tuic_links_to_mihomo_yaml() {
        let subscription = [
            "hy2://password@example.com:8443?sni=hy2.example.com&obfs=salamander&obfs-password=pass#HY2",
            "tuic://123e4567-e89b-12d3-a456-426614174000:secret@example.com:443?congestion_control=bbr&udp_relay_mode=native&sni=tuic.example.com#TUIC",
        ]
        .join("\n");
        let yaml: Value =
            serde_yaml::from_str(&normalize_subscription_content(&subscription).unwrap()).unwrap();

        assert_eq!(yaml["proxies"][0]["type"].as_str().unwrap(), "hysteria2");
        assert_eq!(yaml["proxies"][0]["obfs"].as_str().unwrap(), "salamander");
        assert_eq!(yaml["proxies"][1]["type"].as_str().unwrap(), "tuic");
        assert_eq!(
            yaml["proxies"][1]["congestion-controller"]
                .as_str()
                .unwrap(),
            "bbr"
        );
        assert_eq!(
            yaml["proxies"][1]["udp-relay-mode"].as_str().unwrap(),
            "native"
        );
    }

    #[test]
    fn converts_http_socks_and_anytls_links_to_mihomo_yaml() {
        let subscription = [
            "https://dXNlcjpwYXNz@example.com:8443#HTTPSProxy",
            "socks5://user:pass@example.net:1080#SOCKS",
            "anytls://user@example.org:443?sni=anytls.example.org&insecure=1#AnyTLS",
        ]
        .join("\n");
        let yaml: Value =
            serde_yaml::from_str(&normalize_subscription_content(&subscription).unwrap()).unwrap();

        assert_eq!(yaml["proxies"][0]["type"].as_str().unwrap(), "http");
        assert_eq!(yaml["proxies"][0]["tls"].as_bool().unwrap(), true);
        assert_eq!(yaml["proxies"][1]["type"].as_str().unwrap(), "socks5");
        assert_eq!(yaml["proxies"][1]["username"].as_str().unwrap(), "user");
        assert_eq!(yaml["proxies"][2]["type"].as_str().unwrap(), "anytls");
        assert_eq!(yaml["proxies"][2]["udp"].as_bool().unwrap(), true);
    }
}
