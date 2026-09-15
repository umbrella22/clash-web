use anyhow::{Context, Result, bail, ensure};
use futures_util::StreamExt;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Duration};
use tokio::io::AsyncWriteExt;

pub const REPOSITORY_URL: &str = "https://github.com/umbrella22/clash-web";
const LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/umbrella22/clash-web/releases/latest";
// Bound disk usage before handing a downloaded executable package to dpkg.
const MAX_PACKAGE_BYTES: u64 = 200 * 1024 * 1024;
const MAX_RELEASE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
    pub digest: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    #[serde(default)]
    body: Option<String>,
    assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppRelease {
    pub version: String,
    pub tag: String,
    pub url: String,
    pub notes: String,
    pub asset: Option<ReleaseAsset>,
}

impl AppRelease {
    pub fn is_newer_than(&self, current: &str) -> Result<bool> {
        Ok(parse_version(&self.version)?
            .cmp_precedence(&parse_version(current)?)
            .is_gt())
    }

    pub fn installable(&self) -> bool {
        self.asset
            .as_ref()
            .is_some_and(|asset| asset.sha256().is_ok())
    }
}

impl ReleaseAsset {
    fn sha256(&self) -> Result<&str> {
        let hash = self
            .digest
            .as_deref()
            .and_then(|value| value.strip_prefix("sha256:"));
        match hash {
            Some(hash) if hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()) => {
                Ok(hash)
            }
            _ => bail!("GitHub has not provided a valid SHA-256 digest for this package"),
        }
    }
}

pub fn parse_version(value: &str) -> Result<Version> {
    let version = value
        .strip_prefix("clash-web-v")
        .or_else(|| value.strip_prefix('v'))
        .unwrap_or(value);
    Version::parse(version).context("Unrecognized Clash Web version")
}

pub fn deb_architecture() -> Option<&'static str> {
    match std::env::consts::ARCH {
        "x86_64" => Some("amd64"),
        "x86" => Some("i386"),
        "aarch64" => Some("arm64"),
        _ => None,
    }
}

fn release_from_github(release: GitHubRelease, arch: Option<&str>) -> Result<AppRelease> {
    let version = parse_version(&release.tag_name)?;
    ensure!(
        !release.draft && !release.prerelease && version.pre.is_empty(),
        "Only stable releases can be installed"
    );
    let name = arch.map(|arch| format!("clash-web_{version}_{arch}.deb"));
    let asset = release
        .assets
        .into_iter()
        .find(|asset| Some(&asset.name) == name.as_ref());
    if let Some(asset) = &asset {
        let expected_url = format!(
            "{REPOSITORY_URL}/releases/download/{}/{}",
            release.tag_name, asset.name
        );
        ensure!(
            asset.browser_download_url == expected_url,
            "Unexpected release asset URL"
        );
        ensure!(
            asset.size > 0 && asset.size <= MAX_PACKAGE_BYTES,
            "Release package exceeds the 200 MiB size limit or is empty"
        );
    }
    Ok(AppRelease {
        version: version.to_string(),
        url: format!("{REPOSITORY_URL}/releases/tag/{}", release.tag_name),
        tag: release.tag_name,
        notes: release.body.unwrap_or_default(),
        asset,
    })
}

pub struct GitHubReleaseClient {
    client: reqwest::Client,
}

