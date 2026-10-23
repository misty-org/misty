//! Display captures, sized for the vision models that read them.
use super::ForegroundWindow;

/// The size a display is sent at. Vision providers resize larger images before
/// the model sees them (OpenAI to a 768px short side, Anthropic to a 1568px
/// long side), which would shift every point, so stay inside both bounds.
/// Matches `CompanionCaptureScale` in MistyCompanionCapture.m.
pub fn companion_capture_size(width: u32, height: u32) -> (u32, u32) {
    let (w, h) = (width.max(1) as f64, height.max(1) as f64);
    let scale = (768.0 / w.min(h)).min(1568.0 / w.max(h)).min(1.0);
    (((w * scale) as u32).max(1), ((h * scale) as u32).max(1))
}

// Windows and macOS 12–13 retain xcap: SCScreenshotManager requires macOS 14.
pub(super) fn capture_legacy_display(
    monitor: &xcap::Monitor,
) -> Result<(Vec<u8>, u32, u32), String> {
    let image =
        image::DynamicImage::ImageRgba8(monitor.capture_image().map_err(|e| e.to_string())?);
    encode_capture(image)
}

pub(super) fn encode_capture(image: image::DynamicImage) -> Result<(Vec<u8>, u32, u32), String> {
    let (width, height) = companion_capture_size(image.width(), image.height());
    let resized = image
        .resize_exact(width, height, image::imageops::FilterType::Lanczos3)
        .to_rgb8();
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 80)
        .encode_image(&resized)
        .map_err(|e| e.to_string())?;
    Ok((bytes, resized.width(), resized.height()))
}

#[cfg(target_os = "macos")]
pub fn capture_display(monitor: &xcap::Monitor) -> Result<(Vec<u8>, u32, u32), String> {
    use base64::Engine;
    unsafe extern "C" {
        fn misty_companion_capture_display(display_id: u32) -> *mut std::ffi::c_char;
    }
    let raw = unsafe { misty_companion_capture_display(monitor.id().map_err(|e| e.to_string())?) };
    if raw.is_null() {
        return Err("Screen capture returned no image".into());
    }
    let decoded = unsafe {
        serde_json::from_slice::<serde_json::Value>(std::ffi::CStr::from_ptr(raw).to_bytes())
    };
    unsafe {
        libc::free(raw.cast());
    }
    let value = decoded.map_err(|e| e.to_string())?;
    if value["legacy_capture"].as_bool() == Some(true) {
        return capture_legacy_display(monitor);
    }
    if let Some(error) = value["error"].as_str() {
        return Err(error.into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(
            value["jpeg"]
                .as_str()
                .ok_or("Screen capture returned no image")?,
        )
        .map_err(|e| e.to_string())?;
    let width = value["width"].as_u64().ok_or("Invalid capture width")? as u32;
    let height = value["height"].as_u64().ok_or("Invalid capture height")? as u32;
    Ok((bytes, width, height))
}

#[cfg(windows)]
pub fn capture_display(monitor: &xcap::Monitor) -> Result<(Vec<u8>, u32, u32), String> {
    capture_legacy_display(monitor)
}

/// The window's area of `display`, in pixels of the display's own image.
fn window_crop(
    display: &super::super::Display,
    window: &ForegroundWindow,
    scale: f64,
) -> Option<(u32, u32, u32, u32)> {
    let left = window.x.max(display.x);
    let top = window.y.max(display.y);
    let right = (window.x + window.width).min(display.x + display.width);
    let bottom = (window.y + window.height).min(display.y + display.height);
    if right - left < 1. || bottom - top < 1. {
        return None;
    }
    Some((
        ((left - display.x) * scale).round() as u32,
        ((top - display.y) * scale).round() as u32,
        ((right - left) * scale).round().max(1.) as u32,
        ((bottom - top) * scale).round().max(1.) as u32,
    ))
}

/// The focused window at the display's full resolution, cropped to the part
/// on `display`, then fitted to `companion_capture_size`. Returns the image and
/// the captured area in global units.
#[cfg(windows)]
pub fn capture_window(
    monitor: &xcap::Monitor,
    display: &super::super::Display,
    window: &ForegroundWindow,
) -> Result<(Vec<u8>, u32, u32, super::super::Display), String> {
    capture_window_legacy(monitor, display, window)
}

#[cfg(target_os = "macos")]
pub fn capture_window(
    monitor: &xcap::Monitor,
    display: &super::super::Display,
    window: &ForegroundWindow,
) -> Result<(Vec<u8>, u32, u32, super::super::Display), String> {
    use base64::Engine;
    unsafe extern "C" {
        fn misty_companion_capture_rect(
            display_id: u32,
            x: f64,
            y: f64,
            width: f64,
            height: f64,
            scale: f64,
        ) -> *mut std::ffi::c_char;
    }
    let (x, y, width, height) =
        window_crop(display, window, 1.).ok_or("The focused window is off this display")?;
    let raw = unsafe {
        misty_companion_capture_rect(
            display.id,
            x as f64,
            y as f64,
            width as f64,
            height as f64,
            display.scale,
        )
    };
    if raw.is_null() {
        return Err("Window capture returned no image".into());
    }
    let decoded = unsafe {
        serde_json::from_slice::<serde_json::Value>(std::ffi::CStr::from_ptr(raw).to_bytes())
    };
    unsafe {
        libc::free(raw.cast());
    }
    let value = decoded.map_err(|e| e.to_string())?;
    if value["legacy_capture"].as_bool() == Some(true) {
        return capture_window_legacy(monitor, display, window);
    }
    if let Some(error) = value["error"].as_str() {
        return Err(error.into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(
            value["jpeg"]
                .as_str()
                .ok_or("Window capture returned no image")?,
        )
        .map_err(|e| e.to_string())?;
    let image_width = value["width"].as_u64().ok_or("Invalid capture width")? as u32;
    let image_height = value["height"].as_u64().ok_or("Invalid capture height")? as u32;
    Ok((
        bytes,
        image_width,
        image_height,
        super::super::Display {
            x: display.x + x as f64,
            y: display.y + y as f64,
            width: width as f64,
            height: height as f64,
            ..display.clone()
        },
    ))
}

fn capture_window_legacy(
    monitor: &xcap::Monitor,
    display: &super::super::Display,
    window: &ForegroundWindow,
) -> Result<(Vec<u8>, u32, u32, super::super::Display), String> {
    let full = monitor.capture_image().map_err(|e| e.to_string())?;
    // Display units are points on macOS and pixels on Windows; the image is pixels.
    let scale = full.width() as f64 / display.width.max(1.);
    let (x, y, width, height) =
        window_crop(display, window, scale).ok_or("The focused window is off this display")?;
    let width = width.min(full.width().saturating_sub(x));
    let height = height.min(full.height().saturating_sub(y));
    if width == 0 || height == 0 {
        return Err("The focused window is off this display".into());
    }
    let cropped = image::DynamicImage::ImageRgba8(full).crop_imm(x, y, width, height);
    let (bytes, image_width, image_height) = encode_capture(cropped)?;
    Ok((
        bytes,
        image_width,
        image_height,
        super::super::Display {
            x: display.x + x as f64 / scale,
            y: display.y + y as f64 / scale,
            width: width as f64 / scale,
            height: height as f64 / scale,
            ..display.clone()
        },
    ))
}
