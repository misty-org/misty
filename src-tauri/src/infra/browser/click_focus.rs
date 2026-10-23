//! Activates a Browser page's pane on the click itself. The page is a separate
//! native view outside the renderer's DOM, and its own focus script runs in the
//! web content process, where a busy or hostile page can delay or swallow it.
//! AppKit hands every mouse-down to this monitor before routing it to a view,
//! so the renderer learns which page was clicked before the page does.

use objc2::runtime::{AnyObject, Bool};
use objc2::{class, msg_send};
use objc2_app_kit::{NSEvent, NSView};
use objc2_foundation::NSPoint;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// The click in the renderer view's points (CSS pixels times app zoom), from the top left.
#[derive(Clone, Serialize)]
struct BrowserPagePointerDown {
    x: f64,
    y: f64,
}

pub(crate) fn install(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || unsafe { add_monitor(handle) });
}

unsafe fn add_monitor(app: AppHandle) {
    let handler = block2::RcBlock::new(move |event: *mut NSEvent| -> *mut NSEvent {
        if let Some(event) = event.as_ref() {
            report_page_click(&app, event);
        }
        event
    });
    // Left, right and other mouse-down. AppKit copies the handler and keeps the
    // monitor for the app's lifetime; the event is always passed through.
    let mask: u64 = (1 << 1) | (1 << 3) | (1 << 25);
    let _: *mut AnyObject = msg_send![
        class!(NSEvent),
        addLocalMonitorForEventsMatchingMask: mask,
        handler: &*handler
    ];
}

unsafe fn report_page_click(app: &AppHandle, event: &NSEvent) {
    let window: *mut AnyObject = msg_send![event, window];
    if window.is_null() {
        return;
    }
    let Some(label) = app.windows().into_iter().find_map(|(label, candidate)| {
        (candidate.ns_window().ok()? == window.cast()).then_some(label)
    }) else {
        return;
    };
    let renderer = super::renderer(&label).native as *mut NSView;
    if renderer.is_null() {
        return;
    }
    let content: *mut NSView = msg_send![window, contentView];
    if content.is_null() {
        return;
    }
    let location: NSPoint = msg_send![event, locationInWindow];
    let superview: *mut NSView = msg_send![content, superview];
    let point: NSPoint = if superview.is_null() {
        location
    } else {
        msg_send![superview, convertPoint: location, fromView: std::ptr::null::<NSView>()]
    };
    let mut view: *mut NSView = msg_send![content, hitTest: point];
    // Only a click that lands in a page's own view counts; while a popup raises
    // the renderer above the page, the renderer receives it as app UI.
    let web_view = class!(WKWebView);
    loop {
        if view.is_null() || view == renderer {
            return;
        }
        let page: Bool = msg_send![view, isKindOfClass: web_view];
        if page.as_bool() {
            break;
        }
        view = msg_send![view, superview];
    }
    // WKWebView is flipped, so this is already measured from the top.
    let point: NSPoint =
        msg_send![renderer, convertPoint: location, fromView: std::ptr::null::<NSView>()];
    let _ = app.emit_to(
        label,
        "misty://browser-page-pointer-down",
        BrowserPagePointerDown {
            x: point.x,
            y: point.y,
        },
    );
}
