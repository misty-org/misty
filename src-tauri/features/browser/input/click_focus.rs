use objc2::runtime::{AnyObject, Bool};
use objc2::{class, msg_send};
use objc2_app_kit::{NSEvent, NSView};
use objc2_foundation::NSPoint;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize)]
struct BrowserPagePointerDown {
    x: f64,
    y: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    navigate: Option<&'static str>,
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
    let renderer = crate::browser::renderer(&label).native as *mut NSView;
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
    let button: isize = msg_send![event, buttonNumber];
    let navigate = match button {
        3 => Some("back"),
        4 => Some("forward"),
        _ => None,
    };
    let point: NSPoint =
        msg_send![renderer, convertPoint: location, fromView: std::ptr::null::<NSView>()];
    let _ = app.emit_to(
        label,
        "misty://browser-page-pointer-down",
        BrowserPagePointerDown {
            x: point.x,
            y: point.y,
            navigate,
        },
    );
}
