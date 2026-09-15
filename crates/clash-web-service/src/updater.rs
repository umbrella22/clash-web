pub mod install;

use anyhow::{Context, Result, ensure};
use clash_web_core::app_update::{AppRelease, GitHubReleaseClient, REPOSITORY_URL};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::sync::{Mutex, Notify, RwLock};

pub const CURRENT_VERSION: &str = match option_env!("CLASH_WEB_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct UpdateSettings {
    pub check_interval_hours: u64,
    pub auto_update: bool,
}

impl Default for UpdateSettings {
    fn default() -> Self {
        Self {
            check_interval_hours: 24,
            auto_update: false,
        }
    }
}

impl UpdateSettings {
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.check_interval_hours <= 720,
            "Check interval must be 0 (manual) or 1–720 hours"
        );
        ensure!(
            !self.auto_update || self.check_interval_hours > 0,
            "Automatic updates require a check interval"
        );
        Ok(())
    }

    fn next_check_at(&self, last_checked: Option<i64>, now: i64) -> Option<i64> {
        (self.check_interval_hours > 0).then(|| {
            last_checked.map_or(now, |last| {
                last.saturating_add((self.check_interval_hours * 3600) as i64)
            })
        })
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(default)]
struct SavedUpdates {
    settings: UpdateSettings,
    last_checked_at: Option<i64>,
    latest: Option<AppRelease>,
    check_error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UpdateStatus {
    pub current_version: &'static str,
    pub repository_url: &'static str,
    pub installation_supported: bool,
    pub settings: UpdateSettings,
    pub checking: bool,
    pub last_checked_at: Option<i64>,
    pub next_check_at: Option<i64>,
    pub latest: Option<AppRelease>,
    pub update_available: bool,
    pub package_ready: bool,
    pub check_error: Option<String>,
    pub installation: install::InstallProgress,
}

pub struct AppUpdater {
    path: PathBuf,
    client: GitHubReleaseClient,
    saved: RwLock<SavedUpdates>,
    checking: Mutex<()>,
    installing: Mutex<()>,
    queued_at: RwLock<Option<i64>>,
    changed: Notify,
    installation_supported: bool,
}

impl AppUpdater {
    pub async fn new(config_dir: &str) -> Result<Arc<Self>> {
        let path = Path::new(config_dir).join("app-update.json");
        let saved: SavedUpdates = match tokio::fs::read(&path).await {
            Ok(bytes) => serde_json::from_slice(&bytes).context("Invalid app-update.json")?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => SavedUpdates::default(),
            Err(error) => return Err(error.into()),
        };
        saved.settings.validate()?;
        Ok(Arc::new(Self {
            path,
            client: GitHubReleaseClient::new()?,
            saved: RwLock::new(saved),
            checking: Mutex::new(()),
            installing: Mutex::new(()),
            queued_at: RwLock::new(None),
            changed: Notify::new(),
            installation_supported: install::supported(),
        }))
    }

    pub async fn status(&self) -> UpdateStatus {
        let saved = self.saved.read().await.clone();
        let installation = if self.installation_supported {
            install::progress(*self.queued_at.read().await).await
        } else {
            install::InstallProgress::default()
        };
        UpdateStatus {
            current_version: CURRENT_VERSION,
            repository_url: REPOSITORY_URL,
            installation_supported: self.installation_supported,
            checking: self.checking.try_lock().is_err(),
            next_check_at: saved.settings.next_check_at(saved.last_checked_at, now()),
            update_available: saved
                .latest
                .as_ref()
                .is_some_and(|release| release.is_newer_than(CURRENT_VERSION).unwrap_or(false)),
            package_ready: saved.latest.as_ref().is_some_and(AppRelease::installable),
            settings: saved.settings,
            last_checked_at: saved.last_checked_at,
            latest: saved.latest,
            check_error: saved.check_error,
            installation,
        }
    }

    pub async fn save_settings(&self, settings: UpdateSettings) -> Result<()> {
        settings.validate()?;
        ensure!(
            !settings.auto_update || self.installation_supported,
            "Automatic installation requires the Linux deb package and systemd update service"
        );
        let mut saved = self.saved.write().await;
        let updated = SavedUpdates {
            settings,
            ..saved.clone()
        };
        write_json(&self.path, &updated).await?;
        *saved = updated;
        self.changed.notify_one();
        Ok(())
    }

