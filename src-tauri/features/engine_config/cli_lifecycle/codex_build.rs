// Codex's published build, downloaded by Misty instead of running `install.sh` or `install.ps1`.
// Both scripts add their folder to the person's shell profile (or Windows' user PATH) and take no
// option to skip it, and they keep the program itself in `~/.codex/packages`. This fetches what
// they fetch, from where they fetch it:
//
// - The release: `releases.openai.com/codex/channels/latest`, else GitHub's latest `rust-v*`
//   release, as the scripts fall back to it.
// - The build: `codex-package-<target>.tar.gz` from that release, checked against the SHA-256 the
//   release lists for it (the scripts check the same file against `codex-package_SHA256SUMS`,
//   whose own SHA-256 comes from that same release listing).
//
// The package unpacks whole into `~/.misty/engines/codex` (`bin/codex`, with its `codex-path` and
// `codex-resources` beside it, where Codex looks for them).

use std::path::Path;

use super::super::downloads::{self, Checksum};
use super::super::ProgressReporter;
use super::Target;
use crate::engines::support::paths::engine_install_dir;

const RELEASES: &str = "https://releases.openai.com/codex";
const GITHUB_LATEST: &str = "https://api.github.com/repos/openai/codex/releases/latest";
const GITHUB_DOWNLOADS: &str = "https://github.com/openai/codex/releases/download";

/// Codex's target triple for this system, as its scripts name it. Linux builds are static (musl).
pub(in super::super) fn codex_target(target: Target) -> Option<String> {
    let arch = match target.arch {
        "aarch64" => "aarch64",
        "x86_64" => "x86_64",
        _ => return None,
    };
    let rest = match target.os {
        "macos" => "apple-darwin",
        "linux" => "unknown-linux-musl",
        "windows" => "pc-windows-msvc",
        _ => return None,
    };
    Some(format!("{arch}-{rest}"))
}

/// The build's file name in a release.
pub(in super::super) fn package_name(target: &str) -> String {
    format!("codex-package-{target}.tar.gz")
}

/// The version a release names (`rust-v0.168.0` → `0.168.0`).
pub(in super::super) fn release_version(release: &serde_json::Value) -> Option<String> {
    let tag = release.get("tag_name")?.as_str()?;
    let version = tag.strip_prefix("rust-v")?;
    let plain = version
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'));
    (plain && super::super::parse_version(version).is_some()).then(|| version.to_string())
}

/// The SHA-256 a release lists for `asset` (`"digest": "sha256:<hex>"`).
pub(in super::super) fn asset_checksum(
    release: &serde_json::Value,
    asset: &str,
) -> Option<Checksum> {
    release
        .get("assets")?
        .as_array()?
        .iter()
        .find(|entry| entry.get("name").and_then(serde_json::Value::as_str) == Some(asset))?
        .get("digest")?
        .as_str()?
        .strip_prefix("sha256:")
        .and_then(Checksum::sha256_hex)
}

/// Downloads and checks Codex's build, then puts it in its folder in place of an older one.
pub(super) async fn install(target: Target<'_>, reporter: &ProgressReporter) -> Result<(), String> {
    let build = codex_target(target).ok_or("Codex isn't built for this system.")?;
    let asset = package_name(&build);
    let (release, from_openai) =
        match downloads::fetch_json(&format!("{RELEASES}/channels/latest")).await {
            Ok(release) if asset_checksum(&release, &asset).is_some() => (release, true),
            _ => (downloads::fetch_json(GITHUB_LATEST).await?, false),
        };
    let version = release_version(&release).ok_or("Codex's release didn't name a version.")?;
    let checksum = asset_checksum(&release, &asset)
        .ok_or_else(|| format!("Codex {version} has no checked build for {build}."))?;
    let url = if from_openai {
        format!("{RELEASES}/releases/{version}/{asset}")
    } else {
        format!("{GITHUB_DOWNLOADS}/rust-v{version}/{asset}")
    };
    reporter.emit("stdout", Some(format!("Codex {version} for {build}")), None);
    let folder = engine_install_dir("codex");
    let download = folder.join(format!("codex-package-{version}.tar.gz"));
    downloads::download_verified(&url, &download, &checksum, reporter).await?;
    let staging = folder.join(format!("unpack-{}", uuid::Uuid::new_v4().simple()));
    let unpacked = downloads::unpack(&download, &staging, 0).await;
    let _ = file_access::fs::remove_file(&download);
    let placed = unpacked.and_then(|()| place(&staging, &folder));
    let _ = file_access::fs::remove_dir_all(&staging);
    placed
}

/// Moves the unpacked package's top-level entries into `folder`, each replacing an older one.
fn place(staging: &Path, folder: &Path) -> Result<(), String> {
    let program = staging
        .join("bin")
        .join(if cfg!(windows) { "codex.exe" } else { "codex" });
    if !file_access::fs::is_file(&program) {
        return Err("Codex's download didn't hold the program Misty expected.".into());
    }
    let entries = file_access::fs::read_dir(staging).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let dest = folder.join(entry.file_name());
        if file_access::fs::is_dir(&dest) {
            file_access::fs::remove_dir_all(&dest).map_err(|error| error.to_string())?;
        } else if file_access::fs::symlink_metadata(&dest).is_ok() {
            file_access::fs::remove_file(&dest).map_err(|error| error.to_string())?;
        }
        file_access::fs::rename(entry.path(), &dest).map_err(|error| error.to_string())?;
    }
    Ok(())
}
