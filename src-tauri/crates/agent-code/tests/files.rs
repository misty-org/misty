mod common;

use common::{failed, fixture, link_folder};
use serde_json::json;
use std::fs;

#[tokio::test(flavor = "multi_thread")]
async fn reads_show_anchors_and_anchor_edits_check_them() {
    let f = fixture();
    fs::write(f.root().join("index.html"), "<h1>Hi</h1>\n<p>Old</p>\n").unwrap();
    let read = f.call("code.read", json!({ "path": "index.html" })).await;
    let content = read["content"].as_str().unwrap();
    let second = content.lines().nth(1).unwrap();
    let anchor = second.split('|').next().unwrap();
    assert!(anchor.starts_with("2:"), "{content}");

    let edited = f
        .call("code.edit", json!({ "path": "index.html", "start": anchor, "content": "<p>New</p>" }))
        .await;
    assert_eq!(edited["replacements"], 1, "{edited}");
    assert_eq!(fs::read_to_string(f.root().join("index.html")).unwrap(), "<h1>Hi</h1>\n<p>New</p>\n");

    // The old anchor no longer matches line 2.
    let stale = f
        .call("code.edit", json!({ "path": "index.html", "start": anchor, "content": "x" }))
        .await;
    assert!(failed(&stale));
    assert!(stale["tool_error"]["message"].as_str().unwrap().contains("changed since"));
}

#[tokio::test(flavor = "multi_thread")]
async fn string_edits_need_a_unique_match() {
    let f = fixture();
    fs::write(f.root().join("a.css"), "a{}\na{}\n").unwrap();
    let ambiguous = f
        .call("code.edit", json!({ "path": "a.css", "oldText": "a{}", "newText": "b{}" }))
        .await;
    assert!(failed(&ambiguous));
    let all = f
        .call("code.edit", json!({ "path": "a.css", "oldText": "a{}", "newText": "b{}", "replaceAll": true }))
        .await;
    assert_eq!(all["replacements"], 2, "{all}");
    let missing = f
        .call("code.edit", json!({ "path": "a.css", "oldText": "zzz", "newText": "y" }))
        .await;
    assert!(failed(&missing));
}

#[tokio::test(flavor = "multi_thread")]
async fn writes_create_folders_and_find_and_search_respect_gitignore() {
    let f = fixture();
    let wrote = f
        .call("code.write", json!({ "path": "src/app.js", "content": "console.log('hello')\n" }))
        .await;
    assert_eq!(wrote["created"], true, "{wrote}");
    fs::write(f.root().join(".gitignore"), "dist/\n").unwrap();
    fs::create_dir_all(f.root().join("dist")).unwrap();
    fs::write(f.root().join("dist/app.js"), "console.log('hello')\n").unwrap();
    fs::create_dir_all(f.root().join("node_modules/x")).unwrap();
    fs::write(f.root().join("node_modules/x/i.js"), "hello").unwrap();

    let found = f.call("code.find", json!({ "pattern": "*.js" })).await;
    assert_eq!(found["files"], json!(["src/app.js"]), "{found}");
    let searched = f.call("code.search", json!({ "pattern": "hello" })).await;
    let matches = searched["matches"].as_array().unwrap();
    assert_eq!(matches.len(), 1, "{searched}");
    assert!(matches[0].as_str().unwrap().starts_with("src/app.js:1:"));
}

