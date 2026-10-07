//! Runs Kiri's engine code for real inside a minimal Tauri app: page bridge
//! and ACL, host channel, camera permission hook, editing commands, and (on
//! Windows) that WebView2 keeps its own WebAuthn. Prints `KIRI RUNTIME` lines.
use std::{
    io::{Read, Write},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

static EVENTS: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn record(event: String) {
    println!("EVENT {event}");
    EVENTS.lock().unwrap().push(event);
}

fn seen(prefix: &str) -> Option<String> {
    EVENTS.lock().unwrap().iter().find(|e| e.starts_with(prefix)).cloned()
}

fn wait(prefix: &str, seconds: u64) -> Option<String> {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    while Instant::now() < deadline {
        if let Some(event) = seen(prefix) {
            return Some(event);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    None
}

struct Host;
impl kiri::Host for Host {
    fn signal(&self, caller: &kiri::Caller, signal: kiri::Signal) {
        record(format!("signal {} {} {:?}", caller.webview, caller.origin, signal));
    }
}

struct Channel;
impl kiri::channel::HostChannel for Channel {
    fn receive(&self, message: kiri::channel::HostMessage<'_>) {
        record(format!("host {} {}", message.webview, message.body));
    }
}

struct Policy;
impl kiri::engine::MediaPolicy for Policy {
    fn media_verdict(&self, request: &kiri::engine::MediaRequest) -> kiri::permissions::Verdict {
        record(format!(
            "media-request {} {:?} {:?}",
            request.webview, request.top_origin, request.kind
        ));
        kiri::permissions::Verdict::Deny
    }
}

const PAGE: &str = "<!doctype html><title>Kiri runtime probe</title><body><p id=\"text\">Kiri copy check</p></body>";

fn serve() -> String {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let mut buffer = [0u8; 4096];
            let _ = stream.read(&mut buffer);
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{PAGE}",
                PAGE.len()
            );
        }
    });
    format!("http://127.0.0.1:{port}/")
}

const SCRIPT: &str = r#"(async () => {
  const send = (message) => { const post = window.__kiriHost(); if (post) post(message); };
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const outcome = (promise) => promise.then(() => 'ok', (e) => String(e?.name ?? e));
  send('result:media=' + await outcome(invoke('plugin:kiri|call', { request: { v: 1, cap: 'media', method: 'state', args: { audible: true } } })));
  send('result:unknown=' + await outcome(invoke('plugin:kiri|call', { request: { v: 1, cap: 'bluetooth', method: 'request-device' } })));
  send('result:app=' + await outcome(invoke('plugin:app|version')));
  const passkeys = window.PublicKeyCredential ? await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => 'error') : 'missing';
  const create = navigator.credentials?.create;
  send('result:webauthn=' + (!create ? 'missing' : String(create).includes('[native code]') ? 'native' : 'kiri') + ',platform=' + passkeys);
  send('result:gum=' + await outcome(navigator.mediaDevices ? navigator.mediaDevices.getUserMedia({ video: true }) : Promise.reject({ name: 'NoMediaDevices' })));
  getSelection().selectAllChildren(document.getElementById('text'));
  send('result:selected');
})();"#;

