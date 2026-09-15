use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalMihomoPackage {
    pub name: String,
    pub size: u64,
    pub modified_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalMihomoPackages {
    pub directory: String,
    pub packages: Vec<LocalMihomoPackage>,
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
    Import,
}

impl DownloadTaskType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Install => "install",
            Self::Upgrade => "upgrade",
            Self::Import => "import",
        }
    }
}

#[derive(Debug)]
pub enum InstallTaskError {
    AlreadyRunning(DownloadProgress),
    InvalidPackage(String),
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
            Self::InvalidPackage(message) => write!(f, "{message}"),
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

    pub fn incoming_dir(&self) -> PathBuf {
        Path::new(&self.config_dir).join("incoming")
    }

    pub fn list_local_packages(&self) -> Result<LocalMihomoPackages> {
        let incoming_dir = self.incoming_dir();
        std::fs::create_dir_all(&incoming_dir)?;
        let mut packages = Vec::new();

        for entry in std::fs::read_dir(&incoming_dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }

            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if !Self::is_local_package_name(&name) {
                continue;
            }

            let metadata = entry.metadata()?;
            if metadata.len() == 0 || metadata.len() > MAX_DOWNLOAD_BYTES {
                continue;
            }
            let modified_at = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs() as i64);
            packages.push(LocalMihomoPackage {
                name,
                size: metadata.len(),
                modified_at,
            });
        }

        packages.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(LocalMihomoPackages {
            directory: incoming_dir.to_string_lossy().into_owned(),
            packages,
        })
    }

    pub fn subscribe_progress(&self) -> watch::Receiver<DownloadProgress> {
        self.progress_rx.clone()
    }

    pub fn current_progress(&self) -> DownloadProgress {
        self.progress_rx.borrow().clone()
    }

    fn is_local_package_name(name: &str) -> bool {
        let mut components = Path::new(name).components();
        let is_single_component =
            matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none();

        is_single_component
            && name.starts_with("mihomo-")
            && name.ends_with(".gz")
            && !name.ends_with(".tar.gz")
            && !name.contains("sha256")
    }

    fn resolve_local_package(
        &self,
        name: &str,
    ) -> std::result::Result<(PathBuf, u64), InstallTaskError> {
        if !Self::is_local_package_name(name) {
            return Err(InstallTaskError::InvalidPackage(
                "Local package name must match mihomo-*.gz".to_string(),
            ));
        }

        let path = self.incoming_dir().join(name);
        let metadata = std::fs::symlink_metadata(&path).map_err(|_| {
            InstallTaskError::InvalidPackage(format!("Local package not found: {name}"))
        })?;
        if !metadata.file_type().is_file() {
            return Err(InstallTaskError::InvalidPackage(
                "Local package must be a regular file".to_string(),
            ));
        }
        if metadata.len() == 0 || metadata.len() > MAX_DOWNLOAD_BYTES {
            return Err(InstallTaskError::InvalidPackage(format!(
                "Local package size must be between 1 byte and {MAX_DOWNLOAD_BYTES} bytes"
            )));
        }

        Ok((path, metadata.len()))
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
        if !output.status.success() {
            anyhow::bail!("mihomo version check failed for {path}");
        }
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

    #[cfg(target_os = "linux")]
    fn validate_binary_architecture(path: &Path) -> Result<()> {
        let mut file = std::fs::File::open(path)?;
        let mut header = [0_u8; 20];
        file.read_exact(&mut header)?;
        if &header[..4] != b"\x7fELF" {
            anyhow::bail!("extracted mihomo binary is not an ELF executable");
        }

        let machine = match header[5] {
            1 => u16::from_le_bytes([header[18], header[19]]),
            2 => u16::from_be_bytes([header[18], header[19]]),
            _ => anyhow::bail!("extracted mihomo binary has an invalid ELF byte order"),
        };
        let expected_machine = match std::env::consts::ARCH {
            "x86" => 3,
            "arm" => 40,
            "x86_64" => 62,
            "aarch64" => 183,
            "riscv64" => 243,
            "loongarch64" => 258,
            arch => anyhow::bail!("unsupported host architecture: {arch}"),
        };
        if machine != expected_machine {
            anyhow::bail!(
                "mihomo architecture mismatch: ELF machine {machine}, expected {expected_machine} for {}",
                std::env::consts::ARCH
            );
        }
        Ok(())
    }

    #[cfg(not(target_os = "linux"))]
    fn validate_binary_architecture(_path: &Path) -> Result<()> {
        Ok(())
    }

    fn install_archive(&self, archive: &[u8]) -> Result<String> {
        self.install_archive_with_version_check(archive, |path| self.get_local_version(path))
    }

    fn install_archive_with_version_check<F>(
        &self,
        archive: &[u8],
        get_version: F,
    ) -> Result<String>
    where
        F: FnOnce(&str) -> Result<String>,
    {
        std::fs::create_dir_all(&self.bin_dir)?;
        let bin_path = self.mihomo_bin_path();
        let tmp_bin_path = format!("{}.download", bin_path);
        let _ = std::fs::remove_file(&tmp_bin_path);

        let result = (|| {
            self.extract_binary_archive(archive, &tmp_bin_path)?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&tmp_bin_path, std::fs::Permissions::from_mode(0o755))?;
            }

            Self::validate_binary_architecture(Path::new(&tmp_bin_path))?;
            let version = get_version(&tmp_bin_path)?;
            if Self::extract_version_tag(&version).is_none() {
                anyhow::bail!("mihomo version output is not recognized: {version}");
            }

            std::fs::rename(&tmp_bin_path, &bin_path)?;
            self.create_default_config()?;
            tracing::info!("mihomo installed: {} — {}", bin_path, version);
            Ok(version)
        })();

        if result.is_err() {
            let _ = std::fs::remove_file(&tmp_bin_path);
        }
        result
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

    pub async fn start_local_import(
        self: Arc<Self>,
        name: String,
    ) -> std::result::Result<DownloadTaskStart, InstallTaskError> {
        let (path, size) = self.resolve_local_package(&name)?;
        let task = self.begin_download(DownloadTaskType::Import).await?;
        let initial_progress = self.build_progress(
            &task,
            "starting",
            0,
            size,
            format!("Preparing local package {name}"),
        );
        self.publish_progress(initial_progress.clone());

        let installer = Arc::clone(&self);
        tokio::spawn(async move {
            installer.run_local_import_task(task, path, size).await;
        });

        Ok(DownloadTaskStart {
            started: true,
            progress: initial_progress,
        })
    }

    async fn run_local_import_task(
        self: Arc<Self>,
        task: ActiveDownloadTask,
        path: PathBuf,
        size: u64,
    ) {
        let result = self.import_local_archive_inner(&task, &path, size).await;
        match result {
            Ok(version) => {
                self.publish_progress(self.build_progress(
                    &task,
                    "done",
                    size,
                    size,
                    format!("Imported {}", version),
                ));
            }
            Err(err) => {
                tracing::error!("mihomo local import failed: {err}");
                self.publish_progress(DownloadProgress {
                    active: false,
                    task_type: Some(task.task_type.as_str().to_string()),
                    status: "error".to_string(),
                    downloaded: 0,
                    total: size,
                    percent: 0.0,
                    remaining_secs: None,
                    bytes_per_sec: None,
                    started_at: Some(task.started_at_unix),
                    updated_at: unix_timestamp(),
                    message: err.to_string(),
                });
            }
        }
        self.finish_download().await;
    }

    async fn import_local_archive_inner(
        &self,
        task: &ActiveDownloadTask,
        path: &Path,
        size: u64,
    ) -> Result<String> {
        let metadata = std::fs::symlink_metadata(path)?;
        if !metadata.file_type().is_file() {
            anyhow::bail!("local mihomo package must be a regular file");
        }
        if metadata.len() == 0 || metadata.len() > MAX_DOWNLOAD_BYTES {
            anyhow::bail!("local mihomo package exceeds the size limit");
        }
        let archive = std::fs::read(path)?;
        if archive.len() as u64 != size {
            anyhow::bail!("local mihomo package changed while it was being imported");
        }

        let mut progress = self.build_progress(
            task,
            "extracting",
            size,
            size,
            format!(
                "Extracting {}",
                path.file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("local package")
            ),
        );
        progress.percent = 100.0;
        self.publish_progress(progress);
        self.install_archive(&archive)
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

        self.install_archive(&chunks)
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
    fn extracts_windows_binary_from_deflated_zip() {
        // Generated with Python's zipfile, independently of the Rust zip crate.
        let archive = include_bytes!("../tests/fixtures/mihomo-windows.zip");
        let config_dir = temp_config_dir();
        std::fs::create_dir_all(&config_dir).unwrap();
        let installer = MihomoInstaller::new(config_dir.to_str().unwrap());
        let output = config_dir.join("mihomo.exe");

        installer
            .extract_zip_binary(archive, output.to_str().unwrap())
            .unwrap();

        assert_eq!(std::fs::read(&output).unwrap(), b"fake mihomo executable\n");
        std::fs::remove_dir_all(config_dir).unwrap();
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

    fn temp_config_dir() -> PathBuf {
        std::env::temp_dir().join(format!("clash-web-installer-test-{}", uuid::Uuid::new_v4()))
    }

    fn gzip_bytes(payload: &[u8]) -> Vec<u8> {
        use flate2::write::GzEncoder;
        use std::io::Write;

        let mut encoder = GzEncoder::new(Vec::new(), flate2::Compression::fast());
        encoder.write_all(payload).unwrap();
        encoder.finish().unwrap()
    }

    fn write_fake_mihomo_script(path: &Path, version: &str) {
        let script = format!("#!/bin/sh\necho 'Mihomo Meta v{version} linux amd64'\n");
        std::fs::write(path, script).unwrap();
        make_executable(path);
    }

    fn make_executable(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(path).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(path, permissions).unwrap();
    }

    #[test]
    fn list_local_packages_filters_and_sorts_candidates() {
        let config_dir = temp_config_dir();
        let incoming = config_dir.join("incoming");
        std::fs::create_dir_all(&incoming).unwrap();

        std::fs::write(incoming.join("mihomo-linux-amd64-v1.19.13.gz"), b"a").unwrap();
        std::fs::write(incoming.join("mihomo-linux-amd64-v1.19.1.gz"), b"b").unwrap();
        std::fs::write(incoming.join("notes.txt"), b"ignored").unwrap();
        std::fs::write(
            incoming.join("mihomo-linux-amd64-v1.19.2.tar.gz"),
            b"ignored",
        )
        .unwrap();
        std::fs::write(
            incoming.join("mihomo-linux-amd64-v1.19.2.gz.sha256"),
            b"ignored",
        )
        .unwrap();
        std::fs::write(incoming.join("mihomo-empty.gz"), b"").unwrap();
        std::fs::create_dir(incoming.join("mihomo-linux-arm64-v1.19.2.gz")).unwrap();

        let installer = MihomoInstaller::new(config_dir.to_string_lossy().as_ref());
        let listed = installer.list_local_packages().unwrap();

        assert_eq!(listed.directory, incoming.to_string_lossy().into_owned());
        let names: Vec<&str> = listed.packages.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "mihomo-linux-amd64-v1.19.1.gz",
                "mihomo-linux-amd64-v1.19.13.gz"
            ]
        );

        let _ = std::fs::remove_dir_all(&config_dir);
    }

    #[tokio::test]
    async fn local_import_rejects_unsafe_names_and_missing_files() {
        let config_dir = temp_config_dir();
        std::fs::create_dir_all(config_dir.join("incoming")).unwrap();
        let installer = Arc::new(MihomoInstaller::new(config_dir.to_string_lossy().as_ref()));

        for name in [
            "../mihomo-linux-amd64-v1.19.13.gz",
            "/etc/mihomo.gz",
            "mihomo.tar.gz",
            "other-1.0.0.gz",
            "mihomo-linux-amd64-v1.19.13.gz",
        ] {
            let result = installer.clone().start_local_import(name.to_string()).await;
            match result {
                Err(InstallTaskError::InvalidPackage(message)) => {
                    assert!(!message.is_empty());
                }
                other => panic!("unexpected result for {name}: {other:?}"),
            }
        }

        let _ = std::fs::remove_dir_all(&config_dir);
    }

    #[tokio::test]
    async fn local_import_rejects_traversal_symlink() {
        let config_dir = temp_config_dir();
        let incoming = config_dir.join("incoming");
        std::fs::create_dir_all(&incoming).unwrap();

        let outside = config_dir.join("outside.gz");
        std::fs::write(&outside, b"payload").unwrap();
        std::os::unix::fs::symlink(&outside, incoming.join("mihomo-linux-amd64-v1.19.13.gz"))
            .unwrap();

        let installer = Arc::new(MihomoInstaller::new(config_dir.to_string_lossy().as_ref()));
        let result = installer
            .start_local_import("mihomo-linux-amd64-v1.19.13.gz".to_string())
            .await;

        assert!(matches!(result, Err(InstallTaskError::InvalidPackage(_))));

        let _ = std::fs::remove_dir_all(&config_dir);
    }

    #[tokio::test]
    async fn local_import_failure_keeps_existing_binary() {
        let config_dir = temp_config_dir();
        std::fs::create_dir_all(config_dir.join("incoming")).unwrap();
        std::fs::create_dir_all(config_dir.join("bin")).unwrap();

        let bin_path = config_dir.join("bin").join("mihomo");
        write_fake_mihomo_script(&bin_path, "1.18.0");

        std::fs::write(
            config_dir
                .join("incoming")
                .join("mihomo-linux-amd64-v1.19.13.gz"),
            b"not-a-gzip-archive",
        )
        .unwrap();

        let installer = Arc::new(MihomoInstaller::new(config_dir.to_string_lossy().as_ref()));
        installer
            .clone()
            .start_local_import("mihomo-linux-amd64-v1.19.13.gz".to_string())
            .await
            .unwrap();

        let mut rx = installer.subscribe_progress();
        loop {
            let progress = rx.borrow_and_update().clone();
            if !progress.active {
                assert_eq!(progress.status, "error");
                break;
            }
            rx.changed().await.unwrap();
        }

        assert!(bin_path.exists());
        let remaining = std::fs::read_to_string(&bin_path).unwrap();
        assert!(remaining.contains("v1.18.0"));
        assert!(!config_dir.join("bin").join("mihomo.download").exists());

        let _ = std::fs::remove_dir_all(&config_dir);
    }

    #[tokio::test]
    async fn local_import_installs_package_and_reports_version() {
        let config_dir = temp_config_dir();
        std::fs::create_dir_all(config_dir.join("incoming")).unwrap();

        let staging_dir = temp_config_dir();
        std::fs::create_dir_all(&staging_dir).unwrap();
        let fake_binary = staging_dir.join("mihomo");
        std::fs::write(
            &fake_binary,
            "#!/bin/sh\necho 'Mihomo Meta v1.19.13 linux amd64'\n",
        )
        .unwrap();
        make_executable(&fake_binary);
        let archive = gzip_bytes(&std::fs::read(&fake_binary).unwrap());
        std::fs::write(
            config_dir
                .join("incoming")
                .join("mihomo-linux-amd64-v1.19.13.gz"),
            &archive,
        )
        .unwrap();

        let installer = Arc::new(MihomoInstaller::new(config_dir.to_string_lossy().as_ref()));
        installer
            .clone()
            .start_local_import("mihomo-linux-amd64-v1.19.13.gz".to_string())
            .await
            .unwrap();

        let mut rx = installer.subscribe_progress();
        let final_progress = loop {
            let progress = rx.borrow_and_update().clone();
            if !progress.active {
                break progress;
            }
            rx.changed().await.unwrap();
        };

        assert_eq!(final_progress.status, "done");
        assert_eq!(final_progress.task_type.as_deref(), Some("import"));
        assert!(final_progress.message.contains("1.19.13"));

        let installed = config_dir.join("bin").join("mihomo");
        assert!(installed.exists());
        assert!(config_dir.join("config.yaml").exists());
        // The source archive stays in place for the user to keep or remove.
        assert!(
            config_dir
                .join("incoming")
                .join("mihomo-linux-amd64-v1.19.13.gz")
                .exists()
        );

        let _ = std::fs::remove_dir_all(&config_dir);
        let _ = std::fs::remove_dir_all(&staging_dir);
    }

    #[tokio::test]
    async fn import_and_download_tasks_are_mutually_exclusive() {
        let config_dir = temp_config_dir();
        std::fs::create_dir_all(config_dir.join("incoming")).unwrap();
        std::fs::write(
            config_dir
                .join("incoming")
                .join("mihomo-linux-amd64-v1.19.13.gz"),
            b"stub",
        )
        .unwrap();

        let installer = Arc::new(MihomoInstaller::new(config_dir.to_string_lossy().as_ref()));
        let first = installer
            .clone()
            .start_local_import("mihomo-linux-amd64-v1.19.13.gz".to_string())
            .await;
        assert!(first.is_ok());

        let second = installer
            .clone()
            .start_local_import("mihomo-linux-amd64-v1.19.13.gz".to_string())
            .await;
        assert!(matches!(second, Err(InstallTaskError::AlreadyRunning(_))));

        let third = installer.start_download(DownloadTaskType::Install).await;
        assert!(matches!(third, Err(InstallTaskError::AlreadyRunning(_))));

        let _ = std::fs::remove_dir_all(&config_dir);
    }
}
