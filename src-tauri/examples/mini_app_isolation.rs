//! Desktop smoke test using real WebViews, empty host UI, and temporary packages.
//! Run with `cargo run --example mini_app_isolation`; exits nonzero on failure.
#![allow(dead_code)]
#[path = "../src/platform/app_command_policy.rs"]
mod app_command_policy;
#[path = "../src/platform/mini_app.rs"]
mod mini_app;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tauri::{Listener, Manager};

#[tauri::command]
fn dangerous_host_command() -> &'static str {
    "THIS MUST NEVER REACH APP CODE"
}

struct Control {
    source: String,
    nonce: String,
    app_requests: Arc<AtomicUsize>,
    controls: Arc<AtomicUsize>,
}

#[tauri::command]
fn isolation_control_ready(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: tauri::State<'_, Control>,
    nonce: String,
    rtc: bool,
) -> Result<(), String> {
    if webview.label() != "main" || nonce != state.nonce || !rtc {
        app.exit(1);
        return Err("Host network/WebRTC control failed.".into());
    }
    println!("Host control: local HTTP fetch and PeerConnection are available.");
    if state.controls.fetch_add(1, Ordering::SeqCst) == 0 {
        launch(app, state.source.clone());
    } else {
        println!("PASS: Host network and PeerConnection remain available after App isolation.");
        app.exit(0);
    }
    Ok(())
}

fn launch(app: tauri::AppHandle, source: String) {
    tauri::async_runtime::spawn(async move {
        let main = app.get_webview("main").unwrap();
        let result = mini_app::mini_app_open(
            app.clone(),
            main,
            app.state(),
            mini_app::OpenRequest {
                scope_limit: None,
                owner: None,
                source,
                bounds: mini_app::Bounds {
                    x: 0.,
                    y: 0.,
                    width: 1.,
                    height: 1.,
                },
            },
        )
        .await;
        if let Err(error) = result {
            eprintln!("FAIL: open: {error}");
            app.exit(1);
        }
    });
}

