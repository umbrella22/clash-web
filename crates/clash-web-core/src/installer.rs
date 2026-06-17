use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::{Mutex, watch};

const MAX_DOWNLOAD_BYTES: u64 = 100 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 200 * 1024 * 1024;
const GITHUB_API_TIMEOUT_SECS: u64 = 15;
const DOWNLOAD_TIMEOUT_SECS: u64 = 300;

#[derive(Debug, Clone, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MihomoInstallInfo {
    pub installed: bool,
    pub path: String,
    pub version: Option<String>,
    pub arch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MihomoVersionInfo {
    pub current: Option<String>,
    pub latest: Option<String>,
    pub has_update: bool,
    pub download_url: String,
    pub arch: String,
    pub installed: bool,
}

pub struct MihomoInstaller {
    bin_dir: String,
    config_dir: String,
    progress_tx: watch::Sender<DownloadProgress>,
    progress_rx: watch::Receiver<DownloadProgress>,
    active_task: Mutex<Option<ActiveDownloadTask>>,
}

#[derive(Debug, Clone)]
struct ActiveDownloadTask {
    task_type: DownloadTaskType,
    started_at: Instant,
    started_at_unix: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DownloadTaskType {
    Install,
    Upgrade,
}

impl DownloadTaskType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Install => "install",
            Self::Upgrade => "upgrade",
        }
    }
}

#[derive(Debug)]
pub enum InstallTaskError {
    AlreadyRunning(DownloadProgress),
    Failed(anyhow::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DownloadTaskStart {
    pub started: bool,
    pub progress: DownloadProgress,
}

impl std::fmt::Display for InstallTaskError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AlreadyRunning(progress) => write!(
                f,
                "Mihomo download already running{}",
                progress
                    .task_type
                    .as_deref()
                    .map(|task_type| format!(" ({task_type})"))
                    .unwrap_or_default()
            ),
            Self::Failed(err) => write!(f, "{err}"),
        }
    }
}

impl std::error::Error for InstallTaskError {}

impl From<anyhow::Error> for InstallTaskError {
    fn from(value: anyhow::Error) -> Self {
        Self::Failed(value)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DownloadProgress {
    pub active: bool,
    pub task_type: Option<String>,
    pub status: String,
    pub downloaded: u64,
    pub total: u64,
    pub percent: f64,
    pub remaining_secs: Option<u64>,
    pub bytes_per_sec: Option<u64>,
    pub started_at: Option<i64>,
    pub updated_at: i64,
    pub message: String,
}

impl Default for DownloadProgress {
    fn default() -> Self {
        Self {
            active: false,
            task_type: None,
            status: "idle".to_string(),
            downloaded: 0,
            total: 0,
            percent: 0.0,
            remaining_secs: None,
            bytes_per_sec: None,
            started_at: None,
            updated_at: unix_timestamp(),
            message: String::new(),
        }
    }
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

impl MihomoInstaller {
    pub fn new(config_dir: &str) -> Self {
        let bin_dir = format!("{}/bin", config_dir);
        let (progress_tx, progress_rx) = watch::channel(DownloadProgress::default());
        Self {
            bin_dir,
            config_dir: config_dir.to_string(),
            progress_tx,
            progress_rx,
            active_task: Mutex::new(None),
        }
    }

    pub fn mihomo_bin_path(&self) -> String {
        let executable = if cfg!(windows) {
            "mihomo.exe"
        } else {
            "mihomo"
        };
        format!("{}/{}", self.bin_dir, executable)
    }

    pub fn subscribe_progress(&self) -> watch::Receiver<DownloadProgress> {
        self.progress_rx.clone()
    }

    pub fn current_progress(&self) -> DownloadProgress {
        self.progress_rx.borrow().clone()
    }

    pub fn detect(&self) -> MihomoInstallInfo {
        let arch = std::env::consts::ARCH.to_string();
        let bin_path = self.mihomo_bin_path();

        if Path::new(&bin_path).exists() {
            let version = self.get_local_version(&bin_path).ok();
            return MihomoInstallInfo {
                installed: true,
                path: bin_path,
                version,
                arch,
            };
        }

        if let Ok(output) = std::process::Command::new("which").arg("mihomo").output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    let version = self.get_local_version(&path).ok();
                    return MihomoInstallInfo {
                        installed: true,
                        path,
                        version,
                        arch,
                    };
                }
            }
        }

        MihomoInstallInfo {
            installed: false,
            path: String::new(),
            version: None,
            arch,
        }
    }

