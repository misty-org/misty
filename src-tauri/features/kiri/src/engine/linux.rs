//! WebKitGTK on Linux: the permission-request signal, answered with a refusal. WebKitGTK ships
//! camera, microphone and WebRTC switched off and has no prompt of its own; the handler keeps any
//! request from waiting on an answer.

use gtk::prelude::*;
use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
};
use tauri::Webview;
use webkit2gtk::{PermissionRequestExt, WebViewExt};

/// Native views that already have Kiri's handler.
fn installed() -> &'static Mutex<HashSet<usize>> {
    static INSTALLED: OnceLock<Mutex<HashSet<usize>>> = OnceLock::new();
    INSTALLED.get_or_init(Mutex::default)
}

pub(super) fn deny_permission_requests(webview: &Webview) -> Result<(), String> {
    webview
        .with_webview(move |platform| {
            let view = platform.inner();
            let first = installed()
                .lock()
                .map(|mut views| views.insert(view.as_ptr() as usize))
                .unwrap_or(false);
            if !first {
                return;
            }
            view.connect_permission_request(|_, request| {
                request.deny();
                true
            });
        })
        .map_err(|error| error.to_string())
}

pub(super) fn edit(webview: &Webview, command: super::EditCommand) -> Result<(), String> {
    // WEBKIT_EDITING_COMMAND_COPY / _CUT / _PASTE.
    let name = match command {
        super::EditCommand::Copy => "Copy",
        super::EditCommand::Cut => "Cut",
        super::EditCommand::Paste => "Paste",
    };
    webview
        .with_webview(move |platform| platform.inner().execute_editing_command(name))
        .map_err(|error| error.to_string())
}
