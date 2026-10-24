use super::*;
use serde_json::json;
use std::io::Write;
fn entry(bytes: &[u8]) -> CatalogEntry {
    CatalogEntry {
        id: "1".into(),
        store: Store::Firefox,
        guid: "fixture@misty.test".into(),
        slug: "fixture".into(),
        name: "Fixture".into(),
        summary: String::new(),
        description: String::new(),
        authors: vec![],
        icon_url: String::new(),
        version: "1.0".into(),
        users: 0,
        rating: 0.0,
        source_url: String::new(),
        download_url: String::new(),
        digest: format!("sha256:{}", hex::encode(Sha256::digest(bytes))),
    }
}
fn manifest() -> Value {
    json!({"manifest_version":3,"name":"Fixture","version":"1.0","browser_specific_settings":{"gecko":{"id":"fixture@misty.test"}},"permissions":["storage"],"content_scripts":[{"matches":["https://example.org/*"],"js":["content.js"]}]})
}
fn archive(extra: Option<&str>) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    zip.start_file("manifest.json", zip::write::SimpleFileOptions::default())
        .unwrap();
    zip.write_all(manifest().to_string().as_bytes()).unwrap();
    if let Some(path) = extra {
        zip.start_file(path, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"resource").unwrap();
    }
    zip.finish().unwrap().into_inner()
}
#[test]
fn extraction_keeps_original_and_separates_bridge_resources() {
    let bytes = archive(Some("content.js"));
    let root = tempfile::tempdir().unwrap();
    let review = extract(&bytes, entry(&bytes), root.path(), "review".into()).unwrap();
    assert_eq!(review.hosts, vec!["https://example.org/*"]);
    assert_eq!(fs::read(root.path().join("original.xpi")).unwrap(), bytes);
    assert!(root
        .path()
        .join("runtime/__misty_sync__/bridge.js")
        .exists());
    assert_eq!(
        serde_json::from_slice::<Value>(
            &fs::read(root.path().join("runtime/manifest.json")).unwrap()
        )
        .unwrap(),
        manifest()
    );
}
#[test]
fn rejects_traversal_absolute_duplicate_and_bridge_paths() {
    for path in [
        "../outside",
        "/absolute",
        "nested/../../escape",
        "nested\\escape",
        "MANIFEST.JSON",
        "__misty_sync__/bridge.js",
        "__misty_compat__/core.js",
    ] {
        let bytes = archive(Some(path));
        let root = tempfile::tempdir().unwrap();
        assert!(
            extract(&bytes, entry(&bytes), root.path(), "review".into()).is_err(),
            "{path}"
        );
    }
}
#[test]
fn rejects_digest_identity_and_version_mismatches() {
    let bytes = archive(None);
    let root = tempfile::tempdir().unwrap();
    let mut metadata = entry(&bytes);
    metadata.digest = "sha256:bad".into();
    assert!(extract(&bytes, metadata, root.path(), "review".into())
        .unwrap_err()
        .contains("integrity"));
    let mut metadata = entry(&bytes);
    metadata.guid = "someone-else".into();
    assert!(inspect(&manifest(), metadata, "review".into())
        .unwrap_err()
        .contains("identity"));
    let mut metadata = entry(&bytes);
    metadata.version = "2.0".into();
    assert!(inspect(&manifest(), metadata, "review".into())
        .unwrap_err()
        .contains("version"));
}
#[test]
fn optional_incompatibilities_do_not_block_otherwise_valid_packages() {
    let mut manifest = manifest();
    manifest["optional_permissions"] = json!(["proxy"]);
    let review = inspect(&manifest, entry(&[]), "review".into()).unwrap();
    assert!(!review.blocked);
    assert!(review.findings.iter().any(|v| v.contains("Optional")));
    manifest["permissions"] = json!(["proxy"]);
    assert!(
        inspect(&manifest, entry(&[]), "review".into())
            .unwrap()
            .blocked
    );
    manifest["permissions"] = json!(["webRequest", "webRequestBlocking", "management"]);
    let review = inspect(&manifest, entry(&[]), "review".into()).unwrap();
    assert!(!review.blocked);
    // Only WebKit needs the compatibility layer's stand-ins.
    if cfg!(not(windows)) {
        assert!(review
            .findings
            .iter()
            .any(|v| v.contains("first matching request")));
        assert!(review
            .permissions
            .contains(&"declarativeNetRequest".to_owned()));
    }
    manifest["permissions"] = json!([]);
    manifest["incognito"] = json!("not_allowed");
    assert!(
        !inspect(&manifest, entry(&[]), "review".into())
            .unwrap()
            .private_allowed
    );
}

#[test]
fn rejects_symlinks_and_oversized_expanded_resources() {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    zip.add_symlink(
        "linked",
        "/tmp/outside",
        zip::write::SimpleFileOptions::default(),
    )
    .unwrap();
    let bytes = zip.finish().unwrap().into_inner();
    let root = tempfile::tempdir().unwrap();
    assert!(extract(&bytes, entry(&bytes), root.path(), "review".into())
        .unwrap_err()
        .contains("unsafe path"));

    // Patch the central directory's expanded size without allocating a bomb.
    let mut bytes = archive(None);
    let offset = bytes
        .windows(4)
        .position(|bytes| bytes == b"PK\x01\x02")
        .unwrap();
    bytes[offset + 24..offset + 28].copy_from_slice(&((MAX_EXPANDED + 1) as u32).to_le_bytes());
    let root = tempfile::tempdir().unwrap();
    assert!(extract(&bytes, entry(&bytes), root.path(), "review".into())
        .unwrap_err()
        .contains("256 MiB"));
}
