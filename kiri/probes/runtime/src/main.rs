//! Runs Kiri's engine code for real inside a minimal Tauri app: page bridge
//! and ACL, host channel, camera permission hook, editing commands, and (on
//! Windows) that WebView2 keeps its own WebAuthn, and the ad and tracker
//! filter. Prints `KIRI RUNTIME` lines.
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

/// Where the content filter check loads its page and scripts from.
struct FilterHosts {
    /// The page's own site, also the one allowed in the allowed-site check.
    site: String,
    page: String,
    own: String,
    /// A third party that is not on the list.
    cdn: String,
    /// A listed ad host.
    ad: String,
}

/// Local names when they resolve to this machine (run.sh maps them in
/// Docker); otherwise the real hosts, over the network.
fn filter_hosts(port: u16) -> FilterHosts {
    use std::net::ToSocketAddrs;
    let mapped = ["news.example", "cdn.example", "securepubads.g.doubleclick.net"]
        .iter()
        .all(|host| (*host, port).to_socket_addrs().is_ok_and(|mut a| a.any(|a| a.ip().is_loopback())));
    if mapped {
        FilterHosts {
            site: "news.example".into(),
            page: format!("http://news.example:{port}/filter"),
            own: format!("http://news.example:{port}/own.js"),
            cdn: format!("http://cdn.example:{port}/lib.js"),
            ad: format!("http://securepubads.g.doubleclick.net:{port}/ad.js"),
        }
    } else {
        FilterHosts {
            site: "127.0.0.1".into(),
            page: format!("http://127.0.0.1:{port}/netfilter"),
            own: format!("http://127.0.0.1:{port}/own.js"),
            cdn: "https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js".into(),
            ad: "https://securepubads.g.doubleclick.net/tag/js/gpt.js".into(),
        }
    }
}

/// A news page that loads its own script, a third-party library and a listed
/// ad host's script, and reports to this server whether each one loaded.
fn filter_page(hosts: &FilterHosts, round: &str) -> String {
    let script = |name: &str, url: &str| {
        format!(
            "<script src=\"{url}?{round}\" onload=\"report('{name}','load')\" \
             onerror=\"report('{name}','error')\"></script>"
        )
    };
    format!(
        "<!doctype html><title>filter</title>\
         <script>function report(name, state) {{ new Image().src = '/report?{round}&' + name + '=' + state; }}</script>\
         {}{}{}",
        script("own", &hosts.own),
        script("cdn", &hosts.cdn),
        script("ad", &hosts.ad)
    )
}

