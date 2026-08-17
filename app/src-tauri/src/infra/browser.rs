use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{
    utils::config::{Color, WebviewUrl},
    webview::{DownloadEvent, NewWindowResponse},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Theme, Webview,
    WebviewBuilder,
};
use url::Url;

const MAX_SNAPSHOT_CHARS: usize = 256 * 1024;
const MAX_INTERACTIVE_ELEMENTS: usize = 500;
const MAX_DOWNLOAD_HISTORY: usize = 100;
const AGENT_DOWNLOAD_WINDOW_SECONDS: i64 = 30;
#[cfg(target_os = "macos")]
static BROWSER_OVERLAY_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static MAIN_WEBVIEW_VIEW: AtomicUsize = AtomicUsize::new(0);
const BROWSER_VIEWPORT_SCRIPT: &str = r#"
(() => {
  const install = () => {
    if (document.getElementById('misty-browser-viewport-style')) return;
    const style = document.createElement('style');
    style.id = 'misty-browser-viewport-style';
    style.textContent = 'html, body { overscroll-behavior: none !important; }';
    (document.head || document.documentElement).appendChild(style);
  };
  install();
  document.addEventListener('DOMContentLoaded', install, { once: true });
})();
"#;

#[derive(Default)]
pub struct BrowserSessionState {
    sessions: Mutex<HashMap<String, BrowserSession>>,
    reserved_downloads: Mutex<HashSet<PathBuf>>,
}

#[derive(Default)]
struct BrowserSession {
    scope_id: String,
    grants: HashMap<String, BrowserGrant>,
    snapshot_generation: u64,
    element_selectors: HashMap<String, String>,
    downloads: Vec<BrowserDownload>,
    pending_agent_download: Option<PendingAgentDownload>,
}

#[derive(Clone)]
struct BrowserGrant {
    agent_id: String,
    capabilities: HashSet<String>,
    expires_at: DateTime<Utc>,
}

