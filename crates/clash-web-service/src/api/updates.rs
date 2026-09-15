use axum::{Json, extract::State};
use clash_web_utils::AppError;

use crate::{
    state::AppState,
    updater::{UpdateSettings, UpdateStatus},
};

pub async fn status(State(state): State<AppState>) -> Json<UpdateStatus> {
    Json(state.updater.status().await)
}

pub async fn check(State(state): State<AppState>) -> Json<UpdateStatus> {
    if let Err(error) = state.updater.check().await {
        tracing::warn!(%error, "Manual application update check failed");
    }
    Json(state.updater.status().await)
}

pub async fn settings(
    State(state): State<AppState>,
    Json(settings): Json<UpdateSettings>,
) -> Result<Json<UpdateStatus>, AppError> {
    state
        .updater
        .save_settings(settings)
        .await
        .map_err(|error| AppError::BadRequest(error.to_string()))?;
    Ok(Json(state.updater.status().await))
}

pub async fn install(State(state): State<AppState>) -> Result<Json<UpdateStatus>, AppError> {
    state
        .updater
        .request_install()
        .await
        .map_err(|error| AppError::BadRequest(error.to_string()))?;
    Ok(Json(state.updater.status().await))
}
