mod build;
mod config;
mod metadata;
mod model;
mod state;
mod verification;

use std::{
    fs,
    io::{self, Write},
};

use anyhow::{bail, Result};
use chrono::Utc;

use crate::{
    artifacts, checks,
    process::{npm, CommandSpec},
    workspace::Workspace,
};
use model::{PlatformManifest, ReleaseManifest, PUBLIC_REPOSITORY, RELEASE_MANIFEST_NAME};

pub fn start(workspace: &Workspace, raw_version: &str, dry_run: bool) -> Result<()> {
    workspace.validate()?;
    let version = state::normalize_version(raw_version)?;
    state::verify_versions(workspace, &version)?;
    state::require_release_checkout(workspace, dry_run)?;
    if !dry_run {
        checks::misty(workspace)?;
    }
    let config = config::build()?;
    let config_bytes = serde_json::to_vec_pretty(&config)?;
    let source_commit = state::git(workspace, &workspace.misty, ["rev-parse", "HEAD"])?;
    let cli_commit = state::git(workspace, &workspace.cli, ["rev-parse", "HEAD"])?;
    let tag = format!("misty-v{version}");
    let root = state::release_root(workspace, &version);
    fs::create_dir_all(&root)?;
    let config_path = root.join("tauri.release.conf.json");
    fs::write(&config_path, [&config_bytes[..], b"\n"].concat())?;
    let manifest = ReleaseManifest {
        version: version.clone(),
        tag: tag.clone(),
        source_commit,
        cli_commit,
        cli_version: env!("CARGO_PKG_VERSION").to_owned(),
        config_sha256: artifacts::sha256(&config_path)?,
        created_at: Utc::now(),
        platforms: vec!["macos-universal".to_owned(), "windows-x86_64".to_owned()],
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
    let version = state::normalize_version(raw_version)?;
    let manifest = state::load_manifest(workspace, &version, !dry_run)?;
    state::verify_build_identity(workspace, &manifest)?;
    let platform = build::current_platform()?;
    let config_path = state::release_root(workspace, &version).join("tauri.release.conf.json");
    let config = config::build()?;
    fs::write(
        &config_path,
        format!("{}\n", serde_json::to_string_pretty(&config)?),
    )?;
    if artifacts::sha256(&config_path)? != manifest.config_sha256 {
        bail!("release configuration differs from the release-start manifest");
    }
    if dry_run {
        println!("Dry run: release identity and {platform} configuration are valid.");
        return Ok(());
    }

    CommandSpec::new(npm()).args(["ci"]).run(&workspace.misty)?;
    CommandSpec::new(npm())
        .args(["run", "build:desktop"])
        .run(&workspace.misty)?;
    if platform == "macos-universal" {
        let shared = state::release_root(workspace, &version).join("shared");
        metadata::generate(workspace, &shared)?;
    }
    build::platform(workspace, &manifest, platform, &config_path)?;
    Ok(())
}

pub fn upload(workspace: &Workspace, raw_version: &str, dry_run: bool) -> Result<()> {
    let version = state::normalize_version(raw_version)?;
    let manifest = state::load_manifest(workspace, &version, !dry_run)?;
    state::verify_build_identity(workspace, &manifest)?;
    let platform = build::current_platform()?;
    let platform_root = state::release_root(workspace, &version).join(platform);
    let platform_manifest = platform_root.join(format!("release-{platform}.json"));
    if !platform_manifest.is_file() {
        bail!("build {platform} before uploading");
    }
    let parsed = PlatformManifest::read(&platform_manifest)?;
    state::verify_platform_identity(&manifest, &parsed)?;
    let mut files = artifacts::files_under(&platform_root)?;
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
    println!("Uploaded {platform} release artifacts.");
    Ok(())
}

pub fn verify(workspace: &Workspace, raw_version: &str, dry_run: bool) -> Result<()> {
    let version = state::normalize_version(raw_version)?;
    let manifest = state::load_manifest(workspace, &version, !dry_run)?;
    if dry_run {
        verification::local_platforms(workspace, &manifest)?;
        println!("Dry run: local Mac and Windows manifests are internally consistent.");
        return Ok(());
    }

    let verification_root = state::release_root(workspace, &version).join("verification");
    if verification_root.exists() {
        fs::remove_dir_all(&verification_root)?;
    }
    fs::create_dir_all(&verification_root)?;
    CommandSpec::new("gh")
        .args([
            "release",
            "download",
            &manifest.tag,
            "--repo",
            PUBLIC_REPOSITORY,
            "--dir",
        ])
        .arg(verification_root.as_os_str())
        .run(&workspace.root)?;
    let mac = PlatformManifest::read(&verification_root.join("release-macos-universal.json"))?;
    let windows = PlatformManifest::read(&verification_root.join("release-windows-x86_64.json"))?;
    state::verify_platform_identity(&manifest, &mac)?;
    state::verify_platform_identity(&manifest, &windows)?;
    verification::downloaded_files(&verification_root, &mac)?;
    verification::downloaded_files(&verification_root, &windows)?;
    verification::shared_metadata(&verification_root)?;

    let latest = verification::latest_json(&manifest, &mac, &windows, &verification_root)?;
    fs::write(
        verification_root.join("latest.json"),
        format!("{}\n", serde_json::to_string_pretty(&latest)?),
    )?;
    artifacts::write_checksums(&verification_root)?;
    state::gh_upload(
        workspace,
        &manifest.tag,
        &[
            verification_root.join("latest.json"),
            verification_root.join("SHA256SUMS"),
        ],
    )?;
    println!("Release {} is complete and remains a draft.", manifest.tag);
    Ok(())
}

pub fn publish(workspace: &Workspace, raw_version: &str, yes: bool, dry_run: bool) -> Result<()> {
    let version = state::normalize_version(raw_version)?;
    verify(workspace, &version, dry_run)?;
    if dry_run {
        println!("Dry run: would publish misty-v{version}.");
        return Ok(());
    }
    if !yes {
        print!("Type `publish {version}` to make this prerelease public: ");
        io::stdout().flush()?;
        let mut response = String::new();
        io::stdin().read_line(&mut response)?;
        if response.trim() != format!("publish {version}") {
            bail!("publication canceled");
        }
    }
    CommandSpec::new("gh")
        .args([
            "release",
            "edit",
            &format!("misty-v{version}"),
            "--repo",
            PUBLIC_REPOSITORY,
            "--draft=false",
            "--prerelease",
        ])
        .run(&workspace.root)?;
    println!("Published Misty {version}.");
    Ok(())
}
