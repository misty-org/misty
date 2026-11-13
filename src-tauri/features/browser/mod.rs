pub mod commands;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{
    utils::config::{BackgroundThrottlingPolicy, Color, WebviewUrl},
    webview::{DownloadEvent, NewWindowResponse},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, Webview, WebviewBuilder,
};
use url::Url;

#[cfg(windows)]
use pages::first_paint::hold_until_first_paint;
use pages::first_paint::{
    finish_first_paint_load, is_held_id, is_held_view, release_first_paint,
    report_first_paint_background, PARKED_POSITION,
};

use history_downloads::download_names::{reserve_download_path, sanitize_download_name};

pub(crate) use kiri_link::host_messages::init as init_host_messages;
#[cfg(target_os = "macos")]
use pages::load_watch::emit_navigated;
use pages::load_watch::{next_load_generation, watch_load};

#[cfg(target_os = "macos")]
pub(crate) use input::click_focus::install as install_click_focus;
#[cfg(target_os = "macos")]
pub(crate) use pages::corner_scrollbars::install as install_corner_scrollbars;

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
use menus::popups::open_popup_in_place;

#[cfg(windows)]
use pages::stacked_pages::{is_stacked, stack_windows_webview, unstack, wake};

pub(crate) use agent_pages::page_agent::{page_controls, scope_site, SiteBlocks};
use input::interact::interact_browser;

pub use pages::native_views::*;
mod types;
pub use agent_pages::agent::*;
use agent_pages::agent_actions::*;
pub use agent_pages::agent_grants::*;
pub(crate) use agent_pages::agent_support::*;
pub use agent_pages::agent_tab_close::*;
pub use history_downloads::downloads::*;
pub use menus::menu_commands::*;
pub(crate) use pages::account_views::*;
pub use pages::create::*;
use pages::create_probes::*;
use pages::title_probe::*;
pub use pages::view_close::*;
pub use pages::view_ops::*;
pub use pages::view_overlay::*;
pub use pages::window_pages::*;
pub(crate) use site_data::store_data::*;
pub use types::*;
mod session;
pub use session::*;

#[cfg(windows)]
use std::sync::atomic::AtomicU32;

use crate::browser::input::shortcuts::{
    apply as apply_shortcuts, forget_shortcut_token, forward_navigation, shortcut_token_for,
    shortcut_token_matches, BrowserShortcutBinding,
};
use crate::browser::kiri_link::scripts::{
    browser_status_script, browser_status_update_script, browser_viewport_script,
    emit_browser_pointer, BROWSER_FAVICON_SCRIPT,
};
#[cfg(target_os = "macos")]
use crate::browser::pages::macos::configure_main_webview_pointer_guard;
use crate::browser::pages::macos::{
    configure_browser_frame_rate, configure_browser_webview, native_macos_safari_user_agent,
    refresh_browser_cursor_ownership, reload_browser_webview, unregister_browser_cursor_ownership,
};
#[cfg(not(windows))]
use crate::browser::pages::theme::browser_background;

const MAX_SNAPSHOT_CHARS: usize = 256 * 1024;
const MAX_INTERACTIVE_ELEMENTS: usize = 500;
const MAX_DOWNLOAD_HISTORY: usize = 100;
const AGENT_DOWNLOAD_WINDOW_SECONDS: i64 = 30;
use crate::browser::site_data::profile_store::{data_store_identifier, webkit_store_identifier};
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
            if crate::browser::app_windows::windows::focus::take_programmatic(&format!(
                "misty-browser-{id}"
            )) {
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

pub(crate) fn browser_owner_label(app: &AppHandle, id: &str) -> String {
    app.get_webview(&format!("misty-browser-{id}"))
        .map(|view| view.window().label().to_owned())
        .or_else(|| crate::browser::app_windows::primary_label(app))
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
    url.origin().ascii_serialization()
}

fn external_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "Enter a valid web address or search.".to_owned())?;
    if url.as_str() == "about:blank"
        || (matches!(url.scheme(), "http" | "https")
            && url.username().is_empty()
            && url.password().is_none())
    {
        return Ok(url);
    }
    Err("Misty Browser supports only http and https pages.".to_owned())
}

use pages::bounds::{logical_bounds, set_webview_bounds_if_changed};

fn apply_browser_pointer_tracking(webview: &Webview, enabled: bool) -> Result<(), String> {
    webview
        .eval(&format!(
            "window.__MISTY_SET_POINTER_TRACKING__?.({});",
            if enabled { "true" } else { "false" }
        ))
        .map_err(|error| error.to_string())
}

pub mod agent_pages;
#[cfg(desktop)]
pub mod app_windows;
pub mod history_downloads;
pub mod input;
pub mod kiri_link;
pub mod link_previews;
pub mod menus;
pub mod page_text;
pub mod pages;
#[cfg(desktop)]
pub mod profiles;
pub mod site_data;
pub mod site_icons;
#[cfg(test)]
// Tests build their fixtures directly, outside the file gate.
#[allow(clippy::disallowed_methods, clippy::disallowed_types)]
mod tests;
