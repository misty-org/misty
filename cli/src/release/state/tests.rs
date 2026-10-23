use super::*;

#[test]
fn asset_mutation_requires_an_explicit_draft() {
    assert!(validate_draft_metadata(&serde_json::json!({"isDraft": true})).is_ok());
    assert!(validate_draft_metadata(&serde_json::json!({"isDraft": false})).is_err());
    assert!(validate_draft_metadata(&serde_json::json!({})).is_err());
}
use chrono::Utc;

#[test]
fn version_normalization_is_strict() {
    assert_eq!(normalize_version("misty-v0.2.1").unwrap(), "0.2.1");
    assert!(normalize_version("../0.2.1").is_err());
}

#[test]
fn platform_manifest_cannot_mix_source_revisions() {
    let release = ReleaseManifest {
        version: "0.2.1".to_owned(),
        tag: "misty-v0.2.1".to_owned(),
        source_commit: "source-a".to_owned(),
        cli_version: "0.1.0".to_owned(),
        config_sha256: "config".to_owned(),
        created_at: Utc::now(),
        platforms: vec!["windows-x86_64".to_owned()],
        build_environment: Default::default(),
    };
    let mut platform = PlatformManifest {
        version: release.version.clone(),
        tag: release.tag.clone(),
        source_commit: release.source_commit.clone(),
        platform: "windows-x86_64".to_owned(),
        updater_asset: "Misty.exe".to_owned(),
        signature_asset: "Misty.exe.sig".to_owned(),
        files: vec![],
    };
    assert!(verify_platform_identity(&release, &platform).is_ok());
    platform.source_commit = "source-b".to_owned();
    assert!(verify_platform_identity(&release, &platform).is_err());
}

#[test]
fn release_requires_a_supported_unique_platform_set() {
    let release = |platforms: Vec<&str>| ReleaseManifest {
        version: "0.2.1".to_owned(),
        tag: "misty-v0.2.1".to_owned(),
        source_commit: "source-a".to_owned(),
        cli_version: "0.1.0".to_owned(),
        config_sha256: "config".to_owned(),
        created_at: Utc::now(),
        platforms: platforms.into_iter().map(str::to_owned).collect(),
        build_environment: Default::default(),
    };

    assert!(validate_release_platforms(&release(vec![MACOS_PLATFORM])).is_ok());
    assert!(validate_release_platforms(&release(vec![WINDOWS_PLATFORM])).is_ok());
    assert!(validate_release_platforms(&release(vec![MACOS_PLATFORM, WINDOWS_PLATFORM])).is_ok());
    assert!(validate_release_platforms(&release(vec![])).is_err());
    assert!(validate_release_platforms(&release(vec![MACOS_PLATFORM, MACOS_PLATFORM])).is_err());
    assert!(validate_release_platforms(&release(vec!["linux-x86_64"])).is_err());
}

#[test]
fn annotated_source_tags_resolve_to_their_commit() {
    let directory = tempfile::tempdir().unwrap();
    CommandSpec::new("git")
        .args(["init", "--quiet"])
        .run(directory.path())
        .unwrap();
    CommandSpec::new("git")
        .args(["config", "user.name", "Misty Test"])
        .run(directory.path())
        .unwrap();
    CommandSpec::new("git")
        .args(["config", "user.email", "misty-test@example.invalid"])
        .run(directory.path())
        .unwrap();
    fs::write(directory.path().join("README.md"), "test\n").unwrap();
    CommandSpec::new("git")
        .args(["add", "README.md"])
        .run(directory.path())
        .unwrap();
    CommandSpec::new("git")
        .args(["commit", "--quiet", "-m", "test"])
        .run(directory.path())
        .unwrap();
    CommandSpec::new("git")
        .args(["tag", "-a", "misty-v0.1.0", "-m", "Misty 0.1.0"])
        .run(directory.path())
        .unwrap();

    let head = CommandSpec::new("git")
        .args(["rev-parse", "HEAD"])
        .capture(directory.path())
        .unwrap();
    assert_eq!(
        source_tag_commit(directory.path(), "misty-v0.1.0").unwrap(),
        head.trim()
    );
}
