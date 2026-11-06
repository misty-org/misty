use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{bail, Result};
use serde_json::Value;

use crate::{process::CommandSpec, workspace::Workspace};

use super::model::{
    PlatformManifest, ReleaseManifest, MACOS_PLATFORM, PUBLIC_REPOSITORY, RELEASE_MANIFEST_NAME,
    WINDOWS_ARM_PLATFORM, WINDOWS_PLATFORM,
};

pub fn normalize_version(raw: &str) -> Result<String> {
    let version = raw
        .trim()
        .strip_prefix("misty-v")
        .or_else(|| raw.trim().strip_prefix('v'))
        .unwrap_or(raw.trim());
    if !valid_version(version) {
        bail!("release version is not valid semantic version syntax: {version}");
    }
    Ok(version.to_owned())
}

/// `1.2.3`, with an optional `-prerelease` of letters, digits, dots and hyphens.
fn valid_version(version: &str) -> bool {
    let (core, prerelease) = match version.split_once('-') {
        Some((core, prerelease)) => (core, Some(prerelease)),
        None => (version, None),
    };
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
        && prerelease.map_or(true, |text| {
            !text.is_empty()
                && text
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-')
        })
}

/// The `version` under `[package]` in a Cargo.toml.
fn cargo_package_version(manifest: &str) -> Option<String> {
    let mut in_package = false;
    for line in manifest.lines().map(str::trim) {
        if line.starts_with('[') {
            in_package = line == "[package]";
        } else if in_package {
            if let Some((key, value)) = line.split_once('=') {
                if key.trim() == "version" {
                    let value = value.split('#').next().unwrap_or_default().trim();
                    return value
                        .strip_prefix('"')
                        .and_then(|rest| rest.strip_suffix('"'))
                        .map(str::to_owned);
                }
            }
        }
    }
    None
}

pub(super) fn verify_versions(workspace: &Workspace, expected: &str) -> Result<()> {
    let package: Value = serde_json::from_slice(&fs::read(workspace.misty.join("package.json"))?)?;
    let tauri: Value = serde_json::from_slice(&fs::read(
        workspace.misty.join("src-tauri/tauri.conf.json"),
    )?)?;
    let cargo = cargo_package_version(&fs::read_to_string(
        workspace.misty.join("src-tauri/Cargo.toml"),
    )?);
    let versions = [
        ("package.json", package["version"].as_str()),
        ("src-tauri/tauri.conf.json", tauri["version"].as_str()),
        ("src-tauri/Cargo.toml", cargo.as_deref()),
    ];
    let mismatches = versions
        .into_iter()
        .filter(|(_, version)| *version != Some(expected))
        .map(|(file, version)| format!("{file}={}", version.unwrap_or("missing")))
        .collect::<Vec<_>>();
    if !mismatches.is_empty() {
        bail!(
            "release version {expected} does not match {}",
            mismatches.join(", ")
        );
    }
    Ok(())
}

pub(super) fn require_release_checkout(workspace: &Workspace, fetch: bool) -> Result<()> {
    if fetch {
        git(workspace, &workspace.misty, ["fetch", "origin", "main"])?;
    }
    let branch = git(workspace, &workspace.misty, ["branch", "--show-current"])?;
    if branch != "main" {
        bail!("release start requires the main branch, found {branch}");
    }
    if !git(workspace, &workspace.misty, ["status", "--porcelain"])?.is_empty() {
        bail!("release start requires a clean Misty app checkout");
    }
    let head = git(workspace, &workspace.misty, ["rev-parse", "HEAD"])?;
    let origin = git(workspace, &workspace.misty, ["rev-parse", "origin/main"])?;
    if head != origin {
        bail!("local main is not synchronized with origin/main");
    }
    Ok(())
}

pub(super) fn ensure_source_tag(workspace: &Workspace, manifest: &ReleaseManifest) -> Result<()> {
    let existing = source_tag_commit(&workspace.misty, &manifest.tag);
    if let Some(existing) = existing {
        if existing != manifest.source_commit {
            bail!("{} already points to another commit", manifest.tag);
        }
    } else {
        CommandSpec::new("git")
            .args([
                "tag",
                "-a",
                &manifest.tag,
                "-m",
                &format!("Misty {}", manifest.version),
            ])
            .run(&workspace.misty)?;
    }
    CommandSpec::new("git")
        .args(["push", "origin", &manifest.tag])
        .run(&workspace.misty)
}

fn source_tag_commit(repository: &Path, tag: &str) -> Option<String> {
    CommandSpec::new("git")
        .args([
            "rev-parse",
            "--verify",
            &format!("refs/tags/{tag}^{{commit}}"),
        ])
        .capture(repository)
        .ok()
        .map(|value| value.trim().to_owned())
}

