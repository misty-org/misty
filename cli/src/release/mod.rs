mod build;
mod config;
mod metadata;
mod model;
mod preflight;
mod publish;
mod state;
mod verification;
mod windows_signing;

use std::{
    fs,
    io::{self, Write},
};

use anyhow::{bail, Result};
use chrono::Utc;
use sha2::{Digest, Sha256};

use crate::{
    artifacts, checks,
    process::{npm, CommandSpec},
    workspace::Workspace,
};
use model::{
    PlatformManifest, ReleaseManifest, MACOS_PLATFORM, PUBLIC_REPOSITORY, RELEASE_MANIFEST_NAME,
    WINDOWS_ARM_PLATFORM, WINDOWS_PLATFORM,
};

pub use publish::{publish, verify};

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub enum ReleaseOs {
    Macos,
    Windows,
}

pub fn check(workspace: &Workspace) -> Result<()> {
    preflight::check(workspace)
}

pub fn start(
    workspace: &Workspace,
    raw_version: &str,
    dry_run: bool,
    os: &[ReleaseOs],
) -> Result<()> {
    workspace.validate()?;
    let version = state::normalize_version(raw_version)?;
    let platforms = selected_platforms(os)?;
    state::verify_versions(workspace, &version)?;
    preflight::check(workspace)?;
    state::require_release_checkout(workspace, !dry_run)?;
    if !dry_run {
        checks::release(workspace)?;
    }
    let config = config::build()?;
    let config_bytes = serde_json::to_vec_pretty(&config)?;
    let source_commit = state::git(workspace, &workspace.misty, ["rev-parse", "HEAD"])?;
    let tag = format!("misty-v{version}");
    let root = state::release_root(workspace, &version);
    fs::create_dir_all(&root)?;
    let config_path = root.join("tauri.release.conf.json");
    fs::write(&config_path, [&config_bytes[..], b"\n"].concat())?;
    let manifest = ReleaseManifest {
        version: version.clone(),
        tag: tag.clone(),
        source_commit,
        cli_version: env!("CARGO_PKG_VERSION").to_owned(),
        config_sha256: artifacts::sha256(&config_path)?,
        created_at: Utc::now(),
        platforms,
        build_environment: config::public_environment()?,
    };
    let manifest_path = root.join(RELEASE_MANIFEST_NAME);
    manifest.write(&manifest_path)?;

    if dry_run {
        println!("Dry run: would create source tag {tag} and a draft release.");
        println!("Manifest: {}", manifest_path.display());
        return Ok(());
    }
    state::ensure_source_tag(workspace, &manifest)?;
    state::create_or_update_draft(workspace, &manifest, &manifest_path)?;
    println!("Release {} started as a draft.", manifest.tag);
    Ok(())
}

pub fn build(workspace: &Workspace, raw_version: &str, dry_run: bool) -> Result<()> {
    preflight::check(workspace)?;
    let version = state::normalize_version(raw_version)?;
    let manifest = state::load_manifest(workspace, &version, !dry_run)?;
    state::verify_build_identity(workspace, &manifest)?;
    let platforms = local_platforms(&manifest)?;
    let public_environment = config::public_environment()?;
    if manifest.build_environment != public_environment {
        bail!("release API/website configuration differs from the release-start manifest");
    }
    let config_path = state::release_root(workspace, &version).join("tauri.release.conf.json");
    let config = config::build()?;
    let bytes = format!("{}\n", serde_json::to_string_pretty(&config)?);
    if format!("{:x}", Sha256::digest(bytes.as_bytes())) != manifest.config_sha256 {
        bail!("release configuration differs from the release-start manifest");
    }
    if dry_run {
        println!(
            "Dry run: release identity and {} configuration are valid.",
            platforms.join(", ")
        );
        return Ok(());
    }
    fs::write(&config_path, bytes)?;

    CommandSpec::new(npm()).args(["ci"]).run(&workspace.misty)?;
    checks::app(workspace)?;
    for (name, value) in public_environment {
        std::env::set_var(name, value);
    }
    CommandSpec::new(npm())
        .args(["run", "build:desktop"])
        .run(&workspace.misty)?;
    // Shared metadata comes from the macOS build when the release has one.
    let builds_shared = platforms.contains(&MACOS_PLATFORM)
        || !manifest.platforms.iter().any(|item| item == MACOS_PLATFORM);
    if builds_shared {
        let shared = state::release_root(workspace, &version).join("shared");
        metadata::generate(workspace, &shared)?;
    }
    for platform in platforms {
        build::platform(workspace, &manifest, platform, &config_path)?;
    }
    Ok(())
}

pub fn upload(workspace: &Workspace, raw_version: &str, dry_run: bool) -> Result<()> {
    let version = state::normalize_version(raw_version)?;
    let manifest = state::load_manifest(workspace, &version, !dry_run)?;
    state::verify_build_identity(workspace, &manifest)?;
    let platforms = local_platforms(&manifest)?;
    let mut files = Vec::new();
    for platform in &platforms {
        let platform_root = state::release_root(workspace, &version).join(platform);
        let platform_manifest = platform_root.join(format!("release-{platform}.json"));
        if !platform_manifest.is_file() {
            bail!("build {platform} before uploading");
        }
        let parsed = PlatformManifest::read(&platform_manifest)?;
        state::verify_platform_identity(&manifest, &parsed)?;
        verification::downloaded_files(&platform_root, &parsed)?;
        files.extend(artifacts::files_under(&platform_root)?);
    }
    let shared = state::release_root(workspace, &version).join("shared");
    if shared.is_dir() {
        files.extend(artifacts::files_under(&shared)?);
    }
    if dry_run {
        for file in files {
            println!("would upload {}", file.display());
        }
        return Ok(());
    }
    state::gh_upload(workspace, &manifest.tag, &files)?;
    println!("Uploaded {} release artifacts.", platforms.join(", "));
    Ok(())
}

fn selected_platforms(os: &[ReleaseOs]) -> Result<Vec<String>> {
    if os.is_empty() {
        return Ok(build::current_platforms()?
            .iter()
            .map(|platform| (*platform).to_owned())
            .collect());
    }
    let mut platforms = Vec::new();
    if os.contains(&ReleaseOs::Macos) {
        platforms.push(MACOS_PLATFORM.to_owned());
    }
    if os.contains(&ReleaseOs::Windows) {
        platforms.extend([WINDOWS_PLATFORM.to_owned(), WINDOWS_ARM_PLATFORM.to_owned()]);
    }
    Ok(platforms)
}

/// The release's platforms this machine builds; at least one.
fn local_platforms(release: &ReleaseManifest) -> Result<Vec<&'static str>> {
    let platforms: Vec<&'static str> = build::current_platforms()?
        .iter()
        .copied()
        .filter(|platform| release.platforms.iter().any(|item| item == platform))
        .collect();
    if platforms.is_empty() {
        bail!(
            "release {} includes no platform this machine builds; selected platforms: {}",
            release.version,
            release.platforms.join(", ")
        );
    }
    Ok(platforms)
}

#[cfg(test)]
mod tests;
