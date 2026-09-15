use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

const MAX_BACKUPS: usize = 20;
const MAX_BACKUP_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
const MAX_BACKUP_SOURCE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_BACKUP_FILES: u64 = 5000;
const MAX_BACKUP_DEPTH: u32 = 16;

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
        let backups_dir = self.backups_dir();
        let service_config_path = self.service_config_path.clone();
        tokio::task::spawn_blocking(move || list_backups_blocking(backups_dir, service_config_path))
            .await?
    }

    pub async fn delete(&self, id: &str) -> anyhow::Result<()> {
        let backup_dir = self.backup_dir(id)?;
        if !backup_dir.exists() {
            anyhow::bail!("Backup not found: {}", id);
        }

        tokio::task::spawn_blocking(move || std::fs::remove_dir_all(backup_dir)).await??;
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

        let restored_backup_dir = backup_dir.clone();
        let service_config_path = self.service_config_path.clone();
        let restored = tokio::task::spawn_blocking(move || {
            read_metadata_blocking(&restored_backup_dir, service_config_path)
        })
        .await??;
        let safety_snapshot = self
            .create_with_kind(
                Some(format!("Safety snapshot before restoring {}", id)),
                BackupKind::SafetySnapshot,
            )
            .await?;

        let config_dir = self.config_dir.clone();
        let service_config_path = self.service_config_path.clone();
        tokio::task::spawn_blocking(move || {
            restore_files_blocking(&backup_dir, &config_dir, service_config_path)
        })
        .await??;

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
        self.enforce_retention().await?;
        let created_at = chrono::Utc::now().timestamp();
        let id = self.next_backup_id(&kind);
        let backup_dir = self.backup_dir(&id)?;
        let config_dir = self.config_dir.clone();
        let service_config_path = self.service_config_path.clone();
        let backup_name = name.unwrap_or_else(|| "Manual backup".to_string());

        tokio::task::spawn_blocking(move || {
            create_backup_blocking(
                config_dir,
                service_config_path,
                backup_dir,
                id,
                backup_name,
                created_at,
                kind,
            )
        })
        .await?
    }

    async fn enforce_retention(&self) -> anyhow::Result<()> {
        let backups_dir = self.backups_dir();
        let service_config_path = self.service_config_path.clone();
        tokio::task::spawn_blocking(move || {
            enforce_retention_blocking(backups_dir, service_config_path)
        })
        .await??;
        Ok(())
    }

    fn next_backup_id(&self, kind: &BackupKind) -> String {
        let prefix = match kind {
            BackupKind::Manual => "backup",
            BackupKind::SafetySnapshot => "snapshot",
        };
        let timestamp = chrono::Utc::now().format("%Y%m%d%H%M%S");
        format!("{}-{}-{}", prefix, timestamp, uuid::Uuid::new_v4())
    }

    fn is_restorable(&self, backup_dir: &Path) -> bool {
        is_restorable_blocking(backup_dir, self.service_config_path.as_ref())
    }
}

fn list_backups_blocking(
    backups_dir: PathBuf,
    service_config_path: Option<PathBuf>,
) -> anyhow::Result<Vec<BackupMetadata>> {
    std::fs::create_dir_all(&backups_dir)?;
    let mut backups = Vec::new();

    for entry in std::fs::read_dir(&backups_dir)? {
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
        metadata.size = dir_size_limited(&entry.path())?.bytes;
        metadata.restorable = is_restorable_blocking(&entry.path(), service_config_path.as_ref());
        backups.push(metadata);
    }

    backups.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(backups)
}

fn enforce_retention_blocking(
    backups_dir: PathBuf,
    service_config_path: Option<PathBuf>,
) -> anyhow::Result<()> {
    let mut backups = list_backups_blocking(backups_dir.clone(), service_config_path)?;
    while backups.len() >= MAX_BACKUPS {
        if let Some(oldest) = backups.pop() {
            std::fs::remove_dir_all(backups_dir.join(oldest.id))?;
        }
    }

    let mut total: u64 = backups.iter().map(|backup| backup.size).sum();
    while total > MAX_BACKUP_TOTAL_BYTES {
        if let Some(oldest) = backups.pop() {
            total = total.saturating_sub(oldest.size);
            std::fs::remove_dir_all(backups_dir.join(oldest.id))?;
        } else {
            break;
        }
    }

    Ok(())
}

fn create_backup_blocking(
    config_dir: PathBuf,
    service_config_path: Option<PathBuf>,
    backup_dir: PathBuf,
    id: String,
    name: String,
    created_at: i64,
    kind: BackupKind,
) -> anyhow::Result<BackupMetadata> {
    validate_backup_source(&config_dir, service_config_path.as_ref())?;
    let backups_dir = config_dir.join("backups");
    std::fs::create_dir_all(backups_dir)?;
    std::fs::create_dir(&backup_dir)?;
    copy_current_files_blocking(&config_dir, service_config_path.as_ref(), &backup_dir)?;

    let mut metadata = BackupMetadata {
        id,
        name,
        created_at,
        size: dir_size_limited(&backup_dir)?.bytes,
        restorable: is_restorable_blocking(&backup_dir, service_config_path.as_ref()),
        kind,
    };
    write_metadata_blocking(&backup_dir, &metadata)?;
    metadata.size = dir_size_limited(&backup_dir)?.bytes;
    metadata.restorable = is_restorable_blocking(&backup_dir, service_config_path.as_ref());
    write_metadata_blocking(&backup_dir, &metadata)?;

    Ok(metadata)
}

