//! Opening the page's own context menu at a point, as a trusted click.
use tauri::Webview;

/// Delivers a right-click straight to the page at a fraction of its bounds.
/// While a renderer overlay is open the page sits beneath the renderer, so a
/// physical click there reaches Misty's UI instead. Sending it to the WKWebView
/// directly gives the page a trusted contextmenu event, which opens this menu.
#[cfg(target_os = "macos")]
pub(in crate::infra) fn right_click(view: &Webview, x: f64, y: f64) -> Result<(), String> {
    use objc2::rc::Retained;
    use objc2_app_kit::{NSEvent, NSEventModifierFlags, NSEventType, NSView};
    use objc2_foundation::{NSPoint, NSProcessInfo};
    view.with_webview(move |platform| unsafe {
        let view: &NSView = &*platform.inner().cast();
        let Some(window) = view.window() else { return };
        if view.isHiddenOrHasHiddenAncestor() {
            return;
        }
        let bounds = view.bounds();
        let (x, y) = (x.clamp(0.0, 1.0), y.clamp(0.0, 1.0));
        let local = NSPoint::new(
            bounds.origin.x + x * bounds.size.width,
            bounds.origin.y + (if view.isFlipped() { y } else { 1.0 - y }) * bounds.size.height,
        );
        let location = view.convertPoint_toView(local, None);
        let time = NSProcessInfo::processInfo().systemUptime();
        for kind in [NSEventType::RightMouseDown, NSEventType::RightMouseUp] {
            let pressure: f32 = if kind == NSEventType::RightMouseDown {
                1.0
            } else {
                0.0
            };
            let event: Option<Retained<NSEvent>> = objc2::msg_send![
                objc2::class!(NSEvent),
                mouseEventWithType: kind,
                location: location,
                modifierFlags: NSEventModifierFlags(0),
                timestamp: time,
                windowNumber: window.windowNumber(),
                context: std::ptr::null::<objc2::runtime::AnyObject>(),
                eventNumber: 0isize,
                clickCount: 1isize,
                pressure: pressure
            ];
            let Some(event) = event else { return };
            if kind == NSEventType::RightMouseDown {
                view.rightMouseDown(&event);
            } else {
                view.rightMouseUp(&event);
            }
        }
    })
    .map_err(|error| error.to_string())
}

/// Delivers a right-click to the page at a fraction of its bounds through CDP,
/// so the page gets a trusted contextmenu event, which opens this menu.
#[cfg(windows)]
pub(in crate::infra) fn right_click(view: &Webview, x: f64, y: f64) -> Result<(), String> {
    use crate::infra::webview2::{click, css_viewport, MouseButton};
    let view = view.clone();
    let (x, y) = (x.clamp(0.0, 1.0), y.clamp(0.0, 1.0));
    tauri::async_runtime::spawn(async move {
        if let Ok((width, height)) = css_viewport(&view).await {
            let _ = click(&view, x * width, y * height, MouseButton::Right, 1).await;
        }
    });
    Ok(())
}

#[cfg(not(any(target_os = "macos", windows)))]
pub(in crate::infra) fn right_click(_view: &Webview, _x: f64, _y: f64) -> Result<(), String> {
    Ok(())
}
