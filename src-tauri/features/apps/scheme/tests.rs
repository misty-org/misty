use super::*;

fn uri(text: &str) -> tauri::http::Uri {
    text.parse().unwrap()
}

fn app(id: &str, version: &str, file: &str) -> Option<Target> {
    Some(Target::App {
        id: id.into(),
        version: version.into(),
        file: file.into(),
    })
}

#[test]
fn a_request_names_an_app_a_version_and_a_file() {
    assert_eq!(
        requested(&uri("misty-app://photocraft/1.2.0/assets/a%20b.wasm")),
        app("photocraft", "1.2.0", "assets/a b.wasm")
    );
    assert_eq!(
        requested(&uri("misty-app://docs/1.0.0/")),
        app("docs", "1.0.0", "")
    );
    assert_eq!(
        requested(&uri("misty-app://localhost/docs/1.0.0/a.js")),
        app("docs", "1.0.0", "a.js")
    );
    assert_eq!(
        requested(&uri("http://misty-app.localhost/docs/1.0.0/")),
        app("docs", "1.0.0", "")
    );
    assert_eq!(
        requested(&uri("http://misty-app.docs.localhost/1.0.0/a.js")),
        app("docs", "1.0.0", "a.js")
    );
    assert_eq!(
        requested(&uri("misty-app://docs.localhost/1.0.0/")),
        app("docs", "1.0.0", "")
    );
    assert_eq!(
        requested(&uri("http://misty-app.docs.localhost/__misty/shim.js")),
        Some(Target::Shim)
    );
    assert_eq!(requested(&uri("misty-app://docs/")), None);
    assert_eq!(requested(&uri("misty-app://localhost/docs")), None);
    assert_eq!(
        requested(&uri("misty-app://photocraft/__misty/shim.js")),
        Some(Target::Shim)
    );
    assert_eq!(
        requested(&uri("misty-app://localhost/__misty/screen.js")),
        Some(Target::Screen)
    );
    assert_eq!(
        requested(&uri("misty-app://docs/__misty/bytes/ab12")),
        Some(Target::Bytes("ab12".into()))
    );
    assert_eq!(
        requested(&uri("http://misty-app.docs.localhost/__misty/bytes/ab12")),
        Some(Target::Bytes("ab12".into()))
    );
}

#[test]
fn the_shim_goes_first_in_the_head_and_the_page_is_otherwise_unchanged() {
    let page =
        b"<!DOCTYPE html><HTML><head data-x=\"1\"><title>t</title></head><body>b</body></HTML>";
    let out = String::from_utf8(with_shim(page)).unwrap();
    assert!(out
        .contains("<head data-x=\"1\"><script src=\"/__misty/shim.js\"></script><title>t</title>"));
    assert_eq!(out.replace(SHIM_TAG, "").as_bytes(), page);
    assert!(String::from_utf8(with_shim(b"<p>x</p>"))
        .unwrap()
        .starts_with(SHIM_TAG));
}

#[test]
fn files_have_their_types_and_the_policy_has_no_network_or_eval() {
    assert_eq!(mime_of("a/app.wasm"), "application/wasm");
    assert_eq!(mime_of("x.MJS"), "text/javascript; charset=utf-8");
    assert_eq!(mime_of("noext"), "application/octet-stream");
    let policy = policy("tauri://localhost", false, &[]);
    assert!(
        policy.contains("default-src 'none'")
            && policy.contains("frame-ancestors tauri://localhost")
    );
    assert!(
        !policy.contains("'unsafe-eval'")
            && !policy.contains("https:")
            && !policy.contains("unsafe-inline'; style")
    );
    assert!(self::policy("x", true, &[]).contains("'wasm-unsafe-eval' 'unsafe-inline'"));
    let open = self::policy(
        "x",
        false,
        &["api.example.com".into(), "http://evil".into()],
    );
    assert!(open.contains(" https://api.example.com wss://api.example.com"));
    assert!(!open.contains("evil"));
}

