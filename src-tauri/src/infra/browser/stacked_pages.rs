//! Hidden tabs on Windows stay where they are, beneath the renderer.
//!
//! Each WebView2 page is its own window drawn by another process, so moving,
//! resizing or hiding one and the page drawing again land on screen at
//! different times. A tab switch that moved pages could show neither page, or
//! one with a stale frame. Instead a hidden tab keeps its place and size and
//! drops to the bottom of the window's stacking order, where the renderer
//! covers it; switching back only raises it again, which shows in one frame
//! with the page already drawn. Beyond a generous cap, the least recently
//! hidden pages are parked offscreen instead.
//!
//! A stacked page still counts as on screen to the engine, so it would keep
//! drawing. After a while hidden (a minute unless the person chose otherwise)
//! it is asked to behave as a background tab
//! (`browser/scripts/background_tab.js`): it reads as hidden and stops drawing, with
//! its last frame kept. Tabs playing sound, in picture in picture, capturing,
//! downloading or driven by an agent keep running. Showing the tab undoes it
//! at once. The engine's own freeze is not used: a page it unfreezes stays
//! throttled and stops drawing.
use super::*;

mod background;
pub use background::*;

/// The window's client size when each page was stacked. A page is raised in
/// place only while the window still has that size; otherwise its layout may
/// have moved and the ordinary reconcile places it first.
fn stacked_window_sizes() -> &'static Mutex<HashMap<String, (u32, u32)>> {
    static SIZES: OnceLock<Mutex<HashMap<String, (u32, u32)>>> = OnceLock::new();
    SIZES.get_or_init(Default::default)
}

fn window_size(webview: &Webview) -> Option<(u32, u32)> {
    webview
        .window()
        .inner_size()
        .ok()
        .map(|size| (size.width, size.height))
}

/// Per stacked page: which hide this is, and whether the page was backgrounded.
fn background_states() -> &'static Mutex<HashMap<String, (u64, bool)>> {
    static STATES: OnceLock<Mutex<HashMap<String, (u64, bool)>>> = OnceLock::new();
    STATES.get_or_init(Default::default)
}

/// Hidden pages kept in place per window, beyond the ones on screen. Every
/// open tab stays ready to show at once: a parked page is off screen, which
/// the engine treats as hidden, so it throttles it and drops its drawn frames
/// and the tab has to redraw (or wait) when it comes back. Kept pages cost GPU
/// and CPU while hidden (their videos and animations keep running); memory is
/// about the same, since parked pages stay loaded too. The cap only bounds a
/// window with an unusual number of tabs.
const STACKED_PER_WINDOW: usize = 64;

/// Window label to stacked page ids, least recently hidden first.
fn stacked() -> &'static Mutex<HashMap<String, Vec<String>>> {
    static STACKED: OnceLock<Mutex<HashMap<String, Vec<String>>>> = OnceLock::new();
    STACKED.get_or_init(Default::default)
}

fn page_id(webview: &Webview) -> Option<&str> {
    webview.label().strip_prefix("misty-browser-")
}

pub(super) fn is_stacked(webview: &Webview) -> bool {
    let Some(id) = page_id(webview) else {
        return false;
    };
    stacked().lock().is_ok_and(|windows| {
        windows
            .values()
            .any(|ids| ids.iter().any(|other| other == id))
    })
}

/// The page is closed, or about to be shown or parked: it no longer holds a
/// stacked place, and a pending background check is dropped. Returns whether
/// the page was backgrounded.
pub(super) fn unstack(id: &str) -> bool {
    if let Ok(mut windows) = stacked().lock() {
        for ids in windows.values_mut() {
            ids.retain(|other| other != id);
        }
    }
    if let Ok(mut sizes) = stacked_window_sizes().lock() {
        sizes.remove(id);
    }
    background_states()
        .lock()
        .ok()
        .and_then(|mut states| states.remove(id))
        .is_some_and(|(_, backgrounded)| backgrounded)
}

/// The page is shown or parked: it leaves its stacked place and, if it was
/// backgrounded, runs again before anything else reaches it.
pub(super) fn wake(webview: &Webview) {
    if let Some(id) = page_id(webview) {
        if unstack(id) {
            let _ = webview.eval("window.__MISTY_SET_BACKGROUNDED__?.(false);");
        }
    }
}

/// Drops a page to the bottom of its host's stacking order without moving it,
/// so a parked page loaded in the background can then move into place beneath
/// the renderer and wait there drawn, as a stacked page does.
pub(super) fn place_beneath(webview: &Webview) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{
            SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
        },
    };
    webview
        .with_webview(|platform| {
            let mut child = Default::default();
            // SAFETY: the controller is live during this UI-thread callback.
            if unsafe { platform.controller().ParentWindow(&mut child) }.is_err() {
                return;
            }
            // SAFETY: a window owned by this thread.
            unsafe {
                SetWindowPos(
                    child.0 as HWND,
                    HWND_BOTTOM,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOOWNERZORDER | SWP_NOSIZE,
                );
            }
        })
        .map_err(|error| error.to_string())
}