    fn get_local_version(&self, path: &str) -> Result<String> {
        let output = std::process::Command::new(path).arg("-v").output()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let version_output = stdout.trim();
        if !version_output.is_empty() {
            return Ok(version_output.lines().next().unwrap_or("").to_string());
        }

        let stderr_output = stderr.trim();
        if !stderr_output.is_empty() {
            return Ok(stderr_output.lines().next().unwrap_or("").to_string());
        }

        anyhow::bail!("mihomo version output is empty")
    }

    fn extract_version_tag(version_str: &str) -> Option<String> {
        let re = regex::Regex::new(r"(?:mihomo\s+)?(?:v)?([\d]+\.[\d]+\.[\d]+)").ok()?;
        let caps = re.captures(version_str)?;
        Some(caps[1].to_string())
    }

    pub fn download_url(&self) -> String {
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current()
                .block_on(self.resolve_download_url())
                .unwrap_or_else(|_| self.fallback_download_url())
        })
    }

    fn fallback_download_url(&self) -> String {
        let (os, arch) = self.platform_suffix();
        format!(
            "https://github.com/MetaCubeX/mihomo/releases/latest/download/mihomo-{}-{}.gz",
            os, arch
        )
    }

    fn platform_suffix(&self) -> (String, String) {
        let os = match std::env::consts::OS {
            "linux" => "linux",
            "macos" => "darwin",
            "windows" => "windows",
            "freebsd" => "freebsd",
            _ => "linux",
        };
        let arch = match std::env::consts::ARCH {
            "x86_64" => "amd64",
            "aarch64" => "arm64",
            "arm" => "armv7",
            "riscv64" => "riscv64",
            "loongarch64" => "loong64",
            _ => "amd64",
        };
        (os.to_string(), arch.to_string())
    }

    async fn fetch_latest_release() -> Result<GitHubRelease> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(GITHUB_API_TIMEOUT_SECS))
            .build()?;
        let resp = client
            .get("https://api.github.com/repos/MetaCubeX/mihomo/releases/latest")
            .header("User-Agent", "clash-web/0.1.0")
            .send()
            .await?;

        if !resp.status().is_success() {
            anyhow::bail!("Failed to fetch latest release: HTTP {}", resp.status());
        }

        Ok(resp.json::<GitHubRelease>().await?)
    }

    pub async fn get_latest_version() -> Result<String> {
        Ok(Self::fetch_latest_release().await?.tag_name)
    }

    fn preferred_asset_score(name: &str) -> i32 {
        let mut score = 0;

        if name.ends_with(Self::binary_archive_extension()) {
            score += 100;
        }
        if !name.ends_with(".deb")
            && !name.ends_with(".rpm")
            && !name.ends_with(".pkg.tar.zst")
            && !name.ends_with(".msi")
        {
            score += 20;
        }
        if !name.contains("compatible") {
            score += 10;
        }
        if !name.contains("go") {
            score += 5;
        }
        if !name.contains("softfloat") {
            score += 2;
        }
        if name.contains("-v1.") {
            score += 3;
        }

        score
    }

    fn binary_archive_extension() -> &'static str {
        if cfg!(windows) { ".zip" } else { ".gz" }
    }

    fn matches_asset_name(&self, name: &str) -> bool {
        let (os, arch) = self.platform_suffix();
        let prefix = format!("mihomo-{}-{}", os, arch);
        let archive_extension = Self::binary_archive_extension();

        name.starts_with(&prefix)
            && name.ends_with(archive_extension)
            && !name.ends_with(".tar.gz")
            && !name.contains("sha256")
    }

    fn extract_zip_binary(&self, archive: &[u8], tmp_bin_path: &str) -> Result<()> {
        let reader = std::io::Cursor::new(archive);
        let mut zip = zip::ZipArchive::new(reader)?;

        for index in 0..zip.len() {
            let mut file = zip.by_index(index)?;
            let entry_name = file.name().rsplit('/').next().unwrap_or(file.name());
            if entry_name.eq_ignore_ascii_case("mihomo.exe") {
                if file.size() > MAX_EXTRACTED_BYTES {
                    anyhow::bail!("extracted mihomo binary exceeds size limit");
                }
                let mut out = std::fs::File::create(tmp_bin_path)?;
                std::io::copy(&mut file, &mut out)?;
                out.sync_all()?;
                return Ok(());
            }
        }

        anyhow::bail!("mihomo.exe not found in downloaded zip archive")
    }

    fn extract_binary_archive(&self, archive: &[u8], tmp_bin_path: &str) -> Result<()> {
        if Self::binary_archive_extension() == ".zip" {
            return self.extract_zip_binary(archive, tmp_bin_path);
        }

        let mut gz_decoder = flate2::read::GzDecoder::new(archive);
        let mut out = std::fs::File::create(tmp_bin_path)?;
        let written = std::io::copy(
            &mut gz_decoder.by_ref().take(MAX_EXTRACTED_BYTES + 1),
            &mut out,
        )?;
        if written > MAX_EXTRACTED_BYTES {
            anyhow::bail!("extracted mihomo binary exceeds size limit");
        }
        out.sync_all()?;
        Ok(())
    }

    fn select_asset<'a>(&self, assets: &'a [GitHubReleaseAsset]) -> Option<&'a GitHubReleaseAsset> {
        assets
            .iter()
            .filter(|asset| self.matches_asset_name(&asset.name))
            .max_by_key(|asset| Self::preferred_asset_score(&asset.name))
    }

    async fn resolve_download_url(&self) -> Result<String> {
        let release = Self::fetch_latest_release().await?;
        let asset = self.select_asset(&release.assets).ok_or_else(|| {
            anyhow::anyhow!(
                "No matching mihomo asset found for platform {}/{} in release {}",
                std::env::consts::OS,
                std::env::consts::ARCH,
                release.tag_name
            )
        })?;

        Ok(asset.browser_download_url.clone())
    }

    pub fn check_version(&self) -> MihomoVersionInfo {
        let info = self.detect();
        let current = info.version.clone();

        let latest = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current()
                .block_on(Self::get_latest_version())
                .ok()
        });

        let has_update = match (&current, &latest) {
            (Some(c), Some(l)) => {
                let cv = Self::extract_version_tag(c);
                let lv = Self::extract_version_tag(l);
                match (cv, lv) {
                    (Some(cv), Some(lv)) => lv != cv,
                    _ => l != c,
                }
            }
            _ => !info.installed,
        };

        MihomoVersionInfo {
            current,
            latest,
            has_update,
            download_url: self.download_url(),
            arch: info.arch,
            installed: info.installed,
        }
    }

    pub async fn check_version_async(&self) -> MihomoVersionInfo {
        let info = self.detect();
        let current = info.version.clone();
        let latest = Self::get_latest_version().await.ok();

        let has_update = match (&current, &latest) {
            (Some(c), Some(l)) => {
                let cv = Self::extract_version_tag(c);
                let lv = Self::extract_version_tag(l);
                match (cv, lv) {
                    (Some(cv), Some(lv)) => lv != cv,
                    _ => l != c,
                }
            }
            _ => !info.installed,
        };

        MihomoVersionInfo {
            current,
            latest,
            has_update,
            download_url: self.download_url(),
            arch: info.arch,
            installed: info.installed,
        }
    }

    async fn begin_download(
        &self,
        task_type: DownloadTaskType,
    ) -> std::result::Result<ActiveDownloadTask, InstallTaskError> {
        let mut active_task = self.active_task.lock().await;
        if active_task.is_some() {
            return Err(InstallTaskError::AlreadyRunning(self.current_progress()));
        }

        let task = ActiveDownloadTask {
            task_type,
            started_at: Instant::now(),
            started_at_unix: unix_timestamp(),
        };
        *active_task = Some(task.clone());
        Ok(task)
    }

    async fn finish_download(&self) {
        let mut active_task = self.active_task.lock().await;
        *active_task = None;
    }

    fn build_progress(
        &self,
        task: &ActiveDownloadTask,
        status: &str,
        downloaded: u64,
        total: u64,
        message: String,
    ) -> DownloadProgress {
        let percent = if total > 0 {
            (downloaded as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        let elapsed_secs = task.started_at.elapsed().as_secs_f64();
        let bytes_per_sec = if downloaded > 0 && elapsed_secs > 0.0 {
            Some((downloaded as f64 / elapsed_secs) as u64)
        } else {
            None
        };
        let active = matches!(status, "starting" | "downloading" | "extracting");
        let remaining_secs = if active {
            match (bytes_per_sec, total.checked_sub(downloaded)) {
                (Some(speed), Some(remaining)) if speed > 0 && remaining > 0 => {
                    Some(((remaining as f64) / (speed as f64)).ceil() as u64)
                }
                _ => None,
            }
        } else {
            None
        };

        DownloadProgress {
            active,
            task_type: Some(task.task_type.as_str().to_string()),
            status: status.to_string(),
            downloaded,
            total,
            percent,
            remaining_secs,
            bytes_per_sec,
            started_at: Some(task.started_at_unix),
            updated_at: unix_timestamp(),
            message,
        }
    }

    fn publish_progress(&self, progress: DownloadProgress) {
        let _ = self.progress_tx.send(progress);
    }

    pub async fn start_download(
        self: Arc<Self>,
        task_type: DownloadTaskType,
    ) -> std::result::Result<DownloadTaskStart, InstallTaskError> {
        let task = self.begin_download(task_type).await?;
        let initial_progress = self.build_progress(
            &task,
            "starting",
            0,
            0,
            "Preparing download task".to_string(),
        );
        self.publish_progress(initial_progress.clone());

        let installer = Arc::clone(&self);
        tokio::spawn(async move {
            installer.run_download_task(task).await;
        });

        Ok(DownloadTaskStart {
            started: true,
            progress: initial_progress,
        })
    }

    async fn run_download_task(self: Arc<Self>, task: ActiveDownloadTask) {
        let result = self.download_and_install_inner(&task).await;
        match result {
            Ok(version) => {
                self.publish_progress(self.build_progress(
                    &task,
                    "done",
                    0,
                    0,
                    format!("Installed {}", version),
                ));
            }
            Err(err) => {
                tracing::error!("mihomo download task failed: {err}");
                let progress = self.current_progress();
                let error_progress = DownloadProgress {
                    active: false,
                    task_type: Some(task.task_type.as_str().to_string()),
                    status: "error".to_string(),
                    downloaded: progress.downloaded,
                    total: progress.total,
                    percent: progress.percent,
                    remaining_secs: None,
                    bytes_per_sec: progress.bytes_per_sec,
                    started_at: Some(task.started_at_unix),
                    updated_at: unix_timestamp(),
                    message: err.to_string(),
                };
                self.publish_progress(error_progress);
            }
        }
        self.finish_download().await;
    }

    async fn download_and_install_inner(&self, task: &ActiveDownloadTask) -> Result<String> {
        std::fs::create_dir_all(&self.bin_dir)?;

        let url = self.resolve_download_url().await.map_err(|err| {
            tracing::error!("Failed to resolve mihomo download url: {err}");
            err
        })?;
        tracing::info!("Downloading mihomo from {}", url);

        self.publish_progress(self.build_progress(
            task,
            "downloading",
            0,
            0,
            format!("Connecting to {}", url),
        ));

        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(DOWNLOAD_TIMEOUT_SECS))
            .build()?;
        let resp = client
            .get(&url)
            .header("User-Agent", "clash-web/0.1.0")
            .send()
            .await
            .map_err(|err| {
                tracing::error!("Failed to request mihomo download from {}: {}", url, err);
                err
            })?;

        if !resp.status().is_success() {
            let msg = format!("Download failed: HTTP {}", resp.status());
            tracing::error!("{} ({})", msg, url);
            anyhow::bail!(msg);
        }

        let total = resp.content_length().unwrap_or(0);
        if total > MAX_DOWNLOAD_BYTES {
            anyhow::bail!("downloaded mihomo archive exceeds size limit");
        }
        self.publish_progress(self.build_progress(
            task,
            "downloading",
            0,
            total,
            format!("Downloading {} bytes", total),
        ));

        let mut downloaded: u64 = 0;
        let mut stream = resp.bytes_stream();
        use futures_util::StreamExt;

        let mut chunks: Vec<u8> = Vec::with_capacity(total.min(MAX_DOWNLOAD_BYTES) as usize);
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|err| {
                tracing::error!("Failed while downloading mihomo from {}: {}", url, err);
                err
            })?;
            downloaded += chunk.len() as u64;
            if downloaded > MAX_DOWNLOAD_BYTES {
                anyhow::bail!("downloaded mihomo archive exceeds size limit");
            }
            chunks.extend_from_slice(&chunk);
            let percent = if total > 0 {
                (downloaded as f64 / total as f64) * 100.0
            } else {
                0.0
            };
            let mut progress = self.build_progress(
                task,
                "downloading",
                downloaded,
                total,
                format!("Downloaded {} / {}", downloaded, total),
            );
            progress.percent = percent;
            self.publish_progress(progress);
        }

        let mut extracting_progress = self.build_progress(
            task,
            "extracting",
            downloaded,
            total,
            "Extracting binary...".to_string(),
        );
        extracting_progress.percent = 100.0;
        self.publish_progress(extracting_progress);

        let bin_path = self.mihomo_bin_path();
        let tmp_bin_path = format!("{}.download", bin_path);
        self.extract_binary_archive(&chunks, &tmp_bin_path)?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp_bin_path, std::fs::Permissions::from_mode(0o755))?;
        }

        std::fs::rename(&tmp_bin_path, &bin_path)?;

        let version = self.get_local_version(&bin_path)?;
        tracing::info!("mihomo installed: {} — {}", bin_path, version);

        self.create_default_config()?;

        Ok(version)
    }

    fn create_default_config(&self) -> Result<()> {
        let config_path = format!("{}/config.yaml", self.config_dir);
        if !Path::new(&config_path).exists() {
            std::fs::write(&config_path, crate::config::DEFAULT_MIHOMO_CONFIG)?;
            tracing::info!("Created default config at {}", config_path);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn begin_download_rejects_parallel_requests() {
        let installer = MihomoInstaller::new("/tmp/clash-web-test-installer");

        let first = installer.begin_download(DownloadTaskType::Install).await;
        assert!(first.is_ok());

        let second = installer.begin_download(DownloadTaskType::Install).await;
        match second {
            Err(InstallTaskError::AlreadyRunning(progress)) => {
                assert_eq!(progress.status, "idle");
            }
            other => panic!("unexpected result: {other:?}"),
        }
    }

    #[test]
    fn build_progress_computes_eta_for_active_download() {
        let installer = MihomoInstaller::new("/tmp/clash-web-test-installer");
        let task = ActiveDownloadTask {
            task_type: DownloadTaskType::Upgrade,
            started_at: Instant::now() - std::time::Duration::from_secs(5),
            started_at_unix: unix_timestamp() - 5,
        };

        let progress =
            installer.build_progress(&task, "downloading", 500, 1000, "Downloading".to_string());

        assert!(progress.active);
        assert_eq!(progress.task_type.as_deref(), Some("upgrade"));
        assert!(progress.bytes_per_sec.is_some());
        assert!(progress.remaining_secs.is_some());
    }

    #[test]
    fn extract_gzip_binary_rejects_extracted_payload_over_limit() {
        let installer = MihomoInstaller::new("/tmp/clash-web-test-installer");
        let mut archive = Vec::new();
        {
            use flate2::Compression;
            use flate2::write::GzEncoder;
            use std::io::Write;

            let mut encoder = GzEncoder::new(&mut archive, Compression::fast());
            let chunk = vec![0_u8; 1024 * 1024];
            for _ in 0..=200 {
                encoder.write_all(&chunk).unwrap();
            }
            encoder.finish().unwrap();
        }

        let tmp_bin_path = std::env::temp_dir()
            .join(format!("clash-web-test-mihomo-{}", uuid::Uuid::new_v4()))
            .to_string_lossy()
            .to_string();
        let result = installer.extract_binary_archive(&archive, &tmp_bin_path);
        let _ = std::fs::remove_file(&tmp_bin_path);

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("size limit"));
    }

    #[tokio::test]
    async fn start_download_returns_immediately_with_active_progress() {
        let installer = Arc::new(MihomoInstaller::new("/tmp/clash-web-test-installer"));

        let started = installer
            .clone()
            .start_download(DownloadTaskType::Install)
            .await
            .expect("task should start");

        assert!(started.started);
        assert!(started.progress.active);
        assert_eq!(started.progress.status, "starting");
        assert_eq!(started.progress.task_type.as_deref(), Some("install"));
    }
}