fn copy_current_files_blocking(
    config_dir: &Path,
    service_config_path: Option<&PathBuf>,
    backup_dir: &Path,
) -> anyhow::Result<()> {
    if let Some(service_config_path) = service_config_path {
        if service_config_path.exists() {
            std::fs::copy(service_config_path, backup_dir.join("service.yaml"))?;
        }
    }

    copy_file_if_exists(
        config_dir.join("profiles.json"),
        backup_dir.join("profiles.json"),
    )?;
    copy_file_if_exists(config_dir.join("dns.yaml"), backup_dir.join("dns.yaml"))?;
    copy_dir_if_exists(config_dir.join("profiles"), backup_dir.join("profiles"))?;
    Ok(())
}

fn restore_files_blocking(
    backup_dir: &Path,
    config_dir: &Path,
    service_config_path: Option<PathBuf>,
) -> anyhow::Result<()> {
    if let Some(service_config_path) = service_config_path {
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
        config_dir.join("profiles.json"),
    )?;
    copy_file_if_exists(backup_dir.join("dns.yaml"), config_dir.join("dns.yaml"))?;

    let source_profiles = backup_dir.join("profiles");
    let target_profiles = config_dir.join("profiles");
    if source_profiles.exists() {
        validate_dir_limits(&source_profiles)?;
        if target_profiles.exists() {
            std::fs::remove_dir_all(&target_profiles)?;
        }
        copy_dir(&source_profiles, &target_profiles)?;
    }

    Ok(())
}

fn read_metadata_blocking(
    backup_dir: &Path,
    service_config_path: Option<PathBuf>,
) -> anyhow::Result<BackupMetadata> {
    let content = std::fs::read_to_string(backup_dir.join("metadata.json"))?;
    let mut metadata: BackupMetadata = serde_json::from_str(&content)?;
    metadata.size = dir_size_limited(backup_dir)?.bytes;
    metadata.restorable = is_restorable_blocking(backup_dir, service_config_path.as_ref());
    Ok(metadata)
}

fn write_metadata_blocking(backup_dir: &Path, metadata: &BackupMetadata) -> anyhow::Result<()> {
    let content = serde_json::to_string_pretty(metadata)?;
    std::fs::write(backup_dir.join("metadata.json"), content)?;
    Ok(())
}

fn is_restorable_blocking(backup_dir: &Path, service_config_path: Option<&PathBuf>) -> bool {
    let has_service_config =
        service_config_path.is_none() || backup_dir.join("service.yaml").is_file();
    has_service_config
        && backup_dir.join("metadata.json").is_file()
        && backup_dir.join("profiles.json").is_file()
        && backup_dir.join("dns.yaml").is_file()
        && backup_dir.join("profiles").is_dir()
}

fn validate_backup_source(
    config_dir: &Path,
    service_config_path: Option<&PathBuf>,
) -> anyhow::Result<()> {
    let mut stats = DirStats::default();
    add_file_stats(config_dir.join("profiles.json"), &mut stats)?;
    add_file_stats(config_dir.join("dns.yaml"), &mut stats)?;
    if let Some(service_config_path) = service_config_path {
        add_file_stats(service_config_path, &mut stats)?;
    }
    add_dir_stats(&config_dir.join("profiles"), 0, &mut stats)?;
    Ok(())
}

fn validate_dir_limits(path: &Path) -> anyhow::Result<()> {
    dir_size_limited(path).map(|_| ())
}

#[derive(Default)]
struct DirStats {
    bytes: u64,
    files: u64,
}

fn add_file_stats(path: impl AsRef<Path>, stats: &mut DirStats) -> anyhow::Result<()> {
    let path = path.as_ref();
    if !path.exists() {
        return Ok(());
    }
    let metadata = std::fs::metadata(path)?;
    if metadata.is_file() {
        stats.files = stats.files.saturating_add(1);
        stats.bytes = stats.bytes.saturating_add(metadata.len());
        ensure_stats_within_limits(stats)?;
    }
    Ok(())
}

fn add_dir_stats(path: &Path, depth: u32, stats: &mut DirStats) -> anyhow::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    if depth > MAX_BACKUP_DEPTH {
        anyhow::bail!("Backup directory exceeds maximum depth");
    }
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            add_dir_stats(&entry.path(), depth + 1, stats)?;
        } else if metadata.is_file() {
            stats.files = stats.files.saturating_add(1);
            stats.bytes = stats.bytes.saturating_add(metadata.len());
            ensure_stats_within_limits(stats)?;
        }
    }
    Ok(())
}

fn ensure_stats_within_limits(stats: &DirStats) -> anyhow::Result<()> {
    if stats.files > MAX_BACKUP_FILES {
        anyhow::bail!("Backup source contains too many files");
    }
    if stats.bytes > MAX_BACKUP_SOURCE_BYTES {
        anyhow::bail!("Backup source exceeds size limit");
    }
    Ok(())
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

fn dir_size_limited(path: &Path) -> anyhow::Result<DirStats> {
    let mut stats = DirStats::default();
    add_dir_stats(path, 0, &mut stats)?;
    Ok(stats)
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
