use std::{fs, path::Path};

use anyhow::{bail, Result};
use chrono::Utc;
use serde_json::{json, Value};

use crate::{artifacts, workspace::Workspace};

use super::{
    model::{PlatformManifest, ReleaseManifest, PUBLIC_REPOSITORY, RELEASE_MANIFEST_NAME},
    state,
};

pub(super) fn local_platforms(workspace: &Workspace, release: &ReleaseManifest) -> Result<()> {
    for platform in &release.platforms {
        let root = state::release_root(workspace, &release.version).join(platform);
        let manifest = PlatformManifest::read(&root.join(format!("release-{platform}.json")))?;
        state::verify_platform_identity(release, &manifest)?;
        downloaded_files(&root, &manifest)?;
    }
    Ok(())
}

pub(super) fn downloaded_files(root: &Path, manifest: &PlatformManifest) -> Result<()> {
    for file in &manifest.files {
        let path = root.join(&file.name);
        if !path.is_file() {
            bail!("release is missing {}", file.name);
        }
        if artifacts::sha256(&path)? != file.sha256 || fs::metadata(&path)?.len() != file.bytes {
            bail!("release artifact failed verification: {}", file.name);
        }
    }
    let signature = fs::read_to_string(root.join(&manifest.signature_asset))?;
    if signature.trim().is_empty() {
        bail!("updater signature is empty: {}", manifest.signature_asset);
    }
    Ok(())
}

pub(super) fn shared_metadata(root: &Path) -> Result<()> {
    for name in [
        RELEASE_MANIFEST_NAME,
        "bundle-size.json",
        "misty-web.cdx.json",
        "misty-rust.cdx.json",
        "THIRD_PARTY_NOTICES.md",
    ] {
        if !root.join(name).is_file() {
            bail!("release is missing required metadata: {name}");
        }
    }
    Ok(())
}

pub(super) fn latest_json(
    release: &ReleaseManifest,
    mac: &PlatformManifest,
    windows: &PlatformManifest,
    root: &Path,
) -> Result<Value> {
    let mac_signature = fs::read_to_string(root.join(&mac.signature_asset))?;
    let windows_signature = fs::read_to_string(root.join(&windows.signature_asset))?;
    let url = |asset: &str| {
        format!(
            "https://github.com/{PUBLIC_REPOSITORY}/releases/download/{}/{}",
            release.tag, asset
        )
    };
    Ok(json!({
        "version": release.version,
        "notes": "",
        "pub_date": Utc::now().to_rfc3339(),
        "platforms": {
            "darwin-aarch64": {
                "signature": mac_signature.trim(),
                "url": url(&mac.updater_asset)
            },
            "darwin-x86_64": {
                "signature": mac_signature.trim(),
                "url": url(&mac.updater_asset)
            },
            "windows-x86_64": {
                "signature": windows_signature.trim(),
                "url": url(&windows.updater_asset)
            }
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updater_maps_universal_macos_to_both_architectures() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("mac.sig"), "mac-signature").unwrap();
        fs::write(directory.path().join("windows.sig"), "windows-signature").unwrap();
        let release = ReleaseManifest {
            version: "0.2.0".to_owned(),
            tag: "misty-v0.2.0".to_owned(),
            source_commit: "source".to_owned(),
            cli_commit: "cli".to_owned(),
            cli_version: "0.1.0".to_owned(),
            config_sha256: "hash".to_owned(),
            created_at: Utc::now(),
            platforms: vec![],
        };
        let platform = |name: &str, updater: &str, signature: &str| PlatformManifest {
            version: release.version.clone(),
            tag: release.tag.clone(),
            platform: name.to_owned(),
            source_commit: release.source_commit.clone(),
            cli_commit: release.cli_commit.clone(),
            updater_asset: updater.to_owned(),
            signature_asset: signature.to_owned(),
            files: vec![],
        };
        let latest = latest_json(
            &release,
            &platform("macos-universal", "Misty.tar.gz", "mac.sig"),
            &platform("windows-x86_64", "Misty.exe", "windows.sig"),
            directory.path(),
        )
        .unwrap();
        assert_eq!(
            latest["platforms"]["darwin-aarch64"]["url"],
            latest["platforms"]["darwin-x86_64"]["url"]
        );
    }
}
