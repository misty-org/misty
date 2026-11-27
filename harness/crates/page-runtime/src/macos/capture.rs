use base64::Engine;
use block2::RcBlock;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
use objc2_foundation::{NSDictionary, NSError, NSNumber, NSPoint, NSRect, NSSize};
use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
use serde_json::{json, Value};

pub struct Region {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub fn capture(
    mtm: MainThreadMarker,
    view: &WKWebView,
    region: Region,
    image_width: f64,
    lossless: bool,
    done: impl FnOnce(Result<Value, String>) + 'static,
) {
    let Region {
        x,
        y,
        width,
        height,
    } = region;
    if ![x, y, width, height, image_width]
        .iter()
        .all(|n| n.is_finite())
        || width < 1.0
        || height < 1.0
        || width > 20_000.0
        || height > 40_000.0
        || image_width < 1.0
    {
        done(Err("Capture region is invalid.".into()));
        return;
    }
    let backing = view
        .window()
        .map(|window| window.backingScaleFactor())
        .filter(|scale| *scale > 0.0)
        .unwrap_or(1.0);
    // SAFETY: the live web view's zoom, read on the main thread.
    let zoom = unsafe { view.pageZoom() }.max(0.01);
    // SAFETY: a fresh snapshot configuration, set up on the main thread before WebKit reads it.
    let config = unsafe {
        let config = WKSnapshotConfiguration::new(mtm);
        config.setRect(NSRect::new(
            NSPoint::new(x * zoom, y * zoom),
            NSSize::new(width * zoom, height * zoom),
        ));
        config.setSnapshotWidth(Some(&NSNumber::new_f64(image_width / backing)));
        config.setAfterScreenUpdates(true);
        config
    };
    let done = std::cell::RefCell::new(Some(done));
    let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
        let result = (|| -> Result<Value, String> {
            if !error.is_null() || image.is_null() {
                return Err("WebKit could not capture that region.".into());
            }
            // SAFETY: WebKit hands the snapshot over as a live NSImage.
            let data = unsafe { &*image }
                .TIFFRepresentation()
                .ok_or("Capture returned no image.")?;
            let bitmap =
                NSBitmapImageRep::imageRepWithData(&data).ok_or("Capture image is unavailable.")?;
            // SAFETY: plain AppKit encoding of a bitmap the capture just made.
            let encoded = unsafe {
                bitmap.representationUsingType_properties(
                    if lossless {
                        NSBitmapImageFileType::PNG
                    } else {
                        NSBitmapImageFileType::JPEG
                    },
                    &NSDictionary::new(),
                )
            }
            .ok_or("Capture could not be encoded.")?;
            Ok(json!({
                "dataUrl": format!(
                    "data:image/{};base64,{}",
                    if lossless { "png" } else { "jpeg" },
                    base64::engine::general_purpose::STANDARD.encode(encoded.to_vec())
                ),
                "width": bitmap.pixelsWide(),
                "height": bitmap.pixelsHigh(),
            }))
        })();
        if let Some(done) = done.borrow_mut().take() {
            done(result);
        }
    });
    // SAFETY: called on the main thread with a configuration and handler that outlive the call.
    unsafe { view.takeSnapshotWithConfiguration_completionHandler(Some(&config), &handler) };
}
