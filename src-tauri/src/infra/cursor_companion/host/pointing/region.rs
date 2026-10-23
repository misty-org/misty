//! Full-resolution crops of one display around a companion point.
#[cfg(target_os = "macos")]
use super::native_json;
use super::RegionCapture;

#[cfg(target_os = "macos")]
pub fn capture_region(
    monitor: &xcap::Monitor,
    region: (f64, f64, f64, f64),
    max_side: f64,
) -> Result<RegionCapture, String> {
    use base64::Engine;
    unsafe extern "C" {
        fn misty_companion_capture_region(
            display_id: u32,
            x: f64,
            y: f64,
            width: f64,
            height: f64,
            max_side: f64,
        ) -> *mut std::ffi::c_char;
    }
    let id = monitor.id().map_err(|e| e.to_string())?;
    let value = native_json(unsafe {
        misty_companion_capture_region(id, region.0, region.1, region.2, region.3, max_side)
    })?;
    if value["legacy_capture"].as_bool() == Some(true) {
        return capture_legacy_region(monitor, region, max_side);
    }
    if let Some(error) = value["error"].as_str() {
        return Err(error.into());
    }
    let number = |key: &str| value[key].as_f64().ok_or(format!("Invalid region {key}"));
    Ok(RegionCapture {
        bytes: base64::engine::general_purpose::STANDARD
            .decode(
                value["jpeg"]
                    .as_str()
                    .ok_or("Region capture returned no image")?,
            )
            .map_err(|e| e.to_string())?,
        width: number("width")? as u32,
        height: number("height")? as u32,
        x: number("x")?,
        y: number("y")?,
        region_width: number("regionWidth")?,
        region_height: number("regionHeight")?,
    })
}

#[cfg(windows)]
pub fn capture_region(
    monitor: &xcap::Monitor,
    region: (f64, f64, f64, f64),
    max_side: f64,
) -> Result<RegionCapture, String> {
    capture_legacy_region(monitor, region, max_side)
}

/// Crops a full display capture. The display's units map to its pixels by the
/// capture's own width, which also covers Retina displays on macOS 12–13.
fn capture_legacy_region(
    monitor: &xcap::Monitor,
    region: (f64, f64, f64, f64),
    max_side: f64,
) -> Result<RegionCapture, String> {
    let display_width = monitor.width().map_err(|e| e.to_string())? as f64;
    let display_height = monitor.height().map_err(|e| e.to_string())? as f64;
    let image =
        image::DynamicImage::ImageRgba8(monitor.capture_image().map_err(|e| e.to_string())?);
    let (left, top) = (region.0.max(0.), region.1.max(0.));
    let (right, bottom) = (
        (region.0 + region.2).min(display_width),
        (region.1 + region.3).min(display_height),
    );
    if right <= left || bottom <= top {
        return Err("The region is outside the display.".into());
    }
    let factor = image.width() as f64 / display_width.max(1.);
    let crop = image.crop_imm(
        (left * factor) as u32,
        (top * factor) as u32,
        (((right - left) * factor) as u32).max(1),
        (((bottom - top) * factor) as u32).max(1),
    );
    let longest = crop.width().max(crop.height()) as f64;
    let crop = if longest > max_side {
        let scale = max_side / longest;
        crop.resize_exact(
            ((crop.width() as f64 * scale) as u32).max(1),
            ((crop.height() as f64 * scale) as u32).max(1),
            image::imageops::FilterType::Lanczos3,
        )
    } else {
        crop
    }
    .to_rgb8();
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 85)
        .encode_image(&crop)
        .map_err(|e| e.to_string())?;
    Ok(RegionCapture {
        bytes,
        width: crop.width(),
        height: crop.height(),
        x: left,
        y: top,
        region_width: right - left,
        region_height: bottom - top,
    })
}
