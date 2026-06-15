use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;

pub const MAX_USER_PREFERENCES_SIZE: usize = 128 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OverviewCardPreference {
    pub id: String,
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserPreferences {
    pub overview_cards: Vec<OverviewCardPreference>,
}

pub struct UserPreferencesManager {
    config_dir: String,
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            overview_cards: default_overview_cards(),
        }
    }
}

impl UserPreferencesManager {
    pub async fn new(config_dir: &str) -> Result<Arc<Self>> {
        std::fs::create_dir_all(config_dir)?;
        let manager = Arc::new(Self {
            config_dir: config_dir.to_string(),
        });
        if !Path::new(&manager.data_path()).exists() {
            manager.save(&UserPreferences::default()).await?;
        }
        Ok(manager)
    }

    fn data_path(&self) -> String {
        format!("{}/preferences.json", self.config_dir)
    }

    pub async fn read(&self) -> Result<UserPreferences> {
        let path = self.data_path();
        if !Path::new(&path).exists() {
            self.save(&UserPreferences::default()).await?;
        }
        let metadata = std::fs::metadata(&path)?;
        if metadata.len() > MAX_USER_PREFERENCES_SIZE as u64 {
            anyhow::bail!("User preferences exceeds size limit");
        }
        let content = std::fs::read_to_string(path)?;
        let preferences: UserPreferences = serde_json::from_str(&content)?;
        Ok(normalize_preferences(preferences))
    }

    pub async fn save(&self, preferences: &UserPreferences) -> Result<UserPreferences> {
        let preferences = normalize_preferences(preferences.clone());
        let content = serde_json::to_string_pretty(&preferences)?;
        if content.len() > MAX_USER_PREFERENCES_SIZE {
            anyhow::bail!("User preferences exceeds size limit");
        }
        std::fs::write(self.data_path(), content)?;
        Ok(preferences)
    }

    pub async fn restore_default(&self) -> Result<UserPreferences> {
        self.save(&UserPreferences::default()).await
    }
}

pub fn default_overview_cards() -> Vec<OverviewCardPreference> {
    ["control", "quick_proxy", "traffic", "memory"]
        .into_iter()
        .map(|id| OverviewCardPreference {
            id: id.to_string(),
            visible: true,
        })
        .collect()
}

fn normalize_preferences(mut preferences: UserPreferences) -> UserPreferences {
    let default_cards = default_overview_cards();
    let mut normalized_cards = Vec::new();

    for card in preferences.overview_cards.drain(..) {
        if default_cards.iter().any(|default| default.id == card.id)
            && !normalized_cards
                .iter()
                .any(|item: &OverviewCardPreference| item.id == card.id)
        {
            normalized_cards.push(card);
        }
    }

    for card in default_cards {
        if !normalized_cards.iter().any(|item| item.id == card.id) {
            normalized_cards.push(card);
        }
    }

    UserPreferences {
        overview_cards: normalized_cards,
    }
}

#[cfg(test)]
mod tests {
    use super::{OverviewCardPreference, UserPreferences, UserPreferencesManager};

    #[tokio::test]
    async fn creates_default_preferences_when_missing() {
        let config_dir = std::env::temp_dir()
            .join(format!(
                "clash-web-preferences-test-{}",
                uuid::Uuid::new_v4()
            ))
            .to_string_lossy()
            .to_string();

        let manager = UserPreferencesManager::new(&config_dir).await.unwrap();
        let preferences = manager.read().await.unwrap();

        assert_eq!(preferences.overview_cards.len(), 4);
        assert_eq!(preferences.overview_cards[0].id, "control");
    }

    #[tokio::test]
    async fn normalizes_saved_overview_cards() {
        let config_dir = std::env::temp_dir()
            .join(format!(
                "clash-web-preferences-test-{}",
                uuid::Uuid::new_v4()
            ))
            .to_string_lossy()
            .to_string();
        let manager = UserPreferencesManager::new(&config_dir).await.unwrap();

        let preferences = manager
            .save(&UserPreferences {
                overview_cards: vec![
                    OverviewCardPreference {
                        id: "memory".to_string(),
                        visible: false,
                    },
                    OverviewCardPreference {
                        id: "unknown".to_string(),
                        visible: true,
                    },
                    OverviewCardPreference {
                        id: "memory".to_string(),
                        visible: true,
                    },
                ],
            })
            .await
            .unwrap();

        assert_eq!(preferences.overview_cards.len(), 4);
        assert_eq!(preferences.overview_cards[0].id, "memory");
        assert!(!preferences.overview_cards[0].visible);
        assert!(
            preferences
                .overview_cards
                .iter()
                .all(|card| card.id != "unknown")
        );
    }
}
