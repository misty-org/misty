use serde_json::json;
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, LogicalPosition, Webview};

pub(in crate::browser) const PARKED_POSITION: LogicalPosition<f64> =
    LogicalPosition::new(-32_000.0, -32_000.0);

#[cfg(windows)]
const HOLD_TIMEOUT_MS: u64 = 2000;

#[derive(Default)]
struct FirstPaintState {
    background_reported: bool,
    page_finished: bool,
}

fn held_views() -> &'static Mutex<HashMap<String, FirstPaintState>> {
    static HELD: OnceLock<Mutex<HashMap<String, FirstPaintState>>> = OnceLock::new();
    HELD.get_or_init(Default::default)
}

pub(in crate::browser) fn is_held_id(id: &str) -> bool {
    held_views().lock().is_ok_and(|held| held.contains_key(id))
}

pub(in crate::browser) fn is_held_view(webview: &Webview) -> bool {
    webview
        .label()
        .strip_prefix("misty-browser-")
        .is_some_and(is_held_id)
}

#[cfg(windows)]
pub(in crate::browser) fn hold_until_first_paint(app: &AppHandle, id: &str) {
    if let Ok(mut held) = held_views().lock() {
        held.insert(id.to_owned(), FirstPaintState::default());
    }
    let app = app.clone();
    let id = id.to_owned();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(HOLD_TIMEOUT_MS));
        release_first_paint(&app, &id);
    });
}

pub(in crate::browser) fn report_first_paint_background(app: &AppHandle, id: &str) {
    let ready = held_views().lock().is_ok_and(|mut held| {
        let Some(state) = held.get_mut(id) else {
            return false;
        };
        state.background_reported = true;
        state.page_finished
    });
    if ready {
        release_first_paint(app, id);
    }
}

pub(in crate::browser) fn finish_first_paint_load(app: &AppHandle, id: &str) {
    let ready = held_views().lock().is_ok_and(|mut held| {
        let Some(state) = held.get_mut(id) else {
            return false;
        };
        state.page_finished = true;
        state.background_reported
    });
    if ready {
        release_first_paint(app, id);
    }
}

pub(in crate::browser) fn release_first_paint(app: &AppHandle, id: &str) {
    let was_held = held_views()
        .lock()
        .map(|mut held| held.remove(id))
        .map(|state| state.is_some())
        .unwrap_or(false);
    if was_held {
        let _ = app.emit_to(
            crate::browser::browser_owner_label(app, id),
            "misty://browser-reveal",
            json!({ "id": id }),
        );
    }
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct UnpaintedPage {
    background_reported: bool,
    bare: bool,
    page_finished: bool,
}

#[cfg(target_os = "macos")]
fn unpainted_pages() -> &'static Mutex<HashMap<String, UnpaintedPage>> {
    static UNPAINTED: OnceLock<Mutex<HashMap<String, UnpaintedPage>>> = OnceLock::new();
    UNPAINTED.get_or_init(Default::default)
}

#[cfg(target_os = "macos")]
pub(in crate::browser) fn clear_canvas_until_drawn(webview: &Webview) {
    if let Ok(mut pages) = unpainted_pages().lock() {
        pages.insert(webview.label().to_owned(), UnpaintedPage::default());
    }
    draw_page_canvas(webview, false);
}

#[cfg(target_os = "macos")]
pub(in crate::browser) fn note_page_background(webview: &Webview, bare: bool) {
    settle_unpainted_page(webview, |page| {
        page.background_reported = true;
        page.bare = bare;
    });
}

#[cfg(target_os = "macos")]
pub(in crate::browser) fn note_page_finished(webview: &Webview) {
    settle_unpainted_page(webview, |page| page.page_finished = true);
}

#[cfg(target_os = "macos")]
pub(in crate::browser) fn forget_unpainted_page(label: &str) {
    if let Ok(mut pages) = unpainted_pages().lock() {
        pages.remove(label);
    }
}

#[cfg(target_os = "macos")]
fn settle_unpainted_page(webview: &Webview, mark: impl FnOnce(&mut UnpaintedPage)) {
    let canvas = unpainted_pages().lock().is_ok_and(|mut pages| {
        let label = webview.label();
        let Some(page) = pages.get_mut(label) else {
            return false;
        };
        mark(page);
        if !(page.background_reported && page.page_finished) {
            return false;
        }
        let bare = page.bare;
        pages.remove(label);
        bare
    });
    if canvas {
        draw_page_canvas(webview, true);
    }
}

#[cfg(target_os = "macos")]
fn draw_page_canvas(webview: &Webview, draws: bool) {
    use objc2::runtime::Bool;
    use objc2_app_kit::NSView;
    let _ = webview.with_webview(move |platform_webview| unsafe {
        let Some(view) = platform_webview.inner().cast::<NSView>().as_ref() else {
            return;
        };
        let settable: bool =
            objc2::msg_send![view, respondsToSelector: objc2::sel!(_setDrawsBackground:)];
        if settable {
            let _: () = objc2::msg_send![view, _setDrawsBackground: Bool::new(draws)];
        } else {
            let value = objc2_foundation::NSNumber::numberWithBool(draws);
            let key = objc2_foundation::NSString::from_str("drawsBackground");
            let _: () = objc2::msg_send![view, setValue: &*value, forKey: &*key];
        }
    });
}
