//! WebKit can end a page's content process on its own (memory pressure, a
//! long system sleep). The page then has to load again. Tauri's default only
//! reloads it; Misty also records which page ended and tells the renderer, so
//! a page that refreshes while the window was in the background can be traced.

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
    eprintln!("[misty] WebKit ended the content process of {label}; reloading it");
    let _ = webview.emit("misty://browser-page-process-ended", PageProcessEnded { id });
    if let Err(error) = webview.reload() {
        eprintln!("[misty] could not reload {label}: {error}");
    }
}
