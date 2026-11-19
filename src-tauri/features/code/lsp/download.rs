//! Fetching what an install needs: version lookups, downloads hashed as they arrive (with their
//! progress sent to the window that asked), and unpacking. Every file is written through the
//! file gate, never by an archive library on its own, and no entry may land outside its folder.

use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest as _, Sha256};
use tauri::Emitter;

/// The event an install's progress goes out as, to the window that asked for it.
pub(super) const PROGRESS: &str = "misty://code-lsp-progress";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// Servers and Node.js are tens of megabytes; a slow line needs room.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(1200);
/// Progress goes out at most this often.
const PROGRESS_EVERY: Duration = Duration::from_millis(200);

/// What an install is doing, for the status row.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Step {
    /// Fetching Node.js, which the npm servers run on.
    Node,
    /// Downloading the server itself.
    Download,
    /// npm or Go is installing it; there are no byte counts.
    Install,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    language: &'static str,
    step: Step,
    received: u64,
    total: Option<u64>,
}

/// Sends an install's progress to one window. Background updates have none.
#[derive(Clone)]
pub(super) struct Progress {
    pub(super) app: tauri::AppHandle,
    pub(super) window: String,
    pub(super) language: &'static str,
}

impl Progress {
    pub(super) fn report(&self, step: Step, received: u64, total: Option<u64>) {
        let event = ProgressEvent {
            language: self.language,
            step,
            received,
            total,
        };
        let _ = self.app.emit_to(self.window.as_str(), PROGRESS, event);
    }
}

/// Reports a step through an optional reporter.
pub(super) fn report(progress: Option<&Progress>, step: Step, received: u64, total: Option<u64>) {
    if let Some(progress) = progress {
        progress.report(step, received, total);
    }
}

fn download_client() -> Result<reqwest::Client, String> {
    // Misty's builds carry rustls without a default provider; the app installs ring at launch.
    let _ = rustls::crypto::ring::default_provider().install_default();
    crate::engine_config::proxy::apply_to_client(
        reqwest::Client::builder()
            .user_agent(concat!("Misty/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(DOWNLOAD_TIMEOUT),
    )
    .build()
    .map_err(|error| error.to_string())
}

/// A small text: a version, a release, a checksum list.
pub(super) async fn text(url: &str) -> Result<String, String> {
    let client = crate::engine_config::support::http_client()?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Couldn't reach {url}: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("{url} answered {}.", response.status()));
    }
    response
        .text()
        .await
        .map_err(|error| format!("Couldn't read {url}: {error}"))
}

pub(super) async fn json(url: &str) -> Result<serde_json::Value, String> {
    let text = text(url).await?;
    serde_json::from_str(&text).map_err(|_| format!("{url} didn't send what Misty expected."))
}

/// Downloads `url` to `dest`, reporting progress, and returns the file's SHA-256 in hex.
pub(super) async fn to_file(
    url: &str,
    dest: &Path,
    step: Step,
    progress: Option<&Progress>,
) -> Result<String, String> {
    let client = download_client()?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Couldn't download {url}: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("{url} answered {}.", response.status()));
    }
    let total = response.content_length().filter(|total| *total > 0);
    let mut file = file_access::fs::File::create(dest).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut last = Instant::now();
    report(progress, step, 0, total);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("The download stopped: {error}"))?
    {
        hasher.update(&chunk);
        file.write_all(&chunk).map_err(|error| error.to_string())?;
        received += chunk.len() as u64;
        if last.elapsed() >= PROGRESS_EVERY {
            last = Instant::now();
            report(progress, step, received, total);
        }
    }
    file.flush().map_err(|error| error.to_string())?;
    report(progress, step, received, total.or(Some(received)));
    Ok(hex::encode(hasher.finalize()))
}

/// The SHA-256 a `SHASUMS256.txt` lists for `file` (`<hex>  <file>` per line).
pub(super) fn sha256_from_shasums(shasums: &str, file: &str) -> Option<String> {
    shasums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hex = parts.next()?;
        let name = parts.next()?;
        let valid = hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit());
        (name == file && parts.next().is_none() && valid).then(|| hex.to_ascii_lowercase())
    })
}

/// Unzips a `.gz` holding one program into `to`, marked runnable.
pub(super) fn gunzip(from: &Path, to: &Path) -> io::Result<()> {
    let input = file_access::fs::File::open(from)?;
    let mut decoder = flate2::read::GzDecoder::new(input);
    let mut output = file_access::fs::File::create(to)?;
    io::copy(&mut decoder, &mut output)?;
    output.flush()?;
    drop(output);
    make_executable(to)
}

