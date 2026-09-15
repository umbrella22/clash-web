pub mod auth;
pub mod backups;
pub mod dns;
pub mod installer;
pub mod mihomo_proxy;
pub mod preferences;
pub mod profiles;
pub mod status;
pub mod system;
pub mod traffic;
pub mod updates;

use axum::Router;
use axum::http::{HeaderValue, Method, header};
use axum::routing::{delete, get, patch, post, put};
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::middleware::auth_middleware;
use crate::state::AppState;

pub fn create_router(state: AppState) -> Router {
    let api_routes = Router::new()
        .route("/auth/status", get(auth::get_auth_status))
        .route("/auth/login", post(auth::login))
        .route("/updates", get(updates::status))
        .route("/updates/check", post(updates::check))
        .route("/updates/settings", put(updates::settings))
        .route("/updates/install", post(updates::install))
        .route("/mihomo/status", get(installer::get_install_status))
        .route(
            "/mihomo/local-packages",
            get(installer::list_local_packages),
        )
        .route(
            "/mihomo/local-packages/install",
            post(installer::install_local_package),
        )
        .route("/mihomo/install", post(installer::install_mihomo))
        .route("/mihomo/check", get(installer::check_version))
        .route("/mihomo/upgrade", post(installer::upgrade_mihomo))
        .route(
            "/mihomo/progress/status",
            get(installer::get_install_progress_status),
        )
        .route("/mihomo/progress", get(installer::install_progress_sse))
        .route("/status", get(status::get_status))
        .route("/start", post(status::start_mihomo))
        .route("/stop", post(status::stop_mihomo))
        .route("/restart", post(status::restart_mihomo))
        .route("/mode", get(status::get_mode))
        .route("/mode", put(status::put_mode))
        .route("/runtime/config", get(status::get_runtime_config))
        .route("/runtime/config", patch(status::patch_runtime_config))
        .route("/runtime/config/yaml", get(status::get_runtime_config_yaml))
        .route("/preferences", get(preferences::get_preferences))
        .route("/preferences", put(preferences::save_preferences))
        .route(
            "/preferences/default",
            post(preferences::restore_default_preferences),
        )
        .route(
            "/proxy/environment",
            get(preferences::get_proxy_environment),
        )
        .route("/dns", get(dns::get_dns_config))
        .route("/dns", put(dns::save_dns_config))
        .route("/dns/validate", post(dns::validate_dns_config))
        .route("/dns/apply", post(dns::apply_dns_config_handler))
        .route("/dns/default", post(dns::restore_default_dns_config))
        .route("/backups", get(backups::list_backups))
        .route("/backups", post(backups::create_backup))
        .route("/backups/{id}/restore", post(backups::restore_backup))
        .route("/backups/{id}", delete(backups::delete_backup))
        .route("/traffic", get(traffic::ws_traffic))
        .route("/memory", get(traffic::ws_memory))
        .route("/logs", get(traffic::ws_logs))
        .route("/connections", get(traffic::get_connections))
        .route("/connections", delete(traffic::close_all_connections))
        .route("/connections/{id}", delete(traffic::close_connection))
        .route("/profiles", get(profiles::list_profiles))
        .route("/profiles", post(profiles::create_profile))
        .route("/profiles/reorder", put(profiles::reorder_profiles))
        .route("/profiles/import", post(profiles::import_profile))
        .route("/profiles/{uid}", get(profiles::get_profile))
        .route("/profiles/{uid}", put(profiles::update_profile))
        .route("/profiles/{uid}", delete(profiles::delete_profile))
        .route("/profiles/{uid}/activate", post(profiles::activate_profile))
        .route(
            "/profiles/{uid}/update",
            post(profiles::update_subscription),
        )
        .route("/profiles/{uid}/file", get(profiles::get_profile_file))
        .route("/profiles/{uid}/file", put(profiles::save_profile_file))
        .route("/proxy", get(mihomo_proxy::proxy_root_get))
        .route("/proxy/", get(mihomo_proxy::proxy_root_get))
        .route("/proxy/{*path}", get(mihomo_proxy::proxy_get))
        .route("/proxy/{*path}", post(mihomo_proxy::proxy_post))
        .route("/proxy/{*path}", patch(mihomo_proxy::proxy_patch))
        .route("/proxy/{*path}", put(mihomo_proxy::proxy_put))
        .route("/proxy/{*path}", delete(mihomo_proxy::proxy_delete))
        .route("/system/proxy", get(system::get_system_proxy))
        .route("/system/proxy", post(system::set_system_proxy))
        .route("/system/tun", get(system::get_tun_mode))
        .route("/system/tun", post(system::set_tun_mode));

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _| {
            is_allowed_origin(origin)
        }))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);

    let static_dir = resolve_static_dir();

    Router::new()
        .nest("/api/v1", api_routes)
        .fallback_service(tower_http::services::ServeDir::new(&static_dir).fallback(
            tower_http::services::ServeFile::new(format!("{}/index.html", static_dir)),
        ))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}

