//! Messages from Misty's own page scripts (focus, shortcuts, context menu,
//! companion pointer, page color, Escape-to-stop), delivered over Kiri's host
//! channel on every engine. Each carries the tab's token, which only those
//! scripts hold; anything else is dropped.
use super::*;
use kiri::channel::{HostChannel, HostMessage};

// Saved passwords answer the page script's sign-in messages, which arrive here.
pub(crate) mod passwords;
// "Add to Misty" on the Chrome Web Store and Firefox Add-ons.
mod extension_store;
use std::sync::OnceLock;

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PointerMessage {
    token: String,
    pointer: PointerPosition,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PointerPosition {
    x: f64,
    y: f64,
    inside: bool,
}

fn pointer_message(raw: &str) -> Option<PointerMessage> {
    if raw.len() > 1024 {
        return None;
    }
    let message: PointerMessage = serde_json::from_str(raw).ok()?;
    let p = &message.pointer;
    if !p.x.is_finite()
        || !p.y.is_finite()
        || !(0.0..=100_000.0).contains(&p.x)
        || !(0.0..=100_000.0).contains(&p.y)
    {
        return None;
    }
    Some(message)
}

/// What a page is playing, pushed whenever it changes. The fields are fixed and capped, so the
/// page can say nothing else through this message.
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MediaState {
    title: String,
    artist: String,
    artwork: String,
    duration: Option<f64>,
    position: Option<f64>,
    paused: bool,
    has_media: bool,
    can_previous: bool,
    can_next: bool,
    picture_in_picture: bool,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct MediaMessage {
    token: String,
    media: MediaState,
}

fn media_message(raw: &str) -> Option<MediaMessage> {
    if raw.len() > 4096 {
        return None;
    }
    let message: MediaMessage = serde_json::from_str(raw).ok()?;
    let m = &message.media;
    let fine =
        |value: Option<f64>| value.is_none_or(|n| n.is_finite() && (0.0..=1.0e9).contains(&n));
    (m.title.chars().count() <= 200
        && m.artist.chars().count() <= 200
        && m.artwork.len() <= 600
        && fine(m.duration)
        && fine(m.position))
    .then_some(message)
}

/// A video came back from picture in picture still playing: the floating window's back-to-tab
/// button. Misty's window comes forward even if the person is in another app.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PictureInPictureReturn {
    token: String,
    #[serde(rename = "pipReturn")]
    pip_return: bool,
}

fn picture_in_picture_return(raw: &str) -> Option<PictureInPictureReturn> {
    if raw.len() > 1024 {
        return None;
    }
    serde_json::from_str(raw).ok()
}

/// A host navigation (shortcut or context menu) posted instead of loaded, so
/// the page cannot observe the URL that carries the token. The forwarders it
/// is handed to check that token exactly as they do for a navigation.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct NavigateMessage {
    navigate: String,
}

fn navigate_message(raw: &str) -> Option<Url> {
    if raw.len() > 400_000 {
        return None;
    }
    let message: NavigateMessage = serde_json::from_str(raw).ok()?;
    let url = Url::parse(&message.navigate).ok()?;
    matches!(
        url.scheme(),
        "misty-shortcut" | "misty-context-menu" | "misty-passwords" | "misty-extension-store"
    )
    .then_some(url)
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct BackgroundMessage {
    token: String,
    background: String,
}

/// The page asks to move the window: a press-and-drag on empty space at its top edge.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct DragMessage {
    token: String,
    drag: bool,
}

fn drag_message(raw: &str) -> Option<DragMessage> {
    if raw.len() > 1024 {
        return None;
    }
    serde_json::from_str(raw).ok()
}

/// The page reports a double press on its top edge, which acts as the titlebar's double-click.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ZoomMessage {
    token: String,
    zoom: bool,
}

fn zoom_message(raw: &str) -> Option<ZoomMessage> {
    if raw.len() > 1024 {
        return None;
    }
    serde_json::from_str(raw).ok()
}

fn background_message(raw: &str) -> Option<BackgroundMessage> {
    if raw.len() > 1024 {
        return None;
    }
    let message: BackgroundMessage = serde_json::from_str(raw).ok()?;
    let color = message.background.as_bytes();
    if color.len() != 7 || color[0] != b'#' || !color[1..].iter().all(u8::is_ascii_hexdigit) {
        return None;
    }
    Some(message)
}

