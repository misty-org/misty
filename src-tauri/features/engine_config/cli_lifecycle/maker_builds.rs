// The makers' published builds Misty downloads itself, because their installers can't be pointed
// at Misty's folder or would change the person's shell profile: Claude Code's `install.sh` always
// runs `claude install` into `~/.local`, OpenCode's always writes `~/.opencode/bin`, and Codex's
// and Antigravity's scripts add their folder to the shell profile with no way to skip it. Each
// comes from the same place its script fetches it, with the same check or a stronger one:
//
// - Claude Code: `downloads.claude.ai/claude-code-releases/<version>/<platform>/claude`, checked
//   against the SHA-256 in that version's `manifest.json`, as `install.sh` and `install.ps1` do.
// - OpenCode: the npm registry's `@opencode/cli-<target>` tarball its script fetches, checked
//   against the registry's SHA-512 integrity (the script itself checks nothing).
// - Codex: its release's `codex-package-<target>.tar.gz` (`codex_build.rs`).
// - Antigravity: the build its release manifest names, checked against its SHA-512
//   (`antigravity_build.rs`).

use std::path::{Path, PathBuf};

use super::downloads::{self, Checksum};
use super::ProgressReporter;
use crate::engines::support::paths::{engine_install_dir, InstallRoot};

#[path = "antigravity_build.rs"]
pub(super) mod antigravity;
#[path = "codex_build.rs"]
pub(super) mod codex;

const CLAUDE_RELEASES: &str = "https://downloads.claude.ai/claude-code-releases";
const OPENCODE_LATEST: &str = "https://opencode.ai/update/api/latest/cli/npm";
const NPM_REGISTRY: &str = "https://registry.npmjs.org";

/// The system a build is picked for.
#[derive(Debug, Clone, Copy)]
pub(super) struct Target<'a> {
    pub(super) os: &'a str,
    pub(super) arch: &'a str,
    /// Linux on musl (Alpine and the like).
    pub(super) musl: bool,
    /// An x86-64 CPU with AVX2; OpenCode has a baseline build for ones without.
    pub(super) avx2: bool,
}

impl Target<'static> {
    pub(super) fn this_computer() -> Self {
        Target {
            os: std::env::consts::OS,
            arch: std::env::consts::ARCH,
            musl: is_musl(),
            avx2: has_avx2(),
        }
    }
}

#[allow(clippy::disallowed_methods)] // Only whether the C library is there; nothing is read.
fn is_musl() -> bool {
    cfg!(target_os = "linux")
        && (Path::new("/lib/libc.musl-x86_64.so.1").exists()
            || Path::new("/lib/libc.musl-aarch64.so.1").exists()
            || Path::new("/etc/alpine-release").exists())
}

fn has_avx2() -> bool {
    #[cfg(target_arch = "x86_64")]
    {
        std::arch::is_x86_feature_detected!("avx2")
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        true
    }
}

/// Claude Code's platform name in its manifest.
pub(super) fn claude_platform(target: Target) -> Option<String> {
    let arch = match target.arch {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        _ => return None,
    };
    match target.os {
        "macos" => Some(format!("darwin-{arch}")),
        "linux" if target.musl => Some(format!("linux-{arch}-musl")),
        "linux" => Some(format!("linux-{arch}")),
        "windows" => Some(format!("win32-{arch}")),
        _ => None,
    }
}

/// The SHA-256 `manifest.json` gives for `platform`.
pub(super) fn claude_checksum(manifest: &serde_json::Value, platform: &str) -> Option<Checksum> {
    manifest
        .get("platforms")?
        .get(platform)?
        .get("checksum")?
        .as_str()
        .and_then(Checksum::sha256_hex)
}

/// OpenCode's build name (`darwin-arm64`, `linux-x64-baseline-musl`, …). Windows isn't offered
/// here: OpenCode publishes no Windows script, so Windows installs it through npm.
pub(super) fn opencode_target(target: Target) -> Option<String> {
    let os = match target.os {
        "macos" => "darwin",
        "linux" => "linux",
        _ => return None,
    };
    let arch = match target.arch {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        _ => return None,
    };
    let mut name = format!("{os}-{arch}");
    if arch == "x64" && !target.avx2 {
        name.push_str("-baseline");
    }
    if os == "linux" && target.musl {
        name.push_str("-musl");
    }
    Some(name)
}

fn program_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

/// Where Misty keeps an engine's downloaded program.
pub(super) fn program_path(engine: &str) -> PathBuf {
    program_path_in(&InstallRoot::here(), engine)
}

/// [`program_path`] for Misty's folder at `root`.
pub(super) fn program_path_in(root: &InstallRoot, engine: &str) -> PathBuf {
    let base = super::cli_binary_name(engine);
    root.engine_dir(engine).join("bin").join(program_name(base))
}

/// What a plan says this route does, for Show details.
pub(super) fn plan_step(engine: &str) -> String {
    let into = super::shown_path(&engine_install_dir(engine).join("bin"));
    match engine {
        "claude" => format!(
            "Download Claude Code from downloads.claude.ai, check it against the SHA-256 in its \
             release manifest, and put it in {into}"
        ),
        "codex" => format!(
            "Download Codex's build from releases.openai.com, check it against the SHA-256 its \
             release lists, and put it in {}",
            super::shown_path(&engine_install_dir(engine))
        ),
        "agy" => format!(
            "Download Antigravity's build from the release server its installer uses, check it \
             against the SHA-512 in its manifest, and put it in {into}"
        ),
        _ => format!(
            "Download OpenCode's build from the npm registry, check it against the registry's \
             SHA-512, and put it in {into}"
        ),
    }
}

