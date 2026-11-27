use std::cell::RefCell;

use block2::RcBlock;
use objc2_app_kit::{
    NSAppearance, NSAppearanceCustomization, NSAppearanceNameAqua, NSAppearanceNameDarkAqua,
};
use objc2_foundation::{NSData, NSError, NSString};
use objc2_web_kit::WKWebView;
use serde_json::{json, Value};

pub fn emulate(view: &WKWebView, request: &Value) -> Result<Value, String> {
    let frame = view.frame();
    let shown = frame.size.width;
    if request["reset"] == true {
        // SAFETY: the live web view, on the main thread.
        unsafe { view.setMediaType(None) };
        view.setAppearance(None);
    }
    if let Some(scheme) = request["colorScheme"].as_str() {
        // SAFETY: AppKit's appearance names are immutable static strings.
        let name = unsafe {
            match scheme {
                "dark" => Some(NSAppearanceNameDarkAqua),
                "light" => Some(NSAppearanceNameAqua),
                "no-preference" => None,
                _ => return Err("colorScheme is light, dark or no-preference.".to_owned()),
            }
        };
        let appearance = name.and_then(NSAppearance::appearanceNamed);
        view.setAppearance(appearance.as_deref());
    }
    if let Some(media) = request["media"].as_str() {
        let media = match media {
            "print" => Some(NSString::from_str("print")),
            "screen" => None,
            _ => return Err("media is screen or print.".to_owned()),
        };
        // SAFETY: the live web view, on the main thread.
        unsafe { view.setMediaType(media.as_deref()) };
    }
    // SAFETY: the live web view, on the main thread.
    let (zoom, media) = unsafe { (view.pageZoom(), view.mediaType()) };
    let scheme = view
        .appearance()
        .map(|appearance| {
            if appearance.name().to_string().contains("Dark") {
                "dark"
            } else {
                "light"
            }
        })
        .unwrap_or("no-preference");
    Ok(json!({
        "ok": true,
        "width": (shown / zoom).round() as i64,
        "height": (frame.size.height / zoom).round() as i64,
        "scale": (zoom * 1000.0).round() / 1000.0,
        "colorScheme": scheme,
        "media": media.map(|media| media.to_string()).unwrap_or_else(|| "screen".to_owned()),
    }))
}

pub fn place(view: &WKWebView, fit: &crate::Fit, size: Option<(f64, f64)>) {
    // SAFETY: the live web view's own superview, on the main thread.
    let Some(parent) = (unsafe { view.superview() }) else {
        return;
    };
    let room = parent.bounds();
    let (frame_width, frame_height, zoom) = match size {
        Some(size) => crate::snap(fit, size),
        None => (fit.width, fit.height, 1.0),
    };
    let (x, top) = (fit.x.round(), fit.y.round());
    let y = if parent.isFlipped() { top } else { room.size.height - top - frame_height };
    view.setFrame(objc2_foundation::NSRect::new(
        objc2_foundation::NSPoint::new(x, y),
        objc2_foundation::NSSize::new(frame_width, frame_height),
    ));
    set_scale(view, zoom);
}

pub fn set_scale(view: &WKWebView, scale: f64) {
    // SAFETY: the live web view, on the main thread.
    unsafe { view.setPageZoom(scale) };
}

pub fn pdf(view: &WKWebView, done: impl FnOnce(Result<Vec<u8>, String>) + 'static) {
    let done = RefCell::new(Some(done));
    let handler = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
        let Some(done) = done.borrow_mut().take() else {
            return;
        };
        if !error.is_null() {
            // SAFETY: WebKit passes a valid NSError when it passes one at all.
            let message = unsafe { &*error }.localizedDescription();
            return done(Err(format!("WebKit couldn't make the PDF: {message}")));
        }
        if data.is_null() {
            return done(Err("WebKit made no PDF.".to_owned()));
        }
        // SAFETY: WebKit passes valid PDF data.
        done(Ok(unsafe { &*data }.to_vec()));
    });
    // SAFETY: on the main thread; no configuration makes WebKit print the whole page.
    unsafe { view.createPDFWithConfiguration_completionHandler(None, &handler) };
}