pub(super) fn create_or_update_draft(
    workspace: &Workspace,
    manifest: &ReleaseManifest,
    manifest_path: &Path,
) -> Result<()> {
    let exists = CommandSpec::new("gh")
        .args([
            "release",
            "view",
            &manifest.tag,
            "--repo",
            PUBLIC_REPOSITORY,
        ])
        .capture(&workspace.misty)
        .is_ok();
    if exists {
        gh_upload(workspace, &manifest.tag, &[manifest_path.to_path_buf()])
    } else {
        CommandSpec::new("gh")
            .args([
                "release",
                "create",
                &manifest.tag,
                "--repo",
                PUBLIC_REPOSITORY,
                "--target",
                "main",
                "--draft",
                &format!("--prerelease={}", manifest.version.contains('-')),
                "--title",
                &format!("Misty {}", manifest.version),
                "--notes",
                "Locally built desktop release. Add customer-facing release notes before publishing.",
            ])
            .arg(manifest_path.as_os_str())
            .run(&workspace.misty)
    }
}

pub(super) fn load_manifest(
    workspace: &Workspace,
    version: &str,
    download: bool,
) -> Result<ReleaseManifest> {
    let path = release_root(workspace, version).join(RELEASE_MANIFEST_NAME);
    if !path.is_file() && download {
        fs::create_dir_all(path.parent().unwrap())?;
        CommandSpec::new("gh")
            .args([
                "release",
                "download",
                &format!("misty-v{version}"),
                "--repo",
                PUBLIC_REPOSITORY,
                "--pattern",
                RELEASE_MANIFEST_NAME,
                "--dir",
            ])
            .arg(path.parent().unwrap().as_os_str())
            .run(&workspace.misty)?;
    }
    let manifest = ReleaseManifest::read(&path)?;
    validate_release_platforms(&manifest)?;
    Ok(manifest)
}

pub(super) fn validate_release_platforms(release: &ReleaseManifest) -> Result<()> {
    if release.platforms.is_empty() {
        bail!("release must include at least one desktop platform");
    }
    for (index, platform) in release.platforms.iter().enumerate() {
        if !matches!(
            platform.as_str(),
            MACOS_PLATFORM | WINDOWS_PLATFORM | WINDOWS_ARM_PLATFORM
        ) {
            bail!("release contains unsupported platform: {platform}");
        }
        if release.platforms[..index].contains(platform) {
            bail!("release contains duplicate platform: {platform}");
        }
    }
    Ok(())
}

pub(super) fn verify_build_identity(
    workspace: &Workspace,
    manifest: &ReleaseManifest,
) -> Result<()> {
    verify_versions(workspace, &manifest.version)?;
    let source = git(workspace, &workspace.misty, ["rev-parse", "HEAD"])?;
    if source != manifest.source_commit {
        bail!("Misty app checkout does not match the release source commit");
    }
    if !git(workspace, &workspace.misty, ["status", "--porcelain"])?.is_empty() {
        bail!("release builds require a clean Misty app checkout");
    }
    Ok(())
}

pub(super) fn verify_platform_identity(
    release: &ReleaseManifest,
    platform: &PlatformManifest,
) -> Result<()> {
    if platform.version != release.version
        || platform.tag != release.tag
        || platform.source_commit != release.source_commit
        || !release.platforms.contains(&platform.platform)
    {
        bail!("{} manifest does not match the release", platform.platform);
    }
    Ok(())
}

pub(super) fn gh_upload(workspace: &Workspace, tag: &str, files: &[PathBuf]) -> Result<()> {
    if files.is_empty() {
        bail!("no release files were selected for upload");
    }
    require_draft(workspace, tag)?;
    let mut command = CommandSpec::new("gh").args([
        "release",
        "upload",
        tag,
        "--repo",
        PUBLIC_REPOSITORY,
        "--clobber",
    ]);
    for file in files {
        command = command.arg(file.as_os_str());
    }
    command.run(&workspace.misty)
}

fn require_draft(workspace: &Workspace, tag: &str) -> Result<()> {
    let metadata = CommandSpec::new("gh")
        .args([
            "release",
            "view",
            tag,
            "--repo",
            PUBLIC_REPOSITORY,
            "--json",
            "isDraft",
        ])
        .capture(&workspace.misty)?;
    validate_draft_metadata(&serde_json::from_str::<Value>(&metadata)?)
}

fn validate_draft_metadata(metadata: &Value) -> Result<()> {
    if metadata["isDraft"] != true {
        bail!("refusing to replace assets on a published release; create a new version");
    }
    Ok(())
}

pub(super) fn gh_delete_asset(workspace: &Workspace, tag: &str, name: &str) -> Result<()> {
    require_draft(workspace, tag)?;
    CommandSpec::new("gh")
        .args([
            "release",
            "delete-asset",
            tag,
            name,
            "--repo",
            PUBLIC_REPOSITORY,
            "--yes",
        ])
        .run(&workspace.misty)
}

pub(super) fn release_root(workspace: &Workspace, version: &str) -> PathBuf {
    workspace.misty.join("artifacts/release").join(version)
}

pub(super) fn git<const N: usize>(
    _workspace: &Workspace,
    directory: &Path,
    arguments: [&str; N],
) -> Result<String> {
    CommandSpec::new("git")
        .args(arguments)
        .capture(directory)
        .map(|value| value.trim().to_owned())
}

#[cfg(test)]
mod tests;
