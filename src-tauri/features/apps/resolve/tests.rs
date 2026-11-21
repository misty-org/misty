use super::*;

fn repo(license: &str) -> Repo {
    serde_json::from_value(json!({
        "name": "Sketch_Pad",
        "owner": { "login": "maker", "avatar_url": "https://avatars.example/maker" },
        "description": "Draw together",
        "license": { "spdx_id": license },
    }))
    .unwrap()
}

fn release(assets: Value) -> Release {
    serde_json::from_value(json!({ "tag_name": "v1.2.0", "assets": assets })).unwrap()
}

fn asset(name: &str) -> Value {
    json!({
        "name": name,
        "browser_download_url": format!("https://github.com/maker/Sketch_Pad/releases/download/v1.2.0/{name}"),
        "size": 10,
        "digest": format!("sha256:{}", "a".repeat(64)),
    })
}

#[test]
fn links_name_a_repository() {
    for link in [
        "https://github.com/maker/sketch",
        "github.com/maker/sketch",
        "https://github.com/maker/sketch.git",
        "https://github.com/maker/sketch/tree/main/src",
        "maker/sketch",
        " https://www.github.com/maker/sketch/ ",
    ] {
        assert_eq!(repo_of(link), Some(("maker".into(), "sketch".into())), "{link}");
    }
    for link in ["https://gitlab.com/maker/sketch", "maker", "https://github.com/maker", "maker/../x", ""] {
        assert_eq!(repo_of(link), None, "{link}");
    }
}

#[test]
fn ids_are_made_from_the_repository_name() {
    assert_eq!(id_from("Sketch_Pad"), "sketch-pad");
    assert_eq!(id_from("3d-viewer"), "app-3d-viewer");
    assert_eq!(id_from("--a--b--"), "a-b");
    assert!(valid_id(&id_from(&"x".repeat(200))));
}

#[test]
fn the_basic_check_needs_an_open_source_license_and_one_web_build() {
    let (entry, from) = entry_from(&repo("MIT"), &release(json!([asset("sketch-web-1.2.0.zip")])), None).unwrap();
    assert_eq!(from, ManifestFrom::Basic);
    assert_eq!((entry.id.as_str(), entry.version.as_str()), ("sketch-pad", "1.2.0"));
    assert_eq!(entry.sha256, "a".repeat(64));
    assert!(entry.auto_top && !entry.strip_top);
    assert_eq!(entry.manifest["shim"], json!(true));
    assert_eq!(entry.manifest["license"], json!("MIT"));
    assert_eq!(entry.logo, "https://avatars.example/maker");

    let refused = [
        entry_from(&repo("BUSL-1.1"), &release(json!([asset("sketch-web.zip")])), None),
        entry_from(&repo("NOASSERTION"), &release(json!([asset("sketch-web.zip")])), None),
        entry_from(&repo("MIT"), &release(json!([asset("sketch-mac.dmg")])), None),
        entry_from(&repo("MIT"), &release(json!([asset("a-web.zip"), asset("b-web.zip")])), None),
        entry_from(&repo("MIT"), &release(json!([{ "name": "s-web.zip", "browser_download_url": "https://github.com/maker/Sketch_Pad/releases/download/v1.2.0/s-web.zip", "size": 1 }])), None),
        entry_from(&repo("MIT"), &release(json!([{ "name": "s-web.zip", "browser_download_url": "https://evil.example/s-web.zip", "size": 1, "digest": format!("sha256:{}", "a".repeat(64)) }])), None),
    ];
    for result in refused {
        assert!(result.is_err(), "{result:?}");
    }
}

#[test]
fn a_makers_manifest_names_its_build_and_is_checked_as_the_install_would() {
    let theirs: RepoManifest = serde_json::from_value(json!({
        "name": "Sketch",
        "web_asset": "sketch-web-{version}.zip",
        "icon": "icons/sketch.png",
        "manifest": {
            "name": "Sketch", "logo": "logo.png", "entry": "index.html", "permissions": ["files", "rooms"],
            "collab": "room", "network": [{ "host": "api.sketch.example", "paid": true }]
        },
    }))
    .unwrap();
    let (entry, from) =
        entry_from(&repo("Apache-2.0"), &release(json!([asset("sketch-web-1.2.0.zip")])), Some(theirs.clone())).unwrap();
    assert_eq!(from, ManifestFrom::Maker);
    assert_eq!(entry.permissions, vec!["files".to_owned(), "rooms".to_owned()]);
    assert_eq!(entry.logo, "https://raw.githubusercontent.com/maker/Sketch_Pad/v1.2.0/icons/sketch.png");
    assert!(entry_from(&repo("MIT"), &release(json!([asset("other.zip")])), Some(theirs.clone())).is_err());
    let mut broken = theirs;
    broken.manifest.insert("entry".into(), json!("../index.html"));
    assert!(entry_from(&repo("MIT"), &release(json!([asset("sketch-web-1.2.0.zip")])), Some(broken)).is_err());
}

#[test]
fn a_reviewed_app_is_found_by_its_repository() {
    let catalog = json!({ "apps": [{
        "id": "sketch", "name": "Sketch", "maker": "maker", "upstream": "Maker/Sketch", "license": "MIT",
        "version": "1.0.0", "tag": "v1.0.0", "url": "https://github.com/Maker/Sketch/releases/download/v1.0.0/s.zip",
        "sha256": "a".repeat(64), "size": 1, "logo": "x", "permissions": [], "manifest": {}, "mcp_program": { "program": "p" }
    }] })
    .to_string();
    let found = reviewed_in(&catalog, "maker/sketch").unwrap().unwrap();
    assert_eq!(found.id, "sketch");
    // What Misty doesn't read is carried through.
    assert!(found.extra.contains_key("mcp_program"));
    assert!(reviewed_in(&catalog, "maker/other").unwrap().is_none());
}
