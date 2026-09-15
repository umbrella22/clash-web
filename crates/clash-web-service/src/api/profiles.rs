use axum::{
    Json,
    extract::{Multipart, Path, State},
};
use clash_web_core::config::DEFAULT_MIHOMO_CONFIG;
use clash_web_core::enhance::build_runtime_config_with_dns;
use clash_web_core::mihomo::systemctl;
use clash_web_core::precheck::validate_runtime_config;
use clash_web_core::profile::{
    MAX_PROFILE_FILE_SIZE, Profile, ProfileExtra, ProfileType, ProfileUpdate, SubscriptionInfo,
    SubscriptionUpdateDetail,
};
use clash_web_core::subscription::{
    SubscriptionDownloadOptions, download_subscription_with_options,
};
use clash_web_utils::AppError;
use futures_util::TryStreamExt;
use serde::Deserialize;
use serde_json::json;
use serde_yaml::Value as YamlValue;
use tokio::time::{Duration, sleep};

use crate::state::AppState;

async fn subscription_proxy_url(state: &AppState) -> Option<String> {
    let configs = state.mihomo.get_configs().await.ok()?;
    let port = configs
        .get("mixed-port")
        .and_then(|value| value.as_u64())
        .or_else(|| configs.get("port").and_then(|value| value.as_u64()))
        .unwrap_or(7890);
    Some(format!("http://127.0.0.1:{}", port))
}

async fn subscription_download_options(
    state: &AppState,
    extra: Option<&ProfileExtra>,
) -> SubscriptionDownloadOptions {
    let proxy = if extra.is_some_and(|e| e.download_via_proxy) {
        subscription_proxy_url(state).await
    } else {
        None
    };

    SubscriptionDownloadOptions {
        timeout_secs: extra.and_then(|e| e.download_timeout),
        skip_cert_verify: extra.is_some_and(|e| e.skip_cert_verify),
        proxy,
        request_headers: extra.map(|e| e.request_headers.clone()).unwrap_or_default(),
        retry_count: extra.and_then(|e| e.retry_count).unwrap_or_default(),
        retry_interval_secs: extra
            .and_then(|e| e.retry_interval_secs)
            .unwrap_or_default(),
        allow_private_hosts: false,
    }
}

fn expected_proxy_groups(runtime_config: &str) -> Result<Vec<String>, AppError> {
    let yaml: YamlValue = serde_yaml::from_str(runtime_config)
        .map_err(|e| AppError::Internal(format!("Failed to parse runtime config: {}", e)))?;
    let groups = yaml
        .get("proxy-groups")
        .and_then(YamlValue::as_sequence)
        .into_iter()
        .flatten()
        .filter_map(|group| group.get("name").and_then(YamlValue::as_str))
        .filter(|name| !name.trim().is_empty())
        .map(ToOwned::to_owned)
        .collect();
    Ok(groups)
}

async fn missing_runtime_groups(state: &AppState, expected_groups: &[String]) -> Vec<String> {
    let Ok(proxies) = state.mihomo.get_proxies().await else {
        return expected_groups.to_vec();
    };
    let Some(runtime_proxies) = proxies.get("proxies").and_then(|value| value.as_object()) else {
        return expected_groups.to_vec();
    };
    expected_groups
        .iter()
        .filter(|name| !runtime_proxies.contains_key(name.as_str()))
        .cloned()
        .collect()
}

async fn wait_runtime_groups(state: &AppState, expected_groups: &[String]) -> Vec<String> {
    let mut missing = Vec::new();
    for _ in 0..10 {
        missing = missing_runtime_groups(state, expected_groups).await;
        if missing.is_empty() {
            return missing;
        }
        sleep(Duration::from_millis(300)).await;
    }
    missing
}

async fn wait_mihomo_api(state: &AppState) -> bool {
    for _ in 0..10 {
        if state.mihomo.is_alive().await {
            return true;
        }
        sleep(Duration::from_millis(300)).await;
    }
    false
}

async fn ensure_runtime_config_loaded(
    state: &AppState,
    runtime_config: &str,
) -> Result<(), AppError> {
    let expected_groups = expected_proxy_groups(runtime_config)?;
    if expected_groups.is_empty() {
        return Ok(());
    }

    let missing = wait_runtime_groups(state, &expected_groups).await;
    if missing.is_empty() {
        return Ok(());
    }

    let output = systemctl("restart", "mihomo")
        .await
        .map_err(|e| AppError::Internal(format!("Failed to restart mihomo: {}", e)))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Internal(format!(
            "Applied config, but mihomo runtime did not load proxy groups [{}], and restart failed: {}",
            missing.join(", "),
            stderr
        )));
    }

    let missing_after_restart = wait_runtime_groups(state, &expected_groups).await;
    if missing_after_restart.is_empty() {
        return Ok(());
    }

    Err(AppError::BadRequest(format!(
        "mihomo accepted config, but runtime proxies are still missing groups: {}",
        missing_after_restart.join(", ")
    )))
}