#[tokio::test]
async fn an_installed_app_is_served_with_its_entry_and_policy() {
    let cache = std::env::temp_dir().join(format!("misty-apps-scheme-{}", uuid::Uuid::new_v4()));
    let dir = cache.join("demo").join("1.0.0");
    std::fs::create_dir_all(dir.join("assets")).unwrap();
    std::fs::write(
        dir.join("misty-app.json"),
        r#"{"id":"demo","name":"Demo","version":"1.0.0","logo":"logo.svg","entry":"index.html","permissions":[]}"#,
    )
    .unwrap();
    std::fs::write(dir.join("index.html"), "<html>hi</html>").unwrap();
    std::fs::write(dir.join("logo.svg"), "<svg/>").unwrap();
    std::fs::write(dir.join("assets/app.js"), "1").unwrap();
    *bundle::TEST_CACHE.lock().unwrap() = Some(cache.clone());

    let get = |path: &str| {
        Request::builder()
            .uri(format!("misty-app://localhost{path}"))
            .body(Vec::new())
            .unwrap()
    };
    let page = serve(&get("/demo/1.0.0/"), "tauri://localhost")
        .await
        .unwrap();
    assert_eq!(
        page.body().as_ref(),
        format!("{SCREEN_TAG}<html>hi</html>").as_bytes()
    );
    assert_eq!(
        page.headers()[header::CONTENT_TYPE],
        "text/html; charset=utf-8"
    );
    let policy = page.headers()[header::CONTENT_SECURITY_POLICY]
        .to_str()
        .unwrap();
    assert!(
        policy.contains("default-src 'none'")
            && policy.contains("frame-ancestors tauri://localhost")
    );
    let script = serve(&get("/demo/1.0.0/assets/app.js"), "tauri://localhost")
        .await
        .unwrap();
    assert_eq!(
        script.headers()[header::CONTENT_TYPE],
        "text/javascript; charset=utf-8"
    );
    assert_eq!(script.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN], "*");
    let own = cache.join("pc").join("2.0.0");
    std::fs::create_dir_all(&own).unwrap();
    std::fs::write(
        own.join("misty-app.json"),
        r#"{"id":"pc","name":"Pc","version":"2.0.0","logo":"logo.svg","entry":"index.html","permissions":["files"],"own_origin":true,"inline_scripts":true,"shim":true}"#,
    )
    .unwrap();
    std::fs::write(
        own.join("index.html"),
        "<html><head></head><body><script>1</script></body></html>",
    )
    .unwrap();
    std::fs::write(own.join("logo.svg"), "<svg/>").unwrap();
    let get_own = |path: &str| {
        Request::builder()
            .uri(format!("misty-app://pc{path}"))
            .body(Vec::new())
            .unwrap()
    };
    let own_page = serve(&get_own("/2.0.0/"), "tauri://localhost")
        .await
        .unwrap();
    let html = String::from_utf8(own_page.body().to_vec()).unwrap();
    assert!(html.starts_with(&format!("<html><head>{SCREEN_TAG}{SHIM_TAG}</head>")));
    assert!(own_page.headers()[header::CONTENT_SECURITY_POLICY]
        .to_str()
        .unwrap()
        .contains("'unsafe-inline'; style-src"));
    assert!(!String::from_utf8(page.body().to_vec())
        .unwrap()
        .contains("shim.js"));
    assert!(!page.headers()[header::CONTENT_SECURITY_POLICY]
        .to_str()
        .unwrap()
        .contains("'unsafe-inline'; style-src"));
    assert!(String::from_utf8(page.body().to_vec())
        .unwrap()
        .contains("/__misty/screen.js"));
    let screen = serve(&get("/__misty/screen.js"), "tauri://localhost")
        .await
        .unwrap();
    assert!(String::from_utf8(screen.body().to_vec())
        .unwrap()
        .contains("misty:screen"));
    let shim = serve(&get_own("/__misty/shim.js"), "tauri://localhost")
        .await
        .unwrap();
    assert!(String::from_utf8(shim.body().to_vec())
        .unwrap()
        .contains("files.pick"));
    assert_eq!(
        serve(&get("/nothing/1.0.0/"), "x").await.unwrap_err(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        serve(&get("/demo/1.0.0/missing.js"), "x")
            .await
            .unwrap_err(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        serve(&get("/demo/1.0.0/a/../../x"), "x").await.unwrap_err(),
        StatusCode::FORBIDDEN
    );
    *bundle::TEST_CACHE.lock().unwrap() = None;
    std::fs::remove_dir_all(&cache).unwrap();
}
