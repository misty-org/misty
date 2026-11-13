//! Page captures on WebKitGTK: the view's visible area, drawn by WebKit itself, so
//! cross-origin frames, video and canvas look as they do on screen.
use serde_json::{json, Value};
use tauri::Webview;

/// Agent screenshots are lossless, up to this many pixels on their longest side (as on Windows).
const MAX_SIDE: f64 = 2560.0;

/// The visible page, as `{ dataUrl, width, height }`.
pub async fn capture(webview: Webview) -> Result<Value, String> {
    // Misty's control ring is drawn into the page; leave it out of the picture.
    let _ = webview.eval(OVERLAY_HIDE);
    let (send, receive) = tokio::sync::oneshot::channel();
    let started = webview.with_webview(move |platform| {
        use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};
        platform.inner().snapshot(
            SnapshotRegion::Visible,
            SnapshotOptions::NONE,
            None::<&gtk::gio::Cancellable>,
            move |result| {
                let pixels = result
                    .map_err(|error| format!("WebKit couldn't capture the page: {error}"))
                    .and_then(pixels);
                let _ = send.send(pixels);
            },
        );
    });
    let shot = match started {
        Ok(()) => receive
            .await
            .unwrap_or_else(|_| Err("The page closed before its capture finished.".to_owned())),
        Err(error) => Err(error.to_string()),
    };
    let _ = webview.eval(OVERLAY_SHOW);
    let (width, height, rgba) = shot?;
    let png = tokio::task::spawn_blocking(move || encode_png(width, height, rgba))
        .await
        .map_err(|_| "Encoding the capture stopped.".to_owned())??;
    use base64::Engine;
    let data = base64::engine::general_purpose::STANDARD.encode(png);
    Ok(json!({
        "dataUrl": format!("data:image/png;base64,{data}"),
        "width": width,
        "height": height,
    }))
}

/// The snapshot's pixels as straight RGBA, scaled down to `MAX_SIDE`. Runs on the GTK thread,
/// which owns the surface; encoding happens off it.
fn pixels(surface: gtk::cairo::Surface) -> Result<(u32, u32, Vec<u8>), String> {
    use gtk::cairo::{Context, Format, ImageSurface};
    let invalid = |_| "WebKit returned an unreadable capture.".to_owned();
    let snapshot = ImageSurface::try_from(surface).map_err(invalid)?;
    let (source_width, source_height) = (snapshot.width().max(1), snapshot.height().max(1));
    let scale = (MAX_SIDE / f64::from(source_width.max(source_height))).min(1.0);
    let width = ((f64::from(source_width) * scale).round() as i32).max(1);
    let height = ((f64::from(source_height) * scale).round() as i32).max(1);
    // Drawn into a surface Misty owns alone, so its bytes can be borrowed.
    let mut copy =
        ImageSurface::create(Format::ARgb32, width, height).map_err(|error| error.to_string())?;
    {
        let context = Context::new(&copy).map_err(|error| error.to_string())?;
        context.scale(scale, scale);
        context
            .set_source_surface(&snapshot, 0.0, 0.0)
            .map_err(|error| error.to_string())?;
        context.paint().map_err(|error| error.to_string())?;
    }
    copy.flush();
    let stride = copy.stride() as usize;
    let data = copy.data().map_err(|error| error.to_string())?;
    let (width, height) = (width as usize, height as usize);
    let mut rgba = Vec::with_capacity(width * height * 4);
    for row in 0..height {
        for pixel in data[row * stride..row * stride + width * 4].chunks_exact(4) {
            // Cairo's ARGB32 is premultiplied and native-endian: B, G, R, A in memory on x86 and ARM.
            let word = u32::from_ne_bytes([pixel[0], pixel[1], pixel[2], pixel[3]]);
            let alpha = (word >> 24) as u8;
            let straight = |channel: u32| -> u8 {
                let channel = (channel & 0xff) as u8;
                if alpha == 0 || alpha == 255 {
                    channel
                } else {
                    ((u32::from(channel) * 255 + u32::from(alpha) / 2) / u32::from(alpha)).min(255)
                        as u8
                }
            };
            rgba.extend_from_slice(&[
                straight(word >> 16),
                straight(word >> 8),
                straight(word),
                alpha,
            ]);
        }
    }
    Ok((width as u32, height as u32, rgba))
}

fn encode_png(width: u32, height: u32, rgba: Vec<u8>) -> Result<Vec<u8>, String> {
    let image = image::RgbaImage::from_raw(width, height, rgba)
        .ok_or_else(|| "The capture's size didn't match its pixels.".to_owned())?;
    let mut png = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut png, image::ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(png.into_inner())
}

// The same overlay toggles the Windows capture uses (pages/windows/capture.rs).
const OVERLAY_HIDE: &str = "(() => { for (const id of ['misty-native-companion', 'misty-agent-ring']) { const e = document.getElementById(id); if (e) { e.dataset.mistyCaptureDisplay = e.style.display; e.style.setProperty('display', 'none', 'important'); } } })()";
const OVERLAY_SHOW: &str = "(() => { for (const id of ['misty-native-companion', 'misty-agent-ring']) { const e = document.getElementById(id); if (e && 'mistyCaptureDisplay' in e.dataset) { e.style.display = e.dataset.mistyCaptureDisplay; delete e.dataset.mistyCaptureDisplay; } } })()";
