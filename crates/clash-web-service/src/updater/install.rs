use super::{now, write_json};
use anyhow::{Context, Result, ensure};
use clash_web_core::app_update::{AppRelease, GitHubReleaseClient, deb_architecture};
use serde::{Deserialize, Serialize};
use std::{path::Path, time::Duration};
use tokio::process::Command;

const UPDATE_UNIT: &str = "clash-web-update.service";
const STATUS_PATH: &str = "/var/lib/clash-web-update/status.json";

#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InstallPhase {
    #[default]
    Idle,
    Queued,
    Checking,
    Downloading,
    Installing,
    Restarting,
    Done,
    Error,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct InstallProgress {
    pub phase: InstallPhase,
    pub version: Option<String>,
    pub updated_at: i64,
    pub error: Option<String>,
}

impl InstallProgress {
    pub fn active(&self) -> bool {
        matches!(
            self.phase,
            InstallPhase::Queued
                | InstallPhase::Checking
                | InstallPhase::Downloading
                | InstallPhase::Installing
                | InstallPhase::Restarting
        )
    }

    async fn write(&mut self, phase: InstallPhase) -> Result<()> {
        self.phase = phase;
        self.updated_at = now();
        write_json(Path::new(STATUS_PATH), self).await
    }
}

pub fn supported() -> bool {
    cfg!(target_os = "linux")
        && deb_architecture().is_some()
        && std::env::current_exe().is_ok_and(|path| path == Path::new("/usr/bin/clash-web-service"))
        && Path::new("/run/systemd/system").is_dir()
        && (Path::new("/lib/systemd/system/clash-web-update.service").is_file()
            || Path::new("/usr/lib/systemd/system/clash-web-update.service").is_file())
}