fn resolve_static_dir_from(ui_dir: Option<&str>, dev_dir_exists: bool) -> String {
    if let Some(ui_dir) = ui_dir.filter(|dir| !dir.is_empty()) {
        return ui_dir.to_string();
    }

    if dev_dir_exists {
        "web/dist".to_string()
    } else {
        "/usr/share/clash-web/ui".to_string()
    }
}

fn resolve_static_dir() -> String {
    resolve_static_dir_from(
        std::env::var("CLASH_WEB_UI_DIR").ok().as_deref(),
        std::path::Path::new("web/dist").exists(),
    )
}

fn is_allowed_origin(origin: &HeaderValue) -> bool {
    let Ok(origin) = origin.to_str() else {
        return false;
    };

    matches!(
        origin,
        "http://localhost:5173"
            | "http://127.0.0.1:5173"
            | "http://localhost:9097"
            | "http://127.0.0.1:9097"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_ui_directory_takes_precedence() {
        assert_eq!(
            resolve_static_dir_from(Some(" /tmp/clash-web-ui "), true),
            " /tmp/clash-web-ui "
        );
    }

    #[test]
    fn blank_ui_directory_falls_back_to_development_directory() {
        assert_eq!(resolve_static_dir_from(Some(""), true), "web/dist");
    }

    #[test]
    fn packaged_directory_is_used_when_development_directory_is_missing() {
        assert_eq!(
            resolve_static_dir_from(None, false),
            "/usr/share/clash-web/ui"
        );
    }

    use axum::{
        Json,
        extract::{Path as AxumPath, State},
        response::IntoResponse,
        routing::get as axum_get,
        routing::put as axum_put,
    };
    use clash_web_core::config::{AuthConfig, MihomoConfig, ServerConfig};
    use clash_web_core::profile::{MAX_PROFILE_FILE_SIZE, Profile, ProfileType};
    use serde_json::{Value, json};
    use std::sync::Arc;
    use tokio::net::TcpListener;
    use tokio::sync::Mutex;

    async fn spawn_router(app: Router) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        format!("http://{}", addr)
    }

    async fn fake_mihomo_server(captured: Arc<Mutex<Option<String>>>) -> String {
        async fn version() -> Json<Value> {
            Json(json!({ "version": "Mihomo Meta v1.0.0", "meta": true }))
        }

        async fn proxies() -> Json<Value> {
            Json(json!({
                "proxies": {
                    "GLOBAL": { "type": "Selector", "all": ["DIRECT"], "now": "DIRECT" },
                    "DIRECT": { "type": "Direct" }
                }
            }))
        }

        async fn configs(
            State(captured): State<Arc<Mutex<Option<String>>>>,
            body: String,
        ) -> Json<Value> {
            *captured.lock().await = Some(body);
            Json(json!({ "ok": true }))
        }

        let app = Router::new()
            .route("/version", axum_get(version))
            .route("/proxies", axum_get(proxies))
            .route("/configs", axum_put(configs))
            .with_state(captured);

        spawn_router(app).await
    }

    async fn fake_proxy_workbench_server(captured: Arc<Mutex<Vec<String>>>) -> String {
        async fn version() -> Json<Value> {
            Json(json!({ "version": "Mihomo Meta v1.0.0", "meta": true }))
        }

        async fn proxies() -> Json<Value> {
            Json(json!({
                "proxies": {
                    "GLOBAL": {
                        "type": "Selector",
                        "all": ["HK", "JP"],
                        "now": "HK"
                    },
                    "Auto": {
                        "type": "URLTest",
                        "all": ["HK", "JP"],
                        "now": "HK"
                    },
                    "HK": {
                        "type": "Vmess",
                        "history": [
                            { "time": "2026-05-30T00:00:00Z", "delay": 80 }
                        ]
                    },
                    "JP": {
                        "type": "Shadowsocks",
                        "history": [
                            { "time": "2026-05-30T00:00:00Z", "delay": 120 }
                        ]
                    }
                }
            }))
        }

        async fn select_proxy(
            State(captured): State<Arc<Mutex<Vec<String>>>>,
            AxumPath(name): AxumPath<String>,
            body: String,
        ) -> axum::response::Response {
            captured
                .lock()
                .await
                .push(format!("PUT /proxies/{} {}", name, body));
            if body.contains("Missing") {
                return (
                    axum::http::StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "proxy not found" })),
                )
                    .into_response();
            }
            Json(json!({ "ok": true })).into_response()
        }

        async fn proxy_delay(
            State(captured): State<Arc<Mutex<Vec<String>>>>,
            AxumPath(name): AxumPath<String>,
            req: axum::extract::Request,
        ) -> Json<Value> {
            let query = req
                .uri()
                .query()
                .map(|value| format!("?{}", value))
                .unwrap_or_default();
            captured
                .lock()
                .await
                .push(format!("GET /proxies/{}/delay{}", name, query));
            Json(json!({ "delay": 80 }))
        }

        async fn providers() -> Json<Value> {
            Json(json!({
                "providers": {
                    "airport": {
                        "type": "Proxy",
                        "vehicleType": "HTTP",
                        "proxies": [
                            { "name": "HK", "type": "Vmess" },
                            { "name": "JP", "type": "Shadowsocks" }
                        ],
                        "subscriptionInfo": {
                            "Upload": 1024,
                            "Download": 2048,
                            "Total": 4096,
                            "Expire": 1893456000
                        },
                        "updatedAt": "2026-05-30T00:00:00Z"
                    }
                }
            }))
        }

        async fn update_provider(
            State(captured): State<Arc<Mutex<Vec<String>>>>,
            AxumPath(name): AxumPath<String>,
        ) -> Json<Value> {
            captured
                .lock()
                .await
                .push(format!("PUT /providers/proxies/{}", name));
            Json(json!({ "ok": true }))
        }

        async fn provider_healthcheck(
            State(captured): State<Arc<Mutex<Vec<String>>>>,
            AxumPath(name): AxumPath<String>,
        ) -> Json<Value> {
            captured
                .lock()
                .await
                .push(format!("GET /providers/proxies/{}/healthcheck", name));
            Json(json!({ "ok": true }))
        }

        let app = Router::new()
            .route("/version", axum_get(version))
            .route("/proxies", axum_get(proxies))
            .route("/proxies/{name}", axum_put(select_proxy))
            .route("/proxies/{name}/delay", axum_get(proxy_delay))
            .route("/providers/proxies", axum_get(providers))
            .route("/providers/proxies/{name}", axum_put(update_provider))
            .route(
                "/providers/proxies/{name}/healthcheck",
                axum_get(provider_healthcheck),
            )
            .with_state(captured);

        spawn_router(app).await
    }

    async fn test_state_with_token(api_url: String, config_dir: String, token: &str) -> AppState {
        // reqwest is built with `rustls-no-provider`; main.rs installs the
        // provider at startup, tests must do the same before building clients.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let config = clash_web_core::AppConfig {
            server: ServerConfig {
                host: "127.0.0.1".into(),
                port: 0,
            },
            mihomo: MihomoConfig {
                api_url,
                config_dir,
                secret: String::new(),
            },
            auth: AuthConfig {
                token: token.into(),
            },
            subscription_auto_update_interval: 0,
        };

        AppState::new(config, None).await.unwrap()
    }

    async fn test_state(api_url: String, config_dir: String) -> AppState {
        test_state_with_token(api_url, config_dir, "").await
    }

    #[tokio::test]
    async fn application_update_settings_require_auth_validate_and_survive_restart() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().to_str().unwrap().to_string();
        let state =
            test_state_with_token("http://127.0.0.1:1".into(), path.clone(), "test-token").await;
        let address = spawn_router(create_router(state)).await;
        let client = reqwest::Client::new();
        for (method, route) in [
            (Method::GET, "/updates"),
            (Method::PUT, "/updates/settings"),
            (Method::POST, "/updates/check"),
            (Method::POST, "/updates/install"),
        ] {
            let response = client
                .request(method, format!("{address}/api/v1{route}"))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), reqwest::StatusCode::UNAUTHORIZED);
        }
        let response = client
            .put(format!("{address}/api/v1/updates/settings"))
            .bearer_auth("test-token")
            .json(&json!({"check_interval_hours": 6, "auto_update": false}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        let body: Value = response.json().await.unwrap();
        assert_eq!(body["settings"]["check_interval_hours"], 6);
        assert_eq!(body["current_version"], crate::updater::CURRENT_VERSION);
        for body in [
            json!({"check_interval_hours": 0, "auto_update": true}),
            json!({"check_interval_hours": 721, "auto_update": false}),
        ] {
            let response = client
                .put(format!("{address}/api/v1/updates/settings"))
                .bearer_auth("test-token")
                .json(&body)
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
        }
        let restarted =
            test_state_with_token("http://127.0.0.1:1".into(), path, "test-token").await;
        assert_eq!(
            restarted
                .updater
                .status()
                .await
                .settings
                .check_interval_hours,
            6
        );
        // Development builds must never attempt system package installation.
        let response = client
            .post(format!("{address}/api/v1/updates/install"))
            .bearer_auth("test-token")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn activate_profile_builds_runtime_config_with_merge_profiles() {
        let captured = Arc::new(Mutex::new(None));
        let api_url = fake_mihomo_server(captured.clone()).await;
        let config_dir = std::env::temp_dir()
            .join(format!("clash-web-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        let state = test_state(api_url, config_dir).await;

        let base = state
            .profiles
            .create(Profile {
                uid: String::new(),
                name: "base".into(),
                desc: String::new(),
                profile_type: ProfileType::Local,
                url: None,
                file: String::new(),
                selected: vec![],
                updated: None,
                extra: None,
                subscription_info: None,
                subscription_update_detail: None,
            })
            .await
            .unwrap();
        state
            .profiles
            .write_file(
                &base.uid,
                "proxies: []\nproxy-groups: []\nrules:\n  - MATCH,DIRECT\n",
            )
            .await
            .unwrap();

        let merge = state
            .profiles
            .create(Profile {
                uid: String::new(),
                name: "merge".into(),
                desc: String::new(),
                profile_type: ProfileType::Merge,
                url: None,
                file: String::new(),
                selected: vec![],
                updated: None,
                extra: None,
                subscription_info: None,
                subscription_update_detail: None,
            })
            .await
            .unwrap();
        state
            .profiles
            .write_file(
                &merge.uid,
                "append-rules:\n  - DOMAIN-SUFFIX,example.com,DIRECT\n",
            )
            .await
            .unwrap();

        let app_url = spawn_router(create_router(state.clone())).await;
        let response = reqwest::Client::new()
            .post(format!("{}/api/v1/profiles/{}/activate", app_url, base.uid))
            .send()
            .await
            .unwrap();

        assert!(response.status().is_success());

        let captured_body = captured.lock().await.clone().unwrap();
        let body_json: Value = serde_json::from_str(&captured_body).unwrap();
        let runtime_path = body_json["path"].as_str().unwrap();
        assert!(runtime_path.ends_with("config.yaml"));
        let payload = std::fs::read_to_string(runtime_path).unwrap();
        let payload_yaml: serde_yaml::Value = serde_yaml::from_str(&payload).unwrap();
        let rules = payload_yaml["rules"].as_sequence().unwrap();

        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0].as_str().unwrap(), "MATCH,DIRECT");
        assert_eq!(
            rules[1].as_str().unwrap(),
            "DOMAIN-SUFFIX,example.com,DIRECT"
        );
    }

    #[tokio::test]
    async fn activate_profile_precheck_rejects_unknown_proxy_group_reference() {
        let captured = Arc::new(Mutex::new(None));
        let api_url = fake_mihomo_server(captured.clone()).await;
        let config_dir = std::env::temp_dir()
            .join(format!("clash-web-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        let state = test_state(api_url, config_dir).await;

        let base = state
            .profiles
            .create(Profile {
                uid: String::new(),
                name: "base".into(),
                desc: String::new(),
                profile_type: ProfileType::Local,
                url: None,
                file: String::new(),
                selected: vec![],
                updated: None,
                extra: None,
                subscription_info: None,
                subscription_update_detail: None,
            })
            .await
            .unwrap();
        state
            .profiles
            .write_file(
                &base.uid,
                "proxies: []\nproxy-groups:\n  - name: Auto\n    type: select\n    proxies:\n      - Missing\nrules:\n  - MATCH,DIRECT\n",
            )
            .await
            .unwrap();

        let app_url = spawn_router(create_router(state.clone())).await;
        let response = reqwest::Client::new()
            .post(format!("{}/api/v1/profiles/{}/activate", app_url, base.uid))
            .send()
            .await
            .unwrap();

        assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
        assert!(captured.lock().await.is_none());
    }

    #[tokio::test]
    async fn proxy_root_routes_forward_to_mihomo_proxies() {
        let captured = Arc::new(Mutex::new(None));
        let api_url = fake_mihomo_server(captured).await;
        let config_dir = std::env::temp_dir()
            .join(format!("clash-web-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        let state = test_state(api_url, config_dir).await;
        let app_url = spawn_router(create_router(state)).await;
        let client = reqwest::Client::new();

        let plain = client
            .get(format!("{}/api/v1/proxy", app_url))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        let trailing = client
            .get(format!("{}/api/v1/proxy/", app_url))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();

        assert!(plain.contains("GLOBAL"));
        assert!(trailing.contains("GLOBAL"));
        assert!(!plain.contains("<!doctype html>"));
        assert!(!trailing.contains("<!doctype html>"));
    }

    #[tokio::test]
    async fn proxy_routes_cover_proxy_workbench_flows() {
        let captured = Arc::new(Mutex::new(Vec::new()));
        let api_url = fake_proxy_workbench_server(captured.clone()).await;
        let config_dir = std::env::temp_dir()
            .join(format!("clash-web-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        let state = test_state(api_url, config_dir).await;
        let app_url = spawn_router(create_router(state)).await;
        let client = reqwest::Client::new();

        let proxies = client
            .get(format!("{}/api/v1/proxy", app_url))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap();
        assert_eq!(proxies["proxies"]["GLOBAL"]["type"], "Selector");
        assert_eq!(proxies["proxies"]["GLOBAL"]["now"], "HK");

        let select_resp = client
            .put(format!("{}/api/v1/proxy/proxies/GLOBAL", app_url))
            .json(&json!({ "name": "JP" }))
            .send()
            .await
            .unwrap();
        assert!(select_resp.status().is_success());

        let rejected_select_resp = client
            .put(format!("{}/api/v1/proxy/proxies/GLOBAL", app_url))
            .json(&json!({ "name": "Missing" }))
            .send()
            .await
            .unwrap();
        assert_eq!(
            rejected_select_resp.status(),
            reqwest::StatusCode::BAD_REQUEST
        );
        let rejected_select_body = rejected_select_resp.text().await.unwrap();
        assert!(rejected_select_body.contains("proxy not found"));

        let delay_resp = client
            .get(format!(
                "{}/api/v1/proxy/proxies/HK/delay?timeout=5000&url=https://www.gstatic.com/generate_204",
                app_url
            ))
            .send()
            .await
            .unwrap();
        assert!(delay_resp.status().is_success());

        let providers = client
            .get(format!("{}/api/v1/proxy/providers/proxies", app_url))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap();
        assert_eq!(providers["providers"]["airport"]["vehicleType"], "HTTP");
        assert_eq!(
            providers["providers"]["airport"]["proxies"][0]["name"],
            "HK"
        );

        let update_provider_resp = client
            .put(format!(
                "{}/api/v1/proxy/providers/proxies/airport",
                app_url
            ))
            .send()
            .await
            .unwrap();
        assert!(update_provider_resp.status().is_success());

        let healthcheck_resp = client
            .get(format!(
                "{}/api/v1/proxy/providers/proxies/airport/healthcheck",
                app_url
            ))
            .send()
            .await
            .unwrap();
        assert!(healthcheck_resp.status().is_success());

        let captured = captured.lock().await.clone();
        assert!(captured.contains(&r#"PUT /proxies/GLOBAL {"name":"JP"}"#.to_string()));
        assert!(
            captured
                .iter()
                .any(|entry| entry.starts_with("GET /proxies/HK/delay?timeout=5000&url=")),
            "captured requests: {:?}",
            captured
        );
        assert!(captured.contains(&"PUT /providers/proxies/airport".to_string()));
        assert!(captured.contains(&"GET /providers/proxies/airport/healthcheck".to_string()));
    }

    #[tokio::test]
    async fn proxy_routes_reject_disallowed_paths() {
        let captured = Arc::new(Mutex::new(None));
        let api_url = fake_mihomo_server(captured).await;
        let config_dir = std::env::temp_dir()
            .join(format!("clash-web-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        let state = test_state(api_url, config_dir).await;
        let app_url = spawn_router(create_router(state)).await;

        let response = reqwest::Client::new()
            .get(format!("{}/api/v1/proxy/debug/pprof", app_url))
            .send()
            .await
            .unwrap();

        assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn proxy_routes_reject_oversized_responses() {
        async fn big_response() -> String {
            "x".repeat(2 * 1024 * 1024 + 1)
        }

        let app = Router::new().route("/proxies", axum_get(big_response));
        let api_url = spawn_router(app).await;
        let config_dir = std::env::temp_dir()
            .join(format!("clash-web-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        let state = test_state(api_url, config_dir).await;
        let app_url = spawn_router(create_router(state)).await;

        let response = reqwest::Client::new()
            .get(format!("{}/api/v1/proxy", app_url))
            .send()
            .await
            .unwrap();

        assert_eq!(
            response.status(),
            reqwest::StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[tokio::test]
    async fn auth_routes_report_status_and_validate_login() {
        let captured = Arc::new(Mutex::new(None));
        let api_url = fake_mihomo_server(captured).await;
        let config_dir = std::env::temp_dir()
            .join(format!("clash-web-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        let state = test_state_with_token(api_url, config_dir, "pa ss/+?&=").await;
        let app_url = spawn_router(create_router(state)).await;
        let client = reqwest::Client::new();

        let unauthorized = client
            .get(format!("{}/api/v1/auth/status", app_url))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap();
        assert_eq!(unauthorized["auth_required"], true);
        assert_eq!(unauthorized["authenticated"], false);

        let authorized = client
            .get(format!("{}/api/v1/auth/status", app_url))
            .bearer_auth("pa ss/+?&=")
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap();
        assert_eq!(authorized["auth_required"], true);
        assert_eq!(authorized["authenticated"], true);

        let login_ok = client
            .post(format!("{}/api/v1/auth/login", app_url))
            .json(&json!({ "token": "pa ss/+?&=" }))
            .send()
            .await
            .unwrap();
        assert!(login_ok.status().is_success());

        let login_err = client
            .post(format!("{}/api/v1/auth/login", app_url))
            .json(&json!({ "token": "wrong-token" }))
            .send()
            .await
            .unwrap();
        assert_eq!(login_err.status(), reqwest::StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn encoded_query_token_is_limited_to_stream_routes() {
        let captured = Arc::new(Mutex::new(None));
        let api_url = fake_mihomo_server(captured).await;
        let config_dir = std::env::temp_dir()
            .join(format!("clash-web-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        let state = test_state_with_token(api_url, config_dir, "pa ss/+?&=").await;
        let app_url = spawn_router(create_router(state)).await;
        let encoded: String =
            url::form_urlencoded::byte_serialize("pa ss/+?&=".as_bytes()).collect();

        let client = reqwest::Client::new();

        let normal_response = client
            .get(format!("{}/api/v1/proxy?token={}", app_url, encoded))
            .send()
            .await
            .unwrap();
        assert_eq!(normal_response.status(), reqwest::StatusCode::UNAUTHORIZED);

        let stream_response = client
            .get(format!("{}/api/v1/traffic?token={}", app_url, encoded))
            .send()
            .await
            .unwrap();
        assert_ne!(stream_response.status(), reqwest::StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn cors_allows_local_dev_origins_only() {
        let captured = Arc::new(Mutex::new(None));
        let api_url = fake_mihomo_server(captured).await;
        let config_dir = std::env::temp_dir()
            .join(format!("clash-web-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        let state = test_state(api_url, config_dir).await;
        let app_url = spawn_router(create_router(state)).await;
        let client = reqwest::Client::new();

        let allowed = client
            .request(
                reqwest::Method::OPTIONS,
                format!("{}/api/v1/status", app_url),
            )
            .header("Origin", "http://localhost:5173")
            .header("Access-Control-Request-Method", "GET")
            .send()
            .await
            .unwrap();
        assert_eq!(allowed.status(), reqwest::StatusCode::OK);
        assert_eq!(
            allowed
                .headers()
                .get("access-control-allow-origin")
                .and_then(|value| value.to_str().ok()),
            Some("http://localhost:5173")
        );

        let denied = client
            .request(
                reqwest::Method::OPTIONS,
                format!("{}/api/v1/status", app_url),
            )
            .header("Origin", "http://evil.example")
            .header("Access-Control-Request-Method", "GET")
            .send()
            .await
            .unwrap();
        assert_eq!(denied.status(), reqwest::StatusCode::OK);
        assert!(
            denied
                .headers()
                .get("access-control-allow-origin")
                .is_none()
        );
    }

    #[tokio::test]
    async fn profiles_crud_routes_smoke_test() {
        let captured = Arc::new(Mutex::new(None));
        let api_url = fake_mihomo_server(captured).await;
        let config_dir = std::env::temp_dir()
            .join(format!("clash-web-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        let state = test_state(api_url, config_dir).await;
        let app_url = spawn_router(create_router(state)).await;
        let client = reqwest::Client::new();

        let created = client
            .post(format!("{}/api/v1/profiles", app_url))
            .json(&json!({
                "name": "smoke-profile",
                "type": "local"
            }))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap();
        let uid = created["uid"].as_str().unwrap();

        let listed = client
            .get(format!("{}/api/v1/profiles", app_url))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap();
        assert_eq!(listed["profiles"].as_array().unwrap().len(), 1);

        let original_file = client
            .get(format!("{}/api/v1/profiles/{}/file", app_url, uid))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap();
        assert!(
            original_file["content"]
                .as_str()
                .unwrap()
                .contains("MATCH,DIRECT")
        );

        let updated_content = "proxies: []\nrules:\n  - MATCH,REJECT\n";
        let save_resp = client
            .put(format!("{}/api/v1/profiles/{}/file", app_url, uid))
            .json(&json!({ "content": updated_content }))
            .send()
            .await
            .unwrap();
        assert!(save_resp.status().is_success());

        let updated_file = client
            .get(format!("{}/api/v1/profiles/{}/file", app_url, uid))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap();
        assert_eq!(updated_file["content"].as_str().unwrap(), updated_content);

        let delete_resp = client
            .delete(format!("{}/api/v1/profiles/{}", app_url, uid))
            .send()
            .await
            .unwrap();
        assert!(delete_resp.status().is_success());

        let empty = client
            .get(format!("{}/api/v1/profiles", app_url))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap();
        assert!(empty["profiles"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn create_profile_rejects_path_traversal_file() {
        let captured = Arc::new(Mutex::new(None));
        let api_url = fake_mihomo_server(captured).await;
        let config_dir = std::env::temp_dir()
            .join(format!("clash-web-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        let escaped = std::path::Path::new(&config_dir).join("escaped.yaml");
        let state = test_state(api_url, config_dir).await;
        let app_url = spawn_router(create_router(state)).await;

        let response = reqwest::Client::new()
            .post(format!("{}/api/v1/profiles", app_url))
            .json(&json!({
                "name": "unsafe-profile",
                "type": "local",
                "file": "../escaped.yaml"
            }))
            .send()
            .await
            .unwrap();

        assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
        assert!(!escaped.exists());
    }

    #[tokio::test]
    async fn save_profile_file_rejects_oversized_content() {
        let captured = Arc::new(Mutex::new(None));
        let api_url = fake_mihomo_server(captured).await;
        let config_dir = std::env::temp_dir()
            .join(format!("clash-web-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        let state = test_state(api_url, config_dir).await;
        let app_url = spawn_router(create_router(state)).await;
        let client = reqwest::Client::new();
        let created = client
            .post(format!("{}/api/v1/profiles", app_url))
            .json(&json!({
                "name": "size-profile",
                "type": "local"
            }))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap();
        let uid = created["uid"].as_str().unwrap();

        let response = client
            .put(format!("{}/api/v1/profiles/{}/file", app_url, uid))
            .json(&json!({ "content": "a".repeat(MAX_PROFILE_FILE_SIZE + 1) }))
            .send()
            .await
            .unwrap();

        assert_eq!(response.status(), reqwest::StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[tokio::test]
    async fn subscription_update_rejects_private_target() {
        let captured = Arc::new(Mutex::new(None));
        let api_url = fake_mihomo_server(captured).await;
        let config_dir = std::env::temp_dir()
            .join(format!("clash-web-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        let state = test_state(api_url, config_dir).await;
        let app_url = spawn_router(create_router(state)).await;
        let client = reqwest::Client::new();
        // create_profile eagerly downloads remote profiles (and would already
        // reject the private URL there), so create without a URL first and
        // attach the private URL via update_profile, which does not download.
        let created = client
            .post(format!("{}/api/v1/profiles", app_url))
            .json(&json!({
                "name": "remote-profile",
                "type": "remote"
            }))
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap();
        let uid = created["uid"].as_str().unwrap();

        let response = client
            .put(format!("{}/api/v1/profiles/{}", app_url, uid))
            .json(&json!({ "url": "http://127.0.0.1/sub.yaml" }))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK);

        let response = client
            .post(format!("{}/api/v1/profiles/{}/update", app_url, uid))
            .send()
            .await
            .unwrap();

        assert_eq!(
            response.status(),
            reqwest::StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}
