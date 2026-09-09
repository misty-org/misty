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
fn sdk_probe_log(state: tauri::State<'_, ProbeState>, nonce: String, message: String) -> Result<(), String> {
    if nonce != state.nonce { return Err("Invalid probe nonce".into()); }
    println!("Files probe: {message}");
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

/// Native popup regression check. Loopback fixtures and disposable profile storage only.
#[tauri::command]
async fn sdk_probe_oauth_popups(app: tauri::AppHandle, state: tauri::State<'_, ProbeState>, nonce: String, origin: String) -> Result<String, String> {
    if nonce != state.nonce { return Err("Invalid probe nonce".into()); }
    browser::popup_probe::run(app, origin).await
}

#[tauri::command]
async fn sdk_probe_browser_rendering(app: tauri::AppHandle, state: tauri::State<'_, ProbeState>, nonce: String, origin: String) -> Result<String, String> {
    if nonce != state.nonce { return Err("Invalid probe nonce".into()); }
    browser::render_probe::run(app, origin).await
}

/// Controlled synthetic content in disposable provider profiles. Never registered by the main app.
#[tauri::command]
async fn sdk_probe_provider_fixture(app: tauri::AppHandle, state: tauri::State<'_, ProbeState>, nonce: String, id: String, mode: String) -> Result<serde_json::Value, String> {
    if nonce != state.nonce || !matches!(state.app_id.as_str(), "chat" | "inbox" | "journal" | "planner") { return Err("Invalid provider probe".into()); }
    if matches!(mode.as_str(), "popup-state" | "popup-close") {
        return browser::popup_probe::provider_popup_state(&app, &id, mode == "popup-close").await;
    }
    let webview = app.get_webview(&format!("misty-browser-{id}")).ok_or("Provider view unavailable")?;
    let script = match mode.as_str() {
        "install" => r#"if (location.protocol !== 'https:' || !document.body) return JSON.stringify({installed:false, origin:''}); window.stop(); const main = document.createElement('main'); const heading = document.createElement('h1'); heading.textContent = 'Controlled provider fixture'; const reply = document.createElement('textarea'); reply.setAttribute('aria-label', 'Reply'); const popup = document.createElement('button'); popup.textContent = 'Open authentication fixture'; popup.onclick = () => window.open('about:blank', '_blank'); main.append(heading, reply, popup); document.body.replaceChildren(main); return JSON.stringify({installed:true, origin:location.origin});"#,
        "location" => r#"return JSON.stringify({url:location.href, origin:location.origin, ready:document.readyState});"#,
        "store" => r#"localStorage.setItem('misty-provider-probe', 'account-one'); return JSON.stringify({stored:true, origin:location.origin});"#,
        "blocked-frame" => r#"const frame = document.createElement('iframe'); frame.src = 'https://outside-provider.invalid/embedded-frame'; document.body.append(frame); return JSON.stringify({created:true});"#,
        "state" => r#"return JSON.stringify({marker:localStorage.getItem('misty-provider-probe'), opener:!!window.opener, origin:location.origin, draft:document.querySelector('textarea')?.value || ''});"#,
        _ => return Err("Unknown provider fixture operation".into()),
    };
    let raw = crate::infra::evaluate_probe_javascript(webview, script.to_owned()).await?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

/// Exercise scrolling in the disposable native zoom fixture only.
#[tauri::command]
async fn sdk_probe_browser_zoom_state(app: tauri::AppHandle, state: tauri::State<'_, ProbeState>, nonce: String, scroll: bool, reset_fixture: Option<bool>, smooth_scroll: Option<bool>) -> Result<serde_json::Value, String> {
    if nonce != state.nonce || state.app_id != "browser" { return Err("Invalid zoom probe".into()); }
    let webview = app.get_webview("misty-browser-zoom-probe").ok_or("Zoom probe unavailable")?;
    let reset_fixture = reset_fixture.unwrap_or(false);
    let smooth_scroll = smooth_scroll.unwrap_or(false);
    let script = format!(r#"
      if ({smooth_scroll}) {{
        if (!['127.0.0.1','localhost'].includes(location.hostname) || !location.pathname.endsWith('/sdk-browser-zoom-page.html')) throw new Error('Scrolling probe requires its local fixture');
        return JSON.stringify(await window.runScrollingProbe());
      }}
      if ({reset_fixture} && ['127.0.0.1','localhost'].includes(location.hostname) && location.pathname.endsWith('/sdk-browser-zoom-page.html')) {{ document.querySelector('header')?.remove(); await new Promise(resolve => setTimeout(resolve, 300)); }}
      if ({scroll}) {{ window.scrollTo(document.scrollingElement.scrollWidth, 0); document.body.scrollLeft = document.body.scrollWidth; }}
      const root = document.documentElement, body = document.body;
      return JSON.stringify({{
        ready: document.readyState, innerWidth, innerHeight, scrollX,
        pan: root.hasAttribute('data-misty-horizontal-pan'), scrollbar: document.getElementById('misty-browser-horizontal-scrollbar')?.getBoundingClientRect().toJSON(),
        root: {{client:root.clientWidth, width:root.scrollWidth, height:root.scrollHeight, x:getComputedStyle(root).overflowX, y:getComputedStyle(root).overflowY}},
        body: {{client:body.clientWidth, width:body.scrollWidth, left:body.scrollLeft, height:body.scrollHeight, x:getComputedStyle(body).overflowX, y:getComputedStyle(body).overflowY}},
        bar: {{display:getComputedStyle(root, '::-webkit-scrollbar').display, height:getComputedStyle(root, '::-webkit-scrollbar').height}},
        fixed: Array.from(document.querySelectorAll('body *')).filter(e => getComputedStyle(e).position === 'fixed').slice(0,15).map(e => ({{tag:e.tagName,id:e.id,width:e.scrollWidth,right:e.getBoundingClientRect().right}}))
      }});
    "#);
    let raw = crate::infra::evaluate_probe_javascript(webview, script).await?;
    serde_json::from_str(&raw).map_err(|error|error.to_string())
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
    let names_probe = std::env::var("MISTY_NAVIGATION_NAMES_PROBE").as_deref() == Ok("1");
    let page = match app_id.as_str() {
        _ if names_probe => "navigation-names-probe.html",
        _ if std::env::var("MISTY_SDK_PROBE_BROWSER_RENDERING").as_deref() == Ok("1") => "sdk-browser-render-probe.html",
        _ if std::env::var("MISTY_SDK_PROBE_OAUTH_POPUPS").as_deref() == Ok("1") => "sdk-oauth-popup-probe.html",
        "journal" | "planner" if std::env::var("MISTY_SDK_PROBE_WEBSITE_APPS").as_deref() == Ok("1") => "sdk-website-integrations-probe.html",
        "chat" => "sdk-provider-probe.html",
        "inbox" if std::env::var("MISTY_SDK_PROBE_PROVIDER").as_deref() == Ok("1") => "sdk-provider-probe.html",
        "inbox" => "sdk-inbox-host-probe.html",
        "terminal" => "sdk-component-probe.html",
        "files" => "sdk-local-files-probe.html",
        "planner" => "sdk-planner-probe.html",
        "browser" if std::env::var("MISTY_SDK_PROBE_ZOOM").as_deref() == Ok("1") => "sdk-browser-zoom-probe.html",
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
        .append_pair("native", "1")
        .append_pair("app", &app_id);
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
    let file_runtime_root = data.path().to_owned();
    let files_probe = app_id == "files";
    if files_probe {
        std::fs::create_dir(fixture.path().join("source")).unwrap();
        std::fs::create_dir(fixture.path().join("destination")).unwrap();
        std::fs::write(fixture.path().join("source/example.txt"), "Misty native Files fixture\n").unwrap();
    }
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
            crate::app::commands::navigation_names_snapshot,
            crate::app::commands::navigation_names_update,
            mail_cache_read,
            mail_cache_write,
            mail_cache_remove,
            sdk_probe_complete,
            sdk_probe_log,
            crate::app::commands::app_snapshot,
            crate::app::commands::app_environment_snapshot,
            crate::app::commands::devices_snapshot,
            crate::app::commands::providers_snapshot,
            crate::app::commands::settings_snapshot,
            crate::app::commands::connected_devices_snapshot,
            crate::app::commands::connected_devices_roots,
            crate::app::commands::explorer_list_directory,
            crate::app::commands::file_metadata_snapshot,
            crate::app::commands::explorer_preview_item,
            crate::app::commands::explorer_queue_paste_items,
            crate::app::commands::explorer_queue_create_item,
            crate::app::commands::explorer_queue_rename_item,
            crate::app::commands::explorer_queue_delete_items,
            crate::app::commands::operation_queue_snapshot,
            crate::app::commands::transfers_snapshot,
            crate::app::commands::operation_queue_cancel,
            crate::app::commands::operation_queue_pause,
            crate::app::commands::operation_queue_resume,
            crate::app::commands::operation_queue_retry,
            crate::app::commands::operation_queue_retry_transfer,
            crate::app::commands::transfers_delete_selected,
            crate::app::commands::explorer_library_snapshot,
            crate::app::commands::explorer_library_record_last_opened,
            crate::app::commands::explorer_directory_size_snapshot,
            crate::app::commands::workspaces_snapshot,
            crate::app::commands::explorer_path_exists,
            crate::app::commands::explorer_path_is_directory,
            crate::app::commands::clipboard_snapshot,
            crate::app::commands::search_get_status,
            crate::app::commands::storage_snapshot,
            crate::app::commands::smart_library_snapshot,

            sdk_probe_tamper,
            sdk_probe_browser_count,
            sdk_probe_oauth_popups,
            sdk_probe_browser_rendering,
            crate::platform::plugins::mac_rounded_corners::reveal_main_window,
            sdk_probe_downloads,
            sdk_probe_clipboard_call,
            sdk_probe_exports,
            crate::platform::mini_app::permissions::mini_app_device_call,
            crate::platform::mini_app::permissions::host_files::mini_app_host_file,
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
            sdk_probe_provider_fixture,
            sdk_probe_browser_zoom_state,
            browser::browser_webview_create,
            browser::browser_profile_persistence,
            browser::browser_profile_remove,
            browser::browser_webview_reconcile,
            browser::browser_webview_navigate,
            browser::browser_webview_back,
            browser::browser_webview_forward,
            browser::browser_webview_reload,
            browser::browser_webview_set_zoom,
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
            if files_probe || names_probe { app.manage(crate::app::runtime::MistyRuntime::new_with_data_root(Some(file_runtime_root))); }
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(url))
                .on_page_load(|window, payload| {
                    eprintln!("SDK probe host page: {:?}", payload.event());
                    if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                        let _ = window.set_focus();
                    }
                })
                .title("Misty downloaded SDK package verification")
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true)
                .focused(true)
                .always_on_top(true)
                .inner_size(1100.0, 600.0)
                .data_directory(profile_path)
                .build()?;
            app.show()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let timeout = std::env::var("MISTY_SDK_PROBE_TIMEOUT_SECONDS").ok().and_then(|value| value.parse::<u64>().ok()).map(|value| value.clamp(35, 300)).unwrap_or_else(|| if std::env::var("MISTY_SDK_PROBE_APP").as_deref() == Ok("journal") { 120 } else { 35 });
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