struct PendingAgentDownload {
    grant_id: String,
    agent_id: String,
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewCreateRequest {
    pub id: String,
    pub url: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub scope_id: String,
    #[serde(default = "default_browser_theme")]
    pub theme: String,
    #[serde(default)]
    pub user_agent: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewBoundsRequest {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewIdRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserNavigateRequest {
    pub id: String,
    pub url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserThemeRequest {
    pub theme: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAgentGrantRequest {
    pub id: String,
    pub scope_id: String,
    pub grant_id: String,
    pub agent_id: String,
    pub capabilities: Vec<String>,
    pub expires_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAgentGrantRevokeRequest {
    pub id: String,
    pub grant_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAgentExecuteRequest {
    pub scope_id: String,
    pub grant_id: String,
    pub agent_id: String,
    pub operation: String,
    #[serde(default)]
    pub input: Value,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BrowserPageEvent {
    id: String,
    url: String,
    phase: &'static str,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BrowserTitleEvent {
    id: String,
    title: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BrowserPopupEvent {
    source_id: String,
    url: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDownload {
    download_id: String,
    tab_id: String,
    url: String,
    path: String,
    state: String,
    success: bool,
    initiator: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    grant_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSnapshot {
    url: String,
    title: String,
    text: String,
    truncated: bool,
    #[serde(default)]
    interactive: Vec<RawInteractiveElement>,
    #[serde(default)]
    error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawInteractiveElement {
    selector: String,
    tag: String,
    role: String,
    name: String,
}

fn default_browser_theme() -> String {
    "dark".to_owned()
}

fn browser_theme(value: &str) -> Result<Option<Theme>, String> {
    match value {
        "dark" => Ok(Some(Theme::Dark)),
        "light" => Ok(Some(Theme::Light)),
        "system" => Ok(None),
        _ => Err("Browser theme must be dark, light, or system.".to_owned()),
    }
}

fn browser_background(value: &str) -> Color {
    match value {
        "light" => Color(255, 255, 255, 255),
        _ => Color(32, 33, 36, 255),
    }
}

fn validated_user_agent(value: Option<&str>) -> Result<Option<&str>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.len() > 512 || value.chars().any(char::is_control) {
        return Err("Browser user agent is invalid.".to_owned());
    }
    Ok(Some(value))
}

#[cfg(target_os = "macos")]
fn apply_macos_webview_theme(webview: &Webview, value: &str) -> Result<(), String> {
    use objc2_app_kit::{
        NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua,
        NSView,
    };
    let dark = value != "light";
    webview
        .with_webview(move |platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            let name = if dark {
                NSAppearanceNameDarkAqua
            } else {
                NSAppearanceNameAqua
            };
            let appearance = NSAppearance::appearanceNamed(name);
            view.setAppearance(appearance.as_deref());
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
unsafe fn disable_macos_scroll_elasticity(view: &objc2_app_kit::NSView) {
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSScrollElasticity, NSScrollView};

    let object: &AnyObject = view;
    if let Some(scroll_view) = object.downcast_ref::<NSScrollView>() {
        scroll_view.setHorizontalScrollElasticity(NSScrollElasticity::None);
        scroll_view.setVerticalScrollElasticity(NSScrollElasticity::None);
    }
    for child in view.subviews().iter() {
        disable_macos_scroll_elasticity(&child);
    }
}

#[cfg(target_os = "macos")]
fn configure_macos_webview(webview: &Webview) -> Result<(), String> {
    use objc2_app_kit::NSView;
    webview
        .with_webview(|platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            disable_macos_scroll_elasticity(view);
        })
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn configure_macos_webview(_webview: &Webview) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn position_macos_webview(webview: &Webview, reveal: bool) -> Result<(), String> {
    use objc2_app_kit::{NSView, NSWindow, NSWindowOrderingMode};
    webview
        .with_webview(move |platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            if reveal {
                view.setHidden(false);
            }
            let parent = view.superview().or_else(|| {
                let window: &NSWindow = &*platform_webview.ns_window().cast();
                window.contentView()
            });
            if let Some(parent) = parent {
                let main_view = MAIN_WEBVIEW_VIEW.load(Ordering::Acquire);
                if BROWSER_OVERLAY_ACTIVE.load(Ordering::Acquire) && main_view != 0 {
                    let main_view: &NSView = &*(main_view as *const NSView);
                    parent.addSubview_positioned_relativeTo(
                        view,
                        NSWindowOrderingMode::Below,
                        Some(main_view),
                    );
                } else {
                    // Bounds updates to the main WKWebView can reorder sibling
                    // layers. Keep interactive browser children above the app
                    // renderer whenever no app overlay is open.
                    parent.addSubview_positioned_relativeTo(
                        view,
                        NSWindowOrderingMode::Above,
                        None,
                    );
                }
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn present_macos_webview(webview: &Webview) -> Result<(), String> {
    position_macos_webview(webview, true)
}

#[cfg(not(target_os = "macos"))]
fn present_macos_webview(webview: &Webview) -> Result<(), String> {
    webview.show().map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn apply_macos_webview_theme(_webview: &Webview, _value: &str) -> Result<(), String> {
    Ok(())
}

fn webview_label(id: &str) -> Result<String, String> {
    let valid = !id.is_empty()
        && id.len() <= 96
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
    valid
        .then(|| format!("misty-browser-{id}"))
        .ok_or_else(|| "Browser tab identifier is invalid.".to_owned())
}

fn external_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "Enter a valid web address or search.".to_owned())?;
    if url.as_str() == "about:blank" || matches!(url.scheme(), "http" | "https") {
        return Ok(url);
    }
    Err("Misty Browser supports only http and https pages.".to_owned())
}

fn logical_bounds(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> (LogicalPosition<f64>, LogicalSize<f64>) {
    (
        LogicalPosition::new(x.max(0.0), y.max(0.0)),
        LogicalSize::new(width.max(1.0), height.max(1.0)),
    )
}

fn register_session(state: &BrowserSessionState, id: &str, scope_id: &str) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable.")?;
    let session = sessions.entry(id.to_owned()).or_default();
    if !scope_id.trim().is_empty() {
        session.scope_id = scope_id.trim().to_owned();
    } else if session.scope_id.is_empty() {
        session.scope_id = format!("browser-{id}");
    }
    Ok(())
}

#[tauri::command]
pub fn browser_webview_create(
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserWebviewCreateRequest,
) -> Result<(), String> {
    let label = webview_label(&request.id)?;
    let (position, size) = logical_bounds(request.x, request.y, request.width, request.height);
    let window = app
        .get_window("main")
        .or_else(|| app.windows().into_values().next())
        .ok_or_else(|| "Misty's main window is unavailable.".to_owned())?;
    window
        .set_theme(browser_theme(&request.theme)?)
        .map_err(|error| error.to_string())?;
    register_session(&state, &request.id, &request.scope_id)?;
    if let Some(webview) = app.get_webview(&label) {
        apply_macos_webview_theme(&webview, &request.theme)?;
        configure_macos_webview(&webview)?;
        webview
            .set_bounds(tauri::Rect {
                position: position.into(),
                size: size.into(),
            })
            .map_err(|error| error.to_string())?;
        return present_macos_webview(&webview);
    }

    let page_app = app.clone();
    let page_id = request.id.clone();
    let title_app = app.clone();
    let title_id = request.id.clone();
    let popup_app = app.clone();
    let popup_id = request.id.clone();
    let download_app = app.clone();
    let download_id = request.id.clone();
    let mut builder = WebviewBuilder::new(label, WebviewUrl::External(external_url(&request.url)?))
        .focused(false)
        .accept_first_mouse(true)
        .background_color(browser_background(&request.theme))
        .initialization_script(BROWSER_VIEWPORT_SCRIPT)
        .on_navigation(|url| external_url(url.as_str()).is_ok())
        .on_new_window(move |url, _features| {
            if external_url(url.as_str()).is_ok() {
                let _ = popup_app.emit(
                    "misty://browser-popup",
                    BrowserPopupEvent {
                        source_id: popup_id.clone(),
                        url: url.to_string(),
                    },
                );
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |_webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                if let Some(state) = page_app.try_state::<BrowserSessionState>() {
                    if let Ok(mut sessions) = state.sessions.lock() {
                        if let Some(session) = sessions.get_mut(&page_id) {
                            session.element_selectors.clear();
                        }
                    }
                }
            }
            let phase = match payload.event() {
                tauri::webview::PageLoadEvent::Started => "started",
                tauri::webview::PageLoadEvent::Finished => "finished",
            };
            let _ = page_app.emit(
                "misty://browser-page",
                BrowserPageEvent {
                    id: page_id.clone(),
                    url: payload.url().to_string(),
                    phase,
                },
            );
        })
        .on_document_title_changed(move |_webview, title| {
            let _ = title_app.emit(
                "misty://browser-title",
                BrowserTitleEvent {
                    id: title_id.clone(),
                    title,
                },
            );
        })
        .on_download(move |_webview, event| {
            handle_download_event(&download_app, &download_id, event)
        });
    if let Some(user_agent) = validated_user_agent(request.user_agent.as_deref())? {
        builder = builder.user_agent(user_agent);
    }
    let webview = window
        .add_child(builder, position, size)
        .map_err(|error| error.to_string())?;
    apply_macos_webview_theme(&webview, &request.theme)?;
    configure_macos_webview(&webview)?;
    webview.set_zoom(1.0).map_err(|error| error.to_string())?;
    present_macos_webview(&webview)
}

fn handle_download_event(app: &AppHandle, tab_id: &str, event: DownloadEvent<'_>) -> bool {
    let Some(state) = app.try_state::<BrowserSessionState>() else {
        return false;
    };
    match event {
        DownloadEvent::Requested { url, destination } => {
            let Some(download_dir) = dirs::download_dir().filter(|path| path.is_absolute()) else {
                emit_download_failure(
                    app,
                    &state,
                    tab_id,
                    &url,
                    "The Downloads folder is unavailable.",
                );
                return false;
            };
            if let Err(error) = std::fs::create_dir_all(&download_dir) {
                emit_download_failure(app, &state, tab_id, &url, &error.to_string());
                return false;
            }
            let suggested = destination
                .file_name()
                .and_then(|value| value.to_str())
                .or_else(|| {
                    url.path_segments()
                        .and_then(|mut values| values.next_back())
                })
                .unwrap_or("download");
            let path =
                reserve_download_path(&state, &download_dir, &sanitize_download_name(suggested));
            *destination = path.clone();
            let record = requested_download(&state, tab_id, &url, &path);
            let _ = app.emit("misty://browser-download", record);
            true
        }
        DownloadEvent::Finished { url, path, success } => {
            let record = finish_download(&state, tab_id, &url, path.as_deref(), success);
            let _ = app.emit("misty://browser-download", record);
            true
        }
        _ => true,
    }
}

fn emit_download_failure(
    app: &AppHandle,
    state: &BrowserSessionState,
    tab_id: &str,
    url: &Url,
    error: &str,
) {
    let record = BrowserDownload {
        download_id: format!("download-{}", uuid::Uuid::new_v4()),
        tab_id: tab_id.to_owned(),
        url: url.to_string(),
        path: String::new(),
        state: "failed".to_owned(),
        success: false,
        initiator: "human".to_owned(),
        agent_id: None,
        grant_id: None,
        error: Some(error.to_owned()),
    };
    if let Ok(mut sessions) = state.sessions.lock() {
        let downloads = &mut sessions.entry(tab_id.to_owned()).or_default().downloads;
        downloads.push(record.clone());
        if downloads.len() > MAX_DOWNLOAD_HISTORY {
            downloads.remove(0);
        }
    }
    let _ = app.emit("misty://browser-download", record);
}

fn requested_download(
    state: &BrowserSessionState,
    tab_id: &str,
    url: &Url,
    path: &Path,
) -> BrowserDownload {
    let mut sessions = state
        .sessions
        .lock()
        .expect("browser session mutex poisoned");
    let session = sessions.entry(tab_id.to_owned()).or_default();
    let pending = session
        .pending_agent_download
        .take()
        .filter(|pending| pending.expires_at > Utc::now());
    let record = BrowserDownload {
        download_id: format!("download-{}", uuid::Uuid::new_v4()),
        tab_id: tab_id.to_owned(),
        url: url.to_string(),
        path: path.to_string_lossy().into_owned(),
        state: "requested".to_owned(),
        success: false,
        initiator: if pending.is_some() { "agent" } else { "human" }.to_owned(),
        agent_id: pending.as_ref().map(|value| value.agent_id.clone()),
        grant_id: pending.as_ref().map(|value| value.grant_id.clone()),
        error: None,
    };
    session.downloads.push(record.clone());
    if session.downloads.len() > MAX_DOWNLOAD_HISTORY {
        session.downloads.remove(0);
    }
    record
}

fn finish_download(
    state: &BrowserSessionState,
    tab_id: &str,
    url: &Url,
    path: Option<&Path>,
    success: bool,
) -> BrowserDownload {
    let mut sessions = state
        .sessions
        .lock()
        .expect("browser session mutex poisoned");
    let session = sessions.entry(tab_id.to_owned()).or_default();
    let path_text = path
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let existing = session
        .downloads
        .iter_mut()
        .rev()
        .find(|item| item.url == url.as_str() && item.state == "requested");
    let record = if let Some(item) = existing {
        item.path = path_text.clone();
        item.state = if success { "finished" } else { "failed" }.to_owned();
        item.success = success;
        if !success {
            item.error = Some("The native WebView reported that the download failed.".to_owned());
        }
        item.clone()
    } else {
        BrowserDownload {
            download_id: format!("download-{}", uuid::Uuid::new_v4()),
            tab_id: tab_id.to_owned(),
            url: url.to_string(),
            path: path_text.clone(),
            state: if success { "finished" } else { "failed" }.to_owned(),
            success,
            initiator: "human".to_owned(),
            agent_id: None,
            grant_id: None,
            error: (!success)
                .then(|| "The native WebView reported that the download failed.".to_owned()),
        }
    };
    drop(sessions);
    if let Ok(mut reserved) = state.reserved_downloads.lock() {
        if !path_text.is_empty() {
            reserved.remove(Path::new(&path_text));
        }
    }
    record
}

fn sanitize_download_name(value: &str) -> String {
    let mut name = value
        .chars()
        .filter(|character| !character.is_control() && !matches!(character, '/' | '\\' | ':'))
        .collect::<String>();
    name = name.trim().trim_matches('.').to_owned();
    if name.is_empty() {
        name = "download".to_owned();
    }
    if name.chars().count() > 180 {
        name = name.chars().take(180).collect();
    }
    name
}

fn reserve_download_path(state: &BrowserSessionState, directory: &Path, name: &str) -> PathBuf {
    let mut reserved = state
        .reserved_downloads
        .lock()
        .expect("download mutex poisoned");
    let original = Path::new(name);
    let stem = original
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let extension = original.extension().and_then(|value| value.to_str());
    for index in 0..10_000 {
        let candidate_name = if index == 0 {
            name.to_owned()
        } else if let Some(extension) = extension {
            format!("{stem} ({index}).{extension}")
        } else {
            format!("{stem} ({index})")
        };
        let candidate = directory.join(candidate_name);
        if !candidate.exists() && !reserved.contains(&candidate) {
            reserved.insert(candidate.clone());
            return candidate;
        }
    }
    directory.join(format!("download-{}", uuid::Uuid::new_v4()))
}

#[tauri::command]
pub fn browser_webview_set_bounds(
    app: AppHandle,
    request: BrowserWebviewBoundsRequest,
) -> Result<(), String> {
    let webview = app
        .get_webview(&webview_label(&request.id)?)
        .ok_or_else(|| "Browser tab is not running.".to_owned())?;
    let (position, size) = logical_bounds(request.x, request.y, request.width, request.height);
    webview
        .set_bounds(tauri::Rect {
            position: position.into(),
            size: size.into(),
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_webview_reconcile(
    app: AppHandle,
    request: BrowserWebviewBoundsRequest,
) -> Result<bool, String> {
    let Some(webview) = app.get_webview(&webview_label(&request.id)?) else {
        return Ok(false);
    };
    let (position, size) = logical_bounds(request.x, request.y, request.width, request.height);
    webview
        .set_bounds(tauri::Rect {
            position: position.into(),
            size: size.into(),
        })
        .map_err(|error| error.to_string())?;
    present_macos_webview(&webview)?;
    Ok(true)
}

#[tauri::command]
pub fn browser_webview_navigate(
    app: AppHandle,
    request: BrowserNavigateRequest,
) -> Result<(), String> {
    with_webview(&app, &request.id, |webview| {
        webview
            .navigate(external_url(&request.url)?)
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn browser_webview_set_theme(
    app: AppHandle,
    request: BrowserThemeRequest,
) -> Result<(), String> {
    let window = app
        .get_window("main")
        .or_else(|| app.windows().into_values().next())
        .ok_or_else(|| "Misty's main window is unavailable.".to_owned())?;
    window
        .set_theme(browser_theme(&request.theme)?)
        .map_err(|error| error.to_string())?;
    for (label, webview) in app.webviews() {
        if label.starts_with("misty-browser-") {
            apply_macos_webview_theme(&webview, &request.theme)?;
        }
    }
    Ok(())
}

fn with_webview(
    app: &AppHandle,
    id: &str,
    action: impl FnOnce(Webview) -> Result<(), String>,
) -> Result<(), String> {
    let webview = app
        .get_webview(&webview_label(id)?)
        .ok_or_else(|| "Browser tab is not running.".to_owned())?;
    action(webview)
}

#[tauri::command]
pub fn browser_webview_back(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    with_webview(&app, &request.id, |webview| {
        webview.eval("history.back()").map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn browser_webview_forward(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    with_webview(&app, &request.id, |webview| {
        webview.eval("history.forward()").map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn browser_webview_reload(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    with_webview(&app, &request.id, |webview| {
        webview.reload().map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn browser_webview_show(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    with_webview(&app, &request.id, |webview| present_macos_webview(&webview))
}

#[tauri::command]
pub fn browser_webviews_set_overlay_active(app: AppHandle, active: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let main_webview = app
            .get_webview("main")
            .ok_or_else(|| "Misty's main webview is unavailable.".to_owned())?;
        main_webview
            .with_webview(|platform_webview| {
                MAIN_WEBVIEW_VIEW.store(platform_webview.inner() as usize, Ordering::Release);
            })
            .map_err(|error| error.to_string())?;
        // Wry applies the macOS `drawsBackground` KVC setting through its
        // supported transparent-webview path. A direct Objective-C selector
        // is not available on recent WKWebView subclasses.
        main_webview
            .set_background_color(Some(Color(0, 0, 0, 0)))
            .map_err(|error| error.to_string())?;
        BROWSER_OVERLAY_ACTIVE.store(active, Ordering::Release);

        for (label, webview) in app.webviews() {
            if label.starts_with("misty-browser-") {
                // Hidden tabs still need the correct sibling order for their
                // next activation, but an overlay must never reveal them.
                position_macos_webview(&webview, false)?;
            }
        }
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, active);
        Ok(())
    }
}

#[tauri::command]
pub fn browser_webview_hide(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    let Some(webview) = app.get_webview(&webview_label(&request.id)?) else {
        return Ok(());
    };
    webview.hide().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_webviews_hide_all(app: AppHandle) -> Result<(), String> {
    let mut errors = Vec::new();
    for (label, webview) in app.webviews() {
        if label.starts_with("misty-browser-") {
            if let Err(error) = webview.hide() {
                errors.push(error.to_string());
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

#[tauri::command]
pub fn browser_webview_close(
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    if let Ok(mut sessions) = state.sessions.lock() {
        sessions.remove(&request.id);
    }
    let Some(webview) = app.get_webview(&webview_label(&request.id)?) else {
        return Ok(());
    };
    webview.close().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn browser_agent_grant_register(
    state: State<'_, BrowserSessionState>,
    request: BrowserAgentGrantRequest,
) -> Result<(), String> {
    let expires_at = DateTime::parse_from_rfc3339(&request.expires_at)
        .map_err(|_| "Browser grant expiry is invalid.".to_owned())?
        .with_timezone(&Utc);
    if expires_at <= Utc::now()
        || request.scope_id.trim().is_empty()
        || request.grant_id.trim().is_empty()
    {
        return Err("Browser grant is invalid or expired.".to_owned());
    }
    let capabilities = request.capabilities.into_iter().collect::<HashSet<_>>();
    if capabilities.is_empty()
        || capabilities
            .iter()
            .any(|value| !is_browser_capability(value))
    {
        return Err("Browser grant contains an unsupported capability.".to_owned());
    }
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable.")?;
    let session = sessions
        .get_mut(&request.id)
        .ok_or_else(|| "Browser tab is not running.".to_owned())?;
    if session.scope_id != request.scope_id {
        return Err("Browser grant does not match this tab.".to_owned());
    }
    session.grants.insert(
        request.grant_id,
        BrowserGrant {
            agent_id: request.agent_id,
            capabilities,
            expires_at,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn browser_agent_grant_revoke(
    state: State<'_, BrowserSessionState>,
    request: BrowserAgentGrantRevokeRequest,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable.")?;
    if let Some(session) = sessions.get_mut(&request.id) {
        session.grants.remove(&request.grant_id);
    }
    Ok(())
}

fn is_browser_capability(value: &str) -> bool {
    matches!(
        value,
        "browser.inspect" | "browser.navigate" | "browser.click" | "browser.downloads.list"
    )
}

fn resolve_agent_webview(
    app: &AppHandle,
    state: &BrowserSessionState,
    request: &BrowserAgentExecuteRequest,
) -> Result<(String, String), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable.")?;
    let (id, session) = sessions
        .iter_mut()
        .find(|(_, session)| session.scope_id == request.scope_id)
        .ok_or_else(|| "The granted browser tab is not open.".to_owned())?;
    let agent_id = validate_browser_grant(session, request)?;
    if app.get_webview(&webview_label(id)?).is_none() {
        return Err("The granted browser tab is not running.".to_owned());
    }
    Ok((id.clone(), agent_id))
}

fn validate_browser_grant(
    session: &mut BrowserSession,
    request: &BrowserAgentExecuteRequest,
) -> Result<String, String> {
    session
        .grants
        .retain(|_, grant| grant.expires_at > Utc::now());
    session
        .grants
        .get(&request.grant_id)
        .filter(|grant| {
            grant.agent_id == request.agent_id && grant.capabilities.contains(&request.operation)
        })
        .map(|grant| grant.agent_id.clone())
        .ok_or_else(|| "Browser agent access is not active for this operation.".to_owned())
}

#[tauri::command]
pub async fn browser_agent_execute(
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    if !is_browser_capability(&request.operation) {
        return Err("Unsupported browser agent operation.".to_owned());
    }
    let (id, agent_id) = resolve_agent_webview(&app, &state, &request)?;
    match request.operation.as_str() {
        "browser.inspect" => inspect_browser(&app, &state, &id, &request).await,
        "browser.navigate" => {
            let url = request
                .input
                .get("url")
                .and_then(Value::as_str)
                .ok_or_else(|| "A URL is required.".to_owned())?;
            app.get_webview(&webview_label(&id)?)
                .ok_or_else(|| "Browser tab is not running.".to_owned())?
                .navigate(external_url(url)?)
                .map_err(|error| error.to_string())?;
            Ok(json!({"ok": true, "url": url}))
        }
        "browser.click" => click_browser(&app, &state, &id, &agent_id, &request).await,
        "browser.downloads.list" => {
            let sessions = state
                .sessions
                .lock()
                .map_err(|_| "Browser state is unavailable.")?;
            let downloads = sessions
                .get(&id)
                .map(|session| session.downloads.clone())
                .unwrap_or_default();
            Ok(json!({"downloads": downloads}))
        }
        _ => Err("Unsupported browser agent operation.".to_owned()),
    }
}

async fn inspect_browser(
    app: &AppHandle,
    state: &BrowserSessionState,
    id: &str,
    request: &BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    let script = format!(
        r#"(() => {{
      try {{
        const maxText = {MAX_SNAPSHOT_CHARS};
        const maxElements = {MAX_INTERACTIVE_ELEMENTS};
        const rawText = document.body?.innerText || '';
        const selectorFor = (element) => {{
          if (element.id) return '#' + CSS.escape(element.id);
          const parts = [];
          let current = element;
          while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {{
            let part = current.tagName.toLowerCase();
            const parent = current.parentElement;
            if (parent) {{
              const siblings = Array.from(parent.children).filter((item) => item.tagName === current.tagName);
              if (siblings.length > 1) part += `:nth-of-type(${{siblings.indexOf(current) + 1}})`;
            }}
            parts.unshift(part);
            current = parent;
            if (parts.length >= 8) break;
          }}
          return 'body > ' + parts.join(' > ');
        }};
        const candidates = Array.from(document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])')).slice(0, maxElements);
        const interactive = candidates.map((element) => ({{
          selector: selectorFor(element), tag: element.tagName.toLowerCase(),
          role: element.getAttribute('role') || '',
          name: (element.getAttribute('aria-label') || element.innerText || element.getAttribute('value') || element.getAttribute('title') || '').trim().slice(0, 300)
        }}));
        return {{ url: location.href, title: document.title || '', text: rawText.slice(0, maxText), truncated: rawText.length > maxText, interactive, error: '' }};
      }} catch (error) {{
        return {{ url: location.href, title: document.title || '', text: '', truncated: false, interactive: [], error: String(error) }};
      }}
    }})()"#
    );
    let raw = eval_json(
        app.get_webview(&webview_label(id)?)
            .ok_or_else(|| "Browser tab is not running.".to_owned())?,
        script,
    )
    .await?;
    let snapshot: RawSnapshot = serde_json::from_value(raw)
        .map_err(|error| format!("Browser snapshot was invalid: {error}"))?;
    if !snapshot.error.is_empty() {
        return Err(snapshot.error);
    }
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Browser state is unavailable.")?;
    let session = sessions
        .get_mut(id)
        .ok_or_else(|| "Browser tab is not running.".to_owned())?;
    let grant = session
        .grants
        .get(&request.grant_id)
        .filter(|grant| grant.expires_at > Utc::now())
        .ok_or_else(|| "Browser agent access was revoked.".to_owned())?;
    if !grant.capabilities.contains("browser.inspect") {
        return Err("Browser inspection is not granted.".to_owned());
    }
    let interactive = replace_snapshot_selectors(session, snapshot.interactive);
    Ok(json!({
        "url": snapshot.url, "title": snapshot.title, "text": snapshot.text,
        "truncated": snapshot.truncated, "interactive": interactive,
        "contentTrust": "untrusted-web-page"
    }))
}

fn replace_snapshot_selectors(
    session: &mut BrowserSession,
    elements: Vec<RawInteractiveElement>,
) -> Vec<Value> {
    session.snapshot_generation = session.snapshot_generation.wrapping_add(1);
    session.element_selectors.clear();
    let generation = session.snapshot_generation;
    elements
        .into_iter()
        .enumerate()
        .map(|(index, element)| {
            let element_ref = format!("element-{generation}-{index}");
            session
                .element_selectors
                .insert(element_ref.clone(), element.selector);
            json!({"ref": element_ref, "tag": element.tag, "role": element.role, "name": element.name})
        })
        .collect()
}

async fn click_browser(
    app: &AppHandle,
    state: &BrowserSessionState,
    id: &str,
    agent_id: &str,
    request: &BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    let element_ref = request
        .input
        .get("elementRef")
        .and_then(Value::as_str)
        .ok_or_else(|| "An inspected element reference is required.".to_owned())?;
    let expect_download = request
        .input
        .get("expectDownload")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let (selector, existing_download_ids) = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "Browser state is unavailable.")?;
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| "Browser tab is not running.".to_owned())?;
        let grant = session
            .grants
            .get(&request.grant_id)
            .filter(|grant| grant.expires_at > Utc::now())
            .ok_or_else(|| "Browser agent access was revoked.".to_owned())?;
        if !grant.capabilities.contains("browser.click") {
            return Err("Browser clicks are not granted.".to_owned());
        }
        let selector = session
            .element_selectors
            .get(element_ref)
            .cloned()
            .ok_or_else(|| "The page changed; inspect it again before clicking.".to_owned())?;
        if expect_download {
            session.pending_agent_download = Some(PendingAgentDownload {
                grant_id: request.grant_id.clone(),
                agent_id: agent_id.to_owned(),
                expires_at: Utc::now() + chrono::Duration::seconds(AGENT_DOWNLOAD_WINDOW_SECONDS),
            });
        }
        (
            selector,
            session
                .downloads
                .iter()
                .map(|download| download.download_id.clone())
                .collect::<HashSet<_>>(),
        )
    };
    let encoded_selector = serde_json::to_string(&selector).map_err(|error| error.to_string())?;
    let script = format!(
        r#"(() => {{
      try {{
        const element = document.querySelector({encoded_selector});
        if (!element) return {{ ok: false, error: 'The inspected element no longer exists.' }};
        element.click();
        return {{ ok: true }};
      }} catch (error) {{ return {{ ok: false, error: String(error) }}; }}
    }})()"#
    );
    let result = eval_json(
        app.get_webview(&webview_label(id)?)
            .ok_or_else(|| "Browser tab is not running.".to_owned())?,
        script,
    )
    .await?;
    if result.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(result
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Browser click failed.")
            .to_owned());
    }
    if expect_download {
        let download =
            wait_for_agent_download(state, id, &request.grant_id, &existing_download_ids).await?;
        if !download.success {
            return Err(download
                .error
                .clone()
                .unwrap_or_else(|| "The browser download failed.".to_owned()));
        }
        return Ok(json!({
            "ok": true,
            "elementRef": element_ref,
            "expectDownload": true,
            "download": download
        }));
    }
    Ok(json!({"ok": true, "elementRef": element_ref, "expectDownload": false}))
}

async fn wait_for_agent_download(
    state: &BrowserSessionState,
    id: &str,
    grant_id: &str,
    existing_download_ids: &HashSet<String>,
) -> Result<BrowserDownload, String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(90);
    loop {
        {
            let sessions = state
                .sessions
                .lock()
                .map_err(|_| "Browser state is unavailable.")?;
            let session = sessions
                .get(id)
                .ok_or_else(|| "The granted browser tab was closed.".to_owned())?;
            let grant = session
                .grants
                .get(grant_id)
                .filter(|grant| grant.expires_at > Utc::now())
                .ok_or_else(|| "Browser agent access was revoked.".to_owned())?;
            if !grant.capabilities.contains("browser.click") {
                return Err("Browser clicks are no longer granted.".to_owned());
            }
            if let Some(download) = session.downloads.iter().rev().find(|download| {
                download.grant_id.as_deref() == Some(grant_id)
                    && !existing_download_ids.contains(&download.download_id)
                    && matches!(download.state.as_str(), "finished" | "failed")
            }) {
                return Ok(download.clone());
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(
                "The expected browser download did not start or finish in time.".to_owned(),
            );
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

async fn eval_json(webview: Webview, script: String) -> Result<Value, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    webview
        .eval_with_callback(script, move |value| {
            if let Ok(mut sender) = sender.lock() {
                if let Some(sender) = sender.take() {
                    let _ = sender.send(value);
                }
            }
        })
        .map_err(|error| error.to_string())?;
    let serialized = tokio::time::timeout(Duration::from_secs(10), receiver)
        .await
        .map_err(|_| "Browser page evaluation timed out.".to_owned())?
        .map_err(|_| "Browser page evaluation was canceled.".to_owned())?;
    serde_json::from_str(&serialized)
        .map_err(|error| format!("Browser page returned invalid data: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn browser_labels_reject_unsafe_identifiers() {
        assert!(webview_label("tab-123").is_ok());
        assert!(webview_label("../main").is_err());
        assert!(webview_label("").is_err());
    }

    #[test]
    fn browser_navigation_accepts_only_web_urls() {
        assert!(external_url("about:blank").is_ok());
        assert!(external_url("https://example.com").is_ok());
        assert!(external_url("javascript:alert(1)").is_err());
        assert!(external_url("file:///tmp/private").is_err());
    }

    #[test]
    fn browser_user_agents_reject_header_injection() {
        assert_eq!(
            validated_user_agent(Some("Mozilla/5.0 Safari/605.1.15")).unwrap(),
            Some("Mozilla/5.0 Safari/605.1.15")
        );
        assert!(validated_user_agent(Some("Mozilla/5.0\r\nX-Test: unsafe")).is_err());
        assert!(validated_user_agent(Some(&"x".repeat(513))).is_err());
    }

    #[test]
    fn browser_bounds_do_not_require_creation_fields() {
        let request: BrowserWebviewBoundsRequest = serde_json::from_value(json!({
            "id": "tab-123",
            "x": 10.0,
            "y": 20.0,
            "width": 800.0,
            "height": 600.0
        }))
        .unwrap();
        assert_eq!(request.id, "tab-123");
        let (_, size) = logical_bounds(request.x, request.y, request.width, request.height);
        assert_eq!(size.width, 800.0);
        assert_eq!(size.height, 600.0);
    }

    #[test]
    fn download_names_are_sanitized() {
        assert_eq!(sanitize_download_name("../report.pdf"), "report.pdf");
        assert_eq!(sanitize_download_name("  "), "download");
        assert_eq!(sanitize_download_name("a/b:c.txt"), "abc.txt");
    }

    #[test]
    fn downloads_never_overwrite_or_reuse_reserved_paths() {
        let directory = tempdir().unwrap();
        std::fs::write(directory.path().join("report.pdf"), b"existing").unwrap();
        let state = BrowserSessionState::default();
        let first = reserve_download_path(&state, directory.path(), "report.pdf");
        let second = reserve_download_path(&state, directory.path(), "report.pdf");
        assert_eq!(first.file_name().unwrap(), "report (1).pdf");
        assert_eq!(second.file_name().unwrap(), "report (2).pdf");
    }

    #[test]
    fn browser_capabilities_are_closed_over_known_operations() {
        assert!(is_browser_capability("browser.inspect"));
        assert!(is_browser_capability("browser.downloads.list"));
        assert!(!is_browser_capability("browser.eval"));
    }

    #[test]
    fn new_snapshots_invalidate_old_element_references() {
        let mut session = BrowserSession::default();
        let first = replace_snapshot_selectors(
            &mut session,
            vec![RawInteractiveElement {
                selector: "#first".to_owned(),
                tag: "button".to_owned(),
                role: String::new(),
                name: "First".to_owned(),
            }],
        );
        let first_ref = first[0]["ref"].as_str().unwrap().to_owned();
        let second = replace_snapshot_selectors(
            &mut session,
            vec![RawInteractiveElement {
                selector: "#second".to_owned(),
                tag: "a".to_owned(),
                role: String::new(),
                name: "Second".to_owned(),
            }],
        );
        assert!(!session.element_selectors.contains_key(&first_ref));
        assert_ne!(first[0]["ref"], second[0]["ref"]);
    }

    #[test]
    fn grants_are_agent_capability_and_expiry_scoped() {
        let mut session = BrowserSession::default();
        session.grants.insert(
            "grant".to_owned(),
            BrowserGrant {
                agent_id: "agent-a".to_owned(),
                capabilities: HashSet::from(["browser.inspect".to_owned()]),
                expires_at: Utc::now() + chrono::Duration::minutes(5),
            },
        );
        let mut request = BrowserAgentExecuteRequest {
            scope_id: "scope".to_owned(),
            grant_id: "grant".to_owned(),
            agent_id: "agent-a".to_owned(),
            operation: "browser.inspect".to_owned(),
            input: Value::Null,
        };
        assert!(validate_browser_grant(&mut session, &request).is_ok());
        request.agent_id = "agent-b".to_owned();
        assert!(validate_browser_grant(&mut session, &request).is_err());
        request.agent_id = "agent-a".to_owned();
        request.operation = "browser.click".to_owned();
        assert!(validate_browser_grant(&mut session, &request).is_err());
        session.grants.get_mut("grant").unwrap().expires_at = Utc::now();
        request.operation = "browser.inspect".to_owned();
        assert!(validate_browser_grant(&mut session, &request).is_err());
    }
}
