use clash_web_core::{
    AppConfig, BackupManager, DnsConfigManager, MihomoClient, MihomoInstaller, ProfileManager,
    SubscriptionScheduler, UserPreferencesManager,
};
use std::path::Path;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    pub mihomo: Arc<MihomoClient>,
    pub profiles: Arc<ProfileManager>,
    pub backups: Arc<BackupManager>,
    pub dns: Arc<DnsConfigManager>,
    pub installer: Arc<MihomoInstaller>,
    pub scheduler: Arc<SubscriptionScheduler>,
    pub preferences: Arc<UserPreferencesManager>,
}

impl AppState {
    pub async fn new(
        config: AppConfig,
        service_config_path: Option<&Path>,
    ) -> anyhow::Result<Self> {
        let mihomo = MihomoClient::new(&config.mihomo.api_url, &config.mihomo.secret);
        let profiles = ProfileManager::new(&config.mihomo.config_dir).await?;
        let backups = BackupManager::new(&config.mihomo.config_dir, service_config_path).await?;
        let dns = DnsConfigManager::new(&config.mihomo.config_dir).await?;
        let installer = MihomoInstaller::new(&config.mihomo.config_dir);
        let scheduler = Arc::new(SubscriptionScheduler::new());
        let preferences = UserPreferencesManager::new(&config.mihomo.config_dir).await?;
        Ok(Self {
            config: Arc::new(config),
            mihomo: Arc::new(mihomo),
            profiles,
            backups,
            dns,
            installer: Arc::new(installer),
            scheduler,
            preferences,
        })
    }
}
