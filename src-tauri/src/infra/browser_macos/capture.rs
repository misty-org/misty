//! Capturing a region of a Browser page as an image.

use tauri::Webview;

/// WebKit owns rasterization; the shell does not need a second DOM renderer.
#[cfg(target_os = "macos")]
pub(crate) async fn capture_webview_region(
    webview: Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<serde_json::Value, String> {
    capture_webview_region_sized(webview, x, y, width, height, 640.0).await
}

#[cfg(target_os = "macos")]
pub(crate) async fn capture_webview_region_sized(
    webview: Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    max_dimension: f64,
) -> Result<serde_json::Value, String> {
    use base64::Engine;
    use block2::RcBlock;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError, NSNumber, NSPoint, NSRect, NSSize};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
    use std::{sync::Mutex, time::Duration};
    if ![x, y, width, height].iter().all(|n| n.is_finite())
        || x < 0.0
        || y < 0.0
        || width < 8.0
        || height < 8.0
        || width > 10_000.0
        || height > 10_000.0
    {
        return Err("Capture region is invalid.".into());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let sender = Mutex::new(Some(sender));
    webview.with_webview(move |platform| unsafe {
        let setup = || -> Result<(), String> {
            let _mtm = MainThreadMarker::new().ok_or("Capture must run on the main thread.")?;
            let view: &WKWebView = &*platform.inner().cast();
            let bounds = view.bounds();
            if x + width > bounds.size.width + 1.0 || y + height > bounds.size.height + 1.0 {
                return Err("The selected region is outside the current view.".into());
            }
            Ok(())
        };
        if let Err(error) = setup() {
            if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) { let _ = sender.send(Err(error)); }
            return;
        }
        let mtm = MainThreadMarker::new().unwrap();
        let view: &WKWebView = &*platform.inner().cast();
        let config = WKSnapshotConfiguration::new(mtm);
        config.setRect(NSRect::new(NSPoint::new(x,y), NSSize::new(width,height)));
        // Native screenshots retain text detail; the 640px agent captures keep their old budget.
        config.setSnapshotWidth(Some(&NSNumber::new_f64(width * (max_dimension / width.max(height)).min(if max_dimension > 640.0 { 2.0 } else { 1.0 }))));
        config.setAfterScreenUpdates(true);
        let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
            let result = (|| -> Result<serde_json::Value, String> {
                if !error.is_null() || image.is_null() { return Err("WebKit could not capture that region.".into()); }
                let data = (&*image).TIFFRepresentation().ok_or("Capture returned no image.")?;
                let bitmap = NSBitmapImageRep::imageRepWithData(&data).ok_or("Capture image is unavailable.")?;
                let lossless = max_dimension > 640.0;
                let jpeg = bitmap.representationUsingType_properties(if lossless { NSBitmapImageFileType::PNG } else { NSBitmapImageFileType::JPEG }, &NSDictionary::new())
                    .ok_or("Capture could not be encoded.")?;
                Ok(serde_json::json!({"dataUrl":format!("data:image/{};base64,{}", if lossless { "png" } else { "jpeg" }, base64::engine::general_purpose::STANDARD.encode(jpeg.to_vec())),
                    "width":bitmap.pixelsWide(), "height":bitmap.pixelsHigh()}))
            })();
            if let Some(sender) = sender.lock().ok().and_then(|mut sender| sender.take()) { let _ = sender.send(result); }
        });
        view.takeSnapshotWithConfiguration_completionHandler(Some(&config), &handler);
    }).map_err(|error| error.to_string())?;
    tokio::time::timeout(Duration::from_secs(15), receiver)
        .await
        .map_err(|_| "Capture timed out.")?
        .map_err(|_| "Capture was cancelled.")?
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn host_webview_capture_region(
    webview: Webview,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    max_dimension: Option<f64>,
) -> Result<serde_json::Value, String> {
    if !crate::infra::space_windows::is_space_window(webview.label()) {
        return Err("Only the Host can capture its view.".into());
    }
    capture_webview_region_sized(
        webview,
        x,
        y,
        width,
        height,
        max_dimension.unwrap_or(640.0).clamp(640.0, 3840.0),
    )
    .await
}