impl GitHubReleaseClient {
    pub fn new() -> Result<Self> {
        Ok(Self {
            client: reqwest::Client::builder()
                .https_only(true)
                .user_agent("clash-web-updater")
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(300))
                .build()?,
        })
    }

    pub async fn latest(&self) -> Result<Option<AppRelease>> {
        self.latest_from(LATEST_RELEASE_URL).await
    }

    async fn latest_from(&self, url: &str) -> Result<Option<AppRelease>> {
        let mut response = self
            .client
            .get(url)
            .header("Accept", "application/vnd.github+json")
            .timeout(Duration::from_secs(20))
            .send()
            .await
            .context("Could not reach GitHub")?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        ensure!(
            response.status().is_success(),
            "GitHub release check failed (HTTP {})",
            response.status()
        );
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            ensure!(
                body.len() + chunk.len() <= MAX_RELEASE_BYTES,
                "GitHub release metadata is too large"
            );
            body.extend_from_slice(&chunk);
        }
        let release = serde_json::from_slice(&body).context("Invalid GitHub release response")?;
        release_from_github(release, deb_architecture()).map(Some)
    }

    pub async fn download(&self, asset: &ReleaseAsset, output: &Path) -> Result<()> {
        let expected_hash = asset.sha256()?;
        ensure!(
            asset.size > 0 && asset.size <= MAX_PACKAGE_BYTES,
            "Invalid package size"
        );
        let response = self
            .client
            .get(&asset.browser_download_url)
            .send()
            .await?
            .error_for_status()?;
        if let Some(length) = response.content_length() {
            ensure!(
                length == asset.size,
                "Release package size does not match GitHub metadata"
            );
        }
        let mut file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(output)
            .await?;
        let mut stream = response.bytes_stream();
        let mut hash = Sha256::new();
        let mut downloaded = 0_u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            downloaded += chunk.len() as u64;
            ensure!(
                downloaded <= asset.size,
                "Release package is larger than expected"
            );
            hash.update(&chunk);
            file.write_all(&chunk).await?;
        }
        ensure!(
            downloaded == asset.size,
            "Release package download is incomplete"
        );
        let actual_hash: String = hash
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        ensure!(
            actual_hash.eq_ignore_ascii_case(expected_hash),
            "Release package SHA-256 verification failed"
        );
        file.sync_all().await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn fixture() -> serde_json::Value {
        json!({
            "tag_name": "clash-web-v0.10.0", "draft": false, "prerelease": false,
            "body": "Release notes",
            "assets": (["amd64", "i386", "arm64"].map(|arch| json!({
                "name": format!("clash-web_0.10.0_{arch}.deb"),
                "browser_download_url": format!("{REPOSITORY_URL}/releases/download/clash-web-v0.10.0/clash-web_0.10.0_{arch}.deb"),
                "size": 3,
                // SHA-256 of "abc", from the standard SHA-256 test vector.
                "digest": "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
            })))
        })
    }

    #[test]
    fn compares_release_versions_by_precedence_and_supports_project_tags() {
        let release =
            release_from_github(serde_json::from_value(fixture()).unwrap(), Some("amd64")).unwrap();
        assert!(release.is_newer_than("0.9.9").unwrap());
        assert!(!release.is_newer_than("0.10.0").unwrap());
        assert!(!release.is_newer_than("0.10.0+build.1").unwrap());
        assert!(!release.is_newer_than("1.0.0").unwrap());
        assert!(release.is_newer_than("0.10.0-rc.1").unwrap());
        assert_eq!(
            parse_version("v1.2.3").unwrap(),
            parse_version("clash-web-v1.2.3").unwrap()
        );
        assert!(parse_version("latest").is_err());
    }

    #[test]
    fn selects_exact_architecture_and_handles_release_assets_not_ready_yet() {
        for arch in ["amd64", "i386", "arm64"] {
            let release =
                release_from_github(serde_json::from_value(fixture()).unwrap(), Some(arch))
                    .unwrap();
            assert_eq!(
                release.asset.as_ref().unwrap().name,
                format!("clash-web_0.10.0_{arch}.deb")
            );
            assert!(release.installable());
        }
        let release =
            release_from_github(serde_json::from_value(fixture()).unwrap(), Some("riscv64"))
                .unwrap();
        assert!(!release.installable());
        let mut missing_digest = fixture();
        missing_digest["assets"][0]["digest"] = json!(null);
        let release = release_from_github(
            serde_json::from_value(missing_digest).unwrap(),
            Some("amd64"),
        )
        .unwrap();
        assert!(release.is_newer_than("0.9.0").unwrap());
        assert!(!release.installable());
    }

    #[test]
    fn rejects_unstable_releases_and_assets_outside_the_release() {
        for field in ["draft", "prerelease"] {
            let mut value = fixture();
            value[field] = json!(true);
            assert!(
                release_from_github(serde_json::from_value(value).unwrap(), Some("amd64")).is_err()
            );
        }
        let mut value = fixture();
        value["tag_name"] = json!("v0.10.0-rc.1");
        assert!(release_from_github(serde_json::from_value(value).unwrap(), None).is_err());
        let mut value = fixture();
        value["assets"][0]["browser_download_url"] = json!("https://example.org/package.deb");
        assert!(
            release_from_github(serde_json::from_value(value).unwrap(), Some("amd64")).is_err()
        );
    }

    async fn http_response(status: &str, body: Vec<u8>) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let header = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            let _ = socket.read(&mut request).await;
            let _ = socket.write_all(header.as_bytes()).await;
            let _ = socket.write_all(&body).await;
        });
        url
    }

    fn test_client() -> GitHubReleaseClient {
        let _ = rustls::crypto::ring::default_provider().install_default();
        GitHubReleaseClient {
            client: reqwest::Client::builder().no_proxy().build().unwrap(),
        }
    }

    #[tokio::test]
    async fn release_check_distinguishes_missing_releases_and_github_errors() {
        let client = test_client();
        let url = http_response("200 OK", serde_json::to_vec(&fixture()).unwrap()).await;
        assert_eq!(
            client.latest_from(&url).await.unwrap().unwrap().version,
            "0.10.0"
        );
        let url = http_response("404 Not Found", b"{}".to_vec()).await;
        assert!(client.latest_from(&url).await.unwrap().is_none());
        let url = http_response("403 Forbidden", b"rate limited".to_vec()).await;
        assert!(
            client
                .latest_from(&url)
                .await
                .unwrap_err()
                .to_string()
                .contains("403")
        );
    }

    #[tokio::test]
    async fn verifies_download_checksum_and_rejects_corrupt_or_incomplete_payloads() {
        let client = test_client();
        let release =
            release_from_github(serde_json::from_value(fixture()).unwrap(), Some("amd64")).unwrap();
        let mut asset = release.asset.unwrap();
        let directory =
            std::env::temp_dir().join(format!("clash-web-download-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir(&directory).await.unwrap();

        asset.browser_download_url = http_response("200 OK", b"abc".to_vec()).await;
        let output = directory.join("valid.deb");
        client.download(&asset, &output).await.unwrap();
        assert_eq!(tokio::fs::read(output).await.unwrap(), b"abc");

        asset.browser_download_url = http_response("200 OK", b"abd".to_vec()).await;
        assert!(
            client
                .download(&asset, &directory.join("corrupt.deb"))
                .await
                .unwrap_err()
                .to_string()
                .contains("SHA-256")
        );
        asset.browser_download_url = http_response("200 OK", b"ab".to_vec()).await;
        assert!(
            client
                .download(&asset, &directory.join("short.deb"))
                .await
                .is_err()
        );
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }
}
