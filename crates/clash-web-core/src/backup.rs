use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum BackupKind {
    #[serde(rename = "manual")]
    Manual,
    #[serde(rename = "safety_snapshot")]
    SafetySnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupMetadata {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub size: u64,
    pub restorable: bool,
    pub kind: BackupKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RestoreBackupResult {
    pub restored: BackupMetadata,
    pub safety_snapshot: BackupMetadata,
}

pub struct BackupManager {
    config_dir: PathBuf,
    service_config_path: Option<PathBuf>,
}

impl BackupManager {
    pub async fn new(
        config_dir: impl AsRef<Path>,
        service_config_path: Option<impl AsRef<Path>>,
    ) -> anyhow::Result<Arc<Self>> {
        let manager = Arc::new(Self {
            config_dir: config_dir.as_ref().to_path_buf(),
            service_config_path: service_config_path.map(|path| path.as_ref().to_path_buf()),
        });
        std::fs::create_dir_all(manager.backups_dir())?;
        Ok(manager)
    }

    pub async fn create(&self, name: Option<String>) -> anyhow::Result<BackupMetadata> {
        self.create_with_kind(name, BackupKind::Manual).await
    }

    pub async fn list(&self) -> anyhow::Result<Vec<BackupMetadata>> {
        std::fs::create_dir_all(self.backups_dir())?;
        let mut backups = Vec::new();

        for entry in std::fs::read_dir(self.backups_dir())? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }

            let metadata_path = entry.path().join("metadata.json");
            if !metadata_path.exists() {
                continue;
            }

            let content = std::fs::read_to_string(metadata_path)?;
            let mut metadata: BackupMetadata = serde_json::from_str(&content)?;
            metadata.size = dir_size(&entry.path())?;
            metadata.restorable = self.is_restorable(&entry.path());
            backups.push(metadata);
        }

        backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(backups)
    }

    pub async fn delete(&self, id: &str) -> anyhow::Result<()> {
        let backup_dir = self.backup_dir(id)?;
        if !backup_dir.exists() {
            anyhow::bail!("Backup not found: {}", id);
        }

        std::fs::remove_dir_all(backup_dir)?;
        Ok(())
    }

    pub async fn restore(&self, id: &str) -> anyhow::Result<RestoreBackupResult> {
        let backup_dir = self.backup_dir(id)?;
        if !backup_dir.exists() {
            anyhow::bail!("Backup not found: {}", id);
        }
        if !self.is_restorable(&backup_dir) {
            anyhow::bail!("Backup is not restorable: {}", id);
        }

        let restored = self.read_metadata(&backup_dir)?;
        let safety_snapshot = self
            .create_with_kind(
                Some(format!("Safety snapshot before restoring {}", id)),
                BackupKind::SafetySnapshot,
            )
            .await?;

        self.restore_files(&backup_dir)?;

        Ok(RestoreBackupResult {
            restored,
            safety_snapshot,
        })
    }

    fn backups_dir(&self) -> PathBuf {
        self.config_dir.join("backups")
    }

    fn backup_dir(&self, id: &str) -> anyhow::Result<PathBuf> {
        let path = Path::new(id);
        let is_safe = !id.is_empty()
            && !path.is_absolute()
            && path
                .components()
                .all(|component| matches!(component, Component::Normal(_)));

        if !is_safe {
            anyhow::bail!("Invalid backup id");
        }

        Ok(self.backups_dir().join(path))
    }

    async fn create_with_kind(
        &self,
        name: Option<String>,
        kind: BackupKind,
    ) -> anyhow::Result<BackupMetadata> {
        std::fs::create_dir_all(self.backups_dir())?;
        let created_at = chrono::Utc::now().timestamp();
        let id = self.next_backup_id(&kind);
        let backup_dir = self.backup_dir(&id)?;

        std::fs::create_dir(&backup_dir)?;
        self.copy_current_files(&backup_dir)?;

        let mut metadata = BackupMetadata {
            id,
            name: name.unwrap_or_else(|| "Manual backup".to_string()),
            created_at,
            size: dir_size(&backup_dir)?,
            restorable: self.is_restorable(&backup_dir),
            kind,
        };
        self.write_metadata(&backup_dir, &metadata)?;
        metadata.size = dir_size(&backup_dir)?;
        metadata.restorable = self.is_restorable(&backup_dir);
        self.write_metadata(&backup_dir, &metadata)?;

        Ok(metadata)
    }

    fn next_backup_id(&self, kind: &BackupKind) -> String {
        let prefix = match kind {
            BackupKind::Manual => "backup",
            BackupKind::SafetySnapshot => "snapshot",
        };
        let timestamp = chrono::Utc::now().format("%Y%m%d%H%M%S");
        format!("{}-{}-{}", prefix, timestamp, uuid::Uuid::new_v4())
    }

    fn copy_current_files(&self, backup_dir: &Path) -> anyhow::Result<()> {
        if let Some(service_config_path) = &self.service_config_path {
            if service_config_path.exists() {
                std::fs::copy(service_config_path, backup_dir.join("service.yaml"))?;
            }
        }

        copy_file_if_exists(
            self.config_dir.join("profiles.json"),
            backup_dir.join("profiles.json"),
        )?;
        copy_file_if_exists(
            self.config_dir.join("dns.yaml"),
            backup_dir.join("dns.yaml"),
        )?;
        copy_dir_if_exists(
            self.config_dir.join("profiles"),
            backup_dir.join("profiles"),
        )?;
        Ok(())
    }

    fn restore_files(&self, backup_dir: &Path) -> anyhow::Result<()> {
        if let Some(service_config_path) = &self.service_config_path {
            let source = backup_dir.join("service.yaml");
            if source.exists() {
                if let Some(parent) = service_config_path.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::copy(source, service_config_path)?;
            }
        }

        copy_file_if_exists(
            backup_dir.join("profiles.json"),
            self.config_dir.join("profiles.json"),
        )?;
        copy_file_if_exists(
            backup_dir.join("dns.yaml"),
            self.config_dir.join("dns.yaml"),
        )?;

        let source_profiles = backup_dir.join("profiles");
        let target_profiles = self.config_dir.join("profiles");
        if source_profiles.exists() {
            if target_profiles.exists() {
                std::fs::remove_dir_all(&target_profiles)?;
            }
            copy_dir(&source_profiles, &target_profiles)?;
        }

        Ok(())
    }

    fn read_metadata(&self, backup_dir: &Path) -> anyhow::Result<BackupMetadata> {
        let content = std::fs::read_to_string(backup_dir.join("metadata.json"))?;
        let mut metadata: BackupMetadata = serde_json::from_str(&content)?;
        metadata.size = dir_size(backup_dir)?;
        metadata.restorable = self.is_restorable(backup_dir);
        Ok(metadata)
    }

    fn write_metadata(&self, backup_dir: &Path, metadata: &BackupMetadata) -> anyhow::Result<()> {
        let content = serde_json::to_string_pretty(metadata)?;
        std::fs::write(backup_dir.join("metadata.json"), content)?;
        Ok(())
    }

    fn is_restorable(&self, backup_dir: &Path) -> bool {
        let has_service_config =
            self.service_config_path.is_none() || backup_dir.join("service.yaml").is_file();
        has_service_config
            && backup_dir.join("metadata.json").is_file()
            && backup_dir.join("profiles.json").is_file()
            && backup_dir.join("dns.yaml").is_file()
            && backup_dir.join("profiles").is_dir()
    }
}

