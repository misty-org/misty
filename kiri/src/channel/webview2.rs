//! WebView2 on Windows: `chrome.webview.postMessage`, marked with
//! `WIRE_PREFIX` because Tauri's IPC listens on the same event.

use super::{deliver, WIRE_PREFIX};
use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
};
use tauri::Webview;
use webview2_com::WebMessageReceivedEventHandler;
use windows::core::{Interface, PWSTR};
use windows::Win32::System::Com::CoTaskMemFree;

pub(super) const SENDER_SCRIPT: &str = "() => { const view = window.chrome?.webview; if (!view || typeof view.postMessage !== 'function') return null; const post = view.postMessage.bind(view); return (message) => post('\\u0001kiri-host\\u0001' + message); }";

/// Native views that already have the handler.
fn installed() -> &'static Mutex<HashSet<usize>> {
    static INSTALLED: OnceLock<Mutex<HashSet<usize>>> = OnceLock::new();
    INSTALLED.get_or_init(Mutex::default)
}

// Frees native strings even when the call fails after allocating them.
unsafe fn take_string(read: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>) -> Option<String> {
    let mut pointer = PWSTR::null();
    let status = read(&mut pointer);
    let value = if status.is_ok() && !pointer.is_null() {
        pointer.to_string().ok()
    } else {
        None
    };
    if !pointer.is_null() {
        CoTaskMemFree(Some(pointer.0.cast()));
    }
    value
}

pub(super) fn install(webview: &Webview) -> Result<(), String> {
    let label = webview.label().to_owned();
    webview
        .with_webview(move |platform| unsafe {
            let Ok(core) = platform.controller().CoreWebView2() else {
                return;
            };
            let first = installed()
                .lock()
                .map(|mut views| views.insert(core.as_raw() as usize))
                .unwrap_or(false);
            if !first {
                return;
            }
            let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let text = take_string(|pointer| args.TryGetWebMessageAsString(pointer));
                // Only top-level documents reach this event.
                if let Some(body) = text.as_deref().and_then(|text| text.strip_prefix(WIRE_PREFIX)) {
                    deliver(&label, true, body);
                }
                Ok(())
            }));
            let mut token = 0i64;
            let _ = core.add_WebMessageReceived(&handler, &mut token);
        })
        .map_err(|error| error.to_string())
}

pub(super) fn forget(_webview: &str) {}
