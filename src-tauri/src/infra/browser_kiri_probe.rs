//! Debug-only end-to-end check of Kiri inside the running app (macOS): opens a
//! real browser tab on a loopback page and exercises each Kiri layer. Run with
//! `MISTY_KIRI_PROBE=1 npm run tauri -- dev`; it prints `KIRI PROBE` lines and
//! quits the app. Nothing here runs unless that variable is set.
use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::Listener;

const ID: &str = "kiri-probe";
const PAGE: &str = "<!doctype html><title>Kiri probe</title><body data-fixture=\"ready\"><p id=\"text\">Kiri copy check</p></body>";

fn serve() -> Result<Url, String> {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut stream = stream;
            let mut buffer = [0u8; 4096];
            let _ = stream.read(&mut buffer);
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{PAGE}",
                PAGE.len()
            );
        }
    });
    Url::parse(&format!("http://127.0.0.1:{port}/")).map_err(|e| e.to_string())
}

async fn eval(app: &AppHandle, body: &str) -> Result<Value, String> {
    let view = app.get_webview(&webview_label(ID)?).ok_or("Probe tab unavailable")?;
    let raw = evaluate_browser_async_javascript(view, body.to_owned()).await?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

async fn wait_for(stage: &str, ready: impl Fn() -> bool) -> Result<(), String> {
    let deadline = std::time::Instant::now() + Duration::from_secs(12);
    while !ready() {
        if std::time::Instant::now() > deadline {
            return Err(format!("timed out: {stage}"));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Ok(())
}

/// Counts events for the probe tab.
fn counter(app: &AppHandle, event: &'static str) -> (Arc<AtomicUsize>, tauri::EventId) {
    let count = Arc::new(AtomicUsize::new(0));
    let seen = count.clone();
    let id = app.listen_any(event, move |event| {
        if serde_json::from_str::<Value>(event.payload()).is_ok_and(|v| v["id"] == ID || v["sourceId"] == ID) {
            seen.fetch_add(1, Ordering::SeqCst);
        }
    });
    (count, id)
}

fn report(stage: &str, result: &Result<(), String>) {
    match result {
        Ok(()) => println!("KIRI PROBE PASS: {stage}"),
        Err(error) => println!("KIRI PROBE FAIL: {stage}: {error}"),
    }
}

async fn page_calls_reach_kiri_and_nothing_else(app: &AppHandle) -> Result<(), String> {
    let (media, listener) = counter(app, "misty://browser-media");
    let result = eval(app, r#"
        const invoke = window.__TAURI_INTERNALS__.invoke;
        const outcome = async (promise) => promise.then(() => 'ok', (e) => String(e?.name ?? e));
        return JSON.stringify({
            media: await outcome(invoke('plugin:kiri|call', { request: { v: 1, cap: 'media', method: 'state', args: { audible: true } } })),
            unknown: await outcome(invoke('plugin:kiri|call', { request: { v: 1, cap: 'bluetooth', method: 'request-device' } })),
            app: await outcome(invoke('browser_site_permissions_list')),
            webauthnShim: String(navigator.credentials.create).includes('[native code]') ? 'native' : 'kiri',
        });
    "#).await?;
    wait_for("media signal from the page", || media.load(Ordering::SeqCst) >= 1).await?;
    app.unlisten(listener);
    if result["media"] != "ok" {
        return Err(format!("media.state was refused: {result}"));
    }
    if result["unknown"] != "NotSupportedError" {
        return Err(format!("unknown capability answered {result}"));
    }
    if result["app"] == "ok" {
        return Err("a website reached one of Misty's own commands".into());
    }
    // This build is not signed with the passkey entitlement, so Kiri must leave WebKit's WebAuthn alone.
    if result["webauthnShim"] != "native" {
        return Err("the passkey shim was installed without the entitlement".into());
    }
    Ok(())
}

async fn host_channel_authenticates_misty_scripts(app: &AppHandle) -> Result<(), String> {
    let token = shortcut_token_for(&app.state::<BrowserSessionState>(), ID)?;
    let (focus, focus_listener) = counter(app, "misty://browser-focus");
    let (stopped, stopped_listener) = counter(app, "misty://browser-stopped");
    let (shortcut, shortcut_listener) = counter(app, "misty://browser-shortcut");
    let shortcut_url = format!("misty-shortcut:event?key=w&code=KeyW&alt=false&ctrl=false&meta=true&shift=false&repeat=false&editable=false&token={token}");
    eval(app, &format!(r#"
        const post = (message) => window.webkit.messageHandlers.kiriHost.postMessage(message);
        post('forged-token');
        post({token:?});
        post(JSON.stringify({{ token: 'forged-token', status: 'stopped' }}));
        post(JSON.stringify({{ token: {token:?}, status: 'stopped' }}));
        post(JSON.stringify({{ navigate: {shortcut_url:?} }}));
        return '{{}}';
    "#)).await?;
    wait_for("focus, status and shortcut over the host channel", || {
        stopped.load(Ordering::SeqCst) >= 1 && shortcut.load(Ordering::SeqCst) >= 1
    })
    .await?;
    tokio::time::sleep(Duration::from_millis(300)).await;
    for listener in [focus_listener, stopped_listener, shortcut_listener] {
        app.unlisten(listener);
    }
    // The shortcut also focuses its tab, so focus counts the token message plus the shortcut.
    if stopped.load(Ordering::SeqCst) != 1 || focus.load(Ordering::SeqCst) != 2 {
        return Err(format!(
            "forged messages were accepted (stopped={}, focus={})",
            stopped.load(Ordering::SeqCst),
            focus.load(Ordering::SeqCst)
        ));
    }
    let location = eval(app, "return JSON.stringify({url: location.href});").await?;
    if location["url"].as_str().is_some_and(|url| url.starts_with("misty-")) {
        return Err("a host message navigated the page".into());
    }
    Ok(())
}

async fn context_menu_copies_through_kiri(app: &AppHandle, url: &Url) -> Result<(), String> {
    let token = shortcut_token_for(&app.state::<BrowserSessionState>(), ID)?;
    let menu: Arc<std::sync::Mutex<Option<String>>> = Arc::default();
    let shown = menu.clone();
    let listener = app.listen_any("misty://browser-context-menu", move |event| {
        if let Ok(value) = serde_json::from_str::<Value>(event.payload()) {
            *shown.lock().unwrap() = value["key"].as_str().map(str::to_owned);
        }
    });
    let payload = json!({
        "url": url.as_str(), "documentRevision": "probe:1", "title": "Kiri probe",
        "content": "Kiri copy check", "selection": true, "editable": false, "link": "", "image": "",
    })
    .to_string();
    let open: String = url::form_urlencoded::Serializer::new(String::from("misty-context-menu:open?"))
        .append_pair("token", &token)
        .append_pair("payload", &payload)
        .finish();
    eval(app, &format!(r#"
        getSelection().selectAllChildren(document.getElementById('text'));
        window.webkit.messageHandlers.kiriHost.postMessage(JSON.stringify({{ navigate: {open:?} }}));
        return '{{}}';
    "#)).await?;
    wait_for("context menu presented to the shell", || menu.lock().unwrap().is_some()).await?;
    app.unlisten(listener);
    let key = menu.lock().unwrap().clone().unwrap_or_default();
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    let previous = clipboard.get_text().ok();
    let _ = clipboard.set_text("kiri-probe-before");
    let main = app.get_webview("main").ok_or("Missing main view")?;
    let result = async {
        context_menu::select(app, &main, &key, "copy")?;
        wait_for("copy through kiri::engine::edit", || {
            arboard::Clipboard::new().and_then(|mut c| c.get_text()).is_ok_and(|t| t == "Kiri copy check")
        })
        .await
    }
    .await;
    if let Some(previous) = previous {
        let _ = clipboard.set_text(previous);
    }
    result
}

async fn site_permissions_round_trip(app: &AppHandle) -> Result<(), String> {
    use super::super::browser_site_permissions as permissions;
    let main = app.get_webview("main").ok_or("Missing main view")?;
    let info = serde_json::to_value(permissions::browser_site_info(main.clone(), app.clone(), ID.into()).await?)
        .map_err(|e| e.to_string())?;
    let origin = info["origin"].as_str().ok_or("no origin")?.to_owned();
    let profile = info["profile"].as_str().ok_or("probe tab has no persistent profile")?.to_owned();
    let allowed = permissions::Permissions { camera: permissions::Decision::Allow, microphone: permissions::Decision::Block };
    let saved = serde_json::to_value(
        permissions::browser_site_permissions_set(main.clone(), app.clone(), ID.into(), origin.clone(), allowed).await?,
    )
    .map_err(|e| e.to_string())?;
    let listed = permissions::browser_site_permissions_list(main.clone(), app.clone()).await?;
    let found = listed.iter().any(|entry| entry.origin == origin && entry.profile == profile);
    permissions::browser_site_permissions_reset(main.clone(), app.clone(), profile, origin).await?;
    if saved["permissions"]["camera"] != "allow" || saved["permissions"]["microphone"] != "block" || !found {
        return Err(format!("decision did not round-trip: {saved}"));
    }
    Ok(())
}

/// Runs Kiri's macOS authenticator for real. Unsigned for the passkey
/// entitlement, the system must refuse it and Kiri must say so without hanging.
async fn passkey_path_reaches_authentication_services(app: &AppHandle) -> Result<(), String> {
    use kiri::capabilities::webauthn::{macos, WebAuthn};
    struct ProbeHost(AppHandle);
    impl kiri::Host for ProbeHost {
        fn signal(&self, _caller: &kiri::Caller, _signal: kiri::Signal) {}
        fn run_on_main(&self, work: Box<dyn FnOnce() + Send>) {
            let _ = self.0.run_on_main_thread(work);
        }
    }
    let kiri = kiri::Kiri::new("kiri-probe", ProbeHost(app.clone())).with(WebAuthn::new(macos::MacAuthenticator));
    let page = Url::parse("https://example.com/login").map_err(|e| e.to_string())?;
    let call = |method: &str, args: Value| kiri::Request { v: 1, cap: "webauthn".into(), method: method.into(), args };
    let state_before = authorization_state(app).await;
    // "challenge-challenge" in base64url.
    let get = kiri.dispatch("kiri-probe", &page, call("get", json!({ "challenge": "Y2hhbGxlbmdlLWNoYWxsZW5nZQ", "rpId": "example.com" })));
    tokio::pin!(get);
    let (outcome, shown) = match tokio::time::timeout(Duration::from_secs(8), &mut get).await {
        Ok(outcome) => (outcome, false),
        Err(_) => {
            // System UI is up. Kiri's cancel must end it and settle the page's promise.
            let _ = kiri.dispatch("kiri-probe", &page, call("cancel", Value::Null)).await;
            match tokio::time::timeout(Duration::from_secs(8), &mut get).await {
                Ok(outcome) => (outcome, true),
                Err(_) => {
                    return Err(format!(
                        "system UI stayed open after cancel (passkey authorization before: {state_before})"
                    ))
                }
            }
        }
    };
    println!(
        "KIRI PROBE NOTE: entitled={} authorization={state_before}->{} sheet_shown={shown} passkey get -> {outcome:?}",
        macos::available(),
        authorization_state(app).await
    );
    match outcome {
        Err(error) if ["NotAllowedError", "InvalidStateError"].contains(&error.name) => Ok(()),
        Ok(_) if macos::available() => Ok(()),
        other => Err(format!("unexpected passkey outcome: {other:?}")),
    }
}

/// ASAuthorizationWebBrowserPublicKeyCredentialManager.authorizationStateForPlatformCredentials.
async fn authorization_state(app: &AppHandle) -> &'static str {
    let (send, receive) = tokio::sync::oneshot::channel();
    let _ = app.run_on_main_thread(move || {
        #[allow(unexpected_cfgs)]
        let state = unsafe {
            use objc::runtime::{Class, Object};
            use objc::{msg_send, sel, sel_impl};
            Class::get("ASAuthorizationWebBrowserPublicKeyCredentialManager").map(|class| {
                let manager: *mut Object = msg_send![class, new];
                let state: isize = msg_send![manager, authorizationStateForPlatformCredentials];
                let _: () = msg_send![manager, release];
                state
            })
        };
        let _ = send.send(state);
    });
    match receive.await.ok().flatten() {
        Some(0) => "authorized",
        Some(1) => "denied",
        Some(2) => "not-determined",
        Some(_) => "unknown",
        None => "unavailable",
    }
}

pub(crate) async fn run(app: AppHandle) -> bool {
    let mut passed = true;
    let setup = async {
        wait_for("main window", || app.get_webview("main").is_some()).await?;
        tokio::time::sleep(Duration::from_secs(3)).await;
        let url = serve()?;
        use sha2::{Digest, Sha256};
        let profile = hex::encode(Sha256::digest(format!("kiri-probe:{}", uuid::Uuid::new_v4())));
        let request: BrowserWebviewCreateRequest = serde_json::from_value(json!({
            "id": ID, "url": url.as_str(), "profileId": profile, "scopeId": ID,
            "x": 0, "y": 60, "width": 800, "height": 550,
        }))
        .map_err(|error| error.to_string())?;
        let main = app.get_webview("main").ok_or("Missing main view")?;
        browser_webview_create(main, app.clone(), app.state::<BrowserSessionState>(), request).await?;
        // A cold dev launch can take a while to settle the shell and the tab.
        let mut last = String::new();
        for _ in 0..600 {
            match eval(&app, "return JSON.stringify({ready: document.body?.dataset.fixture === 'ready', url: location.href});").await {
                Ok(value) if value["ready"] == true => {
                    last.clear();
                    break;
                }
                Ok(value) => last = value.to_string(),
                Err(error) => last = error,
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        if !last.is_empty() {
            return Err(format!("probe page did not load: {last}"));
        }
        Ok(url)
    }
    .await;
    report("tab on a loopback page", &setup.as_ref().map(|_| ()).map_err(Clone::clone));
    let Ok(url) = setup else { return false };
    let checks = [
        ("page → plugin:kiri|call (ACL, gate, media signal, no app commands, no passkey shim unentitled)", page_calls_reach_kiri_and_nothing_else(&app).await),
        ("host channel (token focus, Escape-stop status, shortcut; forgeries dropped; no navigation)", host_channel_authenticates_misty_scripts(&app).await),
        ("context menu over the host channel, copy via kiri::engine::edit", context_menu_copies_through_kiri(&app, &url).await),
        ("site permissions set, list and reset through Kiri's engine facts", site_permissions_round_trip(&app).await),
        ("macOS passkey path runs AuthenticationServices end to end (refused without the entitlement)", passkey_path_reaches_authentication_services(&app).await),
    ];
    for (stage, result) in &checks {
        report(stage, result);
        passed &= result.is_ok();
    }
    let _ = browser_webview_close(app.clone(), app.state::<BrowserSessionState>(), BrowserWebviewIdRequest { id: ID.into() });
    passed
}
