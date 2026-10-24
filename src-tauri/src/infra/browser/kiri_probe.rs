//! Debug-only end-to-end check of Kiri inside the running app (macOS): opens a
//! real browser tab on a loopback page and exercises each Kiri layer. Run with
//! `MISTY_KIRI_PROBE=1 npm run tauri -- dev`; it prints `KIRI PROBE` lines and
//! quits the app. Nothing here runs unless that variable is set.
use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::Listener;

mod stages;
use stages::*;

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
    let view = app
        .get_webview(&webview_label(ID)?)
        .ok_or("Probe tab unavailable")?;
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
        if serde_json::from_str::<Value>(event.payload())
            .is_ok_and(|v| v["id"] == ID || v["sourceId"] == ID)
        {
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

pub(crate) async fn run(app: AppHandle) -> bool {
    let mut passed = true;
    let setup = async {
        wait_for("main window", || crate::infra::space_windows::primary_webview(&app).is_some()).await?;
        tokio::time::sleep(Duration::from_secs(3)).await;
        let url = serve()?;
        use sha2::{Digest, Sha256};
        let profile = hex::encode(Sha256::digest(format!("kiri-probe:{}", uuid::Uuid::new_v4())));
        let request: BrowserWebviewCreateRequest = serde_json::from_value(json!({
            "id": ID, "url": url.as_str(), "profileId": profile, "scopeId": ID,
            "x": 0, "y": 60, "width": 800, "height": 550,
        }))
        .map_err(|error| error.to_string())?;
        let main = crate::infra::space_windows::primary_webview(&app).ok_or("Missing main view")?;
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
    report(
        "tab on a loopback page",
        &setup.as_ref().map(|_| ()).map_err(Clone::clone),
    );
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
    let _ = close_browser_webview(
        app.clone(),
        app.state::<BrowserSessionState>(),
        BrowserWebviewIdRequest { id: ID.into() },
    );
    passed
}