/// Where an archive entry goes in `into`, after dropping `strip` leading folders. Nothing for an
/// entry that is one of those folders, or that would reach outside.
fn entry_target(into: &Path, entry: &Path, strip: usize) -> Option<PathBuf> {
    let mut parts = Vec::new();
    for part in entry.components() {
        match part {
            Component::Normal(name) => parts.push(name),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if parts.len() <= strip {
        return None;
    }
    let mut target = into.to_path_buf();
    for name in &parts[strip..] {
        target.push(name);
    }
    Some(target)
}

/// Whether a link at `link` pointing to `target` stays inside `into`, read without touching disk.
#[cfg(unix)]
fn link_stays_inside(into: &Path, link: &Path, target: &Path) -> bool {
    if target.is_absolute() {
        return false;
    }
    let Some(parent) = link.parent() else {
        return false;
    };
    let Ok(below) = parent.strip_prefix(into) else {
        return false;
    };
    let mut depth = below.components().count();
    for part in target.components() {
        match part {
            Component::Normal(_) => depth += 1,
            Component::CurDir => {}
            Component::ParentDir if depth > 0 => depth -= 1,
            _ => return false,
        }
    }
    true
}

/// Unpacks a `.tar.gz` into `into`, dropping `strip` leading folders.
pub(super) fn untar_gz(archive: &Path, into: &Path, strip: usize) -> io::Result<()> {
    let input = file_access::fs::File::open(archive)?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(input));
    file_access::fs::create_dir_all(into)?;
    for entry in tar.entries()? {
        let mut entry = entry?;
        let Some(target) = entry_target(into, &entry.path()?, strip) else {
            continue;
        };
        let kind = entry.header().entry_type();
        if kind.is_dir() {
            file_access::fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            file_access::fs::create_dir_all(parent)?;
        }
        if kind.is_symlink() {
            // Node.js links `bin/npm` and friends to their scripts; Misty runs the scripts
            // directly, but keeps the links that stay inside.
            #[cfg(unix)]
            if let Some(link) = entry.link_name()? {
                if link_stays_inside(into, &target, &link) {
                    let _ = file_access::fs::remove_file(&target);
                    file_access::fs::symlink(&link, &target)?;
                }
            }
            continue;
        }
        if !kind.is_file() {
            continue;
        }
        let mode = entry.header().mode().unwrap_or(0o644);
        let mut output = file_access::fs::File::create(&target)?;
        io::copy(&mut entry, &mut output)?;
        output.flush()?;
        drop(output);
        set_mode(&target, mode)?;
    }
    Ok(())
}

/// Unpacks a `.zip` into `into`, dropping `strip` leading folders.
pub(super) fn unzip(archive: &Path, into: &Path, strip: usize) -> io::Result<()> {
    let input = file_access::fs::File::open(archive)?;
    let mut zip = zip::ZipArchive::new(input).map_err(io::Error::other)?;
    file_access::fs::create_dir_all(into)?;
    for index in 0..zip.len() {
        let mut file = zip.by_index(index).map_err(io::Error::other)?;
        let Some(name) = file.enclosed_name() else {
            continue;
        };
        let Some(target) = entry_target(into, &name, strip) else {
            continue;
        };
        if file.is_dir() {
            file_access::fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            file_access::fs::create_dir_all(parent)?;
        }
        let mode = file.unix_mode();
        let mut output = file_access::fs::File::create(&target)?;
        io::copy(&mut file, &mut output)?;
        output.flush()?;
        drop(output);
        if let Some(mode) = mode {
            set_mode(&target, mode)?;
        }
    }
    Ok(())
}

/// Reads a whole small file, such as a package's manifest.
pub(super) fn read_small(path: &Path) -> io::Result<String> {
    let mut text = String::new();
    file_access::fs::File::open(path)?
        .take(4 * 1024 * 1024)
        .read_to_string(&mut text)?;
    Ok(text)
}

fn set_mode(path: &Path, mode: u32) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Only the permission bits; never set-user-id and the like from an archive.
        let mode = (mode & 0o777) | 0o600;
        file_access::fs::set_permissions(path, file_access::fs::Permissions::from_mode(mode))?;
    }
    #[cfg(not(unix))]
    let _ = (path, mode);
    Ok(())
}

pub(super) fn make_executable(path: &Path) -> io::Result<()> {
    set_mode(path, 0o755)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn archive_entries_stay_inside() {
        let into = Path::new("/staging/out");
        assert_eq!(
            entry_target(into, Path::new("node-v24/bin/node"), 1),
            Some(into.join("bin/node"))
        );
        assert_eq!(entry_target(into, Path::new("node-v24/"), 1), None);
        assert_eq!(entry_target(into, Path::new("node-v24/../../etc"), 1), None);
        assert_eq!(entry_target(into, Path::new("/etc/passwd"), 0), None);
    }

    #[cfg(unix)]
    #[test]
    fn links_may_not_point_outside() {
        let into = Path::new("/staging/out");
        let link = into.join("bin/npm");
        assert!(link_stays_inside(
            into,
            &link,
            Path::new("../lib/node_modules/npm/bin/npm-cli.js")
        ));
        assert!(!link_stays_inside(
            into,
            &link,
            Path::new("../../../etc/passwd")
        ));
        assert!(!link_stays_inside(into, &link, Path::new("/etc/passwd")));
    }

    #[test]
    fn checksums_are_found_by_file_name() {
        let hex = "a".repeat(64);
        let list = format!(
            "{hex}  node-v24.0.0-darwin-arm64.tar.gz\n{}  other.zip\n",
            "b".repeat(64)
        );
        assert_eq!(
            sha256_from_shasums(&list, "node-v24.0.0-darwin-arm64.tar.gz"),
            Some(hex)
        );
        assert_eq!(sha256_from_shasums(&list, "missing.zip"), None);
    }
}
