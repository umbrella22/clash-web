use axum::{Json, extract::Path, extract::State};
use clash_web_utils::AppError;
use serde::Deserialize;
use serde_json::json;

use crate::state::AppState;

#[derive(Deserialize)]
pub struct CreateBackupRequest {
    #[serde(default)]
    pub name: Option<String>,
}

pub async fn list_backups(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let backups = state
        .backups
        .list()
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(json!({ "backups": backups })))
}

pub async fn create_backup(
    State(state): State<AppState>,
    Json(body): Json<CreateBackupRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let backup = state
        .backups
        .create(body.name)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(json!(backup)))
}

pub async fn restore_backup(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let result = state
        .backups
        .restore(&id)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(json!(result)))
}

pub async fn delete_backup(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    state
        .backups
        .delete(&id)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(json!({ "success": true })))
}
