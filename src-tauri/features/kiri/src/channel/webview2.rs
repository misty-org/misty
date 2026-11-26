use super::{deliver, WIRE_PREFIX};
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};
use tauri::Webview;
use webview2_com::WebMessageReceivedEventHandler;
use windows::core::{Interface, PWSTR};
use windows::Win32::System::Com::CoTaskMemFree;

pub(super) const SENDER_SCRIPT: &str = "() => { const view = window.chrome?.webview; if (!view || typeof view.postMessage !== 'function') return null; const post = view.postMessage.bind(view); return (message) => post('\\u0001kiri-host\\u0001' + message); }";

fn installed() -> &'static Mutex<HashMap<String, usize>> {
    static INSTALLED: OnceLock<Mutex<HashMap<String, usize>>> = OnceLock::new();
    INSTALLED.get_or_init(Mutex::default)
}

fn listeners() -> &'static Mutex<HashMap<usize, i64>> {
    static LISTENERS: OnceLock<Mutex<HashMap<usize, i64>>> = OnceLock::new();
    LISTENERS.get_or_init(Mutex::default)
}

unsafe fn take_string(
    read: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>,
) -> Option<String> {
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
                .map(|mut views| {
                    views.insert(label.clone(), core.as_raw() as usize)
                        != Some(core.as_raw() as usize)
                })
                .unwrap_or(false);
            if !first {
                return;
            }
            let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let text = take_string(|pointer| args.TryGetWebMessageAsString(pointer));
                if let Some(body) = text
                    .as_deref()
                    .and_then(|text| text.strip_prefix(WIRE_PREFIX))
                {
                    deliver(&label, true, body);
                }
                Ok(())
            }));
            let raw = core.as_raw() as usize;
            if let Some(before) = listeners()
                .lock()
                .ok()
                .and_then(|mut known| known.remove(&raw))
            {
                let _ = core.remove_WebMessageReceived(before);
            }
            let mut token = 0i64;
            if core.add_WebMessageReceived(&handler, &mut token).is_ok() {
                if let Ok(mut known) = listeners().lock() {
                    known.insert(raw, token);
                }
            }
        })
        .map_err(|error| error.to_string())
}

pub(super) fn forget(webview: &str) {
    let raw = installed()
        .lock()
        .ok()
        .and_then(|mut views| views.remove(webview));
    let Some(raw) = raw else {
        return;
    };
    let still_used = installed()
        .lock()
        .map(|views| views.values().any(|known| *known == raw))
        .unwrap_or(false);
    if !still_used {
        if let Ok(mut known) = listeners().lock() {
            known.remove(&raw);
        }
    }
}
