mod common;

use common::{failed, fixture};
use serde_json::json;
use std::fs;

#[tokio::test(flavor = "multi_thread")]
async fn undo_restores_files_and_removes_added_ones() {
    let f = fixture();
    fs::create_dir_all(f.root().join("css")).unwrap();
    fs::write(f.root().join("index.html"), "original").unwrap();
    fs::write(f.root().join("css/site.css"), "body{}").unwrap();
    fs::write(f.root().join(".gitignore"), "build/\n").unwrap();
    fs::create_dir_all(f.root().join("build")).unwrap();
    fs::write(f.root().join("build/keep.txt"), "ignored output").unwrap();

    f.call("code.write", json!({ "path": "index.html", "content": "changed" })).await;
    f.call("code.write", json!({ "path": "pages/new.html", "content": "added" })).await;
    #[cfg(target_os = "macos")]
    f.run("rm css/site.css").await;
    #[cfg(windows)]
    {
        let deleted = f.run(r"del css\site.css").await;
        assert!(!f.root().join("css/site.css").exists(), "{deleted}");
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    fs::remove_file(f.root().join("css/site.css")).unwrap();

    let listed = f.service.checkpoints("scope_test");
    assert_eq!(listed["checkpoints"][0]["runId"], "run_1", "{listed}");

    let undone = f.service.undo(&f.project, "run_1").unwrap();
    assert!(undone["restored"].as_u64().unwrap() >= 2, "{undone}");
    assert_eq!(fs::read_to_string(f.root().join("index.html")).unwrap(), "original");
    assert_eq!(fs::read_to_string(f.root().join("css/site.css")).unwrap(), "body{}");
    assert!(!f.root().join("pages/new.html").exists());
    assert!(!f.root().join("pages").exists(), "folders the run made are removed");
    assert_eq!(fs::read_to_string(f.root().join("build/keep.txt")).unwrap(), "ignored output");
    assert!(f.service.undo(&f.project, "run_1").is_err(), "undo happens once");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_checkpoint_is_taken_before_the_first_change_only() {
    let f = fixture();
    fs::write(f.root().join("a.txt"), "v1").unwrap();
    f.call("code.write", json!({ "path": "a.txt", "content": "v2" })).await;
    f.call("code.write", json!({ "path": "a.txt", "content": "v3" })).await;
    f.service.undo(&f.project, "run_1").unwrap();
    assert_eq!(fs::read_to_string(f.root().join("a.txt")).unwrap(), "v1");
}

async fn fetch(port_url: &str, host: &str, path: &str) -> (u16, String) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let address = port_url.trim_start_matches("http://").split('/').next().unwrap().to_owned();
    let mut stream = tokio::net::TcpStream::connect(&address).await.unwrap();
    stream
        .write_all(format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n").as_bytes())
        .await
        .unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).await.unwrap();
    let status = response.split_whitespace().nth(1).unwrap().parse().unwrap();
    (status, response)
}

#[tokio::test(flavor = "multi_thread")]
async fn previews_serve_the_project_safely() {
    let f = fixture();
    fs::write(f.root().join("index.html"), "<h1>home</h1>").unwrap();
    fs::write(f.root().join("about.html"), "<h1>about</h1>").unwrap();
    fs::write(f.root().join(".env"), "SECRET=1").unwrap();
    let secret = f.outside.path().join("secret.txt");
    fs::write(&secret, "TOP SECRET").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&secret, f.root().join("leak.txt")).unwrap();
    common::link_folder(f.outside.path(), &f.root().join("leaks"));

    let preview = f.call("code.preview", json!({})).await;
    let url = preview["url"].as_str().unwrap().to_owned();
    assert!(url.starts_with("http://127.0.0.1:"), "{preview}");
    let host = url.trim_start_matches("http://").split('/').next().unwrap().to_owned();

    let (status, body) = fetch(&url, &host, "/").await;
    assert_eq!(status, 200);
    assert!(body.contains("<h1>home</h1>"));
    assert_eq!(fetch(&url, &host, "/about").await.0, 200);
    assert_eq!(fetch(&url, &host, "/.env").await.0, 404);
    assert_eq!(fetch(&url, &host, "/leak.txt").await.0, 404);
    assert_eq!(fetch(&url, &host, "/leaks/secret.txt").await.0, 404);
    assert_eq!(fetch(&url, &host, "/../../etc/passwd").await.0, 404);
    assert_eq!(fetch(&url, &host, "/%2e%2e/%2e%2e/etc/passwd").await.0, 404);
    assert_eq!(fetch(&url, "attacker.example", "/").await.0, 421, "rebinding is refused");

    let missing = f.call("code.preview", json!({ "path": "nope.html" })).await;
    assert!(failed(&missing));

    // A build folder is served as its own site root, so /assets/... resolves.
    fs::create_dir_all(f.root().join("dist/assets")).unwrap();
    fs::write(f.root().join("dist/index.html"), "<script src=\"/assets/app.js\"></script>").unwrap();
    fs::write(f.root().join("dist/assets/app.js"), "console.log(1)").unwrap();
    let built = f.call("code.preview", json!({ "path": "dist" })).await;
    let built_url = built["url"].as_str().unwrap().to_owned();
    let built_host = built_url.trim_start_matches("http://").split('/').next().unwrap().to_owned();
    assert_ne!(built_host, host, "a separate server per site folder");
    let (status, body) = fetch(&built_url, &built_host, "/assets/app.js").await;
    assert_eq!(status, 200);
    assert!(body.contains("text/javascript"));
}

#[test]
fn removing_a_tree_never_follows_symlinks() {
    let f = fixture();
    let outside = f.outside.path().join("keep");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("precious.txt"), "keep me").unwrap();
    fs::create_dir_all(f.root().join("x/inner")).unwrap();
    fs::write(f.root().join("x/inner/a.txt"), "a").unwrap();
    common::link_folder(&outside, &f.root().join("x/link"));
    let root = misty_agent_code::beneath::open_root(&f.root()).unwrap();
    misty_agent_code::beneath::remove_tree(&root, std::path::Path::new("x")).unwrap();
    assert!(!f.root().join("x").exists());
    assert_eq!(fs::read_to_string(outside.join("precious.txt")).unwrap(), "keep me");
    // A symlinked parent is refused outright.
    common::link_folder(f.outside.path(), &f.root().join("swapped"));
    assert!(misty_agent_code::beneath::remove_tree(&root, std::path::Path::new("swapped/keep")).is_err());
    assert!(outside.join("precious.txt").exists());
}