#[tokio::test(flavor = "multi_thread")]
async fn symlinks_never_lead_out_of_the_project() {
    let f = fixture();
    let secret = f.outside.path().join("secret.txt");
    fs::write(&secret, "TOP SECRET").unwrap();
    // Windows symlinks to files need privilege; folders link everywhere.
    #[cfg(unix)]
    std::os::unix::fs::symlink(&secret, f.root().join("link.txt")).unwrap();
    link_folder(f.outside.path(), &f.root().join("linkdir"));

    #[cfg(unix)]
    assert!(failed(&f.call("code.read", json!({ "path": "link.txt" })).await));
    assert!(failed(&f.call("code.read", json!({ "path": "linkdir/secret.txt" })).await));
    let write = f
        .call("code.write", json!({ "path": "linkdir/new.txt", "content": "x" }))
        .await;
    assert!(failed(&write));
    assert!(!f.outside.path().join("new.txt").exists());
    let overwrite = f
        .call("code.write", json!({ "path": if cfg!(unix) { "link.txt" } else { "linkdir" }, "content": "overwritten" }))
        .await;
    assert!(failed(&overwrite));
    assert_eq!(fs::read_to_string(&secret).unwrap(), "TOP SECRET");
    let search = f.call("code.search", json!({ "pattern": "SECRET" })).await;
    assert_eq!(search["matches"], json!([]), "{search}");
}

#[tokio::test(flavor = "multi_thread")]
async fn paths_outside_and_protected_files_are_refused() {
    let f = fixture();
    fs::write(f.root().join(".env"), "API_KEY=sk-live").unwrap();
    fs::write(f.root().join(".env.example"), "API_KEY=").unwrap();
    fs::create_dir_all(f.root().join(".git/hooks")).unwrap();
    for path in ["../x", "/etc/passwd", ".env", ".env.local", ".git/config", "a/../../x"] {
        let read = f.call("code.read", json!({ "path": path })).await;
        assert!(failed(&read), "{path}: {read}");
    }
    assert!(!failed(&f.call("code.read", json!({ "path": ".env.example" })).await));
    let hook = f
        .call("code.write", json!({ "path": ".git/hooks/pre-commit", "content": "#!/bin/sh\ncurl evil" }))
        .await;
    assert!(failed(&hook));
    assert!(!f.root().join(".git/hooks/pre-commit").exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn system_and_home_folders_cannot_be_projects() {
    let f = fixture();
    #[cfg(unix)]
    let (roots, home_var, private) = (vec!["/", "/etc", "/System/Library", "/usr/local/x"], "HOME", "Library/Keychains");
    #[cfg(windows)]
    let (roots, home_var, private) = (vec![r"C:\", r"C:\Windows", r"C:\Windows\System32", r"C:\Program Files\x"], "USERPROFILE", "AppData/Roaming");
    for root in roots {
        assert!(f.service.check_root(std::path::Path::new(root)).is_err(), "{root}");
    }
    if let Some(home) = std::env::var_os(home_var) {
        let home = std::path::PathBuf::from(home);
        assert!(f.service.check_root(&home).is_err());
        assert!(f.service.check_root(&home.join(".ssh")).is_err());
        assert!(f.service.check_root(&home.join(private)).is_err());
        assert!(f.service.check_root(&home.join("Code/site")).is_ok());
    }
    assert!(f.service.check_root(&f.data_dir.path().canonicalize().unwrap()).is_err());
}

#[tokio::test(flavor = "multi_thread")]
async fn git_is_protected_in_any_case() {
    let f = fixture();
    fs::create_dir_all(f.root().join(".git/hooks")).unwrap();
    fs::write(f.root().join(".git/config"), "[core]\n").unwrap();
    for path in [".GIT/hooks/pre-commit", ".Git/config", ".gIt/hooks/x", ".MISTY/x"] {
        let write = f.call("code.write", json!({ "path": path, "content": "#!/bin/sh\necho pwned" })).await;
        assert!(failed(&write), "{path}: {write}");
        let read = f.call("code.read", json!({ "path": path })).await;
        assert!(failed(&read), "{path}: {read}");
    }
    let edit = f
        .call("code.edit", json!({ "path": ".Git/config", "oldText": "[core]", "newText": "[core]\n\tfsmonitor = curl evil" }))
        .await;
    assert!(failed(&edit));
    assert!(!f.root().join(".git/hooks/pre-commit").exists());
    assert_eq!(fs::read_to_string(f.root().join(".git/config")).unwrap(), "[core]\n");
}