    pub async fn check(&self) -> Result<()> {
        let _checking = match self.checking.try_lock() {
            Ok(guard) => guard,
            Err(_) => {
                // Share the in-flight result instead of issuing another request.
                let _completed = self.checking.lock().await;
                return Ok(());
            }
        };
        let result = self.client.latest().await;
        let auto_update = {
            let mut saved = self.saved.write().await;
            saved.last_checked_at = Some(now());
            match &result {
                Ok(release) => {
                    saved.latest = release.clone();
                    saved.check_error = None;
                }
                Err(error) => saved.check_error = Some(format!("{error:#}")),
            }
            // Advance the in-memory attempt time even if persistence fails,
            // so an unwritable disk cannot cause a tight GitHub retry loop.
            write_json(&self.path, &*saved).await?;
            saved.settings.auto_update
        };
        self.changed.notify_one();
        let release = result?;
        if auto_update
            && release.as_ref().is_some_and(|release| {
                release.installable() && release.is_newer_than(CURRENT_VERSION).unwrap_or(false)
            })
            && let Err(error) = self.request_install().await
        {
            let mut saved = self.saved.write().await;
            saved.check_error = Some(format!("Could not start automatic update: {error:#}"));
            write_json(&self.path, &*saved).await?;
            return Err(error);
        }
        Ok(())
    }

    pub async fn request_install(&self) -> Result<()> {
        let _installing = self
            .installing
            .try_lock()
            .context("An update request is already in progress")?;
        ensure!(
            self.installation_supported,
            "Installation requires the Linux deb package and systemd update service"
        );
        let status = self.status().await;
        ensure!(
            !status.installation.active(),
            "An update is already running"
        );
        ensure!(
            status.update_available && status.package_ready,
            "Check for an installable newer release first"
        );
        *self.queued_at.write().await = Some(now());
        if let Err(error) = install::start().await {
            *self.queued_at.write().await = None;
            return Err(error);
        }
        Ok(())
    }

    pub fn start_scheduler(self: &Arc<Self>) -> tokio::task::JoinHandle<()> {
        let updater = self.clone();
        tokio::spawn(async move {
            loop {
                let next = {
                    let saved = updater.saved.read().await;
                    saved.settings.next_check_at(saved.last_checked_at, now())
                };
                if let Some(next) = next {
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_secs(next.saturating_sub(now()).max(0) as u64)) => {},
                        _ = updater.changed.notified() => continue,
                    }
                    if let Err(error) = updater.check().await {
                        tracing::warn!(%error, "Clash Web update check failed");
                    }
                } else {
                    updater.changed.notified().await;
                }
            }
        })
    }
}

pub fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

pub async fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let parent = path.parent().context("Missing update state directory")?;
    tokio::fs::create_dir_all(parent).await?;
    let temporary = parent.join(format!(".update-{}.tmp", uuid::Uuid::new_v4()));
    let result = async {
        use tokio::io::AsyncWriteExt;
        let mut file = tokio::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .await?;
        file.write_all(&serde_json::to_vec_pretty(value)?).await?;
        file.sync_all().await?;
        tokio::fs::rename(&temporary, path).await?;
        Ok::<_, anyhow::Error>(())
    }
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scheduled_checks_respect_disabled_mode_and_interval_changes() {
        let mut settings = UpdateSettings::default();
        assert_eq!(settings.next_check_at(None, 100), Some(100));
        assert_eq!(settings.next_check_at(Some(100), 200), Some(86_500));
        settings.check_interval_hours = 2;
        assert_eq!(settings.next_check_at(Some(100), 200), Some(7_300));
        settings.check_interval_hours = 0;
        assert_eq!(settings.next_check_at(Some(100), 200), None);
        settings.auto_update = true;
        assert!(settings.validate().is_err());
        settings.check_interval_hours = 721;
        assert!(settings.validate().is_err());
        settings.check_interval_hours = 720;
        assert!(settings.validate().is_ok());
    }

    #[tokio::test]
    async fn persists_settings_across_restart_and_does_not_overwrite_on_validation_failure() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().to_str().unwrap();
        let updater = AppUpdater::new(path).await.unwrap();
        updater
            .save_settings(UpdateSettings {
                check_interval_hours: 6,
                auto_update: false,
            })
            .await
            .unwrap();
        let reloaded = AppUpdater::new(path).await.unwrap();
        assert_eq!(reloaded.status().await.settings.check_interval_hours, 6);
        assert!(
            reloaded
                .save_settings(UpdateSettings {
                    check_interval_hours: 0,
                    auto_update: true
                })
                .await
                .is_err()
        );
        assert_eq!(
            AppUpdater::new(path)
                .await
                .unwrap()
                .status()
                .await
                .settings
                .check_interval_hours,
            6
        );
        let entries = std::fs::read_dir(directory.path()).unwrap().count();
        assert_eq!(entries, 1, "atomic writes must not leave staging files");
    }

    #[tokio::test]
    async fn disabled_scheduler_does_not_call_github() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let directory = tempfile::tempdir().unwrap();
        let updater = AppUpdater::new(directory.path().to_str().unwrap())
            .await
            .unwrap();
        updater
            .save_settings(UpdateSettings {
                check_interval_hours: 0,
                auto_update: false,
            })
            .await
            .unwrap();
        let task = updater.start_scheduler();
        tokio::task::yield_now().await;
        assert!(updater.status().await.last_checked_at.is_none());
        assert!(updater.status().await.next_check_at.is_none());
        task.abort();
    }
}