async fn apply_profile_config(state: &AppState, uid: &str) -> Result<(), AppError> {
    let file_content = state
        .profiles
        .read_file(uid)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let all_profiles = state.profiles.list().await;
    let mut merge_profiles = Vec::new();
    for item in all_profiles {
        if matches!(item.profile_type, ProfileType::Merge) {
            let merge_content = state
                .profiles
                .read_file(&item.uid)
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
            merge_profiles.push(merge_content);
        }
    }

    let dns_config = state
        .dns
        .read()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let runtime_config =
        build_runtime_config_with_dns(&file_content, &merge_profiles, Some(&dns_config))
            .map_err(|e| AppError::Internal(format!("Failed to build runtime config: {}", e)))?;
    validate_runtime_config(&runtime_config)
        .map_err(|e| AppError::PrecheckFailed(e.to_string()))?;

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

    let resp = match state
        .mihomo
        .proxy_request(
            reqwest::Method::PUT,
            "/configs?force=true",
            Some(serde_json::json!({ "path": service_config_path })),
        )
        .await
    {
        Ok(resp) => resp,
        Err(error) => {
            let output = systemctl("restart", "mihomo")
                .await
                .map_err(|restart_error| {
                    AppError::Internal(format!(
                        "Failed to apply config: {}, and failed to restart mihomo: {}",
                        error, restart_error
                    ))
                })?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(AppError::Internal(format!(
                    "Failed to apply config: {}, and mihomo restart failed: {}",
                    error, stderr
                )));
            }
            if !wait_mihomo_api(state).await {
                return Err(AppError::BadRequest(format!(
                    "Mihomo API is unreachable after restart. Check that external-controller in the active config matches {} and that mihomo started successfully.",
                    state.config.mihomo.api_url
                )));
            }
            state
                .mihomo
                .proxy_request(
                    reqwest::Method::PUT,
                    "/configs?force=true",
                    Some(serde_json::json!({ "path": service_config_path })),
                )
                .await
                .map_err(|retry_error| {
                    AppError::Internal(format!(
                        "Failed to apply config after mihomo restart: {}",
                        retry_error
                    ))
                })?
        }
    };

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

    ensure_runtime_config_loaded(state, &runtime_config).await?;

    Ok(())
}

async fn clear_runtime_config(state: &AppState) -> Result<(), AppError> {
    let dns_config = state
        .dns
        .read()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let runtime_config =
        build_runtime_config_with_dns(DEFAULT_MIHOMO_CONFIG, &[], Some(&dns_config)).map_err(
            |e| AppError::Internal(format!("Failed to build empty runtime config: {}", e)),
        )?;
    validate_runtime_config(&runtime_config)
        .map_err(|e| AppError::PrecheckFailed(e.to_string()))?;
    state
        .profiles
        .write_active_runtime_config(&runtime_config)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to write empty runtime config: {}", e)))?;

    let service_config_path = state
        .profiles
        .service_config_path()
        .to_string_lossy()
        .to_string();
    let apply_result = state
        .mihomo
        .proxy_request(
            reqwest::Method::PUT,
            "/configs?force=true",
            Some(serde_json::json!({ "path": service_config_path })),
        )
        .await;

    match apply_result {
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            if status.is_success() {
                Ok(())
            } else if body.trim().is_empty() {
                Err(AppError::BadRequest(format!(
                    "mihomo rejected empty config with status {}",
                    status
                )))
            } else {
                Err(AppError::BadRequest(format!(
                    "mihomo rejected empty config with status {}: {}",
                    status, body
                )))
            }
        }
        Err(error) => {
            let output = systemctl("restart", "mihomo")
                .await
                .map_err(|restart_error| {
                    AppError::Internal(format!(
                        "Failed to clear runtime config: {}, and failed to restart mihomo: {}",
                        error, restart_error
                    ))
                })?;
            if output.status.success() {
                Ok(())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(AppError::Internal(format!(
                    "Failed to clear runtime config: {}, and mihomo restart failed: {}",
                    error, stderr
                )))
            }
        }
    }
}

pub async fn list_profiles(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let profiles = state.profiles.list().await;
    let active = state.profiles.get_active().await;
    Ok(Json(json!({
        "profiles": profiles,
        "active": active.map(|p| p.uid),
    })))
}

pub async fn get_profile(
    State(state): State<AppState>,
    Path(uid): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let profile = state
        .profiles
        .get(&uid)
        .await
        .ok_or_else(|| AppError::NotFound(format!("Profile not found: {}", uid)))?;
    Ok(Json(json!(profile)))
}