async fn command(program: &str, args: &[&str], timeout_secs: u64) -> Result<String> {
    let output = tokio::time::timeout(
        Duration::from_secs(timeout_secs),
        Command::new(program)
            .args(args)
            .env("LC_ALL", "C")
            .kill_on_drop(true)
            .output(),
    )
    .await
    .context("Update command timed out")??;
    ensure!(
        output.status.success(),
        "{program} failed: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    );
    Ok(String::from_utf8(output.stdout)?.trim().to_string())
}

pub async fn start() -> Result<()> {
    command(
        "/usr/bin/systemctl",
        &["--no-ask-password", "--no-block", "start", UPDATE_UNIT],
        10,
    )
    .await?;
    Ok(())
}

pub async fn progress(queued_at: Option<i64>) -> InstallProgress {
    let mut progress = tokio::fs::read(STATUS_PATH)
        .await
        .ok()
        .and_then(|bytes| serde_json::from_slice::<InstallProgress>(&bytes).ok())
        .unwrap_or_default();
    if let Some(queued) = queued_at.filter(|queued| *queued > progress.updated_at) {
        progress = InstallProgress {
            phase: InstallPhase::Queued,
            updated_at: queued,
            ..Default::default()
        };
        if now() - queued < 15 {
            return progress;
        }
    }
    match command(
        "/usr/bin/systemctl",
        &["show", "--property=ActiveState", "--value", UPDATE_UNIT],
        3,
    )
    .await
    {
        Ok(state) if matches!(state.as_str(), "active" | "activating" | "reloading") => {
            if !progress.active() {
                progress.phase = InstallPhase::Checking;
                progress.error = None;
            }
        }
        Ok(_) if progress.active() => {
            progress.phase = InstallPhase::Error;
            progress.error = Some("Update service stopped before completion. See journalctl -u clash-web-update.service.".into());
        }
        Err(error) => {
            progress.phase = InstallPhase::Error;
            progress.error = Some(format!("Could not read update service state: {error}"));
        }
        _ => {}
    }
    progress
}

// Invoked only by a fixed, root-owned systemd unit. No URL, local package path,
// repository, or shell command can be supplied through the Web API.
pub async fn apply() -> Result<()> {
    ensure!(
        cfg!(target_os = "linux"),
        "Automatic installation is supported on Linux deb installations"
    );
    ensure!(
        command("/usr/bin/id", &["-u"], 5).await? == "0",
        "The update service must run as root"
    );
    let mut progress = InstallProgress::default();
    progress.write(InstallPhase::Checking).await?;
    let result = apply_release(&mut progress).await;
    if let Err(error) = &result {
        progress.error = Some(format!("{error:#}"));
        progress.write(InstallPhase::Error).await?;
    }
    result
}

async fn apply_release(progress: &mut InstallProgress) -> Result<()> {
    let client = GitHubReleaseClient::new()?;
    // Fetch again as root; never trust the unprivileged service's cached metadata.
    let release = client
        .latest()
        .await?
        .context("No stable GitHub release is available")?;
    let installed_version = command(
        "/usr/bin/dpkg-query",
        &["-W", "-f=${Version}", "clash-web"],
        10,
    )
    .await?;
    if !release.is_newer_than(&installed_version)? {
        progress.version = Some(installed_version);
        progress.write(InstallPhase::Done).await?;
        return Ok(());
    }
    ensure!(
        release.installable(),
        "No verified deb package is available for this architecture"
    );
    let asset = release
        .asset
        .as_ref()
        .context("Missing deb release asset")?;
    progress.version = Some(release.version.clone());
    progress.write(InstallPhase::Downloading).await?;

    let cache = Path::new("/var/cache/clash-web-update");
    tokio::fs::create_dir_all(cache).await?;
    // A private root-owned directory prevents replacement between verification
    // and dpkg reading the package, including by the clash-web service account.
    let download_dir = tempfile::Builder::new()
        .prefix("install-")
        .tempdir_in(cache)?;
    let package = download_dir.path().join(&asset.name);
    client.download(asset, &package).await?;
    let package = package.to_str().context("Invalid package path")?;
    let package_name = command("/usr/bin/dpkg-deb", &["--field", package, "Package"], 10).await?;
    let package_version =
        command("/usr/bin/dpkg-deb", &["--field", package, "Version"], 10).await?;
    let package_arch = command(
        "/usr/bin/dpkg-deb",
        &["--field", package, "Architecture"],
        10,
    )
    .await?;
    validate_package(&release, &package_name, &package_version, &package_arch)?;
    command(
        "/usr/bin/dpkg",
        &[
            "--compare-versions",
            &package_version,
            "gt",
            &installed_version,
        ],
        10,
    )
    .await?;
    install_package(package, &mut SystemInstaller { progress }).await?;
    verify_restarted_service(&release.version).await?;
    progress.write(InstallPhase::Done).await?;
    Ok(())
}

async fn verify_restarted_service(expected_version: &str) -> Result<()> {
    let content = tokio::fs::read_to_string("/etc/clash-web/service.yaml").await?;
    let config: clash_web_core::AppConfig = serde_yaml::from_str(&content)?;
    let host = match config.server.host.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(address)) if address.is_unspecified() => "127.0.0.1".to_string(),
        Ok(std::net::IpAddr::V6(address)) if address.is_unspecified() => "[::1]".to_string(),
        Ok(std::net::IpAddr::V6(address)) => format!("[{address}]"),
        _ => config.server.host,
    };
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()?;
    let url = format!("http://{host}:{}/api/v1/updates", config.server.port);
    let ready = tokio::time::timeout(Duration::from_secs(60), async {
        loop {
            if let Ok(response) = client
                .get(&url)
                .bearer_auth(&config.auth.token)
                .send()
                .await
                && response.status().is_success()
                && let Ok(status) = response.json::<serde_json::Value>().await
                && status["current_version"].as_str() == Some(expected_version)
            {
                break;
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    })
    .await;
    ready.context("Package installed, but the new Web service did not become ready within 60 seconds; inspect journalctl -u clash-web.service")?;
    Ok(())
}

trait InstallOperations {
    async fn command(&mut self, program: &str, args: &[&str], timeout_secs: u64) -> Result<String>;
    async fn phase(&mut self, phase: InstallPhase) -> Result<()>;
}

struct SystemInstaller<'a> {
    progress: &'a mut InstallProgress,
}

impl InstallOperations for SystemInstaller<'_> {
    async fn command(&mut self, program: &str, args: &[&str], timeout_secs: u64) -> Result<String> {
        command(program, args, timeout_secs).await
    }

    async fn phase(&mut self, phase: InstallPhase) -> Result<()> {
        self.progress.write(phase).await
    }
}

async fn install_package(package: &str, operations: &mut impl InstallOperations) -> Result<()> {
    // Detect missing dependencies before unpacking anything.
    operations
        .command("/usr/bin/dpkg", &["--no-act", "--install", package], 30)
        .await?;
    let mihomo_was_active = operations
        .command(
            "/usr/bin/systemctl",
            &[
                "show",
                "--property=ActiveState",
                "--value",
                "mihomo.service",
            ],
            5,
        )
        .await?
        == "active";

    operations.phase(InstallPhase::Installing).await?;
    let installed = operations
        .command(
            "/usr/bin/dpkg",
            &[
                "--refuse-downgrade",
                "--force-confdef",
                "--force-confold",
                "--install",
                package,
            ],
            600,
        )
        .await;
    // Older package prerm scripts stop both services even on upgrade. Restore
    // their previous availability on success and on a failed installation.
    let restore_mihomo = if mihomo_was_active {
        operations
            .command("/usr/bin/systemctl", &["start", "mihomo.service"], 60)
            .await
    } else {
        Ok(String::new())
    };
    if let Err(error) = installed {
        let _ = operations
            .command("/usr/bin/systemctl", &["start", "clash-web.service"], 60)
            .await;
        return Err(error);
    }
    // A status-file failure must not prevent restarting an installed service.
    let restarting = operations.phase(InstallPhase::Restarting).await;
    operations
        .command("/usr/bin/systemctl", &["restart", "clash-web.service"], 60)
        .await?;
    restore_mihomo.context("Package installed, but mihomo could not be restarted")?;
    restarting?;
    Ok(())
}

