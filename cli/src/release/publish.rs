//! Verifying the draft release and publishing it.

use super::*;

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
        .run(&workspace.misty)?;
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
        print!("Type `publish {version}` to make this release public: ");
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
            // Installed apps poll releases/latest/download/latest.json, and
            // GitHub's "latest" skips prereleases. Every published build,
            // betas included, must become the latest release to reach users.
            "--prerelease=false",
            "--latest",
        ])
        .run(&workspace.misty)?;
    println!("Published Misty {version}.");
    Ok(())
}

pub(super) fn finalize_public_release(workspace: &Workspace, version: &str) -> Result<()> {
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
        .run(&workspace.misty)?;
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