#[derive(Deserialize)]
pub struct CreateProfileRequest {
    pub name: String,
    #[serde(default)]
    pub desc: String,
    #[serde(rename = "type", default = "default_profile_type")]
    pub profile_type: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub file: Option<String>,
    #[serde(default)]
    pub extra: Option<ProfileExtra>,
}

fn default_profile_type() -> String {
    "local".to_string()
}

pub async fn create_profile(
    State(state): State<AppState>,
    Json(body): Json<CreateProfileRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let profile_type = match body.profile_type.as_str() {
        "remote" => ProfileType::Remote,
        "local" => ProfileType::Local,
        "merge" => ProfileType::Merge,
        "script" => ProfileType::Script,
        _ => return Err(AppError::BadRequest("Invalid profile type".into())),
    };

    let profile = Profile {
        uid: String::new(),
        name: body.name,
        desc: body.desc,
        profile_type,
        url: body.url,
        file: body.file.unwrap_or_default(),
        selected: vec![],
        updated: None,
        extra: body.extra,
        subscription_info: None,
        subscription_update_detail: None,
    };

    let created = state
        .profiles
        .create(profile)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    if matches!(created.profile_type, ProfileType::Remote)
        && let Some(url) = created.url.as_deref()
    {
        let extra = created.extra.as_ref();
        let ua = extra.and_then(|e| e.user_agent.as_deref());
        let options = subscription_download_options(&state, extra).await;
        let result = download_subscription_with_options(url, ua, options)
            .await
            .map_err(|e| AppError::BadRequest(format!("Failed to download: {:#}", e)))?;
        state
            .profiles
            .write_file(&created.uid, &result.content)
            .await
            .map_err(|e| AppError::BadRequest(e.to_string()))?;
        let now = chrono::Utc::now().timestamp();
        let info = result.subscription_info.unwrap_or(SubscriptionInfo {
            upload: 0,
            download: 0,
            total: 0,
            expire: None,
        });
        let detail = SubscriptionUpdateDetail {
            success: true,
            updated_at: now,
            attempts: result.attempts,
            http_status: Some(result.http_status),
            error: None,
            downloaded_bytes: result.downloaded_bytes,
            skipped_links: result.skipped_links,
            kept_old: false,
        };
        state
            .profiles
            .update_subscription_result(&created.uid, Some(info), detail)
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let updated = state
            .profiles
            .get(&created.uid)
            .await
            .ok_or_else(|| AppError::NotFound(format!("Profile not found: {}", created.uid)))?;
        return Ok(Json(json!(updated)));
    }
    Ok(Json(json!(created)))
}

pub async fn update_profile(
    State(state): State<AppState>,
    Path(uid): Path<String>,
    Json(body): Json<ProfileUpdate>,
) -> Result<Json<serde_json::Value>, AppError> {
    let profile = state
        .profiles
        .update(&uid, body)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(json!(profile)))
}

pub async fn delete_profile(
    State(state): State<AppState>,
    Path(uid): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let is_active = state
        .profiles
        .get_active()
        .await
        .is_some_and(|profile| profile.uid == uid);
    state
        .profiles
        .delete(&uid)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    if is_active {
        clear_runtime_config(&state).await?;
    }
    Ok(Json(json!({ "success": true })))
}

pub async fn activate_profile(
    State(state): State<AppState>,
    Path(uid): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let profile = state
        .profiles
        .get(&uid)
        .await
        .ok_or_else(|| AppError::NotFound(format!("Profile not found: {}", uid)))?;

    match profile.profile_type {
        ProfileType::Merge => {
            return Err(AppError::BadRequest(
                "Merge profile cannot be activated directly".into(),
            ));
        }
        ProfileType::Script => {
            return Err(AppError::BadRequest(
                "Script profile activation is not implemented yet".into(),
            ));
        }
        ProfileType::Remote | ProfileType::Local => {}
    }

    apply_profile_config(&state, &uid).await?;

    let activated = state
        .profiles
        .set_active(&uid)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(json!(activated)))
}

