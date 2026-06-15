use axum::{
    Json,
    extract::State,
    response::sse::{Event, Sse},
};
use clash_web_core::installer::{
    DownloadTaskStart, DownloadTaskType, InstallTaskError, MihomoInstaller,
};
use clash_web_utils::AppError;
use futures_util::stream::Stream;
use serde_json::json;
use std::convert::Infallible;
use std::time::Duration;

use crate::state::AppState;

const MAX_SSE_IDLE_SECS: u64 = 300;

pub async fn get_install_status(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let info = state.installer.detect();
    let latest = MihomoInstaller::get_latest_version().await.ok();
    Ok(Json(json!({
        "installed": info.installed,
        "path": info.path,
        "version": info.version,
        "arch": info.arch,
        "download_url": state.installer.download_url(),
        "latest_version": latest,
    })))
}

pub async fn install_mihomo(
    State(state): State<AppState>,
) -> Result<Json<DownloadTaskStart>, AppError> {
    let started = state
        .installer
        .clone()
        .start_download(DownloadTaskType::Install)
        .await
        .map_err(map_install_error)?;
    Ok(Json(started))
}

pub async fn check_version(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let info = state.installer.check_version_async().await;
    Ok(Json(json!({
        "installed": info.installed,
        "current_version": info.current,
        "latest_version": info.latest,
        "has_update": info.has_update,
        "download_url": info.download_url,
        "arch": info.arch,
    })))
}

pub async fn upgrade_mihomo(
    State(state): State<AppState>,
) -> Result<Json<DownloadTaskStart>, AppError> {
    let started = state
        .installer
        .clone()
        .start_download(DownloadTaskType::Upgrade)
        .await
        .map_err(map_install_error)?;
    Ok(Json(started))
}

pub async fn install_progress_sse(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let mut rx = state.installer.subscribe_progress();

    let stream = async_stream::stream! {
        let initial = rx.borrow().clone();
        if initial.status != "idle" || initial.active {
            let data = serde_json::to_string(&initial).unwrap_or_default();
            yield Ok(Event::default().data(data));
            if !initial.active {
                return;
            }
        }

        let idle_limit = tokio::time::sleep(Duration::from_secs(MAX_SSE_IDLE_SECS));
        tokio::pin!(idle_limit);

        loop {
            tokio::select! {
                changed = rx.changed() => match changed {
                Ok(()) => {
                    let progress = rx.borrow().clone();
                    let data = serde_json::to_string(&progress).unwrap_or_default();
                    yield Ok(Event::default().data(data));
                    if !progress.active {
                        break;
                    }
                }
                Err(_) => break,
                },
                _ = &mut idle_limit => break,
            }
        }
    };

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(5))
            .text("ping"),
    )
}

pub async fn get_install_progress_status(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let progress = state.installer.current_progress();
    Ok(Json(json!(progress)))
}

fn map_install_error(err: InstallTaskError) -> AppError {
    match err {
        InstallTaskError::AlreadyRunning(progress) => AppError::BadRequest(format!(
            "Mihomo download task is already running{}",
            progress
                .task_type
                .as_deref()
                .map(|task_type| format!(" ({task_type})"))
                .unwrap_or_default()
        )),
        InstallTaskError::Failed(err) => {
            AppError::Internal(format!("Failed to process mihomo download: {}", err))
        }
    }
}
