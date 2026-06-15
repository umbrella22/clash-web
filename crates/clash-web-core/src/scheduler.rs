use crate::profile::{ProfileManager, ProfileType, SubscriptionUpdateDetail};
use crate::subscription::{SubscriptionDownloadOptions, download_subscription_with_options};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::time::{Duration, interval};
use tracing::{info, warn};

pub struct SubscriptionScheduler {
    cancel_token: tokio_util::sync::CancellationToken,
    running: Arc<AtomicBool>,
}

impl SubscriptionScheduler {
    pub fn new() -> Self {
        Self {
            cancel_token: tokio_util::sync::CancellationToken::new(),
            running: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn start(&self, profiles: Arc<ProfileManager>, interval_hours: u64) {
        if self.running.swap(true, Ordering::SeqCst) {
            warn!("Subscription scheduler is already running");
            return;
        }
        let cancel = self.cancel_token.clone();
        let running = self.running.clone();
        tokio::spawn(async move {
            let _running_guard = SchedulerRunningGuard { running };
            let mut ticker = interval(Duration::from_secs(interval_hours * 3600));
            ticker.tick().await;

            loop {
                tokio::select! {
                    _ = cancel.cancelled() => {
                        info!("Subscription scheduler stopped");
                        return;
                    }
                    _ = ticker.tick() => {
                        info!("Running scheduled subscription update");
                        let all = profiles.list().await;
                        for item in &all {
                            if matches!(item.profile_type, ProfileType::Remote) {
                                if let Some(ref url) = item.url {
                                    let extra = item.extra.as_ref();
                                    let options = SubscriptionDownloadOptions {
                                        timeout_secs: extra.and_then(|e| e.download_timeout),
                                        skip_cert_verify: extra.is_some_and(|e| e.skip_cert_verify),
                                        request_headers: extra
                                            .map(|e| e.request_headers.clone())
                                            .unwrap_or_default(),
                                        retry_count: extra.and_then(|e| e.retry_count).unwrap_or_default(),
                                        retry_interval_secs: extra
                                            .and_then(|e| e.retry_interval_secs)
                                            .unwrap_or_default(),
                                        ..Default::default()
                                    };
                                    let attempted = options.retry_count.saturating_add(1);
                                    let user_agent = extra.and_then(|e| e.user_agent.as_deref());
                                    match download_subscription_with_options(url, user_agent, options).await {
                                        Ok(result) => {
                                            if let Err(e) = profiles.write_file(&item.uid, &result.content).await {
                                                warn!("Failed to write updated subscription for {}: {}", item.name, e);
                                                continue;
                                            }
                                            let now = chrono::Utc::now().timestamp();
                                            let detail = SubscriptionUpdateDetail {
                                                success: true,
                                                updated_at: now,
                                                attempts: result.attempts,
                                                http_status: Some(result.http_status),
                                                error: None,
                                                downloaded_bytes: result.downloaded_bytes,
                                                kept_old: false,
                                            };
                                            if let Err(e) = profiles.update_subscription_result(
                                                &item.uid,
                                                result.subscription_info.clone(),
                                                detail,
                                            ).await {
                                                warn!("Failed to update subscription info for {}: {}", item.name, e);
                                            }
                                            info!("Updated subscription: {}", item.name);
                                        }
                                        Err(e) => {
                                            let detail = SubscriptionUpdateDetail {
                                                success: false,
                                                updated_at: chrono::Utc::now().timestamp(),
                                                attempts: attempted,
                                                http_status: None,
                                                error: Some(format!("Failed to download: {}", e)),
                                                downloaded_bytes: 0,
                                                kept_old: false,
                                            };
                                            if let Err(update_error) = profiles.update_subscription_result(
                                                &item.uid,
                                                None,
                                                detail,
                                            ).await {
                                                warn!("Failed to record subscription error for {}: {}", item.name, update_error);
                                            }
                                            warn!("Failed to download subscription for {}: {}", item.name, e);
                                        }
                                    }
                                }
                            }
                        }
                        info!("Scheduled subscription update complete");
                    }
                }
            }
        });
    }

    pub fn stop(&self) {
        self.cancel_token.cancel();
    }
}

struct SchedulerRunningGuard {
    running: Arc<AtomicBool>,
}

impl Drop for SchedulerRunningGuard {
    fn drop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
    }
}

impl Default for SubscriptionScheduler {
    fn default() -> Self {
        Self::new()
    }
}