pub async fn update_subscription(
    State(state): State<AppState>,
    Path(uid): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let profile = state
        .profiles
        .get(&uid)
        .await
        .ok_or_else(|| AppError::NotFound(format!("Profile not found: {}", uid)))?;

    let url = profile
        .url
        .clone()
        .ok_or_else(|| AppError::BadRequest("Profile has no URL".into()))?;

    let extra = profile.extra.as_ref();
    let ua = extra.and_then(|e| e.user_agent.as_deref());
    let options = subscription_download_options(&state, extra).await;
    let attempted = options.clone().limited().retry_count.saturating_add(1);

    let result = match download_subscription_with_options(&url, ua, options).await {
        Ok(result) => result,
        Err(e) if extra.is_some_and(|e| e.keep_old_on_failure) => {
            let detail = SubscriptionUpdateDetail {
                success: false,
                updated_at: chrono::Utc::now().timestamp(),
                attempts: attempted,
                http_status: None,
                error: Some(format!("Failed to download: {:#}", e)),
                downloaded_bytes: 0,
                skipped_links: 0,
                kept_old: true,
            };
            state
                .profiles
                .update_subscription_result(&uid, None, detail.clone())
                .await
                .map_err(|e| AppError::Internal(e.to_string()))?;
            return Ok(Json(json!({
                "success": false,
                "detail": detail,
            })));
        }
        Err(e) => {
            let detail = SubscriptionUpdateDetail {
                success: false,
                updated_at: chrono::Utc::now().timestamp(),
                attempts: attempted,
                http_status: None,
                error: Some(format!("Failed to download: {:#}", e)),
                downloaded_bytes: 0,
                skipped_links: 0,
                kept_old: false,
            };
            let _ = state
                .profiles
                .update_subscription_result(&uid, None, detail)
                .await;
            return Err(AppError::Internal(format!("Failed to download: {:#}", e)));
        }
    };

    state
        .profiles
        .write_file(&uid, &result.content)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    if state
        .profiles
        .get_active()
        .await
        .is_some_and(|active| active.uid == uid)
    {
        apply_profile_config(&state, &uid).await?;
    }

    let now = chrono::Utc::now().timestamp();
    let info = result.subscription_info.unwrap_or(SubscriptionInfo {
        upload: 0,
        download: 0,
        total: 0,
        expire: None,
    });
    let detail = SubscriptionUpdateDetail {
        success: true,
        updated_at: now,
        attempts: result.attempts,
        http_status: Some(result.http_status),
        error: None,
        downloaded_bytes: result.downloaded_bytes,
        skipped_links: result.skipped_links,
        kept_old: false,
    };

    state
        .profiles
        .update_subscription_result(&uid, Some(info.clone()), detail.clone())
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(json!({
        "success": true,
        "subscription_info": info,
        "detail": detail,
    })))
}

#[derive(Deserialize)]
pub struct ReorderRequest {
    pub uids: Vec<String>,
}

pub async fn reorder_profiles(
    State(state): State<AppState>,
    Json(body): Json<ReorderRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    state
        .profiles
        .reorder(body.uids)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(json!({ "success": true })))
}

pub async fn get_profile_file(
    State(state): State<AppState>,
    Path(uid): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let content = state
        .profiles
        .read_file(&uid)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(json!({ "content": content })))
}

#[derive(Deserialize)]
pub struct SaveFileRequest {
    pub content: String,
}

pub async fn save_profile_file(
    State(state): State<AppState>,
    Path(uid): Path<String>,
    Json(body): Json<SaveFileRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    if body.content.len() > MAX_PROFILE_FILE_SIZE {
        return Err(AppError::BadRequest(
            "Profile file exceeds size limit".into(),
        ));
    }

    state
        .profiles
        .write_file(&uid, &body.content)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(json!({ "success": true })))
}

pub async fn import_profile(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, AppError> {
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        let name = field.name().unwrap_or("").to_string();
        if name == "file" {
            let mut data = Vec::new();
            let mut stream = field;
            while let Some(chunk) = stream
                .try_next()
                .await
                .map_err(|e| AppError::BadRequest(e.to_string()))?
            {
                if data.len().saturating_add(chunk.len()) > MAX_PROFILE_FILE_SIZE {
                    return Err(AppError::BadRequest(
                        "Profile file exceeds size limit".into(),
                    ));
                }
                data.extend_from_slice(&chunk);
            }
            let content = String::from_utf8(data)
                .map_err(|_| AppError::BadRequest("Profile file must be UTF-8".into()))?;
            let uid = uuid::Uuid::new_v4().to_string();
            let file_name = format!("{}.yaml", uid);

            let profile = Profile {
                uid: uid.clone(),
                name: format!("Imported {}", &uid[..8]),
                desc: String::new(),
                profile_type: ProfileType::Local,
                url: None,
                file: file_name,
                selected: vec![],
                updated: Some(chrono::Utc::now().timestamp()),
                extra: None,
                subscription_info: None,
                subscription_update_detail: None,
            };
            let created = state
                .profiles
                .create(profile)
                .await
                .map_err(|e| AppError::BadRequest(e.to_string()))?;
            state
                .profiles
                .write_file(&created.uid, &content)
                .await
                .map_err(|e| AppError::BadRequest(e.to_string()))?;
            return Ok(Json(json!(created)));
        }
    }
    Err(AppError::BadRequest("No file field in upload".into()))
}