/// Escape stopped a loading page, its document finished loading, or the page changed its URL
/// without loading (History API or hash), naming its new address.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct StatusMessage {
    token: String,
    status: StatusChange,
    #[serde(default)]
    url: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum StatusChange {
    Stopped,
    Loaded,
    Location,
}

fn status_message(raw: &str) -> Option<StatusMessage> {
    if raw.len() > 1024 {
        return None;
    }
    serde_json::from_str(raw).ok()
}

/// Each page's last reported color. Pages survive renderer reloads, but only
/// report a color when it changes, so the shell replays it on reattachment.
static PAGE_BACKGROUNDS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
fn page_backgrounds() -> &'static Mutex<HashMap<String, String>> {
    PAGE_BACKGROUNDS.get_or_init(Mutex::default)
}

/// A new document reports its own color; never show the previous page's.
pub(super) fn forget_page_background(id: &str) {
    if let Ok(mut values) = page_backgrounds().lock() {
        values.remove(id);
    }
}

/// The page's last reported color, if it has reported one.
pub(super) fn reported_page_background(id: &str) -> Option<String> {
    page_backgrounds()
        .lock()
        .ok()
        .and_then(|values| values.get(id).cloned())
}

/// Re-applies a reported page color to the native view.
#[cfg(any(target_os = "macos", windows))]
pub(super) fn apply_page_background(webview: &Webview, hex: String) {
    set_under_page_background(webview, hex);
}

#[cfg(target_os = "macos")]
pub(super) fn replay_page_background(app: &AppHandle, id: &str) {
    let color = page_backgrounds()
        .lock()
        .ok()
        .and_then(|values| values.get(id).cloned());
    if let Some(color) = color {
        let _ = app.emit_to(
            super::browser_owner_label(app, id),
            "misty://browser-background",
            json!({ "id": id, "color": color }),
        );
    }
}

/// WebKit fills area it has not painted yet, such as the strip a live window
/// resize exposes before the page lays out again, with its under-page color.
/// Match the page so that strip blends in instead of flashing gray.
#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn set_under_page_background(webview: &Webview, hex: String) {
    use objc::runtime::{Class, Object, BOOL, NO, YES};
    use objc::{msg_send, sel, sel_impl};
    let _ = webview.with_webview(move |native| unsafe {
        let view = native.inner() as *mut Object;
        let channel = |start: usize| {
            u8::from_str_radix(&hex[start..start + 2], 16).map_or(0.0, |value| f64::from(value) / 255.0)
        };
        let responds: BOOL = if view.is_null() {
            NO
        } else {
            msg_send![view, respondsToSelector: sel!(setUnderPageBackgroundColor:)]
        };
        if responds != YES {
            return;
        }
        let color: *mut Object = msg_send![Class::get("NSColor").unwrap(), colorWithSRGBRed: channel(1) green: channel(3) blue: channel(5) alpha: 1.0f64];
        let _: () = msg_send![view, setUnderPageBackgroundColor: color];
    });
}

/// WebView2 fills unpainted area with its default background color.
#[cfg(windows)]
fn set_under_page_background(webview: &Webview, hex: String) {
    let channel = |start: usize| u8::from_str_radix(&hex[start..start + 2], 16).unwrap_or(0);
    let _ = webview.set_background_color(Some(tauri::window::Color(
        channel(1),
        channel(3),
        channel(5),
        255,
    )));
}

fn trusted(app: &AppHandle, id: &str, token: &str) -> bool {
    app.try_state::<BrowserSessionState>()
        .is_some_and(|state| super::shortcut_token_matches(&state, id, token))
}

struct Channel {
    app: AppHandle,
}

