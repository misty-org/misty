use std::{collections::BTreeSet, fs, path::Path};

use anyhow::{bail, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Utc;
use minisign_verify::{PublicKey, Signature};
use serde_json::{json, Map, Value};

use crate::{artifacts, workspace::Workspace};

use super::{
    model::{
        PlatformManifest, ReleaseManifest, MACOS_PLATFORM, PUBLIC_REPOSITORY,
        RELEASE_MANIFEST_NAME, WINDOWS_PLATFORM,
    },
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
    verify_updater_signature(root, manifest, signature.trim())?;
    Ok(())
}

fn verify_updater_signature(
    root: &Path,
    manifest: &PlatformManifest,
    encoded_signature: &str,
) -> Result<()> {
    let configured_key = std::env::var("TAURI_UPDATER_PUBLIC_KEY")?;
    let compact_key = configured_key.split_whitespace().collect::<String>();
    let decoded_key = STANDARD
        .decode(&compact_key)
        .ok()
        .and_then(|value| String::from_utf8(value).ok())
        .unwrap_or(configured_key);
    let public_key = PublicKey::decode(decoded_key.trim())?;
    let signature_text = String::from_utf8(STANDARD.decode(encoded_signature)?)?;
    let signature = Signature::decode(&signature_text)?;
    let updater = fs::read(root.join(&manifest.updater_asset))?;
    public_key.verify(&updater, &signature, true)?;
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

pub(super) fn reject_unexpected_assets(
    root: &Path,
    release: &ReleaseManifest,
    manifests: &[PlatformManifest],
) -> Result<()> {
    let mut expected = BTreeSet::from([
        RELEASE_MANIFEST_NAME.to_owned(),
        "bundle-size.json".to_owned(),
        "misty-web.cdx.json".to_owned(),
        "misty-rust.cdx.json".to_owned(),
        "THIRD_PARTY_NOTICES.md".to_owned(),
        "latest.json".to_owned(),
        "SHA256SUMS".to_owned(),
    ]);
    for manifest in manifests {
        expected.insert(format!("release-{}.json", manifest.platform));
        expected.insert(format!("SHA256SUMS-{}", manifest.platform));
        expected.extend(manifest.files.iter().map(|file| file.name.clone()));
    }
    let unexpected = artifacts::files_under(root)?
        .into_iter()
        .filter_map(|path| {
            let name = path.file_name()?.to_string_lossy().into_owned();
            (!expected.contains(&name)).then_some(name)
        })
        .collect::<BTreeSet<_>>();
    if !unexpected.is_empty() {
        bail!(
            "release {} contains unexpected assets: {}",
            release.tag,
            unexpected.into_iter().collect::<Vec<_>>().join(", ")
        );
    }
    Ok(())
}

pub(super) fn public_asset_names(manifests: &[PlatformManifest]) -> Result<BTreeSet<String>> {
    let mut names = BTreeSet::from(["latest.json".to_owned()]);
    for manifest in manifests {
        if !manifest
            .files
            .iter()
            .any(|file| file.name == manifest.updater_asset)
        {
            bail!(
                "{} manifest does not record updater asset {}",
                manifest.platform,
                manifest.updater_asset
            );
        }
        names.insert(manifest.updater_asset.clone());

        let installer_extension = match manifest.platform.as_str() {
            MACOS_PLATFORM => "dmg",
            WINDOWS_PLATFORM => "exe",
            platform => bail!("cannot select a public installer for {platform}"),
        };
        let installers = manifest
            .files
            .iter()
            .filter(|file| {
                Path::new(&file.name)
                    .extension()
                    .is_some_and(|extension| extension == installer_extension)
            })
            .collect::<Vec<_>>();
        if installers.len() != 1 {
            bail!(
                "{} release must contain exactly one .{installer_extension} installer, found {}",
                manifest.platform,
                installers.len()
            );
        }
        names.insert(installers[0].name.clone());
    }
    Ok(names)
}

pub(super) fn public_release(
    root: &Path,
    manifests: &[PlatformManifest],
    expected_latest: &Value,
) -> Result<()> {
    let expected_names = public_asset_names(manifests)?;
    let actual_names = artifacts::files_under(root)?
        .into_iter()
        .filter_map(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .collect::<BTreeSet<_>>();
    if actual_names != expected_names {
        bail!(
            "public release assets differ from the minimal contract; expected {}, found {}",
            expected_names.into_iter().collect::<Vec<_>>().join(", "),
            actual_names.into_iter().collect::<Vec<_>>().join(", ")
        );
    }

    for name in actual_names
        .iter()
        .filter(|name| name.as_str() != "latest.json")
    {
        let records = manifests
            .iter()
            .flat_map(|manifest| manifest.files.iter())
            .filter(|file| file.name == *name)
            .collect::<Vec<_>>();
        if records.is_empty() {
            bail!("public asset is not recorded by a platform manifest: {name}");
        }
        let path = root.join(name);
        let sha256 = artifacts::sha256(&path)?;
        let bytes = fs::metadata(&path)?.len();
        if records
            .iter()
            .any(|record| record.sha256 != sha256 || record.bytes != bytes)
        {
            bail!("public release artifact failed verification: {name}");
        }
    }

    let latest: Value = serde_json::from_slice(&fs::read(root.join("latest.json"))?)?;
    if latest != *expected_latest {
        bail!("published latest.json differs from the verified updater manifest");
    }
    Ok(())
}

pub(super) fn latest_json(
    release: &ReleaseManifest,
    manifests: &[PlatformManifest],
    root: &Path,
) -> Result<Value> {
    let url = |asset: &str| {
        format!(
            "https://github.com/{PUBLIC_REPOSITORY}/releases/download/{}/{}",
            release.tag, asset
        )
    };
    let mut platforms = Map::new();
    for manifest in manifests {
        let signature = fs::read_to_string(root.join(&manifest.signature_asset))?;
        let updater = json!({
            "signature": signature.trim(),
            "url": url(&manifest.updater_asset)
        });
        match manifest.platform.as_str() {
            MACOS_PLATFORM => {
                platforms.insert("darwin-aarch64".to_owned(), updater.clone());
                platforms.insert("darwin-x86_64".to_owned(), updater);
            }
            WINDOWS_PLATFORM => {
                platforms.insert("windows-x86_64".to_owned(), updater);
            }
            platform => bail!("cannot generate updater metadata for {platform}"),
        }
    }
    Ok(json!({
        "version": release.version,
        "notes": "",
        "pub_date": Utc::now().to_rfc3339(),
        "platforms": platforms
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
            updater_asset: updater.to_owned(),
            signature_asset: signature.to_owned(),
            files: vec![],
        };
        let latest = latest_json(
            &release,
            &[
                platform(MACOS_PLATFORM, "Misty.tar.gz", "mac.sig"),
                platform(WINDOWS_PLATFORM, "Misty.exe", "windows.sig"),
            ],
            directory.path(),
        )
        .unwrap();
        assert_eq!(
            latest["platforms"]["darwin-aarch64"]["url"],
            latest["platforms"]["darwin-x86_64"]["url"]
        );
        assert!(latest["platforms"]["windows-x86_64"].is_object());
    }

    #[test]
    fn updater_metadata_contains_only_selected_platforms() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("mac.sig"), "mac-signature").unwrap();
        let release = ReleaseManifest {
            version: "0.2.0".to_owned(),
            tag: "misty-v0.2.0".to_owned(),
            source_commit: "source".to_owned(),
            cli_version: "0.1.0".to_owned(),
            config_sha256: "hash".to_owned(),
            created_at: Utc::now(),
            platforms: vec![MACOS_PLATFORM.to_owned()],
        };
        let mac = PlatformManifest {
            version: release.version.clone(),
            tag: release.tag.clone(),
            platform: MACOS_PLATFORM.to_owned(),
            source_commit: release.source_commit.clone(),
            updater_asset: "Misty.tar.gz".to_owned(),
            signature_asset: "mac.sig".to_owned(),
            files: vec![],
        };
        let latest = latest_json(&release, &[mac], directory.path()).unwrap();
        assert!(latest["platforms"]["darwin-aarch64"].is_object());
        assert!(latest["platforms"]["darwin-x86_64"].is_object());
        assert!(latest["platforms"].get("windows-x86_64").is_none());
    }

    #[test]
    fn platform_only_release_rejects_stale_assets() {
        let directory = tempfile::tempdir().unwrap();
        let release = ReleaseManifest {
            version: "0.2.0".to_owned(),
            tag: "misty-v0.2.0".to_owned(),
            source_commit: "source".to_owned(),
            cli_version: "0.1.0".to_owned(),
            config_sha256: "hash".to_owned(),
            created_at: Utc::now(),
            platforms: vec![MACOS_PLATFORM.to_owned()],
        };
        let manifest = PlatformManifest {
            version: release.version.clone(),
            tag: release.tag.clone(),
            platform: MACOS_PLATFORM.to_owned(),
            source_commit: release.source_commit.clone(),
            updater_asset: "Misty.app.tar.gz".to_owned(),
            signature_asset: "Misty.app.tar.gz.sig".to_owned(),
            files: vec![],
        };
        for name in [
            RELEASE_MANIFEST_NAME,
            "bundle-size.json",
            "misty-web.cdx.json",
            "misty-rust.cdx.json",
            "THIRD_PARTY_NOTICES.md",
            "release-macos-universal.json",
            "SHA256SUMS-macos-universal",
        ] {
            fs::write(directory.path().join(name), "").unwrap();
        }
        assert!(reject_unexpected_assets(directory.path(), &release, &[manifest.clone()]).is_ok());
        fs::write(directory.path().join("Misty_0.2.0_x64-setup.exe"), "").unwrap();
        assert!(reject_unexpected_assets(directory.path(), &release, &[manifest]).is_err());
    }

    #[test]
    fn minimal_macos_release_keeps_only_installer_updater_and_metadata() {
        let directory = tempfile::tempdir().unwrap();
        let dmg = "Misty_0.2.0_universal.dmg";
        let updater = "Misty.app.tar.gz";
        fs::write(directory.path().join(dmg), "dmg").unwrap();
        fs::write(directory.path().join(updater), "updater").unwrap();
        let latest = json!({ "version": "0.2.0", "platforms": {} });
        fs::write(
            directory.path().join("latest.json"),
            serde_json::to_vec_pretty(&latest).unwrap(),
        )
        .unwrap();
        let record = |name: &str| super::super::model::ArtifactRecord {
            name: name.to_owned(),
            sha256: artifacts::sha256(&directory.path().join(name)).unwrap(),
            bytes: fs::metadata(directory.path().join(name)).unwrap().len(),
        };
        let manifest = PlatformManifest {
            version: "0.2.0".to_owned(),
            tag: "misty-v0.2.0".to_owned(),
            platform: MACOS_PLATFORM.to_owned(),
            source_commit: "source".to_owned(),
            updater_asset: updater.to_owned(),
            signature_asset: format!("{updater}.sig"),
            files: vec![record(dmg), record(updater)],
        };

        assert_eq!(
            public_asset_names(&[manifest.clone()]).unwrap(),
            BTreeSet::from([dmg.to_owned(), updater.to_owned(), "latest.json".to_owned()])
        );
        public_release(directory.path(), &[manifest], &latest).unwrap();
    }

    #[test]
    fn minimal_release_rejects_extra_or_modified_assets() {
        let directory = tempfile::tempdir().unwrap();
        let updater = "Misty.exe";
        fs::write(directory.path().join(updater), "installer").unwrap();
        let latest = json!({ "version": "0.2.0", "platforms": {} });
        fs::write(
            directory.path().join("latest.json"),
            serde_json::to_vec_pretty(&latest).unwrap(),
        )
        .unwrap();
        let manifest = PlatformManifest {
            version: "0.2.0".to_owned(),
            tag: "misty-v0.2.0".to_owned(),
            platform: WINDOWS_PLATFORM.to_owned(),
            source_commit: "source".to_owned(),
            updater_asset: updater.to_owned(),
            signature_asset: format!("{updater}.sig"),
            files: vec![super::super::model::ArtifactRecord {
                name: updater.to_owned(),
                sha256: artifacts::sha256(&directory.path().join(updater)).unwrap(),
                bytes: fs::metadata(directory.path().join(updater)).unwrap().len(),
            }],
        };

        fs::write(directory.path().join("SHA256SUMS"), "extra").unwrap();
        assert!(public_release(directory.path(), &[manifest.clone()], &latest).is_err());
        fs::remove_file(directory.path().join("SHA256SUMS")).unwrap();
        fs::write(directory.path().join(updater), "modified").unwrap();
        assert!(public_release(directory.path(), &[manifest], &latest).is_err());
    }
}
