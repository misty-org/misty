use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Mutex, OnceLock,
    },
    time::Duration,
};
use tauri::{
    utils::config::{BackgroundThrottlingPolicy, Color, WebviewUrl},
    webview::{DownloadEvent, NewWindowResponse},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Webview, WebviewBuilder,
};
use url::Url;

#[path = "browser_task_files.rs"]
mod task_files;

#[cfg(target_os = "macos")]
#[path = "browser_focus.rs"]
mod focus_messages;

#[cfg(target_os = "macos")]
#[path = "browser_popups.rs"]
mod popups;
#[cfg(target_os = "macos")]
#[path = "browser_attachment_download_macos.rs"]
mod attachment_download;
#[cfg(target_os = "macos")]
use popups::provider_popup;
#[cfg(all(debug_assertions, target_os = "macos"))]
#[path = "browser_popup_probe.rs"]
pub(crate) mod popup_probe;
#[cfg(all(debug_assertions, target_os = "macos"))]
#[path = "browser_render_probe.rs"]
pub(crate) mod render_probe;
#[cfg(all(debug_assertions, target_os = "macos"))]
#[path = "browser_agent_files_probe.rs"]
pub(crate) mod agent_files_probe;

#[cfg(target_os = "macos")]
#[path = "browser_context_menu.rs"]
mod context_menu;

#[path = "browser_page_tools.rs"]
mod page_tools;
pub use page_tools::{
    browser_clear_website_data, browser_webview_developer_tools, browser_webview_set_muted, browser_webview_find, browser_webview_print,
    browser_webview_save_page, browser_webview_stop,
};

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn browser_context_menu_select(app: AppHandle, webview: Webview, key: String, action: String) -> Result<(), String> {
    context_menu::select(&app, &webview, &key, &action)
}

#[cfg(target_os = "macos")]
pub use context_menu::AvailabilityRequest as BrowserMenuAvailabilityRequest;

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn browser_context_menu_availability(webview: Webview, state: State<'_, BrowserSessionState>, request: BrowserMenuAvailabilityRequest) -> Result<(), String> {
    context_menu::publish_availability(webview, state, request)
}

#[cfg(windows)]
use std::sync::atomic::{AtomicIsize, AtomicU32};

use super::browser_macos::{
    browser_requires_ephemeral_store, configure_browser_webview, configure_browser_frame_rate,
    configure_main_webview_pointer_guard, evaluate_browser_async_javascript,
    native_macos_safari_user_agent, refresh_browser_cursor_ownership, reload_browser_webview,
    unregister_browser_cursor_ownership,
};
use super::browser_scripts::{
    browser_pointer_navigation, browser_status_script, browser_status_update_script,
    browser_viewport_script, emit_browser_pointer, set_status_bubble_enabled,
    BROWSER_COMPATIBILITY_SCRIPT, BROWSER_MEDIA_SCRIPT, BROWSER_FAVICON_SCRIPT,
};
use super::browser_shortcuts::{
    apply as apply_shortcuts, forget_shortcut_token, forward_navigation, shortcut_token_for,
    shortcut_token_matches, BrowserShortcutBinding,
};
use super::browser_theme::{browser_background, browser_theme, default_browser_theme};

const MAX_SNAPSHOT_CHARS: usize = 256 * 1024;
const MAX_INTERACTIVE_ELEMENTS: usize = 500;
const MAX_DOWNLOAD_HISTORY: usize = 100;
const AGENT_DOWNLOAD_WINDOW_SECONDS: i64 = 30;
use super::browser_profile::data_store_identifier as browser_profile_identifier;
#[cfg(not(target_os = "macos"))]
const HTML2CANVAS_SOURCE: &str =
    include_str!("../../../node_modules/html2canvas/dist/html2canvas.min.js");
#[derive(Clone,Default)]
struct RendererState { native:usize, overlay:bool, tracking:bool, transparent:bool }
static RENDERERS:OnceLock<Mutex<HashMap<String,RendererState>>>=OnceLock::new();
fn renderers()->&'static Mutex<HashMap<String,RendererState>>{RENDERERS.get_or_init(Mutex::default)}
fn renderer(label:&str)->RendererState{renderers().lock().ok().and_then(|map|map.get(label).cloned()).unwrap_or_default()}
pub(super) fn browser_owner_label(app:&AppHandle,id:&str)->String{app.get_webview(&format!("misty-browser-{id}")).map(|view|view.window().label().to_owned()).unwrap_or_else(||"main".into())}

#[derive(Default)]
pub struct BrowserSessionState {
    #[cfg(target_os = "macos")]
    context_menu: Mutex<HashMap<String,context_menu::PendingMenu>>,
    pending_popups: Mutex<HashSet<String>>,
    sessions: Mutex<HashMap<String, BrowserSession>>,
    reserved_downloads: Mutex<HashSet<PathBuf>>,
    pub(super) shortcut_bindings: Mutex<Vec<BrowserShortcutBinding>>,
    pub(super) shortcut_tokens: Mutex<HashMap<String, String>>,
}

#[derive(Default)]
struct BrowserSession {
    agent_input_locked: bool,
    workspace_tab_id: Option<String>,
    // Native auxiliary windows stay attached to this live integration view.
    popup_parent: Option<String>,
    #[cfg(target_os = "macos")]
    context_capabilities: Option<context_menu::AvailabilityReceipt>,
    origin_space_id: Option<String>,
    zoom_factor: Option<f64>,
    profile_id: Option<String>,
    // Only this logical identity is included in renderer/agent observations.
    logical_profile_id: Option<String>,
    profile_provider: Option<String>,
    provider_id: Option<String>,
    oauth_callback: Option<(super::browser_provider::OAuthCallback, std::time::Instant)>,
    scope_id: String,
    grants: HashMap<String, BrowserGrant>,
    snapshot_generation: u64,
    element_targets: HashMap<String, String>,
    downloads: Vec<BrowserDownload>,
    pending_agent_download: Option<PendingAgentDownload>,
    /// Private tabs keep no download list and share one throwaway data store.
    private: bool,
}

impl BrowserSession {
    fn context_profile_id(&self) -> Option<&str> {
        self.logical_profile_id.as_deref().or(self.profile_id.as_deref())
    }
}

#[derive(Clone)]
struct BrowserGrant {
    agent_id: String,
    capabilities: HashSet<String>,
    expires_at: DateTime<Utc>,
}

#[derive(Clone)]
struct PendingAgentDownload {
    grant_id: String,
    agent_id: String,
    task_id: Option<String>,
    expires_at: DateTime<Utc>,
    popup_id: Option<String>,
}

