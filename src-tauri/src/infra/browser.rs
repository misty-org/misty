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

#[path = "browser_first_paint.rs"]
mod first_paint;
use first_paint::{
    hold_until_first_paint, is_held_id, is_held_view, release_first_paint, PARKED_POSITION,
};
#[path = "browser_native_input.rs"]
mod native_input;

#[path = "browser_task_files.rs"]
mod task_files;

#[path = "browser_download_names.rs"]
mod download_names;
#[cfg(windows)]
#[path = "browser_page_frame_windows.rs"]
mod page_frame;
#[path = "browser_pane_dim.rs"]
pub(crate) mod pane_dim;
use download_names::{reserve_download_path, sanitize_download_name};

#[path = "browser_load_watch.rs"]
mod load_watch;
#[cfg(target_os = "macos")]
#[path = "browser_url_observer.rs"]
mod url_observer;
#[cfg(target_os = "macos")]
use load_watch::emit_navigated;
use load_watch::{next_load_generation, watch_load};
#[path = "browser_host_messages.rs"]
pub(crate) mod host_messages;
pub(super) use host_messages::init as init_host_messages;

#[cfg(target_os = "macos")]
#[path = "browser_click_focus.rs"]
mod click_focus;
#[cfg(target_os = "macos")]
pub(super) use click_focus::install as install_click_focus;
#[cfg(target_os = "macos")]
#[path = "browser_corner_scrollbars.rs"]
mod corner_scrollbars;
#[cfg(target_os = "macos")]
pub(super) use corner_scrollbars::install as install_corner_scrollbars;

#[cfg(target_os = "macos")]
#[path = "browser_attachment_download_macos.rs"]
mod attachment_download;
#[cfg(any(target_os = "macos", windows))]
#[path = "browser_popups.rs"]
mod popups;
#[cfg(any(target_os = "macos", windows))]
use popups::provider_popup;

#[path = "browser_context_menu.rs"]
mod context_menu;
#[cfg(windows)]
#[path = "browser_engine_menu.rs"]
mod engine_menu;
#[cfg(windows)]
#[path = "browser_stacked_pages.rs"]
mod stacked_pages;
#[cfg(windows)]
pub use stacked_pages::browser_webviews_show_only;
#[cfg(windows)]
use stacked_pages::{is_stacked, place_beneath, stack_windows_webview, unstack, wake};

/// Pages switch by stacking order only on Windows; elsewhere the engine shows
/// and hides views in one frame on its own.
#[cfg(not(windows))]
#[tauri::command]
pub fn browser_webviews_show_only() -> Vec<String> {
    Vec::new()
}

#[cfg(all(desktop, debug_assertions))]
#[path = "browser_eval_bridge.rs"]
pub(crate) mod eval_bridge;
#[cfg(all(debug_assertions, target_os = "macos"))]
#[path = "browser_kiri_probe.rs"]
pub(crate) mod kiri_probe;

#[path = "browser_action_confirm.rs"]
pub mod action_confirm;
#[path = "browser_interact.rs"]
mod interact;
#[path = "browser_page/mod.rs"]
mod page_agent;
use interact::interact_browser;
#[path = "browser_page_tools.rs"]
pub(crate) mod page_tools;
pub use page_tools::{
    browser_clear_website_data, browser_webview_developer_tools, browser_webview_find,
    browser_webview_print, browser_webview_save_page, browser_webview_set_muted,
    browser_webview_stop,
};

#[path = "browser_native_views.rs"]
mod native_views;
pub use native_views::*;
#[path = "browser_create.rs"]
mod create;
pub use create::*;
#[path = "browser_downloads.rs"]
mod downloads;
pub use downloads::*;
#[path = "browser_view_ops.rs"]
mod view_ops;
pub use view_ops::*;
#[path = "browser_view_close.rs"]
mod view_close;
pub use view_close::*;
#[path = "browser_agent.rs"]
mod agent;
pub use agent::*;
#[path = "browser_agent_grants.rs"]
mod agent_grants;
pub use agent_grants::*;
#[path = "browser_agent_actions.rs"]
mod agent_actions;
pub use agent_actions::*;
#[path = "browser_agent_support.rs"]
mod agent_support;
pub use agent_support::*;

