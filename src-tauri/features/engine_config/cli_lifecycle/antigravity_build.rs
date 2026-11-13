// Antigravity's published build, downloaded by Misty instead of running `install.sh` or
// `install.ps1`. Both scripts end by running `agy install`, which sets up the person's shell
// profile (or Windows' user PATH), and neither has an option to skip it; they also stop without
// updating when the program is already there. This does the part before that, from the same
// place and with the same check:
//
// - The manifest: `<release server>/manifests/<platform>.json`, naming the version, the build's
//   URL and its SHA-512.
// - The build: a `.tar.gz` holding the program as `antigravity` (macOS, Linux), or the program
//   itself (Windows), kept as `~/.misty/engines/agy/bin/agy`.

use super::super::downloads::{self, Checksum};
use super::super::ProgressReporter;
use super::Target;
use crate::engines::support::paths::engine_install_dir;

const RELEASE_SERVER: &str =
    "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app";

/// Antigravity's platform name in its manifests (`darwin_arm64`, `linux_amd64_musl`, …).
pub(in super::super) fn agy_platform(target: Target) -> Option<String> {
    let arch = match target.arch {
        "aarch64" => "arm64",
        "x86_64" => "amd64",
        _ => return None,
    };
    match target.os {
        "macos" => Some(format!("darwin_{arch}")),
        "linux" if target.musl => Some(format!("linux_{arch}_musl")),
        "linux" => Some(format!("linux_{arch}")),
        "windows" => Some(format!("windows_{arch}")),
        _ => None,
    }
}

/// What a manifest names: the version, the build's URL and its SHA-512.
pub(in super::super) fn manifest_build(
    manifest: &serde_json::Value,
) -> Option<(String, String, Checksum)> {
    let field = |key: &str| manifest.get(key).and_then(serde_json::Value::as_str);
    let version = field("version").filter(|v| super::super::parse_version(v).is_some())?;
    let url = field("url").filter(|url| url.starts_with("https://"))?;
    let checksum = field("sha512").and_then(Checksum::sha512_hex)?;
    Some((version.to_string(), url.to_string(), checksum))
}

/// Downloads and checks Antigravity's build into its folder, replacing an older one.
pub(super) async fn install(target: Target<'_>, reporter: &ProgressReporter) -> Result<(), String> {
    let platform = agy_platform(target).ok_or("Antigravity isn't built for this system.")?;
    let manifest =
        downloads::fetch_json(&format!("{RELEASE_SERVER}/manifests/{platform}.json")).await?;
    let (version, url, checksum) =
        manifest_build(&manifest).ok_or("Antigravity's release manifest wasn't readable.")?;
    reporter.emit(
        "stdout",
        Some(format!("Antigravity {version} for {platform}")),
        None,
    );
    let dest = super::program_path("agy");
    let archived = url
        .split(['?', '#'])
        .next()
        .unwrap_or(&url)
        .ends_with(".tar.gz");
    if !archived {
        downloads::download_verified(&url, &dest, &checksum, reporter).await?;
        return downloads::make_executable(&dest);
    }
    let folder = engine_install_dir("agy");
    let download = folder.join(format!("agy-{version}.tar.gz"));
    downloads::download_verified(&url, &download, &checksum, reporter).await?;
    let staging = folder.join(format!("unpack-{}", uuid::Uuid::new_v4().simple()));
    let unpacked = downloads::unpack(&download, &staging, 0).await;
    let _ = file_access::fs::remove_file(&download);
    let placed = unpacked.and_then(|()| super::place(&staging.join("antigravity"), &dest));
    let _ = file_access::fs::remove_dir_all(&staging);
    placed
}
