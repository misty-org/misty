use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{bail, Result};
use regex::Regex;
use serde_json::Value;

use crate::{process::CommandSpec, workspace::Workspace};

use super::model::{PlatformManifest, ReleaseManifest, PUBLIC_REPOSITORY, RELEASE_MANIFEST_NAME};

pub(super) fn normalize_version(raw: &str) -> Result<String> {
    let version = raw
        .trim()
        .strip_prefix("misty-v")
        .or_else(|| raw.trim().strip_prefix('v'))
        .unwrap_or(raw.trim());
    if !Regex::new(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")?.is_match(version) {
        bail!("release version is not valid semantic version syntax: {version}");
    }
    Ok(version.to_owned())
}

pub(super) fn verify_versions(workspace: &Workspace, expected: &str) -> Result<()> {
    let package: Value = serde_json::from_slice(&fs::read(workspace.misty.join("package.json"))?)?;
    let tauri: Value = serde_json::from_slice(&fs::read(
        workspace.misty.join("src-tauri/tauri.conf.json"),
    )?)?;
    let cargo: toml::Value = toml::from_str(&fs::read_to_string(
        workspace.misty.join("src-tauri/Cargo.toml"),
    )?)?;
    let versions = [
        ("package.json", package["version"].as_str()),
        ("src-tauri/tauri.conf.json", tauri["version"].as_str()),
        (
            "src-tauri/Cargo.toml",
            cargo
                .get("package")
                .and_then(|value| value.get("version"))
                .and_then(toml::Value::as_str),
        ),
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
        bail!("release start requires a clean Misty checkout");
    }
    let head = git(workspace, &workspace.misty, ["rev-parse", "HEAD"])?;
    let origin = git(workspace, &workspace.misty, ["rev-parse", "origin/main"])?;
    if head != origin {
        bail!("local main is not synchronized with origin/main");
    }
    Ok(())
}

pub(super) fn ensure_source_tag(workspace: &Workspace, manifest: &ReleaseManifest) -> Result<()> {
    let existing = CommandSpec::new("git")
        .args([
            "rev-parse",
            "--verify",
            &format!("refs/tags/{}", manifest.tag),
        ])
        .capture(&workspace.misty)
        .ok()
        .map(|value| value.trim().to_owned());
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
        .capture(&workspace.root)
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
                "--prerelease",
                "--title",
                &format!("Misty {} beta", manifest.version),
                "--notes",
                "Public-beta desktop build. Add customer-facing release notes before publishing.",
            ])
            .arg(manifest_path.as_os_str())
            .run(&workspace.root)
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
            .run(&workspace.root)?;
    }
    ReleaseManifest::read(&path)
}

pub(super) fn verify_build_identity(
    workspace: &Workspace,
    manifest: &ReleaseManifest,
) -> Result<()> {
    verify_versions(workspace, &manifest.version)?;
    let source = git(workspace, &workspace.misty, ["rev-parse", "HEAD"])?;
    let cli = git(workspace, &workspace.cli, ["rev-parse", "HEAD"])?;
    if source != manifest.source_commit {
        bail!("Misty checkout does not match the release source commit");
    }
    if cli != manifest.cli_commit {
        bail!("misty-cli checkout does not match the release tooling commit");
    }
    if !git(workspace, &workspace.misty, ["status", "--porcelain"])?.is_empty() {
        bail!("release builds require a clean Misty checkout");
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
        || platform.cli_commit != release.cli_commit
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
    command.run(&workspace.root)
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
mod tests {
    use super::*;
    use chrono::Utc;

    #[test]
    fn version_normalization_is_strict() {
        assert_eq!(normalize_version("misty-v0.2.1").unwrap(), "0.2.1");
        assert!(normalize_version("../0.2.1").is_err());
    }

    #[test]
    fn platform_manifest_cannot_mix_source_or_cli_revisions() {
        let release = ReleaseManifest {
            version: "0.2.1".to_owned(),
            tag: "misty-v0.2.1".to_owned(),
            source_commit: "source-a".to_owned(),
            cli_commit: "cli-a".to_owned(),
            cli_version: "0.1.0".to_owned(),
            config_sha256: "config".to_owned(),
            created_at: Utc::now(),
            platforms: vec!["windows-x86_64".to_owned()],
        };
        let mut platform = PlatformManifest {
            version: release.version.clone(),
            tag: release.tag.clone(),
            source_commit: release.source_commit.clone(),
            cli_commit: release.cli_commit.clone(),
            platform: "windows-x86_64".to_owned(),
            updater_asset: "Misty.exe".to_owned(),
            signature_asset: "Misty.exe.sig".to_owned(),
            files: vec![],
        };
        assert!(verify_platform_identity(&release, &platform).is_ok());
        platform.cli_commit = "cli-b".to_owned();
        assert!(verify_platform_identity(&release, &platform).is_err());
    }
}