#[tauri::command]
pub fn browser_context_menu_select(
    app: AppHandle,
    webview: Webview,
    key: String,
    action: String,
) -> Result<(), String> {
    context_menu::select(&app, &webview, &key, &action)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserContextMenuAtRequest {
    pub id: String,
    /// Fractions of the page's width and height.
    pub x: f64,
    pub y: f64,
}

/// Replays a right-click that landed on the renderer while it covered a page.
#[tauri::command]
pub fn browser_webview_context_menu_at(
    caller: Webview,
    app: AppHandle,
    request: BrowserContextMenuAtRequest,
) -> Result<(), String> {
    if caller.label().starts_with("misty-browser-")
        || !request.x.is_finite()
        || !request.y.is_finite()
    {
        return Err("Browser menu is unavailable".into());
    }
    with_webview(&app, &request.id, |webview| {
        if webview.window().label() != caller.window().label() {
            return Err("Browser menu is unavailable".into());
        }
        context_menu::right_click(&webview, request.x, request.y)
    })
}

#[cfg(windows)]
use std::sync::atomic::{AtomicIsize, AtomicU32};

use super::browser_macos::{
    configure_browser_frame_rate, configure_browser_webview, configure_main_webview_pointer_guard,
    evaluate_browser_async_javascript, native_macos_safari_user_agent,
    refresh_browser_cursor_ownership, reload_browser_webview, unregister_browser_cursor_ownership,
};
use super::browser_scripts::{
    browser_captions_script, browser_scrollbar_script, browser_status_script,
    browser_status_update_script, browser_viewport_script, emit_browser_pointer,
    set_status_bubble_enabled, BROWSER_COMPATIBILITY_SCRIPT, BROWSER_FAVICON_SCRIPT,
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
#[derive(Clone, Default)]
struct RendererState {
    native: usize,
    overlay: bool,
    tracking: bool,
    transparent: bool,
}
static RENDERERS: OnceLock<Mutex<HashMap<String, RendererState>>> = OnceLock::new();
fn renderers() -> &'static Mutex<HashMap<String, RendererState>> {
    RENDERERS.get_or_init(Mutex::default)
}
fn renderer(label: &str) -> RendererState {
    renderers()
        .lock()
        .ok()
        .and_then(|map| map.get(label).cloned())
        .unwrap_or_default()
}
/// Activates a page's pane when the page takes focus. WebView2 reports it
/// from the browser process, so a busy or hostile page can't delay or
/// swallow it the way it could a script of its own.
#[cfg(windows)]
fn watch_page_focus(webview: &Webview, id: &str) {
    use webview2_com::FocusChangedEventHandler;
    let app = webview.app_handle().clone();
    let id = id.to_owned();
    let _ = webview.with_webview(move |platform| {
        let handler = FocusChangedEventHandler::create(Box::new(move |_, _| {
            let _ = app.emit_to(
                browser_owner_label(&app, &id),
                "misty://browser-focus",
                BrowserFocusEvent { id: id.clone() },
            );
            Ok(())
        }));
        let mut token = Default::default();
        // SAFETY: the controller is live during this UI-thread callback.
        let _ = unsafe { platform.controller().add_GotFocus(&handler, &mut token) };
    });
}

pub(super) fn browser_owner_label(app: &AppHandle, id: &str) -> String {
    app.get_webview(&format!("misty-browser-{id}"))
        .map(|view| view.window().label().to_owned())
        .or_else(|| crate::infra::space_windows::primary_label(app))
        .unwrap_or_default()
}

/// Where a tab's site permissions live: its profile's store, or its incognito
/// session's.
pub(super) fn session_permission_scope(
    app: &AppHandle,
    id: &str,
) -> Option<kiri::engine::StoreScope> {
    let state = app.try_state::<BrowserSessionState>()?;
    let sessions = state.sessions.lock().ok()?;
    let session = sessions.get(id)?;
    if session.private {
        return Some(kiri::engine::StoreScope::Temporary(0));
    }
    super::browser_site_permissions::profile_key(session.profile_id.as_deref())
        .ok()
        .map(kiri::engine::StoreScope::Persistent)
}

pub struct BrowserSessionState {
    context_menu: Mutex<HashMap<String, context_menu::PendingMenu>>,
    pending_popups: Mutex<HashSet<String>>,
    sessions: Mutex<HashMap<String, BrowserSession>>,
    reserved_downloads: Mutex<HashSet<PathBuf>>,
    pub(super) shortcut_bindings: Mutex<Vec<BrowserShortcutBinding>>,
    pub(super) shortcut_tokens: Mutex<HashMap<String, String>>,
}

impl Default for BrowserSessionState {
    fn default() -> Self {
        Self {
            context_menu: Mutex::default(),
            pending_popups: Mutex::default(),
            sessions: Mutex::default(),
            reserved_downloads: Mutex::default(),
            shortcut_bindings: Mutex::new(super::browser_shortcuts::default_shortcut_bindings()),
            shortcut_tokens: Mutex::default(),
        }
    }
}

#[derive(Default)]
struct BrowserSession {
    agent_input_locked: bool,
    // An agent's tab while its run goes on: the ring stays even when the person has taken it
    // over and the lock is off (docs/design/agent-browser/BRIEF.md).
    agent_ring: bool,
    workspace_tab_id: Option<String>,
    // Native auxiliary windows stay attached to this live integration view.
    popup_parent: Option<String>,
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
    snapshot_extension: Option<String>,
    element_targets: HashMap<String, String>,
    downloads: Vec<BrowserDownload>,
    pending_agent_download: Option<PendingAgentDownload>,
    /// Private tabs keep no download list and share one throwaway data store.
    private: bool,
    /// The agent run a tab works for, when an agent opened it in the person's window
    /// (docs/design/agent-browser/BRIEF.md): the benchmark pictures each run's own tabs.
    agent_run_id: Option<String>,
}

impl BrowserSession {
    fn context_profile_id(&self) -> Option<&str> {
        self.logical_profile_id
            .as_deref()
            .or(self.profile_id.as_deref())
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

#[cfg(any(target_os = "macos", windows, test))]
fn popup_download_authority(
    source: &BrowserSession,
    popup_id: &str,
) -> Option<(String, String, String)> {
    let pending = source.pending_agent_download.as_ref()?;
    let grant = source.grants.get(&pending.grant_id)?;
    let now = Utc::now();
    if pending.popup_id.as_deref() != Some(popup_id)
        || pending.expires_at <= now
        || grant.expires_at <= now
        || grant.agent_id != pending.agent_id
        || !grant.capabilities.contains("browser.click")
    {
        return None;
    }
    Some((
        source.scope_id.clone(),
        pending.agent_id.clone(),
        pending.task_id.clone()?,
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewCreateRequest {
    /// Temporary offscreen Home capture: no media, popups, downloads, or tab events.
    #[serde(default)]
    pub preview_only: bool,
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
    /// The agent run this tab works for, for an agent's own tab.
    #[serde(default)]
    pub agent_run_id: Option<String>,
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
    /// Top-left, top-right, bottom-right and bottom-left radii where the page
    /// meets a rounded workspace corner.
    #[serde(default)]
    pub corner_radii: Option<[f64; 4]>,
    /// The window chrome around those corners, as `#rrggbb`, which smooths
    /// their edge on Windows.
    #[serde(default)]
    pub corner_color: Option<String>,
    /// Places a hidden page beneath the renderer instead of on top (a tab
    /// loaded in the background on Windows), so it waits there drawn.
    #[serde(default)]
    pub beneath: bool,
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
pub struct BrowserWebviewHideRequest {
    pub id: String,
    /// Park the page out of sight instead of hiding it, so it keeps rendering: a video
    /// floating in picture in picture keeps a page to return to, and an agent's own tab
    /// keeps drawing the widgets it reads.
    #[serde(default)]
    pub keep_live: bool,
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
    /// The account's sites agents may not act on, from the job's server config.
    /// Absent means the safe default: sensitive categories blocked.
    #[serde(default)]
    pub site_blocks: Option<page_agent::SiteBlocks>,
    /// The page actions the account asks about first, from the job's server
    /// config. Absent means the safe default: all of them.
    #[serde(default)]
    pub confirm_kinds: Option<Vec<String>>,
    /// The run's Ask or Auto and the person's remembered page grants for this
    /// agent, from the job's server config. Absent means nothing is remembered.
    #[serde(default)]
    pub grant_set: Option<action_confirm::GrantSet>,
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

fn browser_page_origin(url: &Url) -> String {
    if super::extensions::is_extension_url(url) {
        format!(
            "{}://{}",
            super::extensions::EXTENSION_SCHEME,
            url.host_str().unwrap_or_default()
        )
    } else {
        url.origin().ascii_serialization()
    }
}

fn external_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "Enter a valid web address or search.".to_owned())?;
    if url.as_str() == "about:blank"
        || super::extensions::is_extension_url(&url)
        || (matches!(url.scheme(), "http" | "https")
            && url.username().is_empty()
            && url.password().is_none())
    {
        return Ok(url);
    }
    if url.scheme() == super::extensions::EXTENSION_SCHEME {
        return Err("This extension is not running. Enable it in Extensions.".into());
    }
    Err("Misty Browser supports only http and https pages.".to_owned())
}

/// Only the debug integration harness registers this state, before creating views.
#[cfg(all(debug_assertions, target_os = "macos"))]
pub(crate) struct BrowserProbeDirectories {
    pub profiles: PathBuf,
    pub downloads: PathBuf,
}

pub(super) fn browser_data_directory(
    app: &AppHandle,
    profile: Option<&str>,
) -> Result<PathBuf, String> {
    browser_profile_identifier(profile)?;
    #[cfg(all(debug_assertions, target_os = "macos"))]
    if let Some(directories) = app.try_state::<BrowserProbeDirectories>() {
        let path = directories.profiles.join(profile.unwrap_or("legacy"));
        std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
        return Ok(path);
    }
    let home = super::paths::misty_home_dir().ok_or("Misty's data folder is unavailable.")?;
    let path = super::browser_profile::webview_home(&home, profile)?;
    #[cfg(target_os = "macos")]
    {
        // WebKit picks the store's folder; the profile's `webview` links to it.
        let library = dirs::home_dir()
            .ok_or("The home folder is unavailable.")?
            .join("Library");
        super::browser_profile::link_webview_data(
            &home,
            &library,
            &app.config().identifier,
            profile,
        )?;
    }
    #[cfg(not(target_os = "macos"))]
    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

/// Points a view at its profile's data directory. WebView2 needs every view
/// of one directory to create its environment with the same options, so
/// extension support is switched on here, for all of them.
pub(super) fn with_browser_data(
    builder: tauri::WebviewBuilder<tauri::Wry>,
    app: &AppHandle,
    profile: Option<&str>,
) -> Result<tauri::WebviewBuilder<tauri::Wry>, String> {
    let builder = builder.data_directory(browser_data_directory(app, profile)?);
    #[cfg(windows)]
    let builder = builder.browser_extensions_enabled(true);
    Ok(builder)
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
    app: &AppHandle,
    webview: &Webview,
    position: LogicalPosition<f64>,
    size: LogicalSize<f64>,
) -> Result<(), String> {
    let scale = webview
        .window()
        .scale_factor()
        .map_err(|error| error.to_string())?;
    #[cfg(not(windows))]
    let _ = app;
    // A view still waiting for its first paint takes its size but stays parked,
    // so no caller can pull the blank surface on screen early.
    let position = if is_held_view(webview) {
        PARKED_POSITION
    } else {
        position
    };
    let desired_position = position.to_physical::<i32>(scale);
    let desired_size = size.to_physical::<u32>(scale);
    let current_position = webview.position().map_err(|error| error.to_string())?;
    let current_size = webview.size().map_err(|error| error.to_string())?;
    if current_position == desired_position && current_size == desired_size {
        return Ok(());
    }
    webview
        .set_bounds(tauri::Rect {
            position: position.into(),
            size: size.into(),
        })
        .map_err(|error| error.to_string())?;
    #[cfg(windows)]
    if current_position.x > -10_000 && desired_position.x > -10_000 && !is_stacked(webview) {
        follow_siblings(
            app,
            webview,
            (current_position, current_size),
            (position, size),
        );
    }
    refresh_browser_cursor_ownership(webview)
}

/// Equal sizes after logical-to-physical rounding at fractional display scales.
#[cfg(windows)]
fn about_same_size(a: tauri::PhysicalSize<u32>, b: tauri::PhysicalSize<u32>) -> bool {
    a.width.abs_diff(b.width) <= 2 && a.height.abs_diff(b.height) <= 2
}

/// When a page on screen moves or changes size (the window, the sidebar or a
/// split moved), the hidden tabs that shared its old place follow it: stacked
/// ones to its new place and size, parked ones to its new size. Switching to
/// one then only raises it, already laid out where it shows.
#[cfg(windows)]
fn follow_siblings(
    app: &AppHandle,
    moved: &Webview,
    (old_position, old_size): (tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>),
    (position, size): (LogicalPosition<f64>, LogicalSize<f64>),
) {
    let window = moved.window().label().to_owned();
    for (label, webview) in app.webviews() {
        if label == moved.label()
            || !label.starts_with("misty-browser-")
            || webview.window().label() != window
        {
            continue;
        }
        let (Ok(current_position), Ok(current_size)) = (webview.position(), webview.size()) else {
            continue;
        };
        if !about_same_size(current_size, old_size) {
            continue;
        }
        let parked = current_position.x <= -10_000 && current_position.y <= -10_000;
        let same_place = current_position.x.abs_diff(old_position.x) <= 2
            && current_position.y.abs_diff(old_position.y) <= 2;
        let target = if parked {
            PARKED_POSITION
        } else if is_stacked(&webview) && same_place {
            position
        } else {
            continue;
        };
        let _ = webview.set_bounds(tauri::Rect {
            position: target.into(),
            size: size.into(),
        });
    }
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

#[cfg(test)]
#[path = "browser_tests.rs"]
mod tests;

#[path = "browser_profile_cleanup.rs"]
pub(crate) mod profile_cleanup;
#[path = "browser_retired_profiles.rs"]
pub(crate) mod retired_profiles;

#[tauri::command]
pub fn browser_runtime_for_scope(
    state: State<'_, BrowserSessionState>,
    scope_id: String,
) -> Result<String, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Browser state unavailable")?;
    sessions
        .iter()
        .find(|(_, session)| session.scope_id == scope_id)
        .map(|(id, _)| id.clone())
        .ok_or_else(|| "browser_context_closed".into())
}
