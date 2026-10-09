//! Messages from Misty's own page scripts (focus, shortcuts, context menu,
//! companion pointer, page color, Escape-to-stop), delivered over Kiri's host
//! channel on every engine. Each carries the tab's token, which only those
//! scripts hold; anything else is dropped.
use super::*;
use kiri::channel::{HostChannel, HostMessage};

// Saved passwords answer the page script's sign-in messages, which arrive here.
#[path = "browser_passwords.rs"]
pub(crate) mod passwords;
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
        "misty-shortcut" | "misty-context-menu" | "misty-passwords"
    )
    .then_some(url)
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct BackgroundMessage {
    token: String,
    background: String,
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

/// Escape stopped a loading page.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct StatusMessage {
    token: String,
    status: StatusChange,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum StatusChange {
    Stopped,
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
            {
                super::context_menu::forward(app, id, &url);
            }
            return;
        }
        if let Some(background) = background_message(raw) {
            if !message.main_frame || !trusted(app, id, &background.token) {
                return;
            }
            #[cfg(target_os = "macos")]
            if let Some(webview) = app.get_webview(message.webview) {
                set_under_page_background(&webview, background.background.clone());
            }
            if let Ok(mut values) = page_backgrounds().lock() {
                values.insert(id.to_owned(), background.background.clone());
            }
            let _ = app.emit_to(
                super::browser_owner_label(app, id),
                "misty://browser-background",
                json!({ "id": id, "color": background.background }),
            );
            return;
        }
        // Companion tracking shares the authenticated channel with focus.
        // URL-based telemetry cancels WebKit loads while the user moves the mouse.
        if let Some(pointer) = pointer_message(raw) {
            if trusted(app, id, &pointer.token) {
                super::emit_browser_pointer(
                    app,
                    id,
                    super::super::browser_scripts::BrowserPointerNavigation {
                        x: pointer.pointer.x,
                        y: pointer.pointer.y,
                        inside: pointer.pointer.inside,
                    },
                );
            }
            return;
        }
        if let Some(status) = status_message(raw) {
            if trusted(app, id, &status.token) {
                let StatusChange::Stopped = status.status;
                let _ = app.emit_to(
                    super::browser_owner_label(app, id),
                    "misty://browser-stopped",
                    BrowserFocusEvent { id: id.to_owned() },
                );
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
mod tests {
    use super::*;

    #[test]
    fn background_messages_accept_only_bounded_hex_colors() {
        assert!(background_message(r##"{"token":"test","background":"#202124"}"##).is_some());
        for raw in [
            r##"{"background":"#202124"}"##,
            r##"{"token":"test","background":"#20212400"}"##,
            r##"{"token":"test","background":"red"}"##,
            r##"{"token":"test","background":"#gggggg"}"##,
            r##"{"token":"test","background":"#202124","extra":true}"##,
        ] {
            assert!(background_message(raw).is_none(), "{raw}");
        }
    }

    #[test]
    fn navigate_messages_carry_only_host_navigations() {
        assert!(navigate_message(r#"{"navigate":"misty-shortcut:event?key=w&token=t"}"#).is_some());
        assert!(navigate_message(
            r#"{"navigate":"misty-context-menu:open?token=t&payload=%7B%7D"}"#
        )
        .is_some());
        for raw in [
            r#"{"navigate":"misty-companion:submit?token=t&prompt=hi"}"#,
            r#"{"navigate":"https://example.com/"}"#,
            r#"{"navigate":"misty-shortcut:event","token":"t"}"#,
            r#"{"navigate":7}"#,
        ] {
            assert!(navigate_message(raw).is_none(), "{raw}");
        }
    }

    #[test]
    fn pointer_messages_require_bounded_coordinates_and_a_token() {
        assert!(
            pointer_message(r#"{"token":"test","pointer":{"x":12.5,"y":40,"inside":true}}"#)
                .is_some()
        );
        assert!(
            pointer_message(r#"{"token":"test","pointer":{"x":0,"y":0,"inside":false}}"#).is_some()
        );
        for raw in [
            r#"{"pointer":{"x":0,"y":0,"inside":true}}"#,
            r#"{"token":"test","pointer":{"x":-1,"y":0,"inside":true}}"#,
            r#"{"token":"test","pointer":{"x":100001,"y":0,"inside":true}}"#,
            r#"{"token":"test","pointer":{"x":0,"y":null,"inside":true}}"#,
        ] {
            assert!(pointer_message(raw).is_none(), "{raw}");
        }
    }

    #[test]
    fn status_messages_name_a_known_change_and_carry_a_token() {
        assert!(status_message(r#"{"token":"test","status":"stopped"}"#).is_some());
        for raw in [
            r#"{"status":"stopped"}"#,
            r#"{"token":"test","status":"reloaded"}"#,
            r#"{"token":"test","status":"stopped","extra":1}"#,
        ] {
            assert!(status_message(raw).is_none(), "{raw}");
        }
    }
}
