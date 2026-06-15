use crate::enhance::validate_dns_config;
use anyhow::Result;
use std::path::Path;
use std::sync::Arc;

pub const MAX_DNS_CONFIG_SIZE: usize = 256 * 1024;

pub const DEFAULT_DNS_CONFIG: &str = r#"enable: true
listen: 0.0.0.0:1053
enhanced-mode: fake-ip
fake-ip-range: 198.18.0.1/16
nameserver:
  - https://dns.alidns.com/dns-query
  - https://doh.pub/dns-query
"#;

pub struct DnsConfigManager {
    config_dir: String,
}

impl DnsConfigManager {
    pub async fn new(config_dir: &str) -> Result<Arc<Self>> {
        std::fs::create_dir_all(config_dir)?;
        let manager = Arc::new(Self {
            config_dir: config_dir.to_string(),
        });
        if !Path::new(&manager.data_path()).exists() {
            manager.save(DEFAULT_DNS_CONFIG).await?;
        }
        Ok(manager)
    }

    fn data_path(&self) -> String {
        format!("{}/dns.yaml", self.config_dir)
    }

    pub async fn read(&self) -> Result<String> {
        let path = self.data_path();
        if !Path::new(&path).exists() {
            self.save(DEFAULT_DNS_CONFIG).await?;
        }
        let metadata = std::fs::metadata(&path)?;
        if metadata.len() > MAX_DNS_CONFIG_SIZE as u64 {
            anyhow::bail!("DNS config exceeds size limit");
        }
        Ok(std::fs::read_to_string(path)?)
    }

    pub async fn save(&self, content: &str) -> Result<()> {
        Self::validate(content)?;
        std::fs::write(self.data_path(), content)?;
        Ok(())
    }

    pub async fn restore_default(&self) -> Result<String> {
        self.save(DEFAULT_DNS_CONFIG).await?;
        Ok(DEFAULT_DNS_CONFIG.to_string())
    }

    pub fn validate(content: &str) -> Result<()> {
        if content.len() > MAX_DNS_CONFIG_SIZE {
            anyhow::bail!("DNS config exceeds size limit");
        }
        validate_dns_config(content)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{DEFAULT_DNS_CONFIG, DnsConfigManager};

    #[tokio::test]
    async fn creates_default_dns_config_when_missing() {
        let config_dir = std::env::temp_dir()
            .join(format!("clash-web-dns-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();

        let manager = DnsConfigManager::new(&config_dir).await.unwrap();

        assert_eq!(manager.read().await.unwrap(), DEFAULT_DNS_CONFIG);
    }

    #[tokio::test]
    async fn saves_and_reads_valid_dns_config() {
        let config_dir = std::env::temp_dir()
            .join(format!("clash-web-dns-test-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        let manager = DnsConfigManager::new(&config_dir).await.unwrap();
        let content = "enable: false\nnameserver:\n  - 1.1.1.1\n";

        manager.save(content).await.unwrap();

        assert_eq!(manager.read().await.unwrap(), content);
    }

    #[test]
    fn rejects_non_mapping_dns_config() {
        assert!(DnsConfigManager::validate("- 1.1.1.1\n").is_err());
    }

    #[test]
    fn rejects_invalid_dns_yaml() {
        assert!(DnsConfigManager::validate("enable: [\n").is_err());
    }
}
