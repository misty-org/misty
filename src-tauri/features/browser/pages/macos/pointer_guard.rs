//! Pointer-event isolation for Misty's overlapping macOS webviews.
//!
//! WebKit can keep sending tracking-area callbacks to the main application
//! `WKWebView` even when a sibling browser `WKWebView` is visibly above it.
//! Filter tracking callbacks in both directions: the renderer beneath a browser
//! page, and browser pages beneath renderer-owned menus and modal panels. AppKit
//! also sends mouse moves straight to the first responder, past every tracking
//! area, so the webviews themselves are filtered as well as their tracking owners.

use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    ffi::{c_char, c_uchar},
    sync::{Mutex, OnceLock},
};

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Imp, Method, Sel};
use objc2_app_kit::{NSEvent, NSView};

mod caret;
mod notice_regions;
mod overrides;
mod panels;
pub(crate) use caret::set_caret_rect;
use caret::*;
pub(crate) use notice_regions::set_notice_rects;
use notice_regions::*;
use overrides::*;
pub(crate) use panels::keep_pointer_on_panel;
use panels::*;

/// Every window has its own renderer. Only ever compared, since a closed window's stays.
static MAIN_WEBVIEW_VIEWS: OnceLock<Mutex<HashSet<usize>>> = OnceLock::new();
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

fn main_webview_views() -> &'static Mutex<HashSet<usize>> {
    MAIN_WEBVIEW_VIEWS.get_or_init(|| Mutex::new(HashSet::new()))
}

/// The renderer among a window's views.
unsafe fn renderer_in(parent: &NSView) -> Option<Retained<NSView>> {
    let renderers = main_webview_views().lock().ok()?;
    let siblings = parent.subviews();
    let renderer = siblings
        .iter()
        .find(|view| renderers.contains(&(&**view as *const NSView as usize)));
    renderer
}

/// Where a page and its window's renderer sit among their views, last on top.
unsafe fn page_and_renderer_order(browser: &NSView) -> Option<(usize, usize)> {
    let parent = browser.superview()?;
    let renderer = renderer_in(&parent)?;
    let siblings = parent.subviews();
    let index = |target: *const NSView| {
        siblings
            .iter()
            .position(|view| std::ptr::eq(&*view as *const NSView, target))
    };
    Some((
        index(browser as *const NSView)?,
        index(&*renderer as *const NSView)?,
    ))
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
pub(crate) unsafe fn install_main_webview_guard(view: &NSView) {
    let pointer = view as *const NSView as usize;
    if let Ok(mut renderers) = main_webview_views().lock() {
        renderers.insert(pointer);
    }
    install_notice_hit_test(view);
    if let Ok(mut owners) = main_tracking_owners().lock() {
        owners.insert(pointer);
    }
    install_pointer_event_overrides(AnyObject::class(
        &*std::ptr::from_ref(view).cast::<AnyObject>(),
    ));
    discover_main_tracking_owners(view);
}

/// Remember a browser root and rescan the main renderer before AppKit rebuilds
/// cursor rectangles. Hidden children remain registered but do not suppress
/// anything until they are shown again.
pub(crate) unsafe fn refresh_browser_webview_guard(view: &NSView) {
    let pointer = view as *const NSView as usize;
    if let Ok(mut browser_views) = browser_webview_views().lock() {
        browser_views.insert(pointer);
    }
    // A closed window's renderer can leave this address behind.
    if let Ok(mut renderers) = main_webview_views().lock() {
        renderers.remove(&pointer);
    }
    if let Ok(mut owners) = browser_tracking_owners().lock() {
        owners.insert(pointer, pointer);
    }
    install_pointer_event_overrides(AnyObject::class(
        &*std::ptr::from_ref(view).cast::<AnyObject>(),
    ));
    install_caret_override(AnyObject::class(
        &*std::ptr::from_ref(view).cast::<AnyObject>(),
    ));
    discover_browser_tracking_owners(view, pointer);
    if let Some(renderer) = view.superview().and_then(|parent| renderer_in(&parent)) {
        discover_main_tracking_owners(&renderer);
    }
    if let Some(window) = view.window() {
        window.discardCursorRects();
        window.resetCursorRects();
    }
}

pub(crate) unsafe fn unregister_browser_webview(view: &NSView) {
    forget_caret(view);
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
    let browser = &*(pointer as *const NSView);
    if browser.isHidden() {
        return true;
    }
    page_and_renderer_order(browser).is_some_and(|(browser_index, main_index)| {
        browser_tracking_is_blocked(false, browser_index, main_index)
    })
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
