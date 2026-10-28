pub mod agent_control;
#[cfg(windows)]
pub(super) mod capture_windows;
pub(crate) mod kiri_host;
pub mod night_light;
pub mod page_state;
pub(super) mod scripts;
pub(super) mod theme;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
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

mod first_paint;
#[cfg(windows)]
use first_paint::hold_until_first_paint;
use first_paint::{
    finish_first_paint_load, is_held_id, is_held_view, release_first_paint,
    report_first_paint_background, PARKED_POSITION,
};
mod native_input;
#[cfg(windows)]
mod native_input_windows;

mod task_files;

mod download_names;
#[cfg(windows)]
mod page_frame_windows;
pub(crate) mod pane_dim;
use download_names::{reserve_download_path, sanitize_download_name};

mod load_watch;
#[cfg(target_os = "macos")]
mod url_observer;
#[cfg(target_os = "macos")]
use load_watch::emit_navigated;
use load_watch::{next_load_generation, watch_load};
pub(crate) mod host_messages;
pub(super) use host_messages::init as init_host_messages;

#[cfg(target_os = "macos")]
mod click_focus;
#[cfg(target_os = "macos")]
pub(super) use click_focus::install as install_click_focus;
#[cfg(target_os = "macos")]
mod corner_scrollbars;
#[cfg(target_os = "macos")]
pub(super) use corner_scrollbars::install as install_corner_scrollbars;

#[cfg(target_os = "macos")]
mod attachment_download_macos;
pub(crate) mod creation_guard;
#[cfg(any(target_os = "macos", windows))]
mod popups;
#[cfg(any(target_os = "macos", windows))]
use popups::provider_popup;

mod context_menu;
#[cfg(windows)]
mod engine_menu;
#[cfg(windows)]
pub(crate) mod stacked_pages;
#[cfg(windows)]
use stacked_pages::{is_stacked, place_beneath, stack_windows_webview, unstack, wake};

/// Hidden tabs sleep on their own elsewhere: a hidden view stops drawing.
#[cfg(not(windows))]
#[tauri::command]
pub fn browser_set_hidden_tab_sleep(seconds: u64) {
    let _ = seconds;
}

/// Pages switch by stacking order only on Windows; elsewhere the engine shows
/// and hides views in one frame on its own.
#[cfg(not(windows))]
#[tauri::command]
pub fn browser_webviews_show_only() -> Vec<String> {
    Vec::new()
}

#[cfg(all(desktop, debug_assertions))]
pub(crate) mod eval_bridge;
#[cfg(all(debug_assertions, target_os = "macos"))]
pub(crate) mod kiri_probe;

pub mod action_confirm;
mod interact;
mod page_agent;
use interact::interact_browser;
pub(crate) mod page_tools;

mod native_views;
pub use native_views::*;
mod types;
pub use types::*;
mod create;
pub use create::*;
mod create_probes;
use create_probes::*;
mod downloads;
pub use downloads::*;
mod view_ops;
pub use view_ops::*;
mod view_overlay;
pub use view_overlay::*;
mod title_probe;
use title_probe::*;
mod view_close;
pub use view_close::*;
mod account_views;
pub(crate) use account_views::*;
mod agent_tab_close;
pub use agent_tab_close::*;
mod window_pages;
pub use window_pages::*;
mod agent;
pub use agent::*;
mod agent_grants;
pub use agent_grants::*;
mod agent_actions;
use agent_actions::*;
mod agent_support;
pub(crate) use agent_support::*;
mod menu_commands;
pub use menu_commands::*;
mod profile_data;
pub(super) use profile_data::*;
mod session;
pub use session::*;

#[cfg(windows)]
use std::sync::atomic::AtomicU32;

use self::scripts::{
    browser_captions_script, browser_status_script, browser_status_update_script,
    browser_viewport_script, emit_browser_pointer, set_status_bubble_enabled,
    BROWSER_COMPATIBILITY_SCRIPT, BROWSER_FAVICON_SCRIPT,
};
#[cfg(not(windows))]
use self::theme::browser_background;
use self::theme::{browser_theme, default_browser_theme};
#[cfg(target_os = "macos")]
use super::browser_macos::configure_main_webview_pointer_guard;
use super::browser_macos::{
    configure_browser_frame_rate, configure_browser_webview, evaluate_browser_async_javascript,
    native_macos_safari_user_agent, refresh_browser_cursor_ownership, reload_browser_webview,
    unregister_browser_cursor_ownership,
};
use super::browser_shortcuts::{
    apply as apply_shortcuts, forget_shortcut_token, forward_navigation, shortcut_token_for,
    shortcut_token_matches, BrowserShortcutBinding,
};

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
            // Focus we gave back ourselves changes nothing the app should answer.
            if crate::infra::window_focus_windows::take_programmatic(&format!("misty-browser-{id}"))
            {
                return Ok(());
            }
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

mod bounds;
use bounds::{logical_bounds, set_webview_bounds_if_changed};

fn apply_browser_pointer_tracking(webview: &Webview, enabled: bool) -> Result<(), String> {
    webview
        .eval(&format!(
            "window.__MISTY_SET_POINTER_TRACKING__?.({});",
            if enabled { "true" } else { "false" }
        ))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests;

pub(crate) mod profile_cleanup;
pub(crate) mod retired_profiles;