fn main() {
    let url = serve();
    let origin = url.trim_end_matches('/').to_owned();
    tauri::Builder::default()
        .plugin(kiri::init(|_| kiri::Kiri::new("probe-", Host)))
        .setup(move |app| {
            kiri::engine::set_media_policy(Policy);
            kiri::channel::set_host_channel(Channel);
            // Test-only: expose the captured sender so the script can report back.
            let expose = format!("window.__kiriHost = ({});", kiri::channel::sender_script());
            let window = WebviewWindowBuilder::new(app, "probe-tab", WebviewUrl::External(url.parse().unwrap()))
                .initialization_script(kiri::page_script())
                .initialization_script(&expose)
                .build()?;
            let webview: &tauri::Webview = window.as_ref();
            // A container has no camera; WebKitGTK can fake one.
            #[cfg(target_os = "linux")]
            webview.with_webview(|platform| {
                use webkit2gtk::{SettingsExt, WebViewExt};
                if let Some(settings) = WebViewExt::settings(&platform.inner()) {
                    settings.set_enable_mock_capture_devices(true);
                }
            })?;
            kiri::engine::install_media_permissions(webview)?;
            kiri::channel::install_host_channel(webview)?;
            let handle = app.handle().clone();
            let origin = origin.clone();
            std::thread::spawn(move || drive(handle, origin));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("probe app");
}

#[cfg(target_os = "linux")]
fn clipboard_text(app: &tauri::AppHandle) -> Option<String> {
    let (send, receive) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let clipboard = gtk::Clipboard::get(&gtk::gdk::SELECTION_CLIPBOARD);
        let _ = send.send(clipboard.wait_for_text().map(|t| t.to_string()));
    })
    .ok()?;
    receive.recv_timeout(Duration::from_secs(5)).ok().flatten()
}

#[cfg(not(target_os = "linux"))]
fn clipboard_text(_app: &tauri::AppHandle) -> Option<String> {
    arboard::Clipboard::new().ok()?.get_text().ok()
}

fn drive(app: tauri::AppHandle, origin: String) {
    std::thread::sleep(Duration::from_secs(4));
    let window = app.get_webview_window("probe-tab").expect("probe tab");
    let webview: &tauri::Webview = window.as_ref();
    webview.eval(SCRIPT).expect("eval");
    let mut failures = Vec::new();
    let mut check = |name: &str, ok: bool, detail: String| {
        println!("KIRI RUNTIME {}: {name} ({detail})", if ok { "PASS" } else { "FAIL" });
        if !ok {
            failures.push(name.to_owned());
        }
    };
    let selected = wait("host probe-tab result:selected", 30);
    check("host channel delivers the page script's messages", selected.is_some(), format!("{selected:?}"));
    let result = |key: &str| seen(&format!("host probe-tab result:{key}=")).unwrap_or_default();
    check("page → plugin:kiri|call allowed", result("media").ends_with("=ok"), result("media"));
    let signal = seen("signal ").unwrap_or_default();
    check(
        "media signal reaches the host with the engine's origin",
        signal.contains(&origin) && signal.contains("MediaAudible(true)"),
        signal,
    );
    check("unknown capability is NotSupportedError", result("unknown").ends_with("=NotSupportedError"), result("unknown"));
    check("other Tauri commands are refused to the page", !result("app").ends_with("=ok"), result("app"));
    // Kiri adds a passkey shim only on macOS; elsewhere the engine's own WebAuthn
    // stays (WebView2 has one, WebKitGTK has none).
    check("no Kiri passkey shim off macOS", !result("webauthn").contains("=kiri"), result("webauthn"));
    let request = seen("media-request ").unwrap_or_default();
    let gum = result("gum");
    if request.is_empty() && gum.ends_with("=NotFoundError") {
        println!("KIRI RUNTIME SKIP: camera permission hook (this machine has no camera: {gum})");
    } else {
        check(
            "camera request reaches Kiri's policy",
            request.contains(&origin) && request.contains("Camera"),
            request,
        );
        check("Kiri's block reaches the page", gum.ends_with("=NotAllowedError"), gum);
    }
    kiri::engine::edit(webview, kiri::engine::EditCommand::Copy).expect("edit");
    std::thread::sleep(Duration::from_millis(800));
    let copied = clipboard_text(&app);
    check("engine::edit Copy reaches the clipboard", copied.as_deref() == Some("Kiri copy check"), format!("{copied:?}"));
    println!(
        "KIRI RUNTIME DONE ({}): {}",
        std::env::consts::OS,
        if failures.is_empty() { "all passed".to_owned() } else { failures.join(", ") }
    );
    app.exit(if failures.is_empty() { 0 } else { 1 });
}