impl HostChannel for Channel {
    fn receive(&self, message: HostMessage<'_>) {
        let app = &self.app;
        let Some(id) = message.webview.strip_prefix("misty-browser-") else {
            return;
        };
        let raw = message.body;
        if let Some(url) = navigate_message(raw) {
            if message.main_frame
                && !super::forward_navigation(app, id, &url)
                && !passwords::forward(app, id, &url)
                && !extension_store::forward(app, id, &url)
            {
                super::context_menu::forward(app, id, &url);
            }
            return;
        }
        if let Some(background) = background_message(raw) {
            if !message.main_frame || !trusted(app, id, &background.token) {
                return;
            }
            #[cfg(any(target_os = "macos", windows))]
            if let Some(webview) = app.get_webview(message.webview) {
                set_under_page_background(&webview, background.background.clone());
            }
            if let Ok(mut values) = page_backgrounds().lock() {
                values.insert(id.to_owned(), background.background.clone());
            }
            super::report_first_paint_background(app, id);
            let _ = app.emit_to(
                super::browser_owner_label(app, id),
                "misty://browser-background",
                json!({ "id": id, "color": background.background }),
            );
            return;
        }
        if let Some(back) = picture_in_picture_return(raw) {
            if back.pip_return && message.main_frame && trusted(app, id, &back.token) {
                if let Some(window) = app.get_window(&super::browser_owner_label(app, id)) {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                // The same signal as a click on the page: its tab comes forward.
                let _ = app.emit_to(
                    super::browser_owner_label(app, id),
                    "misty://browser-focus",
                    BrowserFocusEvent { id: id.to_owned() },
                );
            }
            return;
        }
        if let Some(update) = media_message(raw) {
            if message.main_frame && trusted(app, id, &update.token) {
                let _ = app.emit_to(
                    super::browser_owner_label(app, id),
                    "misty://browser-media-state",
                    json!({ "id": id, "info": update.media }),
                );
            }
            return;
        }
        // Companion tracking shares the authenticated channel with focus.
        // URL-based telemetry cancels WebKit loads while the user moves the mouse.
        if let Some(pointer) = pointer_message(raw) {
            if trusted(app, id, &pointer.token) {
                super::emit_browser_pointer(
                    app,
                    id,
                    super::scripts::BrowserPointerNavigation {
                        x: pointer.pointer.x,
                        y: pointer.pointer.y,
                        inside: pointer.pointer.inside,
                    },
                );
            }
            return;
        }
        if let Some(drag) = drag_message(raw) {
            if drag.drag && message.main_frame && trusted(app, id, &drag.token) {
                if let Some(webview) = app.get_webview(message.webview) {
                    let _ = webview.window().start_dragging();
                }
            }
            return;
        }
        if let Some(zoom) = zoom_message(raw) {
            if zoom.zoom && message.main_frame && trusted(app, id, &zoom.token) {
                let _ = app.emit_to(
                    super::browser_owner_label(app, id),
                    "misty://browser-titlebar-zoom",
                    BrowserFocusEvent { id: id.to_owned() },
                );
            }
            return;
        }
        if let Some(status) = status_message(raw) {
            if !trusted(app, id, &status.token) {
                return;
            }
            let owner = super::browser_owner_label(app, id);
            match status.status {
                StatusChange::Stopped => {
                    let _ = app.emit_to(
                        owner,
                        "misty://browser-stopped",
                        BrowserFocusEvent { id: id.to_owned() },
                    );
                }
                // A finished document ends the load even when WebKit never reports it finished.
                StatusChange::Loaded if message.main_frame => {
                    let _ = app.emit_to(
                        owner,
                        "misty://browser-stopped",
                        BrowserFocusEvent { id: id.to_owned() },
                    );
                }
                StatusChange::Location if message.main_frame => {
                    super::load_watch::emit_location(
                        app,
                        &owner,
                        id,
                        message.webview,
                        status.url.as_deref(),
                    );
                }
                _ => {}
            }
            return;
        }
        if trusted(app, id, raw) {
            let _ = app.emit_to(
                super::browser_owner_label(app, id),
                "misty://browser-focus",
                BrowserFocusEvent { id: id.to_owned() },
            );
        }
    }
}

/// Routes Kiri's host channel to Misty. Called once at plugin setup.
pub(crate) fn init(app: &AppHandle) {
    kiri::channel::set_host_channel(Channel { app: app.clone() });
}

pub(super) fn install(view: &Webview) -> Result<(), String> {
    kiri::channel::install_host_channel(view)
}

pub(super) fn forget(id: &str) {
    kiri::channel::forget_host_channel(&format!("misty-browser-{id}"));
    forget_page_background(id);
}

#[cfg(test)]
mod tests;
