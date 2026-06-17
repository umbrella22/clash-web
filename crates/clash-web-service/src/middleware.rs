use axum::{extract::Request, http::StatusCode, middleware::Next, response::Response};
use url::form_urlencoded;

use crate::state::AppState;

const QUERY_TOKEN_COMPAT_PATHS: &[&str] = &[
    "/api/v1/traffic",
    "/api/v1/memory",
    "/api/v1/logs",
    "/api/v1/mihomo/progress",
];

fn query_token(req: &Request) -> Option<String> {
    let query = req.uri().query()?;
    form_urlencoded::parse(query.as_bytes()).find_map(|(key, value)| {
        if key == "token" {
            Some(value.into_owned())
        } else {
            None
        }
    })
}

fn header_token(req: &Request) -> Option<String> {
    req.headers()
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|val| val.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(ToOwned::to_owned)
}

pub fn extract_request_token(req: &Request) -> Option<String> {
    header_token(req).or_else(|| {
        if allows_query_token(req.uri().path()) {
            query_token(req)
        } else {
            None
        }
    })
}

fn allows_query_token(path: &str) -> bool {
    QUERY_TOKEN_COMPAT_PATHS.contains(&path)
}

pub async fn auth_middleware(
    axum::extract::State(state): axum::extract::State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    if state.config.auth.token.is_empty() {
        return Ok(next.run(req).await);
    }

    let path = req.uri().path();
    if !path.starts_with("/api/v1") {
        return Ok(next.run(req).await);
    }

    if path.starts_with("/api/v1/auth") {
        return Ok(next.run(req).await);
    }

    let token = extract_request_token(&req);

    match token {
        Some(token) if token == state.config.auth.token.as_str() => Ok(next.run(req).await),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}
