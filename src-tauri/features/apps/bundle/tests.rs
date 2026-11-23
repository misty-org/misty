use std::io::Write;

use super::*;

fn temp_root(name: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("misty-apps-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    root
}

fn manifest_json(id: &str, version: &str) -> String {
    format!(
        r#"{{"id":"{id}","name":"Demo","version":"{version}","logo":"logo.svg","entry":"index.html","permissions":["files"]}}"#
    )
}

fn zip_of(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    for (name, data) in files {
        writer
            .start_file(*name, zip::write::SimpleFileOptions::default())
            .unwrap();
        writer.write_all(data).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

fn good_zip(id: &str, version: &str) -> Vec<u8> {
    let manifest = manifest_json(id, version);
    zip_of(&[
        (MANIFEST_FILE, manifest.as_bytes()),
        ("index.html", b"<html></html>"),
        ("logo.svg", b"<svg/>"),
        ("assets/app.js", b"1"),
    ])
}

fn installed(root: &Path, id: &str, version: &str) -> bool {
    bundle_dir(root, id, version)
        .ok()
        .is_some_and(|dir| matches!(manifest_in(&dir, id, version), Ok(Some(_))))
}

fn file(root: &Path, id: &str, version: &str, relative: &str) -> Result<PathBuf, FileError> {
    let dir = bundle_dir(root, id, version).map_err(|_| FileError::Invalid)?;
    resolve_file_in(&dir, relative)
}

#[test]
fn a_matching_zip_installs_and_serves_only_its_own_files() {
    let root = temp_root("install");
    let bytes = good_zip("demo", "1.0.0");
    let manifest = install_zip(&root, "demo", "1.0.0", &bytes, &sha256_hex(&bytes)).unwrap();
    assert_eq!(manifest.name, "Demo");
    assert!(installed(&root, "demo", "1.0.0"));
    assert!(file(&root, "demo", "1.0.0", "assets/app.js").is_ok());
    assert_eq!(
        file(&root, "demo", "1.0.0", "nope.js"),
        Err(FileError::NotFound)
    );
    assert_eq!(
        file(&root, "demo", "1.0.0", "../1.0.0/index.html"),
        Err(FileError::Invalid)
    );
    assert_eq!(
        file(&root, "../demo", "1.0.0", "index.html"),
        Err(FileError::Invalid)
    );
    install_zip(
        &root,
        "demo",
        "1.0.0",
        &bytes,
        &sha256_hex(&bytes).to_uppercase(),
    )
    .unwrap();
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_wrong_checksum_or_name_installs_nothing() {
    let root = temp_root("refuse");
    let bytes = good_zip("demo", "1.0.0");
    assert!(install_zip(&root, "demo", "1.0.0", &bytes, &"0".repeat(64)).is_err());
    assert!(install_zip(&root, "other", "1.0.0", &bytes, &sha256_hex(&bytes)).is_err());
    assert!(install_zip(&root, "demo", "2.0.0", &bytes, &sha256_hex(&bytes)).is_err());
    assert!(!installed(&root, "demo", "1.0.0"));
    let leftovers: Vec<_> = std::fs::read_dir(&root).unwrap().flatten().collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_zip_that_leaves_its_folder_or_lacks_its_files_is_refused() {
    let root = temp_root("hostile");
    let manifest = manifest_json("demo", "1.0.0");
    for files in [
        vec![
            (MANIFEST_FILE, manifest.as_bytes()),
            ("index.html", b"x"),
            ("logo.svg", b"x"),
            ("../evil", b"x"),
        ],
        vec![(MANIFEST_FILE, manifest.as_bytes()), ("index.html", b"x")],
        vec![("index.html", b"x"), ("logo.svg", b"x")],
    ] {
        let bytes = zip_of(&files);
        assert!(install_zip(&root, "demo", "1.0.0", &bytes, &sha256_hex(&bytes)).is_err());
    }
    assert!(!installed(&root, "demo", "1.0.0"));
    std::fs::remove_dir_all(&root).unwrap();
}

fn vendor_zip(top: Option<&str>, files: &[(&str, &[u8])]) -> Vec<u8> {
    let prefix = top.map(|folder| format!("{folder}/")).unwrap_or_default();
    let named: Vec<(String, &[u8])> = files
        .iter()
        .map(|(name, data)| (format!("{prefix}{name}"), *data))
        .collect();
    let refs: Vec<(&str, &[u8])> = named
        .iter()
        .map(|(name, data)| (name.as_str(), *data))
        .collect();
    zip_of(&refs)
}

fn wrap(strip_top: bool, copies: &[(&str, &str)]) -> Wrap {
    Wrap {
        manifest: serde_json::json!({
            "name": "Demo", "logo": "logo.png", "entry": "index.html", "permissions": ["files"],
            "own_origin": true, "inline_scripts": true, "shim": true
        }),
        add_copies: copies
            .iter()
            .map(|(from, to)| AddCopy {
                from: (*from).into(),
                to: (*to).into(),
            })
            .collect(),
        strip_top,
        auto_top: false,
        add_files: Vec::new(),
    }
}

#[test]
fn an_adapter_is_added_under_misty_and_never_over_the_release() {
    let root = temp_root("adapter");
    let zip = vendor_zip(None, &[("index.html", b"<html>")]);
    let with = |path: &str| Wrap {
        add_files: vec![AddFile {
            path: path.into(),
            content: "window.mistyAdapter = {};".into(),
        }],
        ..wrap(false, &[])
    };
    install_wrapped(
        &root,
        "demo",
        "1.0.0",
        &zip,
        &sha256_hex(&zip),
        &with("misty/adapter.js"),
    )
    .unwrap();
    assert!(bundle_dir(&root, "demo", "1.0.0")
        .unwrap()
        .join("misty/adapter.js")
        .exists());
    for bad in [
        "adapter.js",
        "misty/../index.html",
        "misty/a.html",
        "index.html",
    ] {
        assert!(
            install_wrapped(&root, "demo", "2.0.0", &zip, &sha256_hex(&zip), &with(bad)).is_err(),
            "{bad}"
        );
    }
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_release_of_unknown_layout_is_taken_with_or_without_its_top_folder() {
    let root = temp_root("auto-top");
    let auto = Wrap {
        strip_top: false,
        auto_top: true,
        ..wrap(false, &[])
    };
    let nested = vendor_zip(Some("demo-web"), &[("index.html", b"<html>")]);
    let flat = vendor_zip(None, &[("index.html", b"<html>")]);
    install_wrapped(&root, "demo", "1.0.0", &nested, &sha256_hex(&nested), &auto).unwrap();
    install_wrapped(&root, "demo", "2.0.0", &flat, &sha256_hex(&flat), &auto).unwrap();
    assert!(bundle_dir(&root, "demo", "1.0.0")
        .unwrap()
        .join("index.html")
        .exists());
    assert!(bundle_dir(&root, "demo", "2.0.0")
        .unwrap()
        .join("index.html")
        .exists());
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_makers_release_is_installed_as_published_with_only_the_wrapper_added() {
    let root = temp_root("wrapped");
    let bytes = vendor_zip(
        Some("demo-web-1.0.0"),
        &[
            ("index.html", b"<html/>"),
            ("app/glue.js", b"g"),
            ("snippets/s.js", b"s"),
            ("LICENSE-MIT", b"mit"),
        ],
    );
    let sum = sha256_hex(&bytes);
    let manifest = install_wrapped(
        &root,
        "demo",
        "1.0.0",
        &bytes,
        &sum,
        &wrap(true, &[("snippets", "app/snippets")]),
    )
    .unwrap();
    assert_eq!(
        (manifest.id.as_str(), manifest.version.as_str()),
        ("demo", "1.0.0")
    );
    assert!(manifest.own_origin && manifest.inline_scripts && manifest.shim);
    let dir = bundle_dir(&root, "demo", "1.0.0").unwrap();
    assert_eq!(std::fs::read(dir.join("index.html")).unwrap(), b"<html/>");
    assert_eq!(std::fs::read(dir.join("snippets/s.js")).unwrap(), b"s");
    assert_eq!(std::fs::read(dir.join("app/snippets/s.js")).unwrap(), b"s");
    assert!(dir.join("LICENSE-MIT").is_file() && dir.join(MANIFEST_FILE).is_file());
    assert!(install_wrapped(
        &root,
        "other",
        "1.0.0",
        &bytes,
        &"0".repeat(64),
        &wrap(true, &[])
    )
    .is_err());
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_wrapped_release_that_doesnt_fit_the_wrapper_installs_nothing() {
    let root = temp_root("wrapped-refuse");
    let try_install = |bytes: Vec<u8>, wrap: Wrap| {
        let sum = sha256_hex(&bytes);
        install_wrapped(&root, "demo", "1.0.0", &bytes, &sum, &wrap)
    };
    assert!(try_install(
        zip_of(&[("a/index.html", b"x"), ("b/other.js", b"x")]),
        wrap(true, &[])
    )
    .is_err());
    assert!(try_install(zip_of(&[("index.html", b"x")]), wrap(true, &[])).is_err());
    assert!(try_install(
        vendor_zip(Some("d"), &[("index.html", b"x")]),
        wrap(true, &[("../x", "y")])
    )
    .is_err());
    assert!(try_install(
        vendor_zip(None, &[("index.html", b"x"), (MANIFEST_FILE, b"{}")]),
        wrap(false, &[])
    )
    .is_err());
    assert!(try_install(
        vendor_zip(Some("d"), &[("other.html", b"x")]),
        wrap(true, &[])
    )
    .is_err());
    assert!(!installed(&root, "demo", "1.0.0"));
    let leftovers: Vec<_> = std::fs::read_dir(&root).unwrap().flatten().collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
#[ignore = "needs a downloaded release"]
fn a_real_vendor_release_installs_from_its_catalog_entry() {
    let (Ok(zip), Ok(catalog), Ok(id)) = (
        std::env::var("MISTY_TEST_VENDOR_ZIP"),
        std::env::var("MISTY_TEST_CATALOG"),
        std::env::var("MISTY_TEST_APP"),
    ) else {
        panic!("set MISTY_TEST_VENDOR_ZIP, MISTY_TEST_CATALOG and MISTY_TEST_APP");
    };
    let catalog: serde_json::Value =
        serde_json::from_slice(&std::fs::read(catalog).unwrap()).unwrap();
    let entry = catalog["apps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|app| app["id"] == id)
        .expect("app in catalog");
    let wrap: Wrap = serde_json::from_value(serde_json::json!({
        "manifest": entry["manifest"], "add_copies": entry["add_copies"], "strip_top": entry["strip_top"]
    }))
    .unwrap();
    let version = entry["version"].as_str().unwrap();
    let bytes = std::fs::read(zip).unwrap();
    let root = temp_root("real");
    let manifest = install_wrapped(
        &root,
        &id,
        version,
        &bytes,
        entry["sha256"].as_str().unwrap(),
        &wrap,
    )
    .unwrap();
    let dir = bundle_dir(&root, &id, version).unwrap();
    assert!(resolve_file_in(&dir, &manifest.entry).is_ok());
    std::fs::remove_dir_all(&root).unwrap();
}
