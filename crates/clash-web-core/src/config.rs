use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub server: ServerConfig,
    pub mihomo: MihomoConfig,
    pub auth: AuthConfig,
    #[serde(default = "default_subscription_auto_update_interval")]
    pub subscription_auto_update_interval: u64,
}

fn default_subscription_auto_update_interval() -> u64 {
    24
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MihomoConfig {
    pub api_url: String,
    pub config_dir: String,
    pub secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthConfig {
    pub token: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server: ServerConfig {
                host: "0.0.0.0".to_string(),
                port: 9097,
            },
            mihomo: MihomoConfig {
                api_url: "http://127.0.0.1:9090".to_string(),
                config_dir: "/etc/clash-web".to_string(),
                secret: String::new(),
            },
            auth: AuthConfig {
                token: String::new(),
            },
            subscription_auto_update_interval: 24,
        }
    }
}

impl AppConfig {
    pub fn load(path: &std::path::Path) -> anyhow::Result<Self> {
        if !path.exists() {
            let config = Self::default();
            let dir = path.parent().unwrap_or(std::path::Path::new("."));
            std::fs::create_dir_all(dir)?;
            let content = serde_yaml::to_string(&config)?;
            std::fs::write(path, content)?;
            tracing::info!("Created default config at {:?}", path);
            return Ok(config);
        }
        let content = std::fs::read_to_string(path)?;
        let config: Self = serde_yaml::from_str(&content)?;
        Ok(config)
    }

    pub fn save(&self, path: &std::path::Path) -> anyhow::Result<()> {
        let content = serde_yaml::to_string(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }

    pub fn profiles_dir(&self) -> std::path::PathBuf {
        std::path::PathBuf::from(&self.mihomo.config_dir).join("profiles")
    }

    pub fn ensure_dirs(&self) -> anyhow::Result<()> {
        std::fs::create_dir_all(&self.mihomo.config_dir)?;
        std::fs::create_dir_all(self.profiles_dir())?;
        Ok(())
    }
}

pub const DEFAULT_MIHOMO_CONFIG: &str = r#"# Clash Web default mihomo configuration
mixed-port: 7890
allow-lan: false
bind-address: '*'
mode: rule
log-level: info
ipv6: false
external-controller: 127.0.0.1:9090

dns:
  enable: true
  listen: 0.0.0.0:1053
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query

proxies: []

proxy-groups: []

rules:
  - MATCH,DIRECT
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_binds_lan_without_auth_token() {
        let config = AppConfig::default();

        assert_eq!(config.server.host, "0.0.0.0");
        assert!(config.auth.token.is_empty());
    }
}
