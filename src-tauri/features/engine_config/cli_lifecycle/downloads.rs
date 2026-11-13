// Downloads Misty makes itself for an install: Node.js from nodejs.org, and a maker's published
// build where its installer can't be pointed at Misty's folder or would change the person's shell
// profile (Claude Code, OpenCode, Codex, Antigravity). Each file
// is streamed to a `.partial` beside where it goes, hashed as it arrives, and kept only when the
// hash matches the one its maker publishes; anything else is thrown away.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine as _;
use sha2::{Digest as _, Sha256, Sha512};

use super::ProgressReporter;

/// A whole download may take this long; big builds (Claude Code is ~350 MB) need room.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(1800);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// Metadata (versions, manifests, checksum lists) is small.
const METADATA_TIMEOUT: Duration = Duration::from_secs(30);

/// The hash a maker publishes for a file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Checksum {
    /// Lowercase hex SHA-256 (nodejs.org's `SHASUMS256.txt`, Claude Code's manifest).
    Sha256(String),
    /// npm's `dist.integrity`: `sha512-<base64>`.
    Sha512(String),
    /// Lowercase hex SHA-512 (Antigravity's release manifest).
    Sha512Hex(String),
}

impl Checksum {
    /// npm's integrity string, or nothing when it isn't a SHA-512 one.
    pub(super) fn from_npm_integrity(integrity: &str) -> Option<Self> {
        integrity
            .split_whitespace()
            .find_map(|part| part.strip_prefix("sha512-"))
            .filter(|digest| !digest.is_empty())
            .map(|digest| Checksum::Sha512(digest.to_string()))
    }

    /// A 64-character hex SHA-256, or nothing.
    pub(super) fn sha256_hex(hex: &str) -> Option<Self> {
        let hex = hex.trim().to_ascii_lowercase();
        (hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit()))
            .then_some(Checksum::Sha256(hex))
    }

    /// A 128-character hex SHA-512, or nothing.
    pub(super) fn sha512_hex(hex: &str) -> Option<Self> {
        let hex = hex.trim().to_ascii_lowercase();
        (hex.len() == 128 && hex.bytes().all(|b| b.is_ascii_hexdigit()))
            .then_some(Checksum::Sha512Hex(hex))
    }
}

/// Hashes bytes as they arrive, for the kind of checksum they're checked against.
pub(super) enum Hasher {
    Sha256(Sha256),
    Sha512(Sha512),
}

impl Hasher {
    pub(super) fn for_checksum(checksum: &Checksum) -> Self {
        match checksum {
            Checksum::Sha256(_) => Hasher::Sha256(Sha256::new()),
            Checksum::Sha512(_) | Checksum::Sha512Hex(_) => Hasher::Sha512(Sha512::new()),
        }
    }

    pub(super) fn update(&mut self, bytes: &[u8]) {
        match self {
            Hasher::Sha256(hasher) => hasher.update(bytes),
            Hasher::Sha512(hasher) => hasher.update(bytes),
        }
    }

    /// Whether what was hashed matches `checksum`.
    pub(super) fn matches(self, checksum: &Checksum) -> bool {
        match (self, checksum) {
            (Hasher::Sha256(hasher), Checksum::Sha256(hex)) => {
                hex::encode(hasher.finalize()) == hex.to_ascii_lowercase()
            }
            (Hasher::Sha512(hasher), Checksum::Sha512(digest)) => {
                base64::engine::general_purpose::STANDARD.encode(hasher.finalize()) == *digest
            }
            (Hasher::Sha512(hasher), Checksum::Sha512Hex(hex)) => {
                hex::encode(hasher.finalize()) == hex.to_ascii_lowercase()
            }
            _ => false,
        }
    }
}

/// Whether the file at `path` matches `checksum`.
#[cfg(test)]
pub(super) fn file_matches(path: &Path, checksum: &Checksum) -> std::io::Result<bool> {
    let mut hasher = Hasher::for_checksum(checksum);
    let mut file = file_access::fs::File::open(path)?;
    let mut chunk = vec![0_u8; 64 * 1024];
    loop {
        let read = std::io::Read::read(&mut file, &mut chunk)?;
        if read == 0 {
            break;
        }
        hasher.update(&chunk[..read]);
    }
    Ok(hasher.matches(checksum))
}

/// The SHA-256 nodejs.org lists for `file` in a `SHASUMS256.txt` (`<hex>  <file>` per line).
pub(super) fn sha256_from_shasums(shasums: &str, file: &str) -> Option<Checksum> {
    shasums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hex = parts.next()?;
        let name = parts.next()?;
        (name == file && parts.next().is_none())
            .then(|| Checksum::sha256_hex(hex))
            .flatten()
    })
}