fn main() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let nonce = uuid::Uuid::new_v4().to_string();
    let app_requests = Arc::new(AtomicUsize::new(0));
    let server_requests = app_requests.clone();
    let server_nonce = nonce.clone();
    std::thread::spawn(move || {
        for connection in listener.incoming() {
            let mut stream = connection.unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(2)))
                .unwrap();
            let mut buffer = [0u8; 8192];
            let size = stream.read(&mut buffer).unwrap_or(0);
            let request = String::from_utf8_lossy(&buffer[..size]);
            let path = request.split_whitespace().nth(1).unwrap_or("");
            println!("HTTP fixture: {path}");
            let (mime, body) = if path == "/control" {
                ("text/plain", server_nonce.clone())
            } else {
                if path == "/app-probe" {
                    server_requests.fetch_add(1, Ordering::SeqCst);
                }
                ("text/plain", "UNMEDIATED APP REQUEST".to_owned())
            };
            let response = format!("HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            let _ = stream.write_all(response.as_bytes());
        }
    });
    let plugins = dirs::home_dir().unwrap().join(".misty/plugins/private");
    std::fs::create_dir_all(&plugins).unwrap();
    let package_a = tempfile::Builder::new()
        .prefix("runtime-isolation-test-")
        .tempdir_in(&plugins)
        .unwrap();
    let package_b = tempfile::Builder::new()
        .prefix("runtime-isolation-test-")
        .tempdir_in(&plugins)
        .unwrap();
    let html =
        "<!doctype html><title>Misty App isolation test</title><script src='./test.js'></script>";
    let js = r#"
      (async () => {
        const checks = {topLevel: window.parent === window};
        try {
          checks.privateStorage = localStorage.getItem('misty-isolation-probe') === null;
          localStorage.setItem('misty-isolation-probe', 'only-this-view');
        } catch (_) { checks.privateStorage = true; }
        try { await __TAURI_INTERNALS__.invoke('dangerous_host_command'); checks.commandDenied = false; }
        catch (_) { checks.commandDenied = true; }
        try { await __TAURI_INTERNALS__.invoke('mini_app_open', {request: {}}); checks.managementDenied = false; }
        catch (_) { checks.managementDenied = true; }
        let cspBlocked = false;
        window.addEventListener('securitypolicyviolation', (event) => {
          if (event.effectiveDirective === 'connect-src' && event.blockedURI.startsWith('__NETWORK_ORIGIN__')) cspBlocked = true;
        });
        try { await fetch('__NETWORK_ORIGIN__/app-probe'); checks.networkDenied = false; }
        catch (_) { checks.networkDenied = true; }
        await new Promise(resolve => setTimeout(resolve, 50));
        checks.networkCspEnforced = cspBlocked;
        checks.peerConnectionDenied = typeof RTCPeerConnection === 'undefined' && typeof webkitRTCPeerConnection === 'undefined';
        checks.directDevicesDenied = !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia === 'undefined';
        const identity = await mistyHost.request({kind: 'identity', instance: 'main'});
        checks.nativeIdentity = identity.observed.startsWith('misty-mini-app-');
        const foreign = await fetch('/another-instance/test.js');
        checks.foreignAssetsDenied = foreign.status === 403;
        await mistyHost.request({kind: 'report', checks});
      })().catch((error) => mistyHost.request({kind: 'report', checks: {startup: false}, error: String(error)}));
    "#;
    for path in [package_a.path(), package_b.path()] {
        std::fs::write(path.join("index.html"), html).unwrap();
        std::fs::write(
            path.join("test.js"),
            js.replace("__NETWORK_ORIGIN__", &origin),
        )
        .unwrap();
    }
    let source = |path: &std::path::Path| {
        format!(
            "misty-extension://localhost/private/{}/index.html",
            path.file_name().unwrap().to_str().unwrap()
        )
    };
    let source_a = source(package_a.path());
    let source_b = source(package_b.path());
    let completed = Arc::new(AtomicUsize::new(0));
    let final_count = completed.clone();
    let controls = Arc::new(AtomicUsize::new(0));
    let final_controls = controls.clone();
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    let control_html = format!(
        r#"<!doctype html><title>Misty isolation control</title><script>
        window.checkIsolationControl = async () => {{
            const nonce = await (await fetch('{origin}/control')).text();
            const rtc = typeof RTCPeerConnection === 'function';
            if (rtc) {{ const connection = new RTCPeerConnection({{iceServers: []}}); connection.close(); }}
            await __TAURI_INTERNALS__.invoke('isolation_control_ready', {{nonce, rtc}});
        }};
        window.checkIsolationControl().catch(error => fetch('{origin}/control-error?message=' + encodeURIComponent(String(error))));
        </script>"#
    );
    let exit_code = tauri::Builder::default()
        .manage(mini_app::MiniAppState::default())
        .manage(Control { source: source_a, nonce, app_requests, controls })
        .register_uri_scheme_protocol("misty-mini-app", mini_app::handle)
        .register_uri_scheme_protocol("misty-isolation-host", move |_, _| tauri::http::Response::builder()
            .header("Content-Type", "text/html").body(control_html.clone().into_bytes()).unwrap())
        .invoke_handler({
            let handler: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> = Box::new(tauri::generate_handler![dangerous_host_command, isolation_control_ready, mini_app::mini_app_rpc, mini_app::mini_app_open]);
            move |invoke| {
                if !app_command_policy::allows(invoke.message.webview_ref().label(), invoke.message.command()) {
                    invoke.resolver.reject("Content view denied."); return true;
                }
                handler(invoke)
            }
        })
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External("misty-isolation-host://localhost/".parse().unwrap()))
                .title("Misty isolation test").inner_size(320., 180.).visible(false).build()?;
            let handle = app.handle().clone();
            let observed = completed.clone();
            app.listen_any("misty:mini-app-request", move |event| {
                let payload: Value = serde_json::from_str(event.payload()).unwrap();
                let instance = payload["instance"].as_str().unwrap().to_owned();
                let request = payload["requestId"].as_str().unwrap().to_owned();
                let main = handle.get_webview("main").unwrap();
                mini_app::mini_app_reply(main, handle.state(), instance.clone(), request, Some(json!({"observed": instance})), None).unwrap();
                if payload["message"]["kind"] == "report" {
                    let checks = payload["message"]["checks"].as_object().unwrap();
                    println!("Native App checks: {}", payload["message"]);
                    if checks.len() < 10 || checks.values().any(|value| value != &json!(true)) { handle.exit(1); return; }
                    if observed.fetch_add(1, Ordering::SeqCst) == 0 { launch(handle.clone(), source_b.clone()); }
                    else {
                        if handle.state::<Control>().app_requests.load(Ordering::SeqCst) != 0 {
                            eprintln!("FAIL: App reached the HTTP server."); handle.exit(1); return;
                        }
                        println!("PASS: separate native App views, private storage, bounded assets/commands, network and WebRTC denial.");
                        handle.get_webview("main").unwrap().eval("window.checkIsolationControl()").unwrap();
                    }
                }
            });
            let timeout = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(25)).await;
                if completed.load(Ordering::SeqCst) < 2 || timeout.state::<Control>().controls.load(Ordering::SeqCst) < 2 { eprintln!("FAIL: native App startup timed out"); timeout.exit(1); }
            });
            Ok(())
        }).build(context).expect("test runtime").run_return(|app, event| { if matches!(event, tauri::RunEvent::Exit) { mini_app::shutdown(app); } });
    drop(package_a);
    drop(package_b);
    std::process::exit(
        if exit_code == 0
            && final_count.load(Ordering::SeqCst) == 2
            && final_controls.load(Ordering::SeqCst) == 2
        {
            0
        } else {
            1
        },
    );
}
