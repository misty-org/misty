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
mod messages;
use messages::*;
mod page_background;
#[cfg(any(target_os = "macos", windows))]
pub(super) use page_background::apply_page_background;
#[cfg(target_os = "macos")]
pub(super) use page_background::replay_page_background;
pub(super) use page_background::{forget_page_background, reported_page_background};
use page_background::page_backgrounds;
#[cfg(any(target_os = "macos", windows))]
use page_background::set_under_page_background;
use std::sync::OnceLock;

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
