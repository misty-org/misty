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
use crate::browser::*;

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

pub(in crate::browser) fn is_stacked(webview: &Webview) -> bool {
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
/// stacked place.
pub(in crate::browser) fn unstack(id: &str) {
    if let Ok(mut windows) = stacked().lock() {
        for ids in windows.values_mut() {
            ids.retain(|other| other != id);
        }
    }
}

/// The page is shown or parked: it leaves its stacked place.
pub(in crate::browser) fn wake(webview: &Webview) {
    if let Some(id) = page_id(webview) {
        unstack(id);
    }
}

/// Hides a page by dropping it beneath every other window in its host, in
/// place. A page that is parked, or held for its first paint, stays parked.
pub(in crate::browser) fn stack_windows_webview(
    app: &AppHandle,
    webview: &Webview,
) -> Result<(), String> {
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
    for id in overflow {
        if let Some(oldest) = app.get_webview(&format!("misty-browser-{id}")) {
            park_windows_webview(&oldest)?;
        }
    }
    Ok(())
}