#[cfg(any(target_os = "macos", test))]
fn popup_download_authority(source: &BrowserSession, popup_id: &str) -> Option<(String, String, String)> {
    let pending = source.pending_agent_download.as_ref()?;
    let grant = source.grants.get(&pending.grant_id)?;
    let now = Utc::now();
    if pending.popup_id.as_deref() != Some(popup_id)
        || pending.expires_at <= now || grant.expires_at <= now
        || grant.agent_id != pending.agent_id || !grant.capabilities.contains("browser.click") {
        return None;
    }
    Some((source.scope_id.clone(), pending.agent_id.clone(), pending.task_id.clone()?))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewCreateRequest {
    #[serde(default)]
    pub origin_space_id: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub profile_provider_id: Option<String>,
    #[serde(default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub workspace_tab_id: Option<String>,
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
    pub native_live_resize: bool,
    /// A private tab: shared throwaway website data, nothing saved or synced.
    #[serde(default)]
    pub private: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewBoundsRequest {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub native_live_resize: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCaptureRegionRequest {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Deserialize)]
pub struct BrowserZoomRequest {
    id: String,
    factor: f64,
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
    #[serde(default)]
    pub oauth_callback: Option<super::browser_provider::OAuthCallback>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserThemeRequest {
    pub theme: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCompanionSuggestion {
    id: String,
    label: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCompanionStateRequest {
    target_id: String,
    visible: bool,
    phase: String,
    name: String,
    label: String,
    #[serde(default)]
    speech: String,
    #[serde(default)]
    capture_attached: bool,
    #[serde(default)]
    suggestions: Vec<BrowserCompanionSuggestion>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BrowserCompanionEvent {
    id: String,
    kind: String,
    prompt: String,
    action_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BrowserFocusEvent {
    id: String,
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
struct BrowserFaviconEvent {
    id: String,
    url: String,
}

#[derive(Debug, Deserialize)]
struct BrowserCompatibilityProbe {
    kind: String,
    url: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BrowserCompatibilityEvent {
    id: String,
    kind: String,
    url: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BrowserPopupEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    popup_instance_key: Option<String>,
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
    task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file: Option<task_files::DownloadFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSnapshot {
    #[serde(default)]
    semantic: Value,
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
    target: String,
    tag: String,
    role: String,
    name: String,
}

#[cfg(target_os = "macos")]
fn apply_macos_webview_theme(webview: &Webview, _value: &str) -> Result<(), String> {
    use objc2_app_kit::{NSAppearanceCustomization, NSView};
    webview
        .with_webview(move |platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            view.setAppearance(None);
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn remember_main_macos_webview(app: &AppHandle, window_label:&str) -> Result<(), String> {
    use objc2_app_kit::NSView;
    let main_webview = app
        .get_webview(window_label)
        .ok_or_else(|| "Misty's main webview is unavailable.".to_owned())?;
    let renderer_label=window_label.to_owned();
    main_webview
        .with_webview(move |platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            if let Ok(mut map)=renderers().lock(){map.entry(renderer_label.clone()).or_default().native=view as *const NSView as usize;}
        })
        .map_err(|error| error.to_string())?;
    if window_label=="main" {configure_main_webview_pointer_guard(&main_webview)?;}
    // Configure the renderer's native background once, before the Browser
    // child is first presented. Reapplying this during every popup transition
    // clears WKWebView's backing layer and produces a dark compositor frame.
    if !renderer(window_label).transparent {
        if let Err(error) = main_webview.set_background_color(Some(Color(0, 0, 0, 0))) {

            return Err(error.to_string());
        }
    }
    if let Ok(mut map)=renderers().lock(){map.entry(window_label.to_owned()).or_default().transparent=true;}
    Ok(())
}

#[cfg(windows)]
fn remember_main_macos_webview(app: &AppHandle, window_label:&str) -> Result<(), String> {
    use windows_sys::Win32::{Foundation::HWND, UI::WindowsAndMessaging::FindWindowExW};

    let main_webview = app
        .get_webview(window_label)
        .ok_or_else(|| "Misty's main webview is unavailable.".to_owned())?;
    if renderer(window_label).native == 0 {
        let window = main_webview.window();
        let parent = window.hwnd().map_err(|error| error.to_string())?;
        let class = "WRY_WEBVIEW\0".encode_utf16().collect::<Vec<_>>();
        let hwnd = unsafe {
            FindWindowExW(
                parent.0 as HWND,
                std::ptr::null_mut(),
                class.as_ptr(),
                std::ptr::null(),
            )
        };
        if let Ok(mut map)=renderers().lock(){map.entry(window_label.to_owned()).or_default().native=hwnd as usize;}
    }
    if renderer(window_label).native == 0 {
        return Err("Misty's main WebView2 window is unavailable.".to_owned());
    }
    // The renderer must stay transparent wherever CSS leaves the Browser page
    // host open, otherwise moving it above the external page paints a solid
    // rectangle instead of just the annotation or popup UI.
    if !renderer(window_label).transparent {
        if let Err(error) = main_webview.set_background_color(Some(Color(0, 0, 0, 0))) {

            return Err(error.to_string());
        }
    }
    if let Ok(mut map)=renderers().lock(){map.entry(window_label.to_owned()).or_default().transparent=true;}
    Ok(())
}

fn browser_child_should_be_below_renderer(overlay_active: bool) -> bool {
    overlay_active
}

#[cfg(not(any(target_os = "macos", windows)))]
fn remember_main_macos_webview(_app: &AppHandle, _window_label:&str) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn position_macos_webview(webview: &Webview, reveal: bool) -> Result<(), String> {
    use objc2_app_kit::{NSView, NSWindow, NSWindowOrderingMode};
    let own_renderer=renderer(webview.window().label());
    webview
        .with_webview(move |platform_webview| unsafe {
            let view: &NSView = &*platform_webview.inner().cast();
            if reveal && view.isHidden() {
                view.setHidden(false);
            }
            let parent = view.superview().or_else(|| {
                let window: &NSWindow = &*platform_webview.ns_window().cast();
                window.contentView()
            });
            if let Some(parent) = parent {
                let main_view = own_renderer.native;
                let below_main = browser_child_should_be_below_renderer(
                    own_renderer.overlay,
                );
                if main_view == 0
                    || browser_stacking_is_correct(&parent, view, main_view, below_main)
                {
                    return;
                }
                let main_view: &NSView = &*(main_view as *const NSView);
                // The external page owns its measured rectangle normally. Misty's
                // renderer moves above it only while app UI needs those pixels.
                parent.addSubview_positioned_relativeTo(
                    view,
                    if below_main {
                        NSWindowOrderingMode::Below
                    } else {
                        NSWindowOrderingMode::Above
                    },
                    Some(main_view),
                );
            }
        })
        .map_err(|error| error.to_string())?;
    refresh_browser_cursor_ownership(webview)
}

#[cfg(windows)]
fn position_windows_webview(
    webview: &Webview,
    reveal: bool,
    below_renderer: bool,
) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::{GetLastError, HWND},
        UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
        },
    };

    if reveal {
        webview.show().map_err(|error| error.to_string())?;
    }
    let own_renderer=renderer(webview.window().label());
    let failure = std::sync::Arc::new(AtomicU32::new(0));
    let callback_failure = failure.clone();
    webview
        .with_webview(move |platform_webview| {
            let mut child = Default::default();
            if unsafe { platform_webview.controller().ParentWindow(&mut child) }.is_err() {
                callback_failure.store(u32::MAX, Ordering::Release);
                return;
            }
            let main = own_renderer.native;
            if main == 0 {
                callback_failure.store(u32::MAX, Ordering::Release);
                return;
            }
            let insert_after = if below_renderer {
                main as HWND
            } else {
                HWND_TOP
            };
            let positioned = unsafe {
                SetWindowPos(
                    child.0 as HWND,
                    insert_after,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOOWNERZORDER | SWP_NOSIZE,
                )
            };
            if positioned == 0 {
                callback_failure.store(unsafe { GetLastError() }, Ordering::Release);
            }
        })
        .map_err(|error| error.to_string())?;
    match failure.load(Ordering::Acquire) {
        0 => refresh_browser_cursor_ownership(webview),
        u32::MAX => Err("A WebView2 window handle is unavailable.".to_owned()),
        code => Err(format!(
            "Could not update Browser stacking (Windows error {code})."
        )),
    }
}

/// Whether `view` already sits on the correct side of the app renderer inside
/// `parent`. Restacking is only needed when this is false.
#[cfg(target_os = "macos")]
unsafe fn browser_stacking_is_correct(
    parent: &objc2_app_kit::NSView,
    view: &objc2_app_kit::NSView,
    main_view: usize,
    below_main: bool,
) -> bool {
    use objc2_app_kit::NSView;
    let subviews = parent.subviews();
    let mut view_index = None;
    let mut main_index = None;
    for (index, child) in subviews.iter().enumerate() {
        let child: *const NSView = &*child;
        if std::ptr::eq(child, view) {
            view_index = Some(index);
        }
        if main_view != 0 && std::ptr::eq(child, main_view as *const NSView) {
            main_index = Some(index);
        }
    }
    // A detached child always needs reinserting.
    let Some(view_index) = view_index else {
        return false;
    };
    match main_index {
        Some(main_index) if below_main => view_index < main_index,
        Some(main_index) => view_index > main_index,
        // Without the app renderer as a reference point, "topmost" is the only
        // ordering the caller can ask for.
        None => view_index + 1 == subviews.count(),
    }
}

#[cfg(target_os = "macos")]
fn present_macos_webview(webview: &Webview) -> Result<(), String> {
    position_macos_webview(webview, true)
}

#[cfg(windows)]
fn present_macos_webview(webview: &Webview) -> Result<(), String> {
    position_windows_webview(
        webview,
        true,
        browser_child_should_be_below_renderer(renderer(webview.window().label()).overlay),
    )
}

#[cfg(not(any(target_os = "macos", windows)))]
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
    if url.as_str() == "about:blank" || (matches!(url.scheme(), "http" | "https") && url.username().is_empty() && url.password().is_none()) {
        return Ok(url);
    }
    Err("Misty Browser supports only http and https pages.".to_owned())
}

/// Only the debug integration harness registers this state, before creating views.
#[cfg(all(debug_assertions, target_os = "macos"))]
pub(crate) struct BrowserProbeDirectories {
    pub profiles: PathBuf,
    pub downloads: PathBuf,
}

pub(super) fn browser_data_directory(app: &AppHandle, profile: Option<&str>) -> Result<PathBuf, String> {
    browser_profile_identifier(profile)?;
    #[cfg(all(debug_assertions, target_os = "macos"))]
    if let Some(directories) = app.try_state::<BrowserProbeDirectories>() {
        let path = directories.profiles.join(profile.unwrap_or("legacy"));
        std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
        return Ok(path);
    }
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let path = base.join(super::browser_profile::relative_data_directory(profile)?);
    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
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

fn set_webview_bounds_if_changed(
    _app: &AppHandle,
    webview: &Webview,
    position: LogicalPosition<f64>,
    size: LogicalSize<f64>,
) -> Result<(), String> {
    let scale = webview
        .window()
        .scale_factor()
        .map_err(|error| error.to_string())?;
    let desired_position = position.to_physical::<i32>(scale);
    let desired_size = size.to_physical::<u32>(scale);
    if webview.position().map_err(|error| error.to_string())? == desired_position
        && webview.size().map_err(|error| error.to_string())? == desired_size
    {
        return Ok(());
    }
    webview
        .set_bounds(tauri::Rect {
            position: position.into(),
            size: size.into(),
        })
        .map_err(|error| error.to_string())?;
    refresh_browser_cursor_ownership(webview)
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

fn apply_browser_pointer_tracking(webview: &Webview, enabled: bool) -> Result<(), String> {
    webview
        .eval(&format!(
            "window.__MISTY_SET_POINTER_TRACKING__?.({});",
            if enabled { "true" } else { "false" }
        ))
        .map_err(|error| error.to_string())
}

#[tauri::command]
// Keep this command asynchronous. WebView2 child creation needs the Windows
// event loop to remain free while `add_child` finishes initializing the view.
pub async fn browser_webview_create(
    caller: Webview,
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    mut request: BrowserWebviewCreateRequest,
) -> Result<(), String> {
    // Private tabs never restore a synced session or bind an account profile.
    let profile_lease = if request.private {
        super::browser_sync::browser_profile_lease(Some(&app), None, None).await?
    } else {
        super::browser_sync::browser_profile_lease(Some(&app), request.profile_id.as_deref(), request.workspace_tab_id.as_deref().map(|id| (id, request.url.as_str()))).await?
    };
    request.profile_id = if request.private { None } else { profile_lease.profile_id.clone() };
    let profile_identifier = browser_profile_identifier(request.profile_id.as_deref())?;
    // Integrations use Browser's navigation rules. Provider metadata identifies
    // the account and automation permissions, not where a person may browse.
    external_url(&request.url)?;
    remember_main_macos_webview(&app,caller.window().label())?;
    let label = webview_label(&request.id)?;
    let (position, size) = logical_bounds(request.x, request.y, request.width, request.height);
    let window = caller.window();
    window
        .set_theme(browser_theme(&request.theme)?)
        .map_err(|error| error.to_string())?;
    // A live webview's cookie store cannot be changed by updating its metadata.
    // Account switches must close/reopen through the owning host view.
    if app.get_webview(&label).is_some() {
        let sessions = state.sessions.lock().map_err(|_| "Browser state is unavailable.")?;
        if let Some(session) = sessions.get(&request.id) {
            if request.profile_id.is_some() && session.profile_id != request.profile_id {
                return Err("browser_profile_changed: reopen the target in its intended profile".into());
            }
        }
    }
    register_session(&state, &request.id, &request.scope_id)?;
    if let Some(session) = state.sessions.lock().map_err(|_| "Browser state is unavailable.")?.get_mut(&request.id) {
        session.workspace_tab_id = request.workspace_tab_id.clone();
        session.origin_space_id = request.origin_space_id.clone();
        session.provider_id = request.provider_id.clone();
        session.private = request.private;
        if request.profile_id.is_some() { session.profile_id = request.profile_id.clone(); session.logical_profile_id = profile_lease.logical_profile_id.clone(); }
        if request.profile_provider_id.is_some() || request.provider_id.is_some() { session.profile_provider = request.profile_provider_id.clone().or(request.provider_id.clone()); }
    }
    let shortcut_token = shortcut_token_for(&state, &request.id)?;
    if let Some(webview) = app.get_webview(&label) {
        #[cfg(target_os = "macos")]
        if state.pending_popups.lock().map_err(|_| "Browser popup state is unavailable.")?.remove(&request.id) {
            let staging = webview.window();
            webview.reparent(&window).map_err(|error| error.to_string())?;
            // The popup's WKWebView and opener survive; only its empty staging window closes.
            staging.destroy().map_err(|error| error.to_string())?;
            if let Ok(url) = webview.url() {
                let _ = app.emit("misty://browser-page", BrowserPageEvent { id: request.id.clone(), url: url.to_string(), phase: "finished" });
            }
        }
        apply_macos_webview_theme(&webview, &request.theme)?;
        configure_browser_webview(&webview, request.native_live_resize)?;
        apply_shortcuts(&webview, &state)?;
        apply_browser_pointer_tracking(
            &webview,
            renderer(webview.window().label()).tracking,
        )?;
        set_webview_bounds_if_changed(&app, &webview, position, size)?;
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
    let navigation_app = app.clone();
    let navigation_id = request.id.clone();
    let restoring_tab_session = profile_lease.tab_session.is_some();
    let initial_url = if restoring_tab_session { "about:blank".parse().map_err(|_| "Invalid bootstrap URL")? } else { external_url(&request.url)? };
    let builder = WebviewBuilder::new(label, WebviewUrl::External(initial_url))
        .background_throttling(BackgroundThrottlingPolicy::Disabled)
        .data_directory(browser_data_directory(&app, request.profile_id.as_deref())?);
    // With no named store, an incognito view joins the shared private session.
    let builder = if request.private {
        builder.incognito(true)
    } else {
        builder
            .data_store_identifier(profile_identifier)
            .incognito(browser_requires_ephemeral_store())
    };
    // Bare WKWebView omits Safari's Version/Safari tokens, which makes sites
    // such as Google serve their legacy compatibility UI. Derive the desktop
    // Safari identity from the installed Safari bundle instead of pinning a
    // release in Misty's source.
    let builder = if let Some(user_agent) = native_macos_safari_user_agent() {
        builder.user_agent(&user_agent)
    } else {
        builder
    };
    let builder = builder
        .focused(false)
        .accept_first_mouse(true)
        .background_color(browser_background(&request.theme))
        .initialization_script(browser_viewport_script(
            &shortcut_token,
            renderer(caller.window().label()).tracking,
        ))
        .initialization_script(browser_status_script())
        .initialization_script(BROWSER_MEDIA_SCRIPT)
        .on_navigation(move |url| {
            if restoring_tab_session && url.as_str() == "about:blank" { return true; }
            #[cfg(target_os = "macos")]
            if context_menu::forward(&navigation_app, &navigation_id, url) { return false; }
            if url.scheme() == "misty-media" {
                let audible = url.query_pairs().any(|(key, value)| key == "audible" && value == "1");
                let _ = navigation_app.emit_to(
                    browser_owner_label(&navigation_app, &navigation_id),
                    "misty://browser-media",
                    json!({ "id": navigation_id, "audible": audible }),
                );
                false
            } else if url.scheme() == "misty-status" {
                let _ = navigation_app.emit_to(
                    browser_owner_label(&navigation_app, &navigation_id),
                    "misty://browser-stopped",
                    BrowserFocusEvent { id: navigation_id.clone() },
                );
                false
            } else if let Some(pointer) = browser_pointer_navigation(url) {
                emit_browser_pointer(&navigation_app, &navigation_id, pointer);
                false
            } else if forward_focus_navigation(&navigation_app, &navigation_id, url) {
                false
            } else if forward_companion_navigation(&navigation_app, &navigation_id, url) {
                false
            } else if forward_navigation(&navigation_app, &navigation_id, url) {
                false
            } else {
                // This callback includes frames, redirects and POST submissions.
                // Never turn these requests into URL-only Browser handoffs.
                external_url(url.as_str()).is_ok()
            }
        })
        .on_new_window(move |url, features| {
            #[cfg(target_os = "macos")]
            if let Some(response) = provider_popup(&popup_app, &popup_id, &url, features) { return response; }
            if external_url(url.as_str()).is_ok() {
                let _ = popup_app.emit(
                    "misty://browser-popup",
                    BrowserPopupEvent {
                        popup_instance_key: None,
                        source_id: popup_id.clone(),
                        url: url.to_string(),
                    },
                );
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |webview, payload| {
            if restoring_tab_session && payload.url().as_str() == "about:blank" { return; }
            #[cfg(any(target_os = "macos", windows))]
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) { super::browser_session_storage::clear(&webview); }
            let locked = page_app.state::<BrowserSessionState>().sessions.lock().ok().and_then(|sessions|sessions.get(&page_id).map(|session|session.agent_input_locked)).unwrap_or(false);
            let _ = apply_agent_input_lock(&webview,locked);
            let _ = apply_browser_pointer_tracking(
                &webview,
                renderer(webview.window().label()).tracking,
            );
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                if let Some(state) = page_app.try_state::<BrowserSessionState>() {
                    if let Ok(mut sessions) = state.sessions.lock() {
                        if let Some(session) = sessions.get_mut(&page_id) {
                            session.element_targets.clear();
                        }
                    }
                    let _ = apply_shortcuts(&webview, &state);
                }
            }
            let phase = match payload.event() {
                tauri::webview::PageLoadEvent::Started => "started",
                tauri::webview::PageLoadEvent::Finished => "finished",
            };
            let _ = webview.eval(browser_status_update_script(&json!({ "loading": phase == "started" })));
            let _ = page_app.emit(
                "misty://browser-page",
                BrowserPageEvent {
                    id: page_id.clone(),
                    url: payload.url().to_string(),
                    phase,
                },
            );
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                apply_page_zoom_policy(&webview, &page_app, &page_id);
                let _ = webview.eval("window.__MISTY_REPORT_BACKGROUND__?.()");
                request_browser_favicon(&webview, &page_app, &page_id);
                request_browser_compatibility(&webview, &page_app, &page_id);
            }
        })
        .on_document_title_changed(move |webview, title| {
            let _ = title_app.emit(
                "misty://browser-title",
                BrowserTitleEvent {
                    id: title_id.clone(),
                    title,
                },
            );
            request_browser_favicon(&webview, &title_app, &title_id);
            request_browser_compatibility(&webview, &title_app, &title_id);
        })
        .on_download(move |_webview, event| {
            handle_download_event(&download_app, &download_id, event)
        });
    let webview = window
        .add_child(builder, position, size)
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    focus_messages::install(&app, &webview, &request.id)?;
    #[cfg(target_os = "macos")]
    attachment_download::install(&webview)?;
    #[cfg(any(target_os = "macos", windows))]
    if let Some(values) = &profile_lease.tab_session {
        let url = external_url(&request.url)?;
        if let Err(error) = super::browser_session_storage::install(&webview, &url.origin().ascii_serialization(), values).await {
            let _ = webview.close();
            return Err(error);
        }
        webview.navigate(url).map_err(|_| "Could not open restored tab")?;
    }
    configure_browser_frame_rate(&webview)?;
    apply_macos_webview_theme(&webview, &request.theme)?;
    configure_browser_webview(&webview, request.native_live_resize)?;
    apply_shortcuts(&webview, &state)?;
    webview.set_zoom(1.0).map_err(|error| error.to_string())?;
    set_webview_bounds_if_changed(&app, &webview, position, size)?;
    present_macos_webview(&webview)
}

fn forward_focus_navigation(app: &AppHandle, id: &str, url: &Url) -> bool {
    if url.scheme() != "misty-focus" {
        return false;
    }
    let token = url
        .query_pairs()
        .find_map(|(key, value)| (key == "token").then(|| value.into_owned()))
        .unwrap_or_default();
    let trusted = app
        .try_state::<BrowserSessionState>()
        .map(|state| shortcut_token_matches(&state, id, &token))
        .unwrap_or(false);
    if trusted {
        let _ = app.emit_to(
            browser_owner_label(app,id),
            "misty://browser-focus",
            BrowserFocusEvent { id: id.to_owned() },
        );
    }
    true
}

fn forward_companion_navigation(app: &AppHandle, id: &str, url: &Url) -> bool {
    if url.scheme() != "misty-companion" {
        return false;
    }
    let values = url.query_pairs().collect::<HashMap<_, _>>();
    let value = |key: &str| values.get(key).map(|value| value.as_ref()).unwrap_or("");
    let trusted = app
        .try_state::<BrowserSessionState>()
        .map(|state| shortcut_token_matches(&state, id, value("token")))
        .unwrap_or(false);
    if !trusted {
        return true;
    }
    let number = |key: &str| value(key).parse::<f64>().unwrap_or(0.0);
    let kind = url.path().trim_start_matches('/').to_owned();
    if !matches!(kind.as_str(), "submit" | "action" | "capture") {
        return true;
    }
    let _ = app.emit_to(
        browser_owner_label(app,id),
        "misty://browser-companion",
        BrowserCompanionEvent {
            id: id.to_owned(),
            kind,
            prompt: value("prompt").chars().take(32 << 10).collect(),
            action_id: value("action").chars().take(200).collect(),
            x: number("x"),
            y: number("y"),
            width: number("width"),
            height: number("height"),
        },
    );
    true
}

fn request_browser_favicon(webview: &Webview, app: &AppHandle, id: &str) {
    let favicon_app = app.clone();
    let favicon_id = id.to_owned();
    let _ = webview.eval_with_callback(BROWSER_FAVICON_SCRIPT, move |value| {
        let Ok(Some(candidate)) = serde_json::from_str::<Option<String>>(&value) else {
            return;
        };
        let Some(url) = validated_favicon_url(&candidate) else {
            return;
        };
        let _ = favicon_app.emit(
            "misty://browser-favicon",
            BrowserFaviconEvent {
                id: favicon_id.clone(),
                url,
            },
        );
    });
}

fn request_browser_compatibility(webview: &Webview, app: &AppHandle, id: &str) {
    let compatibility_app = app.clone();
    let compatibility_id = id.to_owned();
    let _ = webview.eval_with_callback(BROWSER_COMPATIBILITY_SCRIPT, move |value| {
        let Ok(Some(probe)) = serde_json::from_str::<Option<BrowserCompatibilityProbe>>(&value)
        else {
            return;
        };
        if probe.kind != "cloudflare_challenge" || external_url(&probe.url).is_err() {
            return;
        }
        let _ = compatibility_app.emit(
            "misty://browser-compatibility",
            BrowserCompatibilityEvent {
                id: compatibility_id.clone(),
                kind: probe.kind,
                url: probe.url,
            },
        );
    });
}

fn validated_favicon_url(value: &str) -> Option<String> {
    if value.len() > 2_048 {
        return None;
    }
    let url = Url::parse(value).ok()?;
    matches!(url.scheme(), "http" | "https").then(|| url.to_string())
}

fn handle_download_event(app: &AppHandle, tab_id: &str, event: DownloadEvent<'_>) -> bool {
    let Some(state) = app.try_state::<BrowserSessionState>() else {
        return false;
    };
    match event {
        DownloadEvent::Requested { url, destination } => {
            let agent_download = state.sessions.lock().ok().and_then(|sessions| {
                sessions.get(tab_id).and_then(|session| session.pending_agent_download.as_ref())
                    .map(|pending| pending.expires_at > Utc::now())
            }).unwrap_or(false);
            let Some(download_dir) = browser_download_directory(app, agent_download) else {
                emit_download_failure(
                    app,
                    &state,
                    tab_id,
                    &url,
                    "The download destination is unavailable.",
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
            #[cfg(target_os = "macos")]
            let path = if !agent_download && ask_download_location() {
                if let Ok(mut reserved) = state.reserved_downloads.lock() {
                    reserved.remove(&path);
                }
                let Some(chosen) = super::browser_macos::ask_download_destination(&path) else {
                    return false;
                };
                // The save panel already confirmed replacing an existing file,
                // and WebKit will not write over one.
                if chosen.is_file() {
                    let _ = std::fs::remove_file(&chosen);
                }
                if let Ok(mut reserved) = state.reserved_downloads.lock() {
                    reserved.insert(chosen.clone());
                }
                chosen
            } else {
                path
            };
            *destination = path.clone();
            let record = requested_download(&state, tab_id, &url, &path);
            if record.initiator == "human" && !tab_is_private(&state, tab_id) {
                super::browser_library::download_started(app, &record.download_id, &record.url, &path);
            }
            let _ = app.emit_to(browser_owner_label(app,tab_id),"misty://browser-download", record);
            true
        }
        DownloadEvent::Finished { url, path, success } => {
            let record = finish_download(&state, tab_id, &url, path.as_deref(), success);
            if record.initiator == "human" {
                super::browser_library::download_finished(
                    app,
                    &record.download_id,
                    record.success,
                    record.error.as_deref(),
                );
            }
            let _ = app.emit_to(browser_owner_label(app,tab_id),"misty://browser-download", record);
            true
        }
        _ => true,
    }
}

fn tab_is_private(state: &BrowserSessionState, tab_id: &str) -> bool {
    state
        .sessions
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(tab_id).map(|session| session.private))
        .unwrap_or(false)
}

fn browser_download_directory(app: &AppHandle, agent_download: bool) -> Option<PathBuf> {
    #[cfg(all(debug_assertions, target_os = "macos"))]
    if let Some(directories) = app.try_state::<BrowserProbeDirectories>() {
        return Some(directories.downloads.clone());
    }
    // Agent outputs are task intermediates for verified upload, not user-managed
    // downloads. Keep them in the app's cache rather than requiring macOS access
    // to the user's protected Downloads folder from a WKDownload callback.
    if agent_download {
        return app.path().app_cache_dir().ok().map(|path| path.join("agent-downloads"));
    }

    {
        let chosen = user_download_directory()
            .lock()
            .ok()
            .and_then(|directory| directory.clone());
        chosen.or_else(|| dirs::download_dir().filter(|path| path.is_absolute()))
    }
}

static ASK_DOWNLOAD_LOCATION: AtomicBool = AtomicBool::new(false);

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn ask_download_location() -> bool {
    ASK_DOWNLOAD_LOCATION.load(Ordering::Relaxed)
}

/// Whether to ask where to save each download (macOS).
#[tauri::command]
pub fn browser_set_download_prompt(enabled: bool) {
    ASK_DOWNLOAD_LOCATION.store(enabled, Ordering::Relaxed);
}

fn user_download_directory() -> &'static Mutex<Option<PathBuf>> {
    static DIRECTORY: OnceLock<Mutex<Option<PathBuf>>> = OnceLock::new();
    DIRECTORY.get_or_init(Mutex::default)
}

/// The folder chosen in Browser settings; empty restores the Downloads folder.
#[tauri::command]
pub fn browser_set_download_directory(directory: String) -> Result<(), String> {
    let path = PathBuf::from(directory.trim());
    let chosen = if directory.trim().is_empty() {
        None
    } else if path.is_absolute() {
        Some(path)
    } else {
        return Err("Choose a folder for downloads.".to_owned());
    };
    *user_download_directory()
        .lock()
        .map_err(|_| "Download settings are unavailable.".to_owned())? = chosen;
    Ok(())
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
        task_id: None,
        file: None,
        error: Some(error.to_owned()),
    };
    super::browser_library::download_failed(app, &record.download_id, &record.url, error);
    if let Ok(mut sessions) = state.sessions.lock() {
        let downloads = &mut sessions.entry(tab_id.to_owned()).or_default().downloads;
        downloads.push(record.clone());
        if downloads.len() > MAX_DOWNLOAD_HISTORY {
            downloads.remove(0);
        }
    }
    let _ = app.emit_to(browser_owner_label(app,tab_id),"misty://browser-download", record);
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
        task_id: pending.as_ref().and_then(|value| value.task_id.clone()),
        file: None,
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
    // Wry's macOS WKDownload delegate returns no path even on success.
    // Recover only our uniquely recorded destination, never guess a filename.
    let pending = {
        let sessions = state.sessions.lock().expect("browser session mutex poisoned");
        let matches = sessions.get(tab_id).map(|session| session.downloads.iter().filter(|item| {
            item.url == url.as_str() && item.state == "requested" &&
                path.is_none_or(|path| Path::new(&item.path) == path)
        }).cloned().collect::<Vec<_>>()).unwrap_or_default();
        if matches.len() == 1 { matches.into_iter().next() } else { None }
    };
    let resolved_path = pending.as_ref().map(|item| Path::new(&item.path));
    let success=success && resolved_path.is_some_and(|path|std::fs::metadata(path).is_ok_and(|meta|meta.is_file()));
    let file = if success { resolved_path.and_then(|path| task_files::fingerprint(path).ok()) } else { None };
    let mut sessions = state
        .sessions
        .lock()
        .expect("browser session mutex poisoned");
    let session = sessions.entry(tab_id.to_owned()).or_default();
    let path_text = resolved_path
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let existing = session
        .downloads
        .iter_mut()
        .rev()
        .find(|item| pending.as_ref().is_some_and(|pending| item.download_id == pending.download_id) && item.state == "requested");
    let record = if let Some(item) = existing {
        item.path = path_text.clone();
        item.state = if success { "finished" } else { "failed" }.to_owned();
        item.success = success;
        item.file = file;
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
            task_id: None,
            file: None,
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
    configure_browser_webview(&webview, request.native_live_resize)?;
    set_webview_bounds_if_changed(&app, &webview, position, size)
}

#[tauri::command]
pub async fn browser_webview_capture_region(
    app: AppHandle,
    request: BrowserCaptureRegionRequest,
) -> Result<Value, String> {
    if !request.x.is_finite()
        || !request.y.is_finite()
        || !request.width.is_finite()
        || !request.height.is_finite()
        || request.x < 0.0
        || request.y < 0.0
        || request.width < 8.0
        || request.height < 8.0
        || request.width > 10_000.0
        || request.height > 10_000.0
    {
        return Err("Capture region is invalid.".to_owned());
    }
    let webview = app
        .get_webview(&webview_label(&request.id)?)
        .ok_or_else(|| "Browser page is unavailable.".to_owned())?;
    #[cfg(target_os = "macos")]
    {
        // Hide only Misty's overlay; WebKit captures the actual rendered page.
        evaluate_browser_async_javascript(webview.clone(), "const e = document.getElementById('misty-native-companion'); if (e) { e.dataset.mistyCaptureDisplay = e.style.display; e.style.display = 'none'; } return '';".into()).await?;
        let result = super::browser_macos::capture_webview_region(webview.clone(), request.x, request.y, request.width, request.height).await;
        let _ = evaluate_browser_async_javascript(webview, "const e = document.getElementById('misty-native-companion'); if (e) { e.style.display = e.dataset.mistyCaptureDisplay || ''; delete e.dataset.mistyCaptureDisplay; } return '';".into()).await;
        result
    }
    #[cfg(not(target_os = "macos"))]
    {
    let options = json!({
        "x": request.x,
        "y": request.y,
        "width": request.width,
        "height": request.height,
    });
    let script = format!(
        "{}\nconst region = {}; const companion = document.getElementById('misty-native-companion'); const display = companion?.style.display; if (companion) companion.style.display = 'none'; try {{ const source = await window.html2canvas(document.documentElement, {{ x: region.x + scrollX, y: region.y + scrollY, width: region.width, height: region.height, scale: Math.min(2, 1280 / Math.max(region.width, region.height)), useCORS: true, logging: false }}); const ratio = Math.min(1, 1280 / Math.max(source.width, source.height)); const output = document.createElement('canvas'); output.width = Math.max(1, Math.round(source.width * ratio)); output.height = Math.max(1, Math.round(source.height * ratio)); output.getContext('2d').drawImage(source, 0, 0, output.width, output.height); return JSON.stringify({{ dataUrl: output.toDataURL('image/jpeg', .82), width: output.width, height: output.height }}); }} catch (error) {{ return JSON.stringify({{ error: String(error) }}); }} finally {{ if (companion) companion.style.display = display || 'block'; }}",
        HTML2CANVAS_SOURCE,
        serde_json::to_string(&options).map_err(|error| error.to_string())?,
    );
    let serialized = evaluate_browser_async_javascript(webview, script).await?;
    let value: Value = serde_json::from_str(&serialized)
        .map_err(|error| format!("Browser page returned invalid capture data: {error}"))?;
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(format!("Browser capture failed: {error}"));
    }
    Ok(value)
    }
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
    configure_browser_webview(&webview, request.native_live_resize)?;
    set_webview_bounds_if_changed(&app, &webview, position, size)?;
    // Reconciliation owns geometry, visibility, and sibling order so a stale
    // frontend cache cannot leave the page detached from its Browser host.
    present_macos_webview(&webview)?;
    Ok(true)
}

#[tauri::command]
pub fn browser_webview_navigate(
    app: AppHandle,
    request: BrowserNavigateRequest,
) -> Result<(), String> {
    let url = external_url(&request.url)?;
    let state = app.state::<BrowserSessionState>();
    {
        let mut sessions = state.sessions.lock().map_err(|_| "Browser session is unavailable.")?;
        let session = sessions.get_mut(&request.id).ok_or("Browser session is unavailable.")?;
        session.oauth_callback = request.oauth_callback.map(|callback| (callback, std::time::Instant::now()));
    }
    with_webview(&app, &request.id, |webview| {
        webview.navigate(url).map_err(|e| e.to_string())
    })
}

/// Compatibility command for older clients. Remote pages own their presentation.
/// Remove any layer left by an earlier client instead of injecting page styling.
#[tauri::command]
pub fn browser_webview_set_pane_dim(app: AppHandle, id: String, strength: f64, indicator: Option<String>) -> Result<(), String> {
    let _ = (strength, indicator);
    with_webview(&app, &id, |webview| {
        webview.eval("document.getElementById('__misty_pane_dim__')?.remove();")
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub fn browser_webview_set_theme(
    caller:Webview,
    app: AppHandle,
    request: BrowserThemeRequest,
) -> Result<(), String> {
    let window=caller.window();
    window
        .set_theme(browser_theme(&request.theme)?)
        .map_err(|error| error.to_string())?;
    for (label, webview) in app.webviews() {
        if label.starts_with("misty-browser-") && webview.window().label()==window.label() {
            // Update reused views as well as newly created ones. A transparent
            // document must not inherit Misty's dark toolbar canvas.
            webview.set_background_color(Some(browser_background(&request.theme)))
                .map_err(|error| error.to_string())?;
            webview.eval("document.getElementById('__misty_pane_dim__')?.remove();")
                .map_err(|error| error.to_string())?;
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

fn apply_page_zoom_policy(webview: &Webview, app: &AppHandle, id: &str) {
    let factor = app.state::<BrowserSessionState>().sessions.lock().ok()
        .and_then(|sessions| sessions.get(id).and_then(|session| session.zoom_factor)).unwrap_or(1.0);
    let _ = webview.set_zoom(factor);
}

#[tauri::command]
pub fn browser_webview_set_zoom(
    app: AppHandle,
    request: BrowserZoomRequest,
) -> Result<(), String> {
    if !request.factor.is_finite() || !(0.25..=5.0).contains(&request.factor) {
        return Err("Page zoom must be between 25% and 500%.".into());
    }
    with_webview(&app, &request.id, |webview| {
        webview.set_zoom(request.factor).map_err(|error| error.to_string())?;
        if let Some(session) = app.state::<BrowserSessionState>().sessions.lock()
            .map_err(|_| "Browser state is unavailable.")?.get_mut(&request.id) {
            session.zoom_factor = Some(request.factor);
        }
        Ok(())
    })
}

#[tauri::command]
pub fn browser_webview_reload(
    app: AppHandle,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    with_webview(&app, &request.id, |webview| {
        reload_browser_webview(&webview)
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
pub fn browser_webviews_set_overlay_active(caller:Webview, app: AppHandle, active: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        remember_main_macos_webview(&app,caller.window().label())?;
        if let Ok(mut map)=renderers().lock(){map.entry(caller.window().label().to_owned()).or_default().overlay=active;}
        let mut errors = Vec::new();
        for (label, webview) in app.webviews() {
            if label.starts_with("misty-browser-") && webview.window().label() == caller.window().label() {
                if let Err(error) = position_macos_webview(&webview, false) {
                    errors.push(error);
                }
            }
        }
        return if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        };
    }
    #[cfg(windows)]
    {
        remember_main_macos_webview(&app,caller.window().label())?;
        if let Ok(mut map)=renderers().lock(){map.entry(caller.window().label().to_owned()).or_default().overlay=active;}
        let mut errors = Vec::new();
        for (label, webview) in app.webviews() {
            if label.starts_with("misty-browser-") && webview.window().label()==caller.window().label() {
                if let Err(error) = position_windows_webview(&webview, false, active) {
                    errors.push(error);
                }
            }
        }
        return if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        };
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        // WebKitGTK does not expose sibling z-order through Tauri. Park
        // external pages while renderer-owned popovers are open; the frontend
        // reconciles the active page when the overlay closes.
        if active {
            browser_webviews_hide_all(caller,app)
        } else {
            Ok(())
        }
    }
}

#[tauri::command]
pub fn browser_webviews_set_pointer_tracking(caller:Webview, app: AppHandle, enabled: bool) -> Result<(), String> {
    if let Ok(mut map)=renderers().lock(){map.entry(caller.window().label().to_owned()).or_default().tracking=enabled;}
    let mut errors = Vec::new();
    for (label, webview) in app.webviews() {
        if label.starts_with("misty-browser-") && webview.window().label()==caller.window().label() {
            if let Err(error) = apply_browser_pointer_tracking(&webview, enabled) {
                errors.push(error);
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

/// Shows or hides the hovered-link and loading bubble in every browser page.
#[tauri::command]
pub fn browser_webviews_set_status_bubble(app: AppHandle, enabled: bool) -> Result<(), String> {
    set_status_bubble_enabled(enabled);
    let script = browser_status_update_script(&json!({ "enabled": enabled }));
    for (label, webview) in app.webviews() {
        if label.starts_with("misty-browser-") {
            let _ = webview.eval(&script);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn browser_webviews_set_companion(
    app: AppHandle,
    request: BrowserCompanionStateRequest,
) -> Result<(), String> {
    let mut errors = Vec::new();
    for (label, webview) in app.webviews() {
        if !label.starts_with("misty-browser-") {
            continue;
        }
        let runtime_id = label.trim_start_matches("misty-browser-");
        let mut state = serde_json::to_value(&request).map_err(|error| error.to_string())?;
        state["visible"] = Value::Bool(request.visible && runtime_id == request.target_id);
        let script = format!(
            "window.__MISTY_SET_COMPANION__?.({});",
            serde_json::to_string(&state).map_err(|error| error.to_string())?
        );
        if let Err(error) = webview.eval(&script) {
            errors.push(error.to_string());
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
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
    webview.hide().map_err(|error| error.to_string())?;
    refresh_browser_cursor_ownership(&webview)
}

#[tauri::command]
pub fn browser_webviews_hide_all(caller:Webview, app: AppHandle) -> Result<(), String> {
    let mut errors = Vec::new();
    for (label, webview) in app.webviews() {
        if label.starts_with("misty-browser-") && webview.window().label() == caller.window().label() {
            if let Err(error) = webview
                .hide()
                .map_err(|error| error.to_string())
                .and_then(|()| refresh_browser_cursor_ownership(&webview))
            {
                errors.push(error);
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
pub fn browser_webviews_park_all(caller:Webview, app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        remember_main_macos_webview(&app,caller.window().label())?;
        let mut errors = Vec::new();
        for (label, webview) in app.webviews() {
            if label.starts_with("misty-browser-") && webview.window().label()==caller.window().label() {
                // Keep the live page composited directly beneath the app
                // renderer while another workspace tab is active. Returning
                // to Browser can then reveal it without a hide/show gap.
                if let Err(error) = position_windows_webview(&webview, true, true) {
                    errors.push(error);
                }
            }
        }
        return if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        };
    }
    #[cfg(not(windows))]
    {
        browser_webviews_hide_all(caller,app)
    }
}

/// Caller holds the browser lifecycle write lease. Enumerate real native views
/// as well as registered sessions so failed/partial creation is also closed.
pub(super) fn close_account_views(app: &AppHandle) -> Result<(), String> {
    close_account_views_except(app, None)
}

/// A restored, quiescent staging view must survive closure of the old live
/// profile until its activation receipt is committed. Caller holds write lease.
pub(super) fn close_account_views_except(app: &AppHandle, keep_label: Option<&str>) -> Result<(), String> {
    let state = app.state::<BrowserSessionState>();
    let mut ids: HashSet<String> = state.sessions.lock()
        .map_err(|_| "Browser state is unavailable.")?.keys().cloned().collect();
    ids.extend(app.webviews().keys().filter_map(|label| label.strip_prefix("misty-browser-").map(str::to_owned)));
    for id in ids {
        if keep_label == Some(format!("misty-browser-{id}").as_str()) || (keep_label.is_some() && id.starts_with("storage-")) { continue; }
        browser_webview_close(app.clone(), app.state::<BrowserSessionState>(), BrowserWebviewIdRequest { id })?;
    }
    Ok(())
}

#[tauri::command]
pub fn browser_webview_close(
    app: AppHandle,
    state: State<'_, BrowserSessionState>,
    request: BrowserWebviewIdRequest,
) -> Result<(), String> {
    let (children, private_session_ended) = {
        let mut sessions = state.sessions.lock().map_err(|_| "Browser state is unavailable.")?;
        let closed_private = sessions.remove(&request.id).is_some_and(|session| session.private);
        let private_session_ended =
            closed_private && !sessions.values().any(|session| session.private);
        let children = sessions
            .iter()
            .filter(|(_, session)| session.popup_parent.as_deref() == Some(&request.id))
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        (children, private_session_ended)
    };
    for id in children {
        browser_webview_close(app.clone(), app.state::<BrowserSessionState>(), BrowserWebviewIdRequest { id })?;
    }
    #[cfg(target_os = "macos")]
    popups::forget_close_handler(&request.id);
    #[cfg(target_os = "macos")]
    focus_messages::forget(&request.id);
    if let Ok(mut pending) = state.pending_popups.lock() { pending.remove(&request.id); }
    if let Some(staging) = app.get_window(&webview_label(&request.id)?) {
        let _ = staging.destroy();
    }
    forget_shortcut_token(&state, &request.id);
    // The last private tab closed: the next one starts with no cookies or data.
    #[cfg(target_os = "macos")]
    if private_session_ended {
        let _ = app.run_on_main_thread(wry::reset_private_data_store);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = private_session_ended;
    let Some(webview) = app.get_webview(&webview_label(&request.id)?) else {
        return Ok(());
    };
    #[cfg(any(target_os = "macos", windows))]
    super::browser_session_storage::clear(&webview);
    unregister_browser_cursor_ownership(&webview)?;
    webview.close().map_err(|error| error.to_string())?;
    Ok(())
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

pub(super) fn revoke_execution_grant(state: &BrowserSessionState, scope: &str, grant: &str) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|_| "Browser state is unavailable.")?;
    for session in sessions.values_mut().filter(|session| session.scope_id == scope) {
        session.grants.remove(grant);
    }
    Ok(())
}

fn is_browser_capability(value: &str) -> bool {
    matches!(
        value,
        "browser.workspace.visual" | "browser.workspace.interact" | "browser.inspect" | "browser.visual" | "browser.navigate" | "browser.click" | "browser.type" | "browser.request" | "browser.interact" | "browser.upload" | "browser.downloads.list"
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
    super::agent_workspace::authorize_scope(&app,&request.scope_id,&request.agent_id,request.input.get("__mistyTaskId").and_then(Value::as_str).unwrap_or(""))?;
    let (id, agent_id) = resolve_agent_webview(&app, &state, &request)?;
    if request.operation.starts_with("browser.workspace.") {
        return super::workspace_autopilot::execute(&app,&request).await;
    }
    if matches!(request.operation.as_str(), "browser.click" | "browser.type" | "browser.interact" | "browser.upload" | "browser.request") {
        let url = app.get_webview(&webview_label(&id)?).ok_or("Browser tab is not running.")?.url().map_err(|error| error.to_string())?;
        let sessions = state.sessions.lock().map_err(|_| "Browser state is unavailable.")?;
        let target = sessions.get(&id).map(|session| browser_target_observation(session, &url)).ok_or("Browser tab is not running.")?;
        if target["authentication"] == "required" {
            return Err("browser_authentication_required: complete sign-in in the original browser before continuing".into());
        }
    }
    if request.input.get("__mistyTaskId").and_then(Value::as_str).is_some_and(|id|!id.is_empty()){
      let _=app.emit_to(browser_owner_label(&app,&id),"misty://agent-target",json!({"id":id}));
    }
    match request.operation.as_str() {
        "browser.inspect" => inspect_browser(&app, &state, &id, &request).await,
        "browser.visual" => {
            let mut observed=inspect_browser(&app,&state,&id,&request).await?;
            if observed["target"]["authentication"]=="required"{return Ok(observed)}
            #[cfg(any(target_os="macos",windows))]
            if let Some(captures)=super::cursor_companion::task_visual(&app,request.input.get("__mistyTaskId").and_then(Value::as_str).unwrap_or("")).await? {
                observed["displayCaptures"]=json!(captures);
                return Ok(observed);
            }
            let view=app.get_webview(&webview_label(&id)?).ok_or("browser_context_closed")?;
            view.show().map_err(|e|e.to_string())?;
            let size=view.size().map_err(|e|e.to_string())?.to_logical::<f64>(view.window().scale_factor().map_err(|e|e.to_string())?);
            #[cfg(target_os="macos")]
            let capture=super::browser_macos::capture_webview_region(view,0.0,0.0,size.width,size.height).await?;
            #[cfg(windows)]
            let capture=super::browser_capture_windows::capture(view).await?;
            #[cfg(not(any(target_os="macos",windows)))]
            let capture:Value=return Err("Visual browser inspection requires macOS or Windows".into());
            observed["image"]=capture;
            observed["viewport"]=json!({"width":size.width,"height":size.height});
            Ok(observed)
        },
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
        "browser.type" => {
            let target = {
                let sessions = state.sessions.lock().map_err(|_| "Browser state is unavailable.")?;
                sessions.get(&id).and_then(|session| request.input.get("elementRef").and_then(Value::as_str).and_then(|key| session.element_targets.get(key))).cloned()
                    .ok_or("The page changed; inspect it again before typing.")?
            };
            let text = request.input.get("text").and_then(Value::as_str).filter(|text| text.len() <= 80000).ok_or("Draft text is missing or too long.")?;
            let script = format!("({})({}, {})", include_str!("browser_inspection_type.js"), serde_json::to_string(&target).unwrap(), serde_json::to_string(text).unwrap());
            let result = eval_json(app.get_webview(&webview_label(&id)?).ok_or("Browser tab is not running.")?, script).await?;
            resolve_agent_webview(&app, &state, &request)?;
            if result.get("ok").and_then(Value::as_bool) != Some(true) {
        if result.get("errorCode").and_then(Value::as_str) == Some("browser_snapshot_stale") { return Err("browser_snapshot_stale: inspected content changed before dispatch".into()); } return Err(result.get("error").and_then(Value::as_str).unwrap_or("Draft preparation failed.").into()); }
            if let Some(session) = state.sessions.lock().map_err(|_| "Browser state is unavailable.")?.get_mut(&id) { session.element_targets.clear(); }
            Ok(json!({"prepared": true}))
        }
        "browser.request" => {
            let origin = request.input.get("origin").and_then(Value::as_str).ok_or("Provider origin required.")?;
            let path = request.input.get("path").and_then(Value::as_str).filter(|path| path.starts_with('/') && !path.starts_with("//") && path.len() <= 2048).ok_or("A relative provider path is required.")?;
            {
                let sessions = state.sessions.lock().map_err(|_| "Browser state is unavailable.")?;
                let provider = sessions.get(&id).and_then(|session| session.provider_id.as_deref()).ok_or("Requests require an active provider view.")?;
                if !super::browser_provider::allows(provider, &external_url(origin)?) { return Err("Provider origin mismatch.".into()); }
            }
            #[cfg(target_os = "macos")]
            {
                let script = format!("const origin = {}; const path = {}; {}", serde_json::to_string(origin).unwrap(), serde_json::to_string(path).unwrap(), include_str!("browser_provider_request.js"));
                let raw = super::browser_macos::evaluate_browser_async_javascript(app.get_webview(&webview_label(&id)?).ok_or("Browser tab is not running.")?, script).await?;
                resolve_agent_webview(&app, &state, &request)?;
                serde_json::from_str(&raw).map_err(|_| "Invalid provider response.".into())
            }
            #[cfg(not(target_os = "macos"))]
            { Err("Provider requests require macOS.".into()) }
        }
        "browser.upload" => upload_browser(&app,&state,&id,&request).await,
        "browser.interact" => interact_browser(&app, &state, &id, &request).await,
        "browser.downloads.list" => {
            let task = request.input.get("__mistyTaskId").and_then(Value::as_str).filter(|id| !id.is_empty());
            let sessions = state
                .sessions
                .lock()
                .map_err(|_| "Browser state is unavailable.")?;
            let downloads = sessions
                .get(&id)
                .map(|session| session.downloads.iter().filter(|item| task.is_none_or(|task| item.task_id.as_deref() == Some(task))).cloned().collect::<Vec<_>>())
                .unwrap_or_default();
            Ok(json!({"sourceScopeId": request.scope_id, "downloads": downloads}))
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
    let webview = app.get_webview(&webview_label(id)?).ok_or("Browser tab is not running.")?;
    let observed_url = webview.url().map_err(|error| error.to_string())?;
    let target = {
        let sessions = state.sessions.lock().map_err(|_| "Browser state is unavailable.")?;
        let session = sessions.get(id).ok_or("Browser tab is not running.")?;
        browser_target_observation(session, &observed_url)
    };
    if target["authentication"] == "required" {
        if let Some(session) = state.sessions.lock().map_err(|_| "Browser state is unavailable.")?.get_mut(id) { session.element_targets.clear(); }
        let mut safe_url = observed_url.clone();
        safe_url.set_query(None); safe_url.set_fragment(None);
        return Ok(json!({"documentId":uuid::Uuid::new_v4().to_string(),"url":safe_url.to_string(),"title":"Sign-in required","text":"Complete sign-in in the original browser. Request user action before continuing.","truncated":true,"interactive":[],"contentTrust":"untrusted-web-page","target":target}));
    }
    let document_id = uuid::Uuid::new_v4().to_string();
    let nonce = serde_json::to_string(&document_id).map_err(|error| error.to_string())?;
    let script = format!(
        "({})({nonce}, {MAX_SNAPSHOT_CHARS}, {MAX_INTERACTIVE_ELEMENTS}, ({}))",
        include_str!("browser_inspection_snapshot.js"), include_str!("browser_semantic_snapshot.js")
    );
    let raw = eval_json(
        app.get_webview(&webview_label(id)?)
            .ok_or_else(|| "Browser tab is not running.".to_owned())?,
        script,
    )
    .await?;
    if webview.url().map_err(|error| error.to_string())? != observed_url {
        return Err("browser_document_changed: inspect the current page again".into());
    }
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
    if !grant.capabilities.contains("browser.inspect") && !grant.capabilities.contains("browser.visual") {
        return Err("Browser inspection is not granted.".to_owned());
    }
    let interactive = replace_snapshot_targets(session, snapshot.interactive);
    Ok(json!({
        "documentId": document_id,
        "url": observed_url.to_string(), "title": snapshot.title, "text": snapshot.text,
        "truncated": snapshot.truncated, "interactive": interactive, "semantic": snapshot.semantic,
        "contentTrust": "untrusted-web-page", "target":target
    }))
}

fn browser_target_observation(session: &BrowserSession, url: &url::Url) -> Value {
    let provider = session.profile_provider.as_deref().or(session.provider_id.as_deref());
    let callback_page = session.oauth_callback.as_ref().is_some_and(|(callback, _)| {
        url::Url::parse(&callback.url).is_ok_and(|expected| expected.origin() == url.origin() && expected.path() == url.path())
    });
    let required = callback_page || super::browser_provider::authentication_required(provider, url);
    let mut target = json!({"scopeId":session.scope_id,"origin":url.origin().ascii_serialization(),"authentication":if required {"required"} else {"unknown"},"accountIdentity":"unverified","trust":"host-observation","observedAt":Utc::now().to_rfc3339()});
    if let Some(profile) = session.context_profile_id() {target["profileId"] = json!(profile);}
    if let Some(provider) = provider {target["providerId"] = json!(provider);}
    target
}

fn replace_snapshot_targets(
    session: &mut BrowserSession,
    elements: Vec<RawInteractiveElement>,
) -> Vec<Value> {
    session.snapshot_generation = session.snapshot_generation.wrapping_add(1);
    session.element_targets.clear();
    let generation = session.snapshot_generation;
    elements
        .into_iter()
        .enumerate()
        .map(|(index, element)| {
            let element_ref = format!("element-{generation}-{index}");
            session
                .element_targets
                .insert(element_ref.clone(), element.target);
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
    let (target, existing_download_ids) = {
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
            .element_targets
            .get(element_ref)
            .cloned()
            .ok_or_else(|| "The page changed; inspect it again before clicking.".to_owned())?;
        if expect_download {
            session.pending_agent_download = Some(PendingAgentDownload {
                grant_id: request.grant_id.clone(),
                agent_id: agent_id.to_owned(),
                task_id: request.input.get("__mistyTaskId").and_then(Value::as_str).filter(|id| !id.is_empty()).map(str::to_owned),
                expires_at: Utc::now() + chrono::Duration::seconds(AGENT_DOWNLOAD_WINDOW_SECONDS),
                popup_id: None,
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
    let encoded_target = serde_json::to_string(&target).map_err(|error| error.to_string())?;
    let script = format!(
        "({})({encoded_target})",
        include_str!("browser_inspection_click.js")
    );
    let result = eval_json(
        app.get_webview(&webview_label(id)?)
            .ok_or_else(|| "Browser tab is not running.".to_owned())?,
        script,
    )
    .await?;
    if result.get("ok").and_then(Value::as_bool) != Some(true) {
        if result.get("errorCode").and_then(Value::as_str) == Some("browser_snapshot_stale") { return Err("browser_snapshot_stale: inspected content changed before dispatch".into()); }
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
            "sourceScopeId": request.scope_id,
            "download": download
        }));
    }
    Ok(json!({"ok": true, "elementRef": element_ref, "expectDownload": false}))
}

async fn interact_browser(
    app: &AppHandle,
    state: &BrowserSessionState,
    id: &str,
    request: &BrowserAgentExecuteRequest,
) -> Result<Value, String> {
    let action = request.input.get("action").ok_or_else(|| "A browser action is required.".to_owned())?;
    let kind = action.get("kind").and_then(Value::as_str).unwrap_or("");
    if !matches!(kind, "fill" | "select" | "scroll" | "key" | "point") {
        return Err("Unsupported browser interaction.".to_owned());
    }
    let element_ref = action.get("elementRef").and_then(Value::as_str);
    if element_ref.is_none() && kind != "scroll" && kind != "point" {
        return Err("An inspected element reference is required.".to_owned());
    }
    let target = {
        let mut sessions = state.sessions.lock().map_err(|_| "Browser state is unavailable.".to_owned())?;
        let session = sessions.get_mut(id).ok_or_else(|| "Browser tab is not running.".to_owned())?;
        validate_browser_grant(session, request)?;
        let target = match element_ref {
            Some(reference) => Some(session.element_targets.get(reference).cloned().ok_or_else(|| "The page changed; inspect it again.".to_owned())?),
            None => {
                if session.snapshot_generation == 0 { return Err("Inspect the page before scrolling.".to_owned()); }
                None
            }
        };
        session.element_targets.clear();
        target
    };
    let webview = app.get_webview(&webview_label(id)?).ok_or_else(|| "Browser tab is not running.".to_owned())?;
    let origin = webview.url().map_err(|error| error.to_string())?.origin().ascii_serialization();
    let encoded_target = serde_json::to_string(&target).map_err(|error| error.to_string())?;
    let encoded_action = serde_json::to_string(action).map_err(|error| error.to_string())?;
    let encoded_origin = serde_json::to_string(&origin).map_err(|error| error.to_string())?;
    let encoded_document = serde_json::to_string(&request.input.get("documentId")).map_err(|error| error.to_string())?;
    let script = format!("({})({encoded_target}, {encoded_action}, {encoded_origin}, {encoded_document})", include_str!("browser_inspection_interact.js"));
    let result = eval_json(webview, script).await?;
    if result.get("ok").and_then(Value::as_bool) != Some(true) {
        if result.get("errorCode").and_then(Value::as_str) == Some("browser_snapshot_stale") { return Err("browser_snapshot_stale: inspected content changed before dispatch".into()); }
        return Err(result.get("error").and_then(Value::as_str).unwrap_or("Browser interaction failed.").to_owned());
    }
    let mut output = json!({"attempted": true});
    for field in ["textRetained", "websiteEditVerified", "scrolled"] {
        if let Some(value) = result.get(field).and_then(Value::as_bool) {
            output[field] = json!(value);
        }
    }
    Ok(output)
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
    let script = format!("{}\n{}", include_str!("browser_agent_cursor.js"), script);
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
    fn popup_download_requires_exact_live_source_authority() {
        let fixture = || {
            let mut source = BrowserSession::default();
            source.scope_id = "source-scope".into();
            source.grants.insert("grant".into(), BrowserGrant {
                agent_id: "agent".into(), capabilities: ["browser.click".into()].into(),
                expires_at: Utc::now() + chrono::Duration::minutes(1),
            });
            source.pending_agent_download = Some(PendingAgentDownload {
                grant_id: "grant".into(), agent_id: "agent".into(), task_id: Some("task".into()),
                expires_at: Utc::now() + chrono::Duration::seconds(30), popup_id: Some("popup".into()),
            });
            source
        };
        assert_eq!(popup_download_authority(&fixture(), "popup"), Some(("source-scope".into(), "agent".into(), "task".into())));
        assert!(popup_download_authority(&fixture(), "other-popup").is_none());
        for case in 0..6 {
            let mut source = fixture();
            match case {
                0 => source.pending_agent_download = None,
                1 => source.grants.clear(),
                2 => source.pending_agent_download.as_mut().unwrap().expires_at = Utc::now() - chrono::Duration::seconds(1),
                3 => source.grants.get_mut("grant").unwrap().expires_at = Utc::now() - chrono::Duration::seconds(1),
                4 => source.grants.get_mut("grant").unwrap().agent_id = "other-agent".into(),
                _ => source.grants.get_mut("grant").unwrap().capabilities.clear(),
            }
            assert!(popup_download_authority(&source, "popup").is_none(), "case {case}");
        }
    }

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
        // Ordinary browsing can follow federated login redirects; this does not
        // grant the destination provider-specific native or automation access.
        assert!(external_url("https://tenant.identity.example/login").is_ok());
        assert!(external_url("https://user:password@example.com").is_err());
        assert!(external_url("misty-extension://localhost/app.js").is_err());
    }

    #[test]
    fn browser_page_and_renderer_swap_sibling_order_for_overlays() {
        assert!(!browser_child_should_be_below_renderer(false));
        assert!(browser_child_should_be_below_renderer(true));
    }

    #[test]
    fn managed_profile_observations_expose_only_logical_identity() {
        let session = BrowserSession {
            profile_id: Some("b".repeat(64)),
            logical_profile_id: Some("a".repeat(64)),
            ..Default::default()
        };
        let target = browser_target_observation(&session, &Url::parse("https://example.test/").unwrap());
        assert_eq!(target["profileId"], "a".repeat(64));
        assert!(!target.to_string().contains(&"b".repeat(64)));
    }

    #[test]
    fn browser_favicons_accept_only_bounded_web_urls() {
        assert_eq!(
            validated_favicon_url("https://example.com/icon-144.png").as_deref(),
            Some("https://example.com/icon-144.png")
        );
        assert!(validated_favicon_url("data:image/svg+xml,<svg></svg>").is_none());
        assert!(validated_favicon_url("file:///tmp/icon.png").is_none());
        assert!(
            validated_favicon_url(&format!("https://example.com/{}", "x".repeat(2_048))).is_none()
        );
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
        assert!(!request.native_live_resize);
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
    fn macos_download_completion_recovers_the_recorded_destination() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("mockup.png");
        let state = BrowserSessionState::default();
        let url = Url::parse("https://example.test/mockup").unwrap();
        let requested = requested_download(&state,"source",&url,&path);
        std::fs::write(&path,b"\x89PNG\r\n\x1a\nimage").unwrap();
        let finished = finish_download(&state,"source",&url,None,true);
        assert!(finished.success);
        assert_eq!(finished.path, requested.path);
        assert_eq!(finished.download_id, requested.download_id);
        assert!(finished.file.is_some());
        assert!(!finish_download(&state,"source",&url,None,true).success);
    }

    #[test]
    fn download_completion_never_guesses_between_simultaneous_identical_urls() {
        let directory = tempdir().unwrap();
        let state = BrowserSessionState::default();
        let url = Url::parse("https://example.test/mockup").unwrap();
        for name in ["one.png", "two.png"] {
            let path=directory.path().join(name);
            requested_download(&state,"source",&url,&path);
            std::fs::write(&path,b"\x89PNG\r\n\x1a\nimage").unwrap();
        }
        assert!(!finish_download(&state,"source",&url,None,true).success);
        let one=directory.path().join("one.png");
        assert!(finish_download(&state,"source",&url,Some(&one),true).success);
        assert!(finish_download(&state,"source",&url,None,true).success);
    }

    #[test]
    fn browser_capabilities_are_closed_over_known_operations() {
        assert!(is_browser_capability("browser.inspect"));
        assert!(is_browser_capability("browser.type"));
        assert!(is_browser_capability("browser.request"));
        assert!(is_browser_capability("browser.interact"));
        assert!(is_browser_capability("browser.downloads.list"));
        assert!(!is_browser_capability("browser.eval"));
    }

    #[test]
    fn new_snapshots_invalidate_old_element_references() {
        let mut session = BrowserSession::default();
        let first = replace_snapshot_targets(
            &mut session,
            vec![RawInteractiveElement {
                target: "snapshot-a:0".to_owned(),
                tag: "button".to_owned(),
                role: String::new(),
                name: "First".to_owned(),
            }],
        );
        let first_ref = first[0]["ref"].as_str().unwrap().to_owned();
        let second = replace_snapshot_targets(
            &mut session,
            vec![RawInteractiveElement {
                target: "snapshot-b:0".to_owned(),
                tag: "a".to_owned(),
                role: String::new(),
                name: "Second".to_owned(),
            }],
        );
        assert!(!session.element_targets.contains_key(&first_ref));
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

#[tauri::command]
pub fn browser_profile_persistence() -> bool { !browser_requires_ephemeral_store() }

#[path = "browser_profile_cleanup.rs"]
mod profile_cleanup;
#[tauri::command]
pub async fn browser_profile_remove(app: AppHandle, profile_id: String) -> Result<(), String> {
    profile_cleanup::remove(app, profile_id).await
}

#[tauri::command]
pub fn browser_runtime_for_scope(state:State<'_,BrowserSessionState>,scope_id:String)->Result<String,String>{
 let sessions=state.sessions.lock().map_err(|_|"Browser state unavailable")?;
 sessions.iter().find(|(_,session)|session.scope_id==scope_id).map(|(id,_)|id.clone()).ok_or_else(||"browser_context_closed".into())
}

fn apply_agent_input_lock(webview:&Webview,locked:bool)->Result<(),String>{
 if !locked { webview.eval("window[Symbol.for('misty.browser.agent.cursor')]?.hide()").map_err(|e|e.to_string())?; }
 let script=format!("({})({locked})",include_str!("browser_agent_input_guard.js"));
 webview.eval(&script).map_err(|e|e.to_string())
}
#[tauri::command]
pub fn browser_agent_set_locked(caller:Webview,app:AppHandle,state:State<'_,BrowserSessionState>,request:BrowserWebviewIdRequest,locked:bool)->Result<(),String>{
 let view=app.get_webview(&webview_label(&request.id)?).ok_or("browser_context_closed")?;
 if view.window().label()!=caller.window().label(){return Err("browser_window_mismatch".into())}
 if let Some(session)=state.sessions.lock().map_err(|_|"browser_state_unavailable")?.get_mut(&request.id){session.agent_input_locked=locked;}
 apply_agent_input_lock(&view,locked)
}

async fn upload_browser(app:&AppHandle,state:&BrowserSessionState,id:&str,request:&BrowserAgentExecuteRequest)->Result<Value,String>{
 let mut input = request.input.clone();
 if input.get("downloadId").is_some_and(|value| !value.is_null()) {
  input["file"] = task_files::prepare_upload(app, state, request)?;
 }
 let reference=request.input.get("elementRef").and_then(Value::as_str).ok_or("An inspected file input is required.")?;
 let target={let mut sessions=state.sessions.lock().map_err(|_|"browser_state_unavailable")?;
 let session=sessions.get_mut(id).ok_or("browser_context_closed")?;
 let target=session.element_targets.get(reference).cloned().ok_or("browser_snapshot_stale: inspect the file input again")?;
 session.element_targets.clear();target};
 let webview=app.get_webview(&webview_label(id)?).ok_or("browser_context_closed")?;
 let origin=webview.url().map_err(|e|e.to_string())?.origin().ascii_serialization();
 // Reading a file must not extend a revoked task or execution grant.
 super::agent_workspace::authorize_scope(app,&request.scope_id,&request.agent_id,input.get("__mistyTaskId").and_then(Value::as_str).unwrap_or(""))?;
 resolve_agent_webview(app,state,request)?;
 let script=format!("({})({},{},{})",include_str!("browser_inspection_upload.js"),serde_json::to_string(&target).unwrap(),serde_json::to_string(&input).map_err(|e|e.to_string())?,serde_json::to_string(&origin).unwrap());
 let result=eval_json(webview,script).await?;
 if result["ok"]!=true{return Err(result["error"].as_str().unwrap_or("File upload failed").to_owned())}
 Ok(result)
}

pub(super) fn resume_task_downloads(app: &AppHandle, scope: &str, agent: &str, previous: &str, next: &str) -> Result<(), String> {
 let state = app.state::<BrowserSessionState>();
 let mut sessions = state.sessions.lock().map_err(|_| "browser_state_unavailable")?;
 let session = sessions.values_mut().find(|session| session.scope_id == scope).ok_or("browser_context_closed")?;
 task_files::resume_downloads(&mut session.downloads, agent, previous, next);
 // An old delayed download is never attributed to the resumed task.
 session.pending_agent_download = None;
 Ok(())
}

pub(super) fn authorize_workspace_dispatch(app:&AppHandle,scope:&str,agent:&str,grant:&str,task:&str)->Result<(),String> {
    super::agent_workspace::authorize_scope(app,scope,agent,task)?;
    let state=app.state::<BrowserSessionState>();
    let mut sessions=state.sessions.lock().map_err(|_|"Browser state unavailable")?;
    let session=sessions.values_mut().find(|s|s.scope_id==scope).ok_or("Browser scope closed")?;
    let request=BrowserAgentExecuteRequest{scope_id:scope.into(),agent_id:agent.into(),grant_id:grant.into(),operation:"browser.workspace.interact".into(),input:json!({})};
    validate_browser_grant(session,&request)?;
    Ok(())
}

/// Enumerate only registered website views in the actual selected native profile.
#[cfg(any(target_os = "macos", windows))]
pub(super) fn sync_storage_views(app: &AppHandle, physical: &str) -> Result<Vec<(String, Webview)>, String> {
    let state = app.state::<BrowserSessionState>();
    let sessions = state.sessions.lock().map_err(|_| "Browser state is unavailable")?;
    let legacy = super::browser_profile::legacy_profile_identity();
    Ok(sessions.iter().filter(|(_, session)| session.profile_id.as_deref().unwrap_or(&legacy) == physical)
        .filter_map(|(id, session)| webview_label(id).ok().and_then(|label| app.get_webview(&label)).map(|view| (session.workspace_tab_id.clone().unwrap_or_else(|| id.clone()), view))).collect())
}
