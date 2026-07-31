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
use model::{
    PlatformManifest, ReleaseManifest, MACOS_PLATFORM, PUBLIC_REPOSITORY, RELEASE_MANIFEST_NAME,
    WINDOWS_PLATFORM,
};

pub fn start(
    workspace: &Workspace,
    raw_version: &str,
    dry_run: bool,
    no_macos: bool,
    no_windows: bool,
) -> Result<()> {
    workspace.validate()?;
    let version = state::normalize_version(raw_version)?;
    let platforms = selected_platforms(no_macos, no_windows)?;
    state::verify_versions(workspace, &version)?;
    state::require_release_checkout(workspace, dry_run)?;
    state::require_clean_cli_checkout(workspace)?;
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
        platforms,
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
    require_selected_platform(&manifest, platform)?;
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
    if platform == MACOS_PLATFORM || !manifest.platforms.iter().any(|item| item == MACOS_PLATFORM) {
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
    require_selected_platform(&manifest, platform)?;
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
        println!(
            "Dry run: local manifests for {} are internally consistent.",
            manifest.platforms.join(", ")
        );
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
    let mut platform_manifests = Vec::new();
    for platform in &manifest.platforms {
        let platform_manifest =
            PlatformManifest::read(&verification_root.join(format!("release-{platform}.json")))?;
        state::verify_platform_identity(&manifest, &platform_manifest)?;
        verification::downloaded_files(&verification_root, &platform_manifest)?;
        platform_manifests.push(platform_manifest);
    }
    verification::shared_metadata(&verification_root)?;
    verification::reject_unexpected_assets(&verification_root, &manifest, &platform_manifests)?;

    let latest = verification::latest_json(&manifest, &platform_manifests, &verification_root)?;
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
    finalize_public_release(workspace, &version)?;
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

fn finalize_public_release(workspace: &Workspace, version: &str) -> Result<()> {
    let manifest = state::load_manifest(workspace, version, false)?;
    let verification_root = state::release_root(workspace, version).join("verification");
    let platform_manifests = manifest
        .platforms
        .iter()
        .map(|platform| {
            PlatformManifest::read(&verification_root.join(format!("release-{platform}.json")))
        })
        .collect::<Result<Vec<_>>>()?;
    let expected_latest: serde_json::Value =
        serde_json::from_slice(&fs::read(verification_root.join("latest.json"))?)?;
    let public_names = verification::public_asset_names(&platform_manifests)?;

    for path in artifacts::files_under(&verification_root)? {
        let Some(name) = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
        else {
            continue;
        };
        if !public_names.contains(&name) {
            state::gh_delete_asset(workspace, &manifest.tag, &name)?;
        }
    }

    let public_verification_root =
        state::release_root(workspace, version).join("public-verification");
    if public_verification_root.exists() {
        fs::remove_dir_all(&public_verification_root)?;
    }
    fs::create_dir_all(&public_verification_root)?;
    CommandSpec::new("gh")
        .args([
            "release",
            "download",
            &manifest.tag,
            "--repo",
            PUBLIC_REPOSITORY,
            "--dir",
        ])
        .arg(public_verification_root.as_os_str())
        .run(&workspace.root)?;
    verification::public_release(
        &public_verification_root,
        &platform_manifests,
        &expected_latest,
    )?;
    println!(
        "Finalized {} with only: {}",
        manifest.tag,
        public_names.into_iter().collect::<Vec<_>>().join(", ")
    );
    Ok(())
}

fn selected_platforms(no_macos: bool, no_windows: bool) -> Result<Vec<String>> {
    let mut platforms = Vec::new();
    if !no_macos {
        platforms.push(MACOS_PLATFORM.to_owned());
    }
    if !no_windows {
        platforms.push(WINDOWS_PLATFORM.to_owned());
    }
    if platforms.is_empty() {
        bail!("release start cannot exclude both macOS and Windows");
    }
    Ok(platforms)
}

fn require_selected_platform(release: &ReleaseManifest, platform: &str) -> Result<()> {
    if release.platforms.iter().any(|item| item == platform) {
        return Ok(());
    }
    bail!(
        "release {} does not include {platform}; selected platforms: {}",
        release.version,
        release.platforms.join(", ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_selection_defaults_to_both() {
        assert_eq!(
            selected_platforms(false, false).unwrap(),
            [MACOS_PLATFORM, WINDOWS_PLATFORM]
        );
    }

    #[test]
    fn platform_selection_can_exclude_either_platform() {
        assert_eq!(selected_platforms(false, true).unwrap(), [MACOS_PLATFORM]);
        assert_eq!(selected_platforms(true, false).unwrap(), [WINDOWS_PLATFORM]);
        assert!(selected_platforms(true, true).is_err());
    }
}