/// A client for big downloads, through the proxy from Settings. Unlike `support::http_client`
/// it has no 30-second cap on the whole request, only on connecting.
fn download_client() -> Result<reqwest::Client, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    super::super::proxy::apply_to_client(
        reqwest::Client::builder()
            .user_agent(concat!("Misty/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(DOWNLOAD_TIMEOUT),
    )
    .build()
    .map_err(|error| error.to_string())
}

/// A small text from `url` (a version, a manifest, a checksum list).
pub(super) async fn fetch_text(url: &str) -> Result<String, String> {
    let client = super::support::http_client()?;
    let response = tokio::time::timeout(METADATA_TIMEOUT, client.get(url).send())
        .await
        .map_err(|_| format!("{url} didn't answer in time."))?
        .map_err(|error| format!("Couldn't reach {url}: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("{url} answered {}.", response.status()));
    }
    response
        .text()
        .await
        .map_err(|error| format!("Couldn't read {url}: {error}"))
}

pub(super) async fn fetch_json(url: &str) -> Result<serde_json::Value, String> {
    let text = fetch_text(url).await?;
    serde_json::from_str(&text).map_err(|_| format!("{url} didn't send what Misty expected."))
}

/// Downloads `url` to `dest`, reporting progress, and keeps it only if it matches `checksum`.
pub(super) async fn download_verified(
    url: &str,
    dest: &Path,
    checksum: &Checksum,
    reporter: &ProgressReporter,
) -> Result<(), String> {
    let partial = partial_path(dest);
    if let Some(parent) = dest.parent() {
        file_access::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let result = stream_to(url, &partial, checksum, reporter).await;
    match result {
        Ok(true) => {
            file_access::fs::rename(&partial, dest).map_err(|error| error.to_string())?;
            reporter.emit(
                "stdout",
                Some("The download matches its published checksum.".into()),
                None,
            );
            Ok(())
        }
        Ok(false) => {
            let _ = file_access::fs::remove_file(&partial);
            Err(
                "The download didn't match its published checksum, so it was thrown away. \
                 Try again."
                    .into(),
            )
        }
        Err(error) => {
            let _ = file_access::fs::remove_file(&partial);
            Err(error)
        }
    }
}

fn partial_path(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().unwrap_or_default().to_os_string();
    name.push(".partial");
    dest.with_file_name(name)
}

async fn stream_to(
    url: &str,
    partial: &Path,
    checksum: &Checksum,
    reporter: &ProgressReporter,
) -> Result<bool, String> {
    reporter.emit("stdout", Some(format!("Downloading {url}")), None);
    let client = download_client()?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Couldn't download {url}: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("{url} answered {}.", response.status()));
    }
    let total = response.content_length();
    let mut file = file_access::fs::File::create(partial).map_err(|error| error.to_string())?;
    let mut hasher = Hasher::for_checksum(checksum);
    let mut received: u64 = 0;
    let mut reported_tenth = 0;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("The download stopped: {error}"))?
    {
        hasher.update(&chunk);
        file.write_all(&chunk).map_err(|error| error.to_string())?;
        received += chunk.len() as u64;
        if let Some(total) = total.filter(|total| *total > 0) {
            let tenth = (received * 10 / total).min(10);
            if tenth > reported_tenth {
                reported_tenth = tenth;
                reporter.emit("stdout", Some(format!("{}%", tenth * 10)), None);
            }
        }
    }
    file.flush().map_err(|error| error.to_string())?;
    drop(file);
    Ok(hasher.matches(checksum))
}

/// Unpacks `archive` (`.tar.gz`, `.tgz` or `.zip`) into `into` with the system's own `tar`
/// (bsdtar on macOS and Windows reads zip too), dropping `strip` leading folders.
pub(super) async fn unpack(archive: &Path, into: &Path, strip: u32) -> Result<(), String> {
    file_access::fs::create_dir_all(into).map_err(|error| error.to_string())?;
    let mut command = tokio::process::Command::new(system_tar());
    command.arg("-xf").arg(archive).arg("-C").arg(into);
    if strip > 0 {
        command.arg(format!("--strip-components={strip}"));
    }
    let output = super::run_capture(&mut command, Duration::from_secs(300))
        .await
        .map_err(|error| format!("Couldn't unpack {}: {error}", archive.display()))?;
    if output.status.is_some_and(|status| status.success()) {
        Ok(())
    } else {
        Err(format!(
            "Couldn't unpack {}: {}",
            archive.display(),
            super::tail(&output.stderr, 400)
        ))
    }
}

/// The system's `tar`, by its full path where it has a known one, so a folder can't shadow it.
fn system_tar() -> PathBuf {
    if cfg!(windows) {
        let root = std::env::var("SystemRoot")
            .ok()
            .filter(|root| !root.trim().is_empty())
            .unwrap_or_else(|| "C:\\Windows".to_string());
        return PathBuf::from(root).join("System32").join("tar.exe");
    }
    for candidate in ["/usr/bin/tar", "/bin/tar"] {
        if super::is_file_outside_gate(Path::new(candidate)) {
            return PathBuf::from(candidate);
        }
    }
    PathBuf::from("tar")
}

/// Marks a downloaded program runnable.
pub(super) fn make_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file_access::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}
