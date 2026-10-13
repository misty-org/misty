//! The engine can end a page's content process on its own (memory pressure, a
//! long system sleep, a crash). The page then has to load again. Tauri's
//! default only reloads it on macOS; Misty also records which page ended and
//! tells the renderer, so a page that refreshes while the window was in the
//! background can be traced.

use serde::Serialize;
use tauri::{Emitter, Runtime, Webview};

#[derive(Clone, Serialize)]
struct PageProcessEnded {
    /// Browser runtime id, or None when Misty's own window content ended.
    id: Option<String>,
}

pub fn page_process_ended<R: Runtime>(webview: &Webview<R>) {
    let label = webview.label();
    let id = label.strip_prefix("misty-browser-").map(str::to_owned);
    eprintln!("[misty] the engine ended the content process of {label}; reloading it");
    let _ = webview.emit(
        "misty://browser-page-process-ended",
        PageProcessEnded { id },
    );
    if let Err(error) = webview.reload() {
        eprintln!("[misty] could not reload {label}: {error}");
    }
}

/// WebView2 reports a crashed or hung renderer as ProcessFailed. Only the
/// page's own renderer is recovered here; a failed browser process takes the
/// whole view with it and is handled by closing the tab.
#[cfg(windows)]
pub fn watch_page_process<R: Runtime>(webview: &Webview<R>) {
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PROCESS_FAILED_KIND,
            COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
            COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE,
        },
        ProcessFailedEventHandler,
    };
    let target = webview.clone();
    let _ = webview.with_webview(move |platform| {
        let handler = ProcessFailedEventHandler::create(Box::new(move |_, args| {
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            if let Some(args) = args {
                // SAFETY: event arguments are valid for the handler's duration.
                let _ = unsafe { args.ProcessFailedKind(&mut kind) };
            }
            if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE
            {
                page_process_ended(&target);
            }
            Ok(())
        }));
        // SAFETY: the controller is live during this UI-thread callback.
        let _ = unsafe {
            platform.controller().CoreWebView2().and_then(|core| {
                let mut token = Default::default();
                core.add_ProcessFailed(&handler, &mut token)
            })
        };
    });
}
