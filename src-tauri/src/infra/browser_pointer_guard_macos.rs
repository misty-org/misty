//! Pointer-event isolation for Misty's overlapping macOS webviews.
//!
//! WebKit can keep sending tracking-area callbacks to the main application
//! `WKWebView` even when a sibling browser `WKWebView` is visibly above it.
//! Filter tracking callbacks in both directions: the renderer beneath a browser
//! page, and browser pages beneath renderer-owned menus and modal panels.

use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    ffi::{c_char, c_uchar},
    sync::{Mutex, OnceLock},
};

use objc2::runtime::{AnyClass, AnyObject, Imp, Method, Sel};
use objc2_app_kit::{NSEvent, NSView};

mod overrides;
use overrides::*;

static MAIN_WEBVIEW_VIEW: OnceLock<usize> = OnceLock::new();
static MAIN_TRACKING_OWNERS: OnceLock<Mutex<HashSet<usize>>> = OnceLock::new();
static BROWSER_TRACKING_OWNERS: OnceLock<Mutex<HashMap<usize, usize>>> = OnceLock::new();
static BROWSER_WEBVIEW_VIEWS: OnceLock<Mutex<HashSet<usize>>> = OnceLock::new();
static POINTER_EVENT_IMPLEMENTATIONS: OnceLock<Mutex<HashMap<(usize, Sel), usize>>> =
    OnceLock::new();

thread_local! {
    /// Objective-C implementations can call their superclass implementation.
    /// Track the active class so an override installed on both classes keeps
    /// walking up instead of redispatching to itself.
    static POINTER_EVENT_DISPATCH: RefCell<Vec<(usize, Sel, usize)>> = const { RefCell::new(Vec::new()) };
}

fn main_tracking_owners() -> &'static Mutex<HashSet<usize>> {
    MAIN_TRACKING_OWNERS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn browser_webview_views() -> &'static Mutex<HashSet<usize>> {
    BROWSER_WEBVIEW_VIEWS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn pointer_event_implementations() -> &'static Mutex<HashMap<(usize, Sel), usize>> {
    POINTER_EVENT_IMPLEMENTATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Install filtering for the main application webview's current WebKit
/// tracking owners. This is safe to repeat because WebKit can add descendants
/// after its root view is created.
pub(super) unsafe fn install_main_webview_guard(view: &NSView) {
    let _ = MAIN_WEBVIEW_VIEW.set(view as *const NSView as usize);
    discover_main_tracking_owners(view);
}

/// Remember a browser root and rescan the main renderer before AppKit rebuilds
/// cursor rectangles. Hidden children remain registered but do not suppress
/// anything until they are shown again.
pub(super) unsafe fn refresh_browser_webview_guard(view: &NSView) {
    if let Ok(mut browser_views) = browser_webview_views().lock() {
        browser_views.insert(view as *const NSView as usize);
    }
    discover_browser_tracking_owners(view, view as *const NSView as usize);
    if let Some(main) = MAIN_WEBVIEW_VIEW.get().copied() {
        discover_main_tracking_owners(&*(main as *const NSView));
    }
    if let Some(window) = view.window() {
        window.discardCursorRects();
        window.resetCursorRects();
    }
}

pub(super) unsafe fn unregister_browser_webview(view: &NSView) {
    if let Ok(mut owners) = browser_tracking_owners().lock() {
        owners.retain(|_, root| *root != view as *const NSView as usize);
    }
    if let Ok(mut browser_views) = browser_webview_views().lock() {
        browser_views.remove(&(view as *const NSView as usize));
    }
    if let Some(window) = view.window() {
        window.discardCursorRects();
        window.resetCursorRects();
    }
}

fn browser_tracking_owners() -> &'static Mutex<HashMap<usize, usize>> {
    BROWSER_TRACKING_OWNERS.get_or_init(|| Mutex::new(HashMap::new()))
}

unsafe fn discover_browser_tracking_owners(view: &NSView, root: usize) {
    // WebKit creates tracking owners lazily, so rescan after layout and page loads.
    for area in view.trackingAreas().iter() {
        let Some(owner) = area.owner() else {
            continue;
        };
        if let Ok(mut owners) = browser_tracking_owners().lock() {
            owners.insert(&*owner as *const AnyObject as usize, root);
        }
        install_pointer_event_overrides(AnyObject::class(&*owner));
    }
    for child in view.subviews().iter() {
        discover_browser_tracking_owners(&child, root);
    }
}

// Tracking-area callbacks bypass ordinary view hit testing. Sibling ordering
// must therefore gate them explicitly, including hover and cursor changes.
fn browser_tracking_is_blocked(hidden: bool, browser_index: usize, main_index: usize) -> bool {
    hidden || browser_index < main_index
}

unsafe fn browser_is_below_renderer(pointer: usize) -> bool {
    let Some(main_pointer) = MAIN_WEBVIEW_VIEW.get().copied() else {
        return false;
    };
    let browser = &*(pointer as *const NSView);
    if browser.isHidden() {
        return true;
    }
    let Some(parent) = browser.superview() else {
        return false;
    };
    let siblings = parent.subviews();
    let browser_index = siblings
        .iter()
        .position(|view| &*view as *const NSView as usize == pointer);
    let main_index = siblings
        .iter()
        .position(|view| &*view as *const NSView as usize == main_pointer);
    match (browser_index, main_index) {
        (Some(browser_index), Some(main_index)) => {
            browser_tracking_is_blocked(false, browser_index, main_index)
        }
        _ => false,
    }
}

unsafe fn discover_main_tracking_owners(view: &NSView) {
    for area in view.trackingAreas().iter() {
        let Some(owner) = area.owner() else {
            continue;
        };
        if let Ok(mut owners) = main_tracking_owners().lock() {
            owners.insert(&*owner as *const AnyObject as usize);
        }
        install_pointer_event_overrides(AnyObject::class(&*owner));
    }
    for child in view.subviews().iter() {
        discover_main_tracking_owners(&child);
    }
}

#[cfg(test)]
mod tests;
