//! WebKitGTK on Linux: a script message handler named `kiriHost`.

use super::{deliver, HANDLER_NAME};
use gtk::prelude::*;
use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
};
use tauri::Webview;
use webkit2gtk::{UserContentManagerExt, WebViewExt};

pub(super) const SENDER_SCRIPT: &str = "() => { const handler = window.webkit?.messageHandlers?.kiriHost; return handler && typeof handler.postMessage === 'function' ? handler.postMessage.bind(handler) : null; }";

/// Content managers that already have the handler.
fn installed() -> &'static Mutex<HashSet<usize>> {
    static INSTALLED: OnceLock<Mutex<HashSet<usize>>> = OnceLock::new();
    INSTALLED.get_or_init(Mutex::default)
}

pub(super) fn install(webview: &Webview) -> Result<(), String> {
    let label = webview.label().to_owned();
    webview
        .with_webview(move |platform| {
            let Some(manager) = platform.inner().user_content_manager() else {
                return;
            };
            let first = installed()
                .lock()
                .map(|mut managers| managers.insert(manager.as_ptr() as usize))
                .unwrap_or(false);
            if !first {
                return;
            }
            // Connect before registering, as WebKitGTK recommends. WebKitGTK
            // does not report the sending frame.
            manager.connect_script_message_received(Some(HANDLER_NAME), move |_, message| {
                if let Some(value) = message.js_value() {
                    deliver(&label, true, &value.to_string());
                }
            });
            manager.register_script_message_handler(HANDLER_NAME);
        })
        .map_err(|error| error.to_string())
}

pub(super) fn forget(_webview: &str) {}
