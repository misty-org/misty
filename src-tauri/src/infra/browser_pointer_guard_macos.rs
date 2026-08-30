//! Pointer-event isolation for Misty's overlapping macOS webviews.
//!
//! WebKit can keep sending tracking-area callbacks to the main application
//! `WKWebView` even when a sibling browser `WKWebView` is visibly above it.
//! Keep this policy in Misty rather than patching Wry: only tracking owners
//! discovered under the main renderer are filtered, and only inside a visible
//! browser child's frame while that child is above the renderer.

use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    ffi::{c_char, c_uchar},
    sync::{Mutex, OnceLock},
};

use objc2::runtime::{AnyClass, AnyObject, Imp, Method, Sel};
use objc2_app_kit::{NSEvent, NSView};

static MAIN_WEBVIEW_VIEW: OnceLock<usize> = OnceLock::new();
static MAIN_TRACKING_OWNERS: OnceLock<Mutex<HashSet<usize>>> = OnceLock::new();
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
    if let Some(main) = MAIN_WEBVIEW_VIEW.get().copied() {
        discover_main_tracking_owners(&*(main as *const NSView));
    }
    if let Some(window) = view.window() {
        window.discardCursorRects();
        window.resetCursorRects();
    }
}

pub(super) unsafe fn unregister_browser_webview(view: &NSView) {
    if let Ok(mut browser_views) = browser_webview_views().lock() {
        browser_views.remove(&(view as *const NSView as usize));
    }
    if let Some(window) = view.window() {
        window.discardCursorRects();
        window.resetCursorRects();
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

unsafe fn install_pointer_event_overrides(class: &AnyClass) {
    // `mouseExited:` must still clear hover state when the pointer leaves an
    // uncovered part of the main renderer.
    for selector in [
        objc2::sel!(mouseMoved:),
        objc2::sel!(mouseEntered:),
        objc2::sel!(cursorUpdate:),
    ] {
        install_pointer_event_override(class, selector);
    }
}

unsafe fn install_pointer_event_override(class: &AnyClass, selector: Sel) {
    unsafe extern "C" {
        fn class_addMethod(
            cls: *const AnyClass,
            name: Sel,
            imp: Imp,
            types: *const c_char,
        ) -> c_uchar;
        fn method_getTypeEncoding(method: *const Method) -> *const c_char;
    }

    let Ok(mut implementations) = pointer_event_implementations().lock() else {
        return;
    };
    let class_key = class as *const AnyClass as usize;
    if implementations.contains_key(&(class_key, selector)) {
        return;
    }
    let Some(method) = class.instance_method(selector) else {
        return;
    };
    let replacement: unsafe extern "C-unwind" fn(_, _, _) = pointer_event;
    let replacement: Imp = std::mem::transmute(replacement);
    let types = method_getTypeEncoding(method);
    if class_addMethod(class, selector, replacement, types) != 0 {
        implementations.insert((class_key, selector), method.implementation() as usize);
        return;
    }
    if let Some(own_method) = class
        .instance_methods()
        .iter()
        .find(|candidate| candidate.name() == selector)
    {
        let previous = own_method.set_implementation(replacement);
        implementations.insert((class_key, selector), previous as usize);
    }
}

unsafe extern "C-unwind" fn pointer_event(this: &AnyObject, command: Sel, event: &NSEvent) {
    let belongs_to_main = main_tracking_owners()
        .lock()
        .map(|owners| owners.contains(&(this as *const AnyObject as usize)))
        .unwrap_or(false);
    if !belongs_to_main || !browser_child_covers_event(event) {
        call_original_pointer_event(this, command, event);
    }
}

unsafe fn browser_child_covers_event(event: &NSEvent) -> bool {
    let Some(main_pointer) = MAIN_WEBVIEW_VIEW.get().copied() else {
        return false;
    };
    let main: &NSView = &*(main_pointer as *const NSView);
    let Some(parent) = main.superview() else {
        return false;
    };
    let subviews = parent.subviews();
    let Some(main_index) = subviews
        .iter()
        .position(|candidate| std::ptr::eq(&*candidate as *const NSView, main as *const NSView))
    else {
        return false;
    };
    let point = parent.convertPoint_fromView(event.locationInWindow(), None);
    let Ok(browser_views) = browser_webview_views().lock() else {
        return false;
    };
    browser_views.iter().any(|browser_pointer| {
        let browser: &NSView = &*(*browser_pointer as *const NSView);
        if browser.isHidden() {
            return false;
        }
        let Some(browser_parent) = browser.superview() else {
            return false;
        };
        if !std::ptr::eq(&*browser_parent, &*parent) {
            return false;
        }
        let browser_is_above_main = subviews.iter().enumerate().any(|(index, candidate)| {
            index > main_index
                && std::ptr::eq(&*candidate as *const NSView, browser as *const NSView)
        });
        if !browser_is_above_main {
            return false;
        }
        let frame = browser.frame();
        point.x >= frame.origin.x
            && point.y >= frame.origin.y
            && point.x < frame.origin.x + frame.size.width
            && point.y < frame.origin.y + frame.size.height
    })
}

unsafe fn call_original_pointer_event(this: &AnyObject, command: Sel, event: &NSEvent) {
    let object_key = this as *const AnyObject as usize;
    let after_class = POINTER_EVENT_DISPATCH.with(|dispatch| {
        dispatch
            .borrow()
            .iter()
            .rev()
            .find(|(object, selector, _)| *object == object_key && *selector == command)
            .map(|(_, _, class)| *class)
    });
    let Some((class_key, implementation)) =
        original_pointer_event_implementation(this, command, after_class)
    else {
        return;
    };
    POINTER_EVENT_DISPATCH.with(|dispatch| {
        dispatch.borrow_mut().push((object_key, command, class_key));
    });
    let original: unsafe extern "C-unwind" fn(&AnyObject, Sel, &NSEvent) =
        std::mem::transmute(implementation);
    original(this, command, event);
    POINTER_EVENT_DISPATCH.with(|dispatch| {
        dispatch.borrow_mut().pop();
    });
}

fn original_pointer_event_implementation(
    object: &AnyObject,
    selector: Sel,
    after_class: Option<usize>,
) -> Option<(usize, usize)> {
    let implementations = pointer_event_implementations().lock().ok()?;
    let mut class = Some(AnyObject::class(object));
    let mut passed_previous = after_class.is_none();
    while let Some(current) = class {
        let class_key = current as *const AnyClass as usize;
        if passed_previous {
            if let Some(implementation) = implementations.get(&(class_key, selector)) {
                return Some((class_key, *implementation));
            }
        } else if Some(class_key) == after_class {
            passed_previous = true;
        }
        class = current.superclass();
    }
    None
}
