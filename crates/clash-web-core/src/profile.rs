use crate::enhance::build_runtime_config;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

pub const MAX_PROFILE_FILE_SIZE: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub uid: String,
    pub name: String,
    #[serde(default)]
    pub desc: String,
    #[serde(rename = "type")]
    pub profile_type: ProfileType,
    pub url: Option<String>,
    pub file: String,
    #[serde(default)]
    pub selected: Vec<HashMap<String, String>>,
    pub updated: Option<i64>,
    #[serde(default)]
    pub extra: Option<ProfileExtra>,
    #[serde(default)]
    pub subscription_info: Option<SubscriptionInfo>,
    #[serde(default)]
    pub subscription_update_detail: Option<SubscriptionUpdateDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ProfileType {
    #[serde(rename = "remote", alias = "Remote")]
    Remote,
    #[serde(rename = "local", alias = "Local")]
    Local,
    #[serde(rename = "merge", alias = "Merge")]
    Merge,
    #[serde(rename = "script", alias = "Script")]
    Script,
}

impl std::fmt::Display for ProfileType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProfileType::Remote => write!(f, "remote"),
            ProfileType::Local => write!(f, "local"),
            ProfileType::Merge => write!(f, "merge"),
            ProfileType::Script => write!(f, "script"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileExtra {
    #[serde(default)]
    pub user_agent: Option<String>,
    #[serde(default)]
    pub request_headers: HashMap<String, String>,
    #[serde(default)]
    pub retry_count: Option<u32>,
    #[serde(default)]
    pub retry_interval_secs: Option<u64>,
    #[serde(default)]
    pub update_interval: Option<i64>,
    #[serde(default)]
    pub download_timeout: Option<u64>,
    #[serde(default)]
    pub skip_cert_verify: bool,
    #[serde(default)]
    pub download_via_proxy: bool,
    #[serde(default)]
    pub keep_old_on_failure: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionInfo {
    #[serde(default)]
    pub upload: i64,
    #[serde(default)]
    pub download: i64,
    #[serde(default)]
    pub total: i64,
    #[serde(default)]
    pub expire: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionUpdateDetail {
    pub success: bool,
    pub updated_at: i64,
    #[serde(default)]
    pub attempts: u32,
    #[serde(default)]
    pub http_status: Option<u16>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub downloaded_bytes: u64,
    #[serde(default)]
    pub skipped_links: u32,
    #[serde(default)]
    pub kept_old: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProfilesConfig {
    pub profiles: Vec<Profile>,
    #[serde(default)]
    pub active: Option<String>,
}

pub struct ProfileManager {
    config_dir: String,
    data: RwLock<ProfilesConfig>,
}

#[cfg(test)]
mod tests {
    use super::{
        Profile, ProfileExtra, ProfileManager, ProfileType, SubscriptionInfo,
        SubscriptionUpdateDetail,
    };
    use std::path::Path;

    #[test]
    fn profile_type_serializes_lowercase_and_accepts_legacy_values() {
        assert_eq!(
            serde_json::to_string(&ProfileType::Remote).unwrap(),
            "\"remote\""
        );
        assert_eq!(
            serde_json::to_string(&ProfileType::Local).unwrap(),
            "\"local\""
        );

        assert_eq!(
            serde_json::from_str::<ProfileType>("\"Remote\"").unwrap(),
            ProfileType::Remote
        );
        assert_eq!(
            serde_json::from_str::<ProfileType>("\"merge\"").unwrap(),
            ProfileType::Merge
        );
    }

    #[test]
    fn profile_deserializes_without_extra_for_legacy_profiles_json() {
        let profile: Profile = serde_json::from_str(
            r#"{
                "uid": "legacy",
                "name": "Legacy",
                "desc": "",
                "type": "local",
                "url": null,
                "file": "legacy.yaml",
                "selected": [],
                "updated": null
            }"#,
        )
        .unwrap();

        assert!(profile.extra.is_none());
        assert!(profile.subscription_update_detail.is_none());
    }

    #[test]
    fn profile_extra_deserializes_missing_advanced_options_as_defaults() {
        let extra: ProfileExtra = serde_json::from_str(r#"{"user_agent":"ClashWeb"}"#).unwrap();

        assert_eq!(extra.user_agent.as_deref(), Some("ClashWeb"));
        assert!(extra.request_headers.is_empty());
        assert_eq!(extra.retry_count, None);
        assert_eq!(extra.retry_interval_secs, None);
        assert_eq!(extra.update_interval, None);
        assert_eq!(extra.download_timeout, None);
        assert!(!extra.skip_cert_verify);
        assert!(!extra.download_via_proxy);
        assert!(!extra.keep_old_on_failure);
    }

    #[tokio::test]
    async fn rejects_profile_file_path_traversal() {
        let config_dir = std::env::temp_dir()
            .join(format!("clash-web-profile-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        let manager = ProfileManager::new(&config_dir).await.unwrap();
        let outside = Path::new(&config_dir).join("escape.yaml");

        let result = manager
            .create(Profile {
                uid: String::new(),
                name: "unsafe".into(),
                desc: String::new(),
                profile_type: ProfileType::Local,
                url: None,
                file: "../escape.yaml".into(),
                selected: vec![],
                updated: None,
                extra: None,
                subscription_info: None,
                subscription_update_detail: None,
            })
            .await;

        assert!(result.is_err());
        assert!(!outside.exists());
    }

    #[tokio::test]
    async fn reads_runtime_config_with_merge_profiles() {
        let config_dir = std::env::temp_dir()
            .join(format!("clash-web-profile-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        let manager = ProfileManager::new(&config_dir).await.unwrap();
        let profile = manager
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
        let merge = manager
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

        manager
            .write_file(&merge.uid, "append-rules:\n  - DOMAIN,example.com,DIRECT\n")
            .await
            .unwrap();

        let runtime_config = manager.read_runtime_config(&profile.uid).await.unwrap();

        assert!(runtime_config.contains("DOMAIN,example.com,DIRECT"));
    }

    #[tokio::test]
    async fn records_subscription_update_detail() {
        let config_dir = std::env::temp_dir()
            .join(format!("clash-web-profile-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        let manager = ProfileManager::new(&config_dir).await.unwrap();
        let profile = manager
            .create(Profile {
                uid: String::new(),
                name: "remote".into(),
                desc: String::new(),
                profile_type: ProfileType::Remote,
                url: Some("https://example.com/sub.yaml".into()),
                file: String::new(),
                selected: vec![],
                updated: None,
                extra: None,
                subscription_info: None,
                subscription_update_detail: None,
            })
            .await
            .unwrap();

        manager
            .update_subscription_result(
                &profile.uid,
                Some(SubscriptionInfo {
                    upload: 1,
                    download: 2,
                    total: 3,
                    expire: Some(4),
                }),
                SubscriptionUpdateDetail {
                    success: true,
                    updated_at: 100,
                    attempts: 1,
                    http_status: Some(200),
                    error: None,
                    downloaded_bytes: 42,
                    skipped_links: 0,
                    kept_old: false,
                },
            )
            .await
            .unwrap();

        let updated = manager.get(&profile.uid).await.unwrap();
        assert_eq!(updated.updated, Some(100));
        assert_eq!(updated.subscription_info.unwrap().download, 2);
        let detail = updated.subscription_update_detail.unwrap();
        assert!(detail.success);
        assert_eq!(detail.attempts, 1);
        assert_eq!(detail.http_status, Some(200));
        assert_eq!(detail.downloaded_bytes, 42);

        manager
            .update_subscription_result(
                &profile.uid,
                None,
                SubscriptionUpdateDetail {
                    success: false,
                    updated_at: 200,
                    attempts: 2,
                    http_status: None,
                    error: Some("failed".into()),
                    skipped_links: 0,
                    downloaded_bytes: 0,
                    kept_old: true,
                },
            )
            .await
            .unwrap();

        let failed = manager.get(&profile.uid).await.unwrap();
        assert_eq!(failed.updated, Some(100));
        assert_eq!(failed.subscription_info.unwrap().download, 2);
        let detail = failed.subscription_update_detail.unwrap();
        assert!(!detail.success);
        assert_eq!(detail.attempts, 2);
        assert_eq!(detail.error.as_deref(), Some("failed"));
        assert!(detail.kept_old);
    }
}

impl ProfileManager {
    pub async fn new(config_dir: &str) -> anyhow::Result<Arc<Self>> {
        std::fs::create_dir_all(config_dir)?;
        let profiles_dir = format!("{}/profiles", config_dir);
        std::fs::create_dir_all(&profiles_dir)?;

        let data_path = format!("{}/profiles.json", config_dir);
        let data = if Path::new(&data_path).exists() {
            let content = std::fs::read_to_string(&data_path)?;
            serde_json::from_str(&content)?
        } else {
            ProfilesConfig::default()
        };

        Ok(Arc::new(Self {
            config_dir: config_dir.to_string(),
            data: RwLock::new(data),
        }))
    }

    fn data_path(&self) -> String {
        format!("{}/profiles.json", self.config_dir)
    }

    fn profiles_dir(&self) -> String {
        format!("{}/profiles", self.config_dir)
    }

    pub fn runtime_config_path(&self) -> PathBuf {
        Path::new(&self.config_dir).join("runtime.yaml")
    }

    pub fn service_config_path(&self) -> PathBuf {
        Path::new(&self.config_dir).join("config.yaml")
    }

    fn profile_file_path(&self, file: &str) -> anyhow::Result<PathBuf> {
        let path = Path::new(file);
        let is_safe = !file.is_empty()
            && !path.is_absolute()
            && path
                .components()
                .all(|component| matches!(component, Component::Normal(_)));

        if !is_safe {
            anyhow::bail!("Invalid profile file path");
        }

        Ok(Path::new(&self.profiles_dir()).join(path))
    }

    async fn save(&self) -> anyhow::Result<()> {
        let data = self.data.read().await;
        let content = serde_json::to_string_pretty(&*data)?;
        std::fs::write(self.data_path(), content)?;
        Ok(())
    }

    pub async fn list(&self) -> Vec<Profile> {
        self.data.read().await.profiles.clone()
    }

    pub async fn get(&self, uid: &str) -> Option<Profile> {
        self.data
            .read()
            .await
            .profiles
            .iter()
            .find(|p| p.uid == uid)
            .cloned()
    }

    pub async fn create(&self, mut profile: Profile) -> anyhow::Result<Profile> {
        if profile.uid.is_empty() {
            profile.uid = uuid::Uuid::new_v4().to_string();
        }
        if profile.file.is_empty() {
            profile.file = format!("{}.yaml", profile.uid);
        }

        let file_path = self.profile_file_path(&profile.file)?;
        if !file_path.exists() {
            let default_content = match profile.profile_type {
                ProfileType::Merge => {
                    "prepend-rules: []\nprepend-proxies: []\nprepend-proxy-groups: []\nappend-rules: []\nappend-proxies: []\nappend-proxy-groups: []\n"
                }
                ProfileType::Script => "// function main(config) { return config; }\n",
                _ => "proxies: []\nrules:\n  - MATCH,DIRECT\n",
            };
            std::fs::write(&file_path, default_content)?;
        }

        let mut data = self.data.write().await;
        data.profiles.push(profile.clone());
        drop(data);
        self.save().await?;
        Ok(profile)
    }

    pub async fn update(&self, uid: &str, update: ProfileUpdate) -> anyhow::Result<Profile> {
        let mut data = self.data.write().await;
        let profile = data
            .profiles
            .iter_mut()
            .find(|p| p.uid == uid)
            .ok_or_else(|| anyhow::anyhow!("Profile not found: {}", uid))?;

        if let Some(name) = update.name {
            profile.name = name;
        }
        if let Some(desc) = update.desc {
            profile.desc = desc;
        }
        if let Some(url) = update.url {
            profile.url = Some(url);
        }
        if let Some(extra) = update.extra {
            profile.extra = Some(extra);
        }

        let result = profile.clone();
        drop(data);
        self.save().await?;
        Ok(result)
    }

    pub async fn delete(&self, uid: &str) -> anyhow::Result<()> {
        let mut data = self.data.write().await;
        let idx = data
            .profiles
            .iter()
            .position(|p| p.uid == uid)
            .ok_or_else(|| anyhow::anyhow!("Profile not found: {}", uid))?;
        let profile = data.profiles.remove(idx);
        if data.active.as_deref() == Some(uid) {
            data.active = None;
        }
        drop(data);

        let file_path = self.profile_file_path(&profile.file)?;
        let _ = std::fs::remove_file(&file_path);

        self.save().await?;
        Ok(())
    }

    pub async fn reorder(&self, uids: Vec<String>) -> anyhow::Result<()> {
        let mut data = self.data.write().await;
        let mut reordered = Vec::with_capacity(uids.len());
        for uid in &uids {
            if let Some(p) = data.profiles.iter().find(|p| &p.uid == uid).cloned() {
                reordered.push(p);
            }
        }
        data.profiles = reordered;
        drop(data);
        self.save().await?;
        Ok(())
    }

    pub async fn get_active(&self) -> Option<Profile> {
        let data = self.data.read().await;
        if let Some(active_uid) = &data.active {
            data.profiles.iter().find(|p| &p.uid == active_uid).cloned()
        } else {
            None
        }
    }

    pub async fn set_active(&self, uid: &str) -> anyhow::Result<Profile> {
        let mut data = self.data.write().await;
        let profile = data
            .profiles
            .iter()
            .find(|p| p.uid == uid)
            .ok_or_else(|| anyhow::anyhow!("Profile not found: {}", uid))?
            .clone();
        data.active = Some(uid.to_string());
        drop(data);
        self.save().await?;
        Ok(profile)
    }

    pub async fn read_file(&self, uid: &str) -> anyhow::Result<String> {
        let data = self.data.read().await;
        let profile = data
            .profiles
            .iter()
            .find(|p| p.uid == uid)
            .ok_or_else(|| anyhow::anyhow!("Profile not found: {}", uid))?;
        let file_path = self.profile_file_path(&profile.file)?;
        let metadata = std::fs::metadata(&file_path)?;
        if metadata.len() > MAX_PROFILE_FILE_SIZE as u64 {
            anyhow::bail!("Profile file exceeds size limit");
        }
        let content = std::fs::read_to_string(&file_path)?;
        Ok(content)
    }

    pub async fn write_file(&self, uid: &str, content: &str) -> anyhow::Result<()> {
        if content.len() > MAX_PROFILE_FILE_SIZE {
            anyhow::bail!("Profile file exceeds size limit");
        }

        let data = self.data.read().await;
        let profile = data
            .profiles
            .iter()
            .find(|p| p.uid == uid)
            .ok_or_else(|| anyhow::anyhow!("Profile not found: {}", uid))?;
        let file_path = self.profile_file_path(&profile.file)?;
        std::fs::write(&file_path, content)?;
        Ok(())
    }

    pub async fn read_runtime_config(&self, uid: &str) -> anyhow::Result<String> {
        let profile_content = self.read_file(uid).await?;
        let profiles = self.list().await;
        let mut merge_profiles = Vec::new();

        for profile in profiles {
            if matches!(profile.profile_type, ProfileType::Merge) {
                merge_profiles.push(self.read_file(&profile.uid).await?);
            }
        }

        build_runtime_config(&profile_content, &merge_profiles)
    }

    pub async fn write_runtime_config(&self, content: &str) -> anyhow::Result<PathBuf> {
        if content.len() > MAX_PROFILE_FILE_SIZE {
            anyhow::bail!("Runtime config exceeds size limit");
        }
        let path = self.runtime_config_path();
        std::fs::write(&path, content)?;
        Ok(path)
    }

    pub async fn write_active_runtime_config(&self, content: &str) -> anyhow::Result<PathBuf> {
        let runtime_path = self.write_runtime_config(content).await?;
        std::fs::write(self.service_config_path(), content)?;
        Ok(runtime_path)
    }

    pub async fn update_subscription_result(
        &self,
        uid: &str,
        info: Option<SubscriptionInfo>,
        detail: SubscriptionUpdateDetail,
    ) -> anyhow::Result<()> {
        let mut data = self.data.write().await;
        let profile = data
            .profiles
            .iter_mut()
            .find(|p| p.uid == uid)
            .ok_or_else(|| anyhow::anyhow!("Profile not found: {}", uid))?;
        if let Some(info) = info {
            profile.subscription_info = Some(info);
        }
        if detail.success {
            profile.updated = Some(detail.updated_at);
        }
        profile.subscription_update_detail = Some(detail);
        drop(data);
        self.save().await?;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
pub struct ProfileUpdate {
    pub name: Option<String>,
    pub desc: Option<String>,
    pub url: Option<String>,
    pub extra: Option<ProfileExtra>,
}