fn validate_package(release: &AppRelease, name: &str, version: &str, arch: &str) -> Result<()> {
    ensure!(name == "clash-web", "Downloaded package is not clash-web");
    ensure!(
        version == release.version,
        "Package version does not match the release"
    );
    ensure!(
        Some(arch) == deb_architecture(),
        "Package architecture does not match this installation"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct FakeInstaller {
        running: bool,
        reject_preflight: bool,
        fail_install: bool,
        fail_restart_status: bool,
        commands: Vec<String>,
        phases: Vec<InstallPhase>,
    }

    impl InstallOperations for FakeInstaller {
        async fn command(&mut self, program: &str, args: &[&str], _: u64) -> Result<String> {
            self.commands.push(format!("{program} {}", args.join(" ")));
            if args.contains(&"--no-act") && self.reject_preflight {
                anyhow::bail!("Missing dependency");
            }
            if args.contains(&"--force-confold") && self.fail_install {
                anyhow::bail!("dpkg installation failed");
            }
            if args.first() == Some(&"show") {
                return Ok(if self.running { "active" } else { "inactive" }.into());
            }
            Ok(String::new())
        }

        async fn phase(&mut self, phase: InstallPhase) -> Result<()> {
            self.phases.push(phase);
            if phase == InstallPhase::Restarting && self.fail_restart_status {
                anyhow::bail!("Status disk full");
            }
            Ok(())
        }
    }

    #[tokio::test]
    async fn preserves_config_and_restores_previously_running_services() {
        let mut operations = FakeInstaller {
            running: true,
            ..Default::default()
        };
        install_package("/private/package.deb", &mut operations)
            .await
            .unwrap();
        assert!(operations.commands.iter().any(|command| command
            == "/usr/bin/dpkg --refuse-downgrade --force-confdef --force-confold --install /private/package.deb"));
        assert!(
            operations
                .commands
                .iter()
                .any(|command| command == "/usr/bin/systemctl start mihomo.service")
        );
        assert_eq!(
            operations.commands.last().unwrap(),
            "/usr/bin/systemctl restart clash-web.service"
        );
        assert_eq!(
            operations.phases,
            [InstallPhase::Installing, InstallPhase::Restarting]
        );
        let mut operations = FakeInstaller::default();
        install_package("/private/package.deb", &mut operations)
            .await
            .unwrap();
        assert!(
            !operations
                .commands
                .iter()
                .any(|command| command.contains("start mihomo.service"))
        );
    }

    #[tokio::test]
    async fn rejects_missing_dependencies_before_installing_and_recovers_after_dpkg_failure() {
        let mut operations = FakeInstaller {
            reject_preflight: true,
            ..Default::default()
        };
        assert!(
            install_package("/private/package.deb", &mut operations)
                .await
                .is_err()
        );
        assert_eq!(operations.commands.len(), 1);
        assert!(operations.phases.is_empty());
        let mut operations = FakeInstaller {
            running: true,
            fail_install: true,
            ..Default::default()
        };
        assert!(
            install_package("/private/package.deb", &mut operations)
                .await
                .unwrap_err()
                .to_string()
                .contains("dpkg")
        );
        assert!(
            operations
                .commands
                .iter()
                .any(|command| command.contains("start mihomo.service"))
        );
        assert_eq!(
            operations.commands.last().unwrap(),
            "/usr/bin/systemctl start clash-web.service"
        );
    }

    #[tokio::test]
    async fn restarts_the_service_even_if_writing_progress_fails_after_installation() {
        let mut operations = FakeInstaller {
            fail_restart_status: true,
            ..Default::default()
        };
        assert!(
            install_package("/private/package.deb", &mut operations)
                .await
                .is_err()
        );
        assert_eq!(
            operations.commands.last().unwrap(),
            "/usr/bin/systemctl restart clash-web.service"
        );
    }

    #[test]
    fn rejects_wrong_package_identity_version_and_architecture() {
        let release = AppRelease {
            version: "0.10.0".into(),
            tag: "v0.10.0".into(),
            url: String::new(),
            notes: String::new(),
            asset: None,
        };
        let arch = deb_architecture().unwrap();
        assert!(validate_package(&release, "clash-web", "0.10.0", arch).is_ok());
        assert!(validate_package(&release, "other-app", "0.10.0", arch).is_err());
        assert!(validate_package(&release, "clash-web", "0.9.0", arch).is_err());
        assert!(validate_package(&release, "clash-web", "0.10.0", "wrong-arch").is_err());
    }
}
