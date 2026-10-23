use super::*;

#[test]
fn updater_maps_universal_macos_to_both_architectures() {
    let directory = tempfile::tempdir().unwrap();
    fs::write(directory.path().join("mac.sig"), "mac-signature").unwrap();
    fs::write(directory.path().join("windows.sig"), "windows-signature").unwrap();
    fs::write(directory.path().join("arm.sig"), "arm-signature").unwrap();
    let release = ReleaseManifest {
        version: "0.2.0".to_owned(),
        tag: "misty-v0.2.0".to_owned(),
        source_commit: "source".to_owned(),
        cli_version: "0.1.0".to_owned(),
        config_sha256: "hash".to_owned(),
        created_at: Utc::now(),
        platforms: vec![],
        build_environment: Default::default(),
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
            platform(WINDOWS_ARM_PLATFORM, "Misty-arm64.exe", "arm.sig"),
        ],
        directory.path(),
    )
    .unwrap();
    assert_eq!(
        latest["platforms"]["darwin-aarch64"]["url"],
        latest["platforms"]["darwin-x86_64"]["url"]
    );
    assert!(latest["platforms"]["windows-x86_64"].is_object());
    assert_eq!(
        latest["platforms"]["windows-aarch64"]["signature"],
        "arm-signature"
    );
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
        build_environment: Default::default(),
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
        build_environment: Default::default(),
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
    assert!(
        reject_unexpected_assets(directory.path(), &release, std::slice::from_ref(&manifest))
            .is_ok()
    );
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
        public_asset_names(std::slice::from_ref(&manifest)).unwrap(),
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
    assert!(public_release(directory.path(), std::slice::from_ref(&manifest), &latest).is_err());
    fs::remove_file(directory.path().join("SHA256SUMS")).unwrap();
    fs::write(directory.path().join(updater), "modified").unwrap();
    assert!(public_release(directory.path(), &[manifest], &latest).is_err());
}
