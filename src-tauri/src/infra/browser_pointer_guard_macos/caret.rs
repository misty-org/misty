//! Where the system's AutoFill suggestions open. WebKit answers the text input system's "where is
//! the caret" question from the page, and on a page view placed inside Misty's window the answer
//! lands at the view's left edge. The page reports its focused field's rectangle instead, and the
//! page view answers with that.
use super::*;
use objc2_foundation::{NSPoint, NSRect, NSSize};
use std::collections::HashMap;

/// The focused field of each page view, in page pixels: x, y, width, height.
static CARET_RECTS: OnceLock<Mutex<HashMap<usize, [f64; 4]>>> = OnceLock::new();

fn caret_rects() -> &'static Mutex<HashMap<usize, [f64; 4]>> {
    CARET_RECTS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Records (or clears) a page view's focused field.
pub(in crate::infra) fn set_caret_rect(webview: &tauri::Webview, rect: Option<[f64; 4]>) {
    let _ = webview.with_webview(move |platform_webview| {
        let key = platform_webview.inner() as usize;
        if let Ok(mut rects) = caret_rects().lock() {
            match rect {
                Some(rect) => rects.insert(key, rect),
                None => rects.remove(&key),
            };
        }
    });
}

pub(super) unsafe fn forget_caret(view: &NSView) {
    if let Ok(mut rects) = caret_rects().lock() {
        rects.remove(&(view as *const NSView as usize));
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub(super) struct TextRange {
    location: usize,
    length: usize,
}

pub(super) unsafe fn install_caret_override(class: &AnyClass) {
    let selector = objc2::sel!(firstRectForCharacterRange:actualRange:);
    let replacement: unsafe extern "C-unwind" fn(
        &NSView,
        Sel,
        TextRange,
        *mut TextRange,
    ) -> NSRect = first_rect;
    install_method_override(class, selector, std::mem::transmute(replacement));
}

/// The field's rectangle on the screen, if the page reported one.
unsafe fn field_on_screen(view: &NSView) -> Option<NSRect> {
    let [x, y, w, h] = *caret_rects()
        .lock()
        .ok()?
        .get(&(view as *const NSView as usize))?;
    let zoom: f64 = objc2::msg_send![view, pageZoom];
    let zoom = if zoom.is_finite() && zoom > 0.0 {
        zoom
    } else {
        1.0
    };
    // A web view is flipped, so page pixels times its zoom are points from its top left.
    let local = NSRect::new(
        NSPoint::new(x * zoom, y * zoom),
        NSSize::new(w * zoom, h * zoom),
    );
    let in_window = view.convertRect_toView(local, None);
    Some(view.window()?.convertRectToScreen(in_window))
}

unsafe extern "C-unwind" fn first_rect(
    this: &NSView,
    command: Sel,
    range: TextRange,
    actual: *mut TextRange,
) -> NSRect {
    if let Some(rect) = field_on_screen(this) {
        return rect;
    }
    let object = &*std::ptr::from_ref(this).cast::<AnyObject>();
    let Some((_, implementation)) = original_pointer_event_implementation(object, command, None)
    else {
        return NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(0.0, 0.0));
    };
    let original: unsafe extern "C-unwind" fn(&NSView, Sel, TextRange, *mut TextRange) -> NSRect =
        std::mem::transmute(implementation);
    original(this, command, range, actual)
}
