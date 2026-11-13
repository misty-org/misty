//! Messages from Misty's own page scripts (focus, shortcuts, context menu,
//! companion pointer, page color, Escape-to-stop), delivered over Kiri's host
//! channel on every engine. Each carries the tab's token, which only those
//! scripts hold; anything else is dropped.
use crate::browser::*;
use kiri::channel::{HostChannel, HostMessage};

mod messages;
use messages::*;
mod page_background;
pub(in crate::browser) use page_background::forget_page_background;
use page_background::page_backgrounds;
#[cfg(target_os = "macos")]
pub(in crate::browser) use page_background::replay_page_background;
#[cfg(any(target_os = "macos", windows))]
use page_background::set_under_page_background;
use std::sync::OnceLock;

fn trusted(app: &AppHandle, id: &str, token: &str) -> bool {
    app.try_state::<BrowserSessionState>()
        .is_some_and(|state| crate::browser::shortcut_token_matches(&state, id, token))
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
            if message.main_frame && !crate::browser::forward_navigation(app, id, &url) {
                crate::browser::menus::context_menu::forward(app, id, &url);
            }
            return;
        }
        if let Some(caret) = caret_message(raw) {
            #[cfg(target_os = "macos")]
            if message.main_frame && trusted(app, id, &caret.token) {
                if let Some(webview) = app.get_webview(message.webview) {
                    let rect = caret.caret.map(|r| [r.x, r.y, r.w, r.h]);
                    crate::browser::pages::macos::pointer_guard::set_caret_rect(&webview, rect);
                }
            }
            return;
        }
        if let Some(fullscreen) = fullscreen_message(raw) {
            if message.main_frame && trusted(app, id, &fullscreen.token) {
                crate::browser::pages::fullscreen::set_page_fullscreen(
                    app,
                    id,
                    fullscreen.fullscreen,
                );
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
            crate::browser::report_first_paint_background(app, id);
            return;
        }
        // Companion tracking shares the authenticated channel with focus.
        // URL-based telemetry cancels WebKit loads while the user moves the mouse.
        if let Some(pointer) = pointer_message(raw) {
            if trusted(app, id, &pointer.token) {
                crate::browser::emit_browser_pointer(
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
                    crate::browser::browser_owner_label(app, id),
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
            let owner = crate::browser::browser_owner_label(app, id);
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
                    crate::browser::pages::load_watch::emit_location(
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
                crate::browser::browser_owner_label(app, id),
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

pub(in crate::browser) fn install(view: &Webview) -> Result<(), String> {
    kiri::channel::install_host_channel(view)
}

pub(in crate::browser) fn forget(id: &str) {
    kiri::channel::forget_host_channel(&format!("misty-browser-{id}"));
    forget_page_background(id);
}

#[cfg(test)]
mod tests;
