//! Debug-only integration harness; not registered by the normal application.
//! Uses the real installer, signature verifier, package protocol and terminal.
use crate::{
    infra::{browser, misty, ssh_terminal, terminal},
    platform::extension_protocol,
};
use std::io::Write;
#[path = "sdk_probe_clipboard.rs"]
mod clipboard;
use tauri::Manager;
use std::sync::{
    atomic::{AtomicI32, Ordering},
    Arc,
};

struct ProbeState {
    nonce: String,
    data_root: std::path::PathBuf,
    app_id: String,
    downloads: std::path::PathBuf,
    exports: std::path::PathBuf,
    exit_status: Arc<AtomicI32>,
}

#[tauri::command]
fn sdk_probe_complete(
    app: tauri::AppHandle,
    state: tauri::State<'_, ProbeState>,
    nonce: String,
    success: bool,
    message: String,
) -> Result<(), String> {
    if nonce != state.nonce {
        return Err("Invalid probe nonce".into());
    }
    println!("{message}");
    state
        .exit_status
        .store(if success { 0 } else { 1 }, Ordering::SeqCst);
    app.exit(if success { 0 } else { 1 });
    Ok(())
}

#[tauri::command]
fn sdk_probe_tamper(state: tauri::State<'_, ProbeState>, nonce: String) -> Result<(), String> {
    if nonce != state.nonce {
        return Err("Invalid probe nonce".into());
    }
    // Deliberately change only the disposable probe installation.
    std::fs::OpenOptions::new()
        .append(true)
        .open(
            state
                .data_root
                .join(".misty/plugins/public")
                .join(&state.app_id)
                .join("web/app.js"),
        )
        .and_then(|mut file| file.write_all(b"\n// verification probe modification\n"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn sdk_probe_browser_count(app: tauri::AppHandle, state: tauri::State<'_, ProbeState>, nonce: String) -> Result<usize, String> {
    if nonce != state.nonce { return Err("Invalid probe nonce".into()); }
    Ok(app.webviews().keys().filter(|label| label.starts_with("misty-browser-")).count())
}

#[tauri::command]
fn sdk_probe_downloads(state: tauri::State<'_, ProbeState>, nonce: String) -> Result<Vec<String>, String> {
    if nonce != state.nonce { return Err("Invalid probe nonce".into()); }
    if !state.downloads.exists() { return Ok(Vec::new()); }
    std::fs::read_dir(&state.downloads).map_err(|error| error.to_string())?
        .map(|entry| {
            let path = entry.map_err(|error| error.to_string())?.path();
            if path.metadata().map_err(|error| error.to_string())?.len() > 1024 {
                return Err("Probe download exceeded fixture size".into());
            }
            std::fs::read_to_string(path).map_err(|error| error.to_string())
        }).collect()
}

#[tauri::command]
async fn sdk_probe_clipboard_call(app: tauri::AppHandle, webview: tauri::Webview, probe: tauri::State<'_, ProbeState>, state: tauri::State<'_, crate::platform::mini_app::MiniAppState>, nonce: String, instance: String, method: String, params: serde_json::Value) -> Result<serde_json::Value, String> {
    if nonce != probe.nonce { return Err("Invalid probe nonce".into()); }
    clipboard::call(app, webview, state, instance, method, params).await
}

#[tauri::command]
fn sdk_probe_exports(state: tauri::State<'_, ProbeState>, nonce: String) -> Result<Vec<serde_json::Value>, String> {
    if nonce != state.nonce { return Err("Invalid probe nonce".into()); }
    std::fs::read_dir(&state.exports).map_err(|error| error.to_string())?.map(|entry| {
        let path = entry.map_err(|error| error.to_string())?.path();
        let size = path.metadata().map_err(|error| error.to_string())?.len();
        if size > 10 * 1024 * 1024 { return Err("Probe export exceeded fixture limit".into()); }
        let text = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
        Ok(serde_json::json!({"name":path.file_name().unwrap().to_string_lossy(),"text":text}))
    }).collect()
}

// Production ciphertext storage with a disposable cache root for this harness.
#[tauri::command]
async fn mail_cache_read(state: tauri::State<'_, ProbeState>, account_id: String) -> Result<Option<String>, String> {
    crate::infra::mail_cache::read(&state.data_root.join("cache"), &account_id).await.map_err(|error| error.to_string())
}
#[tauri::command]
async fn mail_cache_write(state: tauri::State<'_, ProbeState>, account_id: String, value: String) -> Result<(), String> {
    crate::infra::mail_cache::write(&state.data_root.join("cache"), &account_id, &value).await.map_err(|error| error.to_string())
}
#[tauri::command]
async fn mail_cache_remove(state: tauri::State<'_, ProbeState>, account_id: String) -> Result<(), String> {
    crate::infra::mail_cache::remove(&state.data_root.join("cache"), &account_id).await.map_err(|error| error.to_string())
}

pub fn run(mut context: tauri::Context<tauri::Wry>) {
    let fixture = tempfile::tempdir().unwrap();
    let profile = tempfile::tempdir().unwrap();
    let exports = fixture.path().join("exports");
    std::fs::create_dir(&exports).unwrap();
    let data = tempfile::tempdir().unwrap();
    // Set before any threads start; neither the user's profile nor installed
    // packages are read or changed by the package installer in this process.
    std::env::set_var("MISTY_DESKTOP_DATA_ROOT", data.path());
    let nonce = uuid::Uuid::new_v4().to_string();
    let app_id = std::env::var("MISTY_SDK_PROBE_APP").unwrap_or_else(|_| "terminal".into());
    let page = match app_id.as_str() {
        "inbox" => "sdk-inbox-host-probe.html",
        "terminal" => "sdk-component-probe.html",
        "planner" => "sdk-planner-probe.html",
        "browser" if std::env::var("MISTY_SDK_PROBE_HOST").as_deref() == Ok("1") => "sdk-browser-host-probe.html",
        "browser" => "sdk-browser-probe.html",
        "journal" if std::env::var("MISTY_SDK_PROBE_HOST").as_deref() == Ok("1") => "sdk-journal-host-probe.html",
        "journal" => "sdk-journal-native-probe.html",
        _ => panic!("Unsupported SDK probe App"),
    };
    let origin = std::env::var("MISTY_SDK_PROBE_ORIGIN").unwrap_or_else(|_| "http://127.0.0.1:5173".into());
    let origin = url::Url::parse(&origin).expect("Invalid probe origin");
    assert!(origin.scheme() == "http" && matches!(origin.host_str(), Some("127.0.0.1" | "localhost")), "The probe requires a loopback development server");
    let mut url = origin.join(&format!("/scripts/{page}")).unwrap();
    url.query_pairs_mut()
        .append_pair("fixture", fixture.path().to_str().unwrap())
        .append_pair("nonce", &nonce)
        .append_pair("package", "1")
        .append_pair("native", "1");
    if let Ok(catalog) = std::env::var("MISTY_SDK_PROBE_CATALOG") {
        url.query_pairs_mut().append_pair("catalog", &catalog);
    }
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "com.misty.sdk-package-probe".into();
    if app_id == "browser" {
        context.config_mut().identifier = format!("com.misty.sdk-browser-probe.{nonce}");
    }
    context.config_mut().build.dev_url = Some(origin);
    let profile_path = profile.path().to_owned();
    // WebKit/AppKit shutdown can return zero after a requested nonzero exit.
    // Only an explicit successful report from the probe may pass this harness.
    let exit_status = Arc::new(AtomicI32::new(1));
    tauri::Builder::default()
        .manage(browser::BrowserSessionState::default())
        .manage(crate::platform::mini_app::MiniAppState::default())
        .manage(crate::platform::mini_app::permissions::MiniAppProbeDirectory(exports.clone()))
        .plugin(tauri_plugin_dialog::init())
        .manage(browser::BrowserProbeDirectories { profiles: profile.path().join("children"), downloads: fixture.path().join("downloads") })
        .manage(ProbeState {
            nonce,
            data_root: data.path().to_owned(),
            app_id,
            downloads: fixture.path().join("downloads"),
            exports,
            exit_status: exit_status.clone(),
        })
        .register_uri_scheme_protocol("misty-extension", extension_protocol::handle)
        .invoke_handler(tauri::generate_handler![
            mail_cache_read,
            mail_cache_write,
            mail_cache_remove,
            sdk_probe_complete,
            sdk_probe_tamper,
            sdk_probe_browser_count,
            sdk_probe_downloads,
            sdk_probe_clipboard_call,
            sdk_probe_exports,
            crate::platform::mini_app::permissions::mini_app_device_call,
            crate::platform::mini_app::mini_widget_open,
            crate::platform::mini_app::mini_app_close,
            crate::platform::mini_app::permissions::mini_app_permission_status,
            crate::platform::mini_app::permissions::mini_app_permission_decide,
            misty::install_plugin_bundle,
            misty::finalize_official_app_install,
            misty::official_app_package_ready,
            misty::scan_local_plugins,
            misty::uninstall_plugin,
            terminal::terminal_create,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            ssh_terminal::terminal_ssh_environments,
            ssh_terminal::terminal_ssh_preflight,
            ssh_terminal::terminal_ssh_trust_host,
            browser::browser_webview_create,
            browser::browser_webview_reconcile,
            browser::browser_webview_navigate,
            browser::browser_webview_back,
            browser::browser_webview_forward,
            browser::browser_webview_reload,
            browser::browser_webview_close,
            browser::browser_webview_hide,
            browser::browser_webview_show,
            browser::browser_webview_set_bounds,
            browser::browser_webview_set_theme,
            browser::browser_webviews_set_overlay_active,
            browser::browser_webviews_set_pointer_tracking,
            browser::browser_webviews_hide_all,
            browser::browser_webviews_park_all,
            browser::browser_agent_grant_register,
            browser::browser_agent_grant_revoke,
            browser::browser_agent_execute
        ])
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(url))
                .title("Misty downloaded SDK package verification")
                .focused(false)
                .inner_size(1100.0, 600.0)
                .data_directory(profile_path)
                .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let timeout = if std::env::var("MISTY_SDK_PROBE_APP").as_deref() == Ok("journal") { 120 } else { 35 };
                std::thread::sleep(std::time::Duration::from_secs(timeout));
                eprintln!("SDK package probe watchdog expired");
                handle.exit(1);
            });
            Ok(())
        })
        .build(context)
        .unwrap()
        .run_return(|_, _| {});
    drop(fixture);
    drop(profile);
    drop(data);
    std::process::exit(exit_status.load(Ordering::SeqCst));
}
