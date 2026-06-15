use axum::{
    Json,
    extract::{Request, State},
};
use clash_web_utils::AppError;
use serde::Deserialize;
use serde_json::json;

use crate::{middleware::extract_request_token, state::AppState};

pub async fn get_auth_status(
    State(state): State<AppState>,
    req: Request,
) -> Result<Json<serde_json::Value>, AppError> {
    let expected = state.config.auth.token.as_str();
    let auth_required = !expected.is_empty();
    let authenticated = if auth_required {
        extract_request_token(&req).as_deref() == Some(expected)
    } else {
        true
    };

    Ok(Json(json!({
        "auth_required": auth_required,
        "authenticated": authenticated,
    })))
}

#[derive(Deserialize)]
pub struct LoginRequest {
    #[serde(default)]
    pub token: String,
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let expected = state.config.auth.token.as_str();

    if expected.is_empty() {
        return Ok(Json(json!({
            "auth_required": false,
            "authenticated": true,
        })));
    }

    if body.token == expected {
        return Ok(Json(json!({
            "auth_required": true,
            "authenticated": true,
        })));
    }

    Err(AppError::Unauthorized)
}
