//! Display captures, sized for the vision models that read them.
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