/// Whether Misty can download this engine's build for this computer.
pub(super) fn available(engine: &str, target: Target) -> bool {
    match engine {
        "claude" => claude_platform(target).is_some(),
        "opencode" => opencode_target(target).is_some(),
        "codex" => codex::codex_target(target).is_some(),
        "agy" => antigravity::agy_platform(target).is_some(),
        _ => false,
    }
}

/// Downloads and checks the engine's build into its folder, replacing an older one.
pub(super) async fn install(engine: &str, reporter: &ProgressReporter) -> Result<(), String> {
    let target = Target::this_computer();
    match engine {
        "claude" => install_claude(target, reporter).await,
        "opencode" => install_opencode(target, reporter).await,
        "codex" => codex::install(target, reporter).await,
        "agy" => antigravity::install(target, reporter).await,
        _ => Err(format!("Misty doesn't download {engine}'s build itself.")),
    }
}

async fn install_claude(target: Target<'_>, reporter: &ProgressReporter) -> Result<(), String> {
    let platform = claude_platform(target).ok_or("Claude Code isn't built for this system.")?;
    let version = downloads::fetch_text(&format!("{CLAUDE_RELEASES}/latest"))
        .await?
        .trim()
        .to_string();
    if super::parse_version(&version).is_none()
        || !version.starts_with(|c: char| c.is_ascii_digit())
    {
        return Err(
            "downloads.claude.ai didn't give a version. It may not be reachable from here.".into(),
        );
    }
    reporter.emit(
        "stdout",
        Some(format!("Claude Code {version} for {platform}")),
        None,
    );
    let manifest =
        downloads::fetch_json(&format!("{CLAUDE_RELEASES}/{version}/manifest.json")).await?;
    let checksum = claude_checksum(&manifest, &platform)
        .ok_or_else(|| format!("Claude Code's manifest has no build for {platform}."))?;
    let file = program_name("claude");
    let url = format!("{CLAUDE_RELEASES}/{version}/{platform}/{file}");
    let dest = program_path("claude");
    downloads::download_verified(&url, &dest, &checksum, reporter).await?;
    downloads::make_executable(&dest)
}

async fn install_opencode(target: Target<'_>, reporter: &ProgressReporter) -> Result<(), String> {
    let build = opencode_target(target).ok_or("OpenCode isn't built for this system.")?;
    let latest = downloads::fetch_json(OPENCODE_LATEST).await?;
    let version = latest
        .get("version")
        .and_then(serde_json::Value::as_str)
        .filter(|version| super::parse_version(version).is_some())
        .ok_or("opencode.ai didn't give a version.")?;
    let package = latest
        .pointer("/metadata/package")
        .or_else(|| latest.get("package"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or("@opencode/cli");
    let scope = package
        .strip_suffix("/cli")
        .filter(|scope| scope.starts_with('@') && !scope.contains(['/', '%', '?', '#']))
        .ok_or("opencode.ai named a package Misty doesn't know.")?;
    let name = format!("{scope}/cli-{build}");
    let info = downloads::fetch_json(&format!(
        "{NPM_REGISTRY}/{}/{version}",
        name.replace('/', "%2f")
    ))
    .await?;
    let tarball = info
        .pointer("/dist/tarball")
        .and_then(serde_json::Value::as_str)
        .filter(|url| url.starts_with(&format!("{NPM_REGISTRY}/")))
        .ok_or("The npm registry gave no download for OpenCode's build.")?;
    let checksum = info
        .pointer("/dist/integrity")
        .and_then(serde_json::Value::as_str)
        .and_then(Checksum::from_npm_integrity)
        .ok_or("The npm registry gave no SHA-512 for OpenCode's build.")?;
    reporter.emit(
        "stdout",
        Some(format!("OpenCode {version} for {build}")),
        None,
    );
    let folder = engine_install_dir("opencode");
    let download = folder.join(format!("cli-{build}-{version}.tgz"));
    downloads::download_verified(tarball, &download, &checksum, reporter).await?;
    let staging = folder.join(format!("unpack-{}", uuid::Uuid::new_v4().simple()));
    let unpacked = downloads::unpack(&download, &staging, 0).await;
    let _ = file_access::fs::remove_file(&download);
    let placed = match unpacked {
        Ok(()) => place(
            &staging.join("package").join("bin").join("opencode"),
            &program_path("opencode"),
        ),
        Err(error) => Err(error),
    };
    let _ = file_access::fs::remove_dir_all(&staging);
    placed
}

/// Moves an unpacked program to `dest`, where Misty keeps the engine's program.
fn place(unpacked: &Path, dest: &Path) -> Result<(), String> {
    if !file_access::fs::is_file(unpacked) {
        return Err("The download didn't hold the program Misty expected.".into());
    }
    if let Some(parent) = dest.parent() {
        file_access::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    file_access::fs::rename(unpacked, dest).map_err(|error| error.to_string())?;
    downloads::make_executable(dest)
}
