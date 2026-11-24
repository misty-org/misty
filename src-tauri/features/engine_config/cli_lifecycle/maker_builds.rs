use std::path::{Path, PathBuf};

use super::downloads::{self, Checksum};
use super::ProgressReporter;
use crate::engines::support::paths::{engine_install_dir, InstallRoot};

#[path = "antigravity_build.rs"]
pub(super) mod antigravity;
#[path = "codex_build.rs"]
pub(super) mod codex;

const CLAUDE_RELEASES: &str = "https://downloads.claude.ai/claude-code-releases";

#[derive(Debug, Clone, Copy)]
pub(super) struct Target<'a> {
    pub(super) os: &'a str,
    pub(super) arch: &'a str,
    pub(super) musl: bool,
}

impl Target<'static> {
    pub(super) fn this_computer() -> Self {
        Target {
            os: std::env::consts::OS,
            arch: std::env::consts::ARCH,
            musl: is_musl(),
        }
    }
}

#[allow(clippy::disallowed_methods)]
fn is_musl() -> bool {
    cfg!(target_os = "linux")
        && (Path::new("/lib/libc.musl-x86_64.so.1").exists()
            || Path::new("/lib/libc.musl-aarch64.so.1").exists()
            || Path::new("/etc/alpine-release").exists())
}

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

pub(super) fn claude_checksum(manifest: &serde_json::Value, platform: &str) -> Option<Checksum> {
    manifest
        .get("platforms")?
        .get(platform)?
        .get("checksum")?
        .as_str()
        .and_then(Checksum::sha256_hex)
}

fn program_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

pub(super) fn program_path(engine: &str) -> PathBuf {
    program_path_in(&InstallRoot::here(), engine)
}

pub(super) fn program_path_in(root: &InstallRoot, engine: &str) -> PathBuf {
    let base = super::cli_binary_name(engine);
    root.engine_dir(engine).join("bin").join(program_name(base))
}

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
        _ => format!(
            "Download Antigravity's build from the release server its installer uses, check it \
             against the SHA-512 in its manifest, and put it in {into}"
        ),
    }
}

pub(super) fn available(engine: &str, target: Target) -> bool {
    match engine {
        "claude" => claude_platform(target).is_some(),
        "codex" => codex::codex_target(target).is_some(),
        "agy" => antigravity::agy_platform(target).is_some(),
        _ => false,
    }
}

pub(super) async fn install(engine: &str, reporter: &ProgressReporter) -> Result<(), String> {
    let target = Target::this_computer();
    match engine {
        "claude" => install_claude(target, reporter).await,
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