fn copy_file_if_exists(source: impl AsRef<Path>, target: impl AsRef<Path>) -> anyhow::Result<()> {
    let source = source.as_ref();
    if !source.exists() {
        return Ok(());
    }

    if let Some(parent) = target.as_ref().parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(source, target)?;
    Ok(())
}

fn copy_dir_if_exists(source: impl AsRef<Path>, target: impl AsRef<Path>) -> anyhow::Result<()> {
    let source = source.as_ref();
    if !source.exists() {
        return Ok(());
    }

    copy_dir(source, target.as_ref())
}

fn copy_dir(source: &Path, target: &Path) -> anyhow::Result<()> {
    std::fs::create_dir_all(target)?;

    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());

        if entry.file_type()?.is_dir() {
            copy_dir(&source_path, &target_path)?;
        } else {
            std::fs::copy(source_path, target_path)?;
        }
    }

    Ok(())
}

fn dir_size(path: &Path) -> anyhow::Result<u64> {
    let mut size = 0;

    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            size += dir_size(&entry.path())?;
        } else {
            size += metadata.len();
        }
    }

    Ok(size)
}

#[cfg(test)]
mod tests {
    use super::{BackupKind, BackupManager};
    use std::path::{Path, PathBuf};

    #[tokio::test]
    async fn creates_lists_and_deletes_backup() {
        let (config_dir, service_config_path) = seed_config_dir();
        let manager = BackupManager::new(&config_dir, Some(&service_config_path))
            .await
            .unwrap();

        let backup = manager
            .create(Some("test backup".to_string()))
            .await
            .unwrap();
        let backups = manager.list().await.unwrap();

        assert_eq!(backup.name, "test backup");
        assert_eq!(backup.kind, BackupKind::Manual);
        assert!(backup.restorable);
        assert!(backup.size > 0);
        assert_eq!(backups.len(), 1);

        manager.delete(&backup.id).await.unwrap();

        assert!(manager.list().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn restores_backup_after_creating_safety_snapshot() {
        let (config_dir, service_config_path) = seed_config_dir();
        let manager = BackupManager::new(&config_dir, Some(&service_config_path))
            .await
            .unwrap();
        let backup = manager.create(None).await.unwrap();

        std::fs::write(
            config_dir.join("profiles.json"),
            r#"{"profiles":[],"active":null}"#,
        )
        .unwrap();
        std::fs::write(config_dir.join("dns.yaml"), "enable: false\n").unwrap();
        std::fs::write(
            config_dir.join("profiles").join("local.yaml"),
            "rules: []\n",
        )
        .unwrap();
        std::fs::write(&service_config_path, "server:\n  port: 1\n").unwrap();

        let result = manager.restore(&backup.id).await.unwrap();

        assert_eq!(result.restored.id, backup.id);
        assert_eq!(result.safety_snapshot.kind, BackupKind::SafetySnapshot);
        assert_eq!(
            std::fs::read_to_string(config_dir.join("profiles.json")).unwrap(),
            "profiles: seed\n"
        );
        assert_eq!(
            std::fs::read_to_string(config_dir.join("dns.yaml")).unwrap(),
            "enable: true\n"
        );
        assert_eq!(
            std::fs::read_to_string(config_dir.join("profiles").join("local.yaml")).unwrap(),
            "proxies: []\n"
        );
        assert_eq!(
            std::fs::read_to_string(service_config_path).unwrap(),
            "server:\n  port: 9097\n"
        );
        assert_eq!(manager.list().await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn rejects_backup_id_path_traversal() {
        let (config_dir, service_config_path) = seed_config_dir();
        let manager = BackupManager::new(&config_dir, Some(&service_config_path))
            .await
            .unwrap();

        let result = manager.delete("../escape").await;

        assert!(result.is_err());
        assert!(!Path::new("../escape").exists());
    }

    fn seed_config_dir() -> (PathBuf, PathBuf) {
        let root =
            std::env::temp_dir().join(format!("clash-web-backup-test-{}", uuid::Uuid::new_v4()));
        let config_dir = root.join("config");
        let profiles_dir = config_dir.join("profiles");
        let service_config_path = root.join("service.yaml");

        std::fs::create_dir_all(&profiles_dir).unwrap();
        std::fs::write(config_dir.join("profiles.json"), "profiles: seed\n").unwrap();
        std::fs::write(config_dir.join("dns.yaml"), "enable: true\n").unwrap();
        std::fs::write(profiles_dir.join("local.yaml"), "proxies: []\n").unwrap();
        std::fs::write(&service_config_path, "server:\n  port: 9097\n").unwrap();

        (config_dir, service_config_path)
    }
}