/// Hides a page by dropping it beneath every other window in its host, in
/// place. A page that is parked, or held for its first paint, stays parked.
pub(super) fn stack_windows_webview(app: &AppHandle, webview: &Webview) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::HWND,
        UI::{
            Input::KeyboardAndMouse::{GetFocus, SetFocus},
            WindowsAndMessaging::{
                IsChild, SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER,
                SWP_NOSIZE,
            },
        },
    };
    let Some(id) = page_id(webview).map(str::to_owned) else {
        return park_windows_webview(webview);
    };
    let parked = webview
        .position()
        .is_ok_and(|position| position.x <= -10_000 && position.y <= -10_000);
    if parked || is_held_view(webview) {
        return park_windows_webview(webview);
    }
    let renderer = renderer(webview.window().label()).native;
    webview
        .with_webview(move |platform| {
            let mut child = Default::default();
            // SAFETY: the controller is live during this UI-thread callback.
            if unsafe { platform.controller().ParentWindow(&mut child) }.is_err() {
                return;
            }
            let child = child.0 as HWND;
            // SAFETY: windows owned by this thread.
            unsafe {
                // Just beneath the renderer, not the very bottom: the page left last is then
                // the first one a gap in a fast switch can show through, instead of a tab
                // hidden long ago that now sits above every recent one.
                let insert_after = if renderer != 0 {
                    renderer as HWND
                } else {
                    HWND_BOTTOM
                };
                SetWindowPos(
                    child,
                    insert_after,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOOWNERZORDER | SWP_NOSIZE,
                );
                let focused = GetFocus();
                if renderer != 0
                    && !focused.is_null()
                    && (focused == child || IsChild(child, focused) != 0)
                {
                    SetFocus(renderer as HWND);
                }
            }
        })
        .map_err(|error| error.to_string())?;
    let window = webview.window().label().to_owned();
    let overflow = {
        let Ok(mut windows) = stacked().lock() else {
            return Ok(());
        };
        for ids in windows.values_mut() {
            ids.retain(|other| *other != id);
        }
        let ids = windows.entry(window).or_default();
        ids.push(id.clone());
        let extra = ids.len().saturating_sub(STACKED_PER_WINDOW);
        ids.drain(..extra).collect::<Vec<_>>()
    };
    if let (Some(size), Ok(mut sizes)) = (window_size(webview), stacked_window_sizes().lock()) {
        sizes.insert(id.clone(), size);
    }
    schedule_background(app, &id);
    for id in overflow {
        if let Some(oldest) = app.get_webview(&format!("misty-browser-{id}")) {
            park_windows_webview(&oldest)?;
        }
    }
    Ok(())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserShowOnlyRequest {
    /// The pages the window's active tabs show now.
    pub ids: Vec<String>,
}

/// Switches the caller's window to `ids` the moment its tabs change, before
/// any layout runs: stacked pages among them come up in place, already drawn,
/// and every other page on screen drops beneath the renderer. Returns the
/// pages it raised; the rest are left to the ordinary reconcile, which also
/// still checks every page's bounds afterward.
#[tauri::command]
pub fn browser_webviews_show_only(
    caller: Webview,
    app: AppHandle,
    request: BrowserShowOnlyRequest,
) -> Result<Vec<String>, String> {
    let window = caller.window().label().to_owned();
    let size = window_size(&caller);
    let mut raised = Vec::new();
    // The pages coming up are raised before any page goes under, so the window is never left
    // with nothing in front for the renderer's transparent area to show through.
    let mut leaving = Vec::new();
    for (label, webview) in app.webviews() {
        let Some(id) = label.strip_prefix("misty-browser-") else {
            continue;
        };
        if webview.window().label() != window {
            continue;
        }
        if request.ids.iter().any(|wanted| wanted == id) {
            let same_window = stacked_window_sizes()
                .lock()
                .is_ok_and(|sizes| size.is_some() && sizes.get(id).copied() == size);
            if is_stacked(&webview) && same_window && !is_held_view(&webview) {
                present_macos_webview(&webview)?;
                raised.push(id.to_owned());
            }
            continue;
        }
        leaving.push(webview);
    }
    for webview in leaving {
        let parked = webview
            .position()
            .is_ok_and(|position| position.x <= -10_000 && position.y <= -10_000);
        if !parked && !is_stacked(&webview) && !is_held_view(&webview) {
            stack_windows_webview(&app, &webview)?;
        }
    }
    Ok(raised)
}