fn serve() -> (String, u16) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for mut stream in listener.incoming().flatten() {
            let mut buffer = [0u8; 4096];
            let read = stream.read(&mut buffer).unwrap_or(0);
            let request = String::from_utf8_lossy(&buffer[..read]);
            let path = request.split_whitespace().nth(1).unwrap_or("/").to_owned();
            let host = request
                .lines()
                .find_map(|line| line.strip_prefix("Host: "))
                .and_then(|host| host.split(':').next())
                .unwrap_or("")
                .to_owned();
            record(format!("served {host} {path}"));
            if path.contains("filter?slow") {
                std::thread::sleep(Duration::from_millis(1500));
            }
            let round = path.strip_prefix("/filter?").or_else(|| path.strip_prefix("/netfilter?"));
            let (kind, body) = if let Some(round) = round {
                ("text/html", filter_page(&filter_hosts(port), round))
            } else if path.contains(".js") {
                ("text/javascript", "void 0;".to_owned())
            } else {
                ("text/html", PAGE.to_owned())
            };
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    (format!("http://127.0.0.1:{port}/"), port)
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
    let (url, port) = serve();
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
            std::thread::spawn(move || drive(handle, origin, port));
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

fn drive(app: tauri::AppHandle, origin: String, port: u16) {
    std::thread::sleep(Duration::from_secs(4));
    let window = app.get_webview_window("probe-tab").expect("probe tab");
    let webview: &tauri::Webview = window.as_ref();
    let mut failures = Vec::new();
    let mut check = |name: &str, ok: bool, detail: String| {
        println!("KIRI RUNTIME {}: {name} ({detail})", if ok { "PASS" } else { "FAIL" });
        if !ok {
            failures.push(name.to_owned());
        }
    };
    // On a person's own desktop, run only the content filter checks: the others
    // use the camera and the clipboard.
    if std::env::var_os("KIRI_PROBE_CONTENT_FILTER_ONLY").is_some() {
        content_filter(&app, webview, port, &mut check);
        return finish(&app, failures);
    }
    webview.eval(SCRIPT).expect("eval");
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
    content_filter(&app, webview, port, &mut check);
    finish(&app, failures);
}

fn finish(app: &tauri::AppHandle, failures: Vec<String>) {
    println!(
        "KIRI RUNTIME DONE ({}): {}",
        std::env::consts::OS,
        if failures.is_empty() { "all passed".to_owned() } else { failures.join(", ") }
    );
    app.exit(if failures.is_empty() { 0 } else { 1 });
}

/// Whether each of the filter page's scripts loaded in `round`, as the page
/// reported it.
fn filter_requests(round: &str) -> [bool; 3] {
    let reported = |name: &str| {
        let prefix = format!(" /report?{round}&{name}=");
        EVENTS
            .lock()
            .unwrap()
            .iter()
            .find_map(|event| event.split_once(&prefix).map(|(_, state)| state == "load"))
    };
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline && ["own", "cdn", "ad"].iter().any(|name| reported(name).is_none()) {
        std::thread::sleep(Duration::from_millis(100));
    }
    [reported("own") == Some(true), reported("cdn") == Some(true), reported("ad") == Some(true)]
}

/// Loads the filter page in an open tab.
fn load_filter_page(webview: &tauri::Webview, hosts: &FilterHosts, round: &str) -> [bool; 3] {
    webview.navigate(format!("{}?{round}", hosts.page).parse().unwrap()).expect("navigate");
    filter_requests(round)
}

/// Opens the filter page in a new tab and installs the filter on it right
/// away, the way Misty sets up every browser page.
fn open_filter_tab(app: &tauri::AppHandle, hosts: &FilterHosts, round: &str) -> [bool; 3] {
    let url = format!("{}?{round}", hosts.page);
    let window = WebviewWindowBuilder::new(app, format!("filter-{round}"), WebviewUrl::External(url.parse().unwrap()))
        .build()
        .expect("filter tab");
    kiri::engine::install_content_filter(window.as_ref()).expect("install content filter");
    filter_requests(round)
}

/// The ad and tracker filter, applied the way Misty applies it: a listed host
/// is blocked as a third party while the page's own and other third-party
/// scripts load, from a new tab's first load on; an allowed site and turning
/// blocking off let it through again.
fn content_filter(
    app: &tauri::AppHandle,
    webview: &tauri::Webview,
    port: u16,
    check: &mut impl FnMut(&str, bool, String),
) {
    let hosts = filter_hosts(port);
    println!("KIRI RUNTIME NOTE: content filter page at {}", hosts.page);
    // A setting change: configure, build the filter, update open pages.
    let configure = |enabled: bool, allowed: Vec<String>| {
        kiri::content_filter::configure(enabled, allowed);
        kiri::engine::prepare_content_filter(app).expect("prepare content filter");
        kiri::engine::install_content_filter(webview).expect("install content filter");
        std::thread::sleep(Duration::from_secs(2));
    };
    configure(true, Vec::new());
    let [own, cdn, ad] = open_filter_tab(app, &hosts, "new-tab");
    check("a new tab's first load blocks a listed third-party host", own && cdn && !ad, format!("own={own} cdn={cdn} ad={ad}"));
    let [own, cdn, ad] = load_filter_page(webview, &hosts, "open-tab");
    check("an open tab blocks it after the setting turns on", own && cdn && !ad, format!("own={own} cdn={cdn} ad={ad}"));
    // A tab that opens while the filter is still compiling waits for it.
    kiri::content_filter::configure(true, vec!["unrelated.example".to_owned()]);
    let [own, cdn, ad] = open_filter_tab(app, &hosts, "slow-while-compiling");
    // Still loading when the filter is requested, it is stopped and loaded
    // again once the filter is in place (the stopped request may never reach
    // the server, so only the outcome is checked).
    check(
        "a slow tab opened while the filter compiles is filtered",
        own && cdn && !ad,
        format!("own={own} cdn={cdn} ad={ad}"),
    );
    kiri::content_filter::configure(true, vec!["other.example".to_owned()]);
    let [own, cdn, ad] = open_filter_tab(app, &hosts, "fast-while-compiling");
    check(
        "a fast tab opened while the filter compiles is filtered",
        own && cdn && !ad,
        format!("own={own} cdn={cdn} ad={ad}"),
    );
    configure(true, vec![hosts.site.clone()]);
    let [own, _, ad] = load_filter_page(webview, &hosts, "allowed");
    check("an allowed site loads its ads", own && ad, format!("own={own} ad={ad}"));
    configure(false, Vec::new());
    let [own, _, ad] = load_filter_page(webview, &hosts, "off");
    check("turning blocking off removes the filter", own && ad, format!("own={own} ad={ad}"));
}
