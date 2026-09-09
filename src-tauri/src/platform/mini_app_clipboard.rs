//! A bounded native image copy. This module never publishes to shared clipboard/server storage.
use base64::Engine;
use serde_json::Value;
use std::{borrow::Cow, io::Cursor};

const MAX_PNG: usize = 4 * 1024 * 1024;
const MAX_PIXELS: u64 = 8 * 1024 * 1024;

pub(super) fn encode_png(image: arboard::ImageData<'_>) -> Result<Value, String> {
    let width = u32::try_from(image.width).map_err(|_| "Invalid clipboard image dimensions.")?;
    let height = u32::try_from(image.height).map_err(|_| "Invalid clipboard image dimensions.")?;
    let pixels = u64::from(width) * u64::from(height);
    if width == 0 || height == 0 || width > 4096 || height > 4096 || pixels > MAX_PIXELS || image.bytes.len() as u64 != pixels * 4 {
        return Err("Clipboard image exceeds its supported dimensions.".into());
    }
    let mut png = Vec::new();
    image::ImageEncoder::write_image(
        image::codecs::png::PngEncoder::new(&mut png), image.bytes.as_ref(), width, height, image::ExtendedColorType::Rgba8,
    ).map_err(|_| "The clipboard image could not be encoded.")?;
    if png.len() > MAX_PNG { return Err("Clipboard images are limited to 4 MB.".into()); }
    Ok(serde_json::json!({"mimeType":"image/png","data":base64::engine::general_purpose::STANDARD.encode(png)}))
}

pub(super) fn decode_png(params: &Value) -> Result<arboard::ImageData<'static>, String> {
    let object = params.as_object().ok_or("Invalid clipboard image.")?;
    if object.len() != 2 || params.get("mimeType").and_then(Value::as_str) != Some("image/png") {
        return Err("Clipboard images must be PNG files.".into());
    }
    let encoded = params.get("data").and_then(Value::as_str).ok_or("Missing clipboard image.")?;
    if encoded.is_empty() || encoded.len() > 4 * MAX_PNG.div_ceil(3) {
        return Err("Clipboard images are limited to 4 MB.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded)
        .map_err(|_| "Invalid clipboard image encoding.")?;
    if bytes.len() > MAX_PNG { return Err("Clipboard images are limited to 4 MB.".into()); }
    let dimensions = image::ImageReader::with_format(Cursor::new(&bytes), image::ImageFormat::Png)
        .into_dimensions().map_err(|_| "Invalid clipboard PNG.")?;
    if dimensions.0 == 0 || dimensions.1 == 0 || dimensions.0 > 4096 || dimensions.1 > 4096
        || u64::from(dimensions.0) * u64::from(dimensions.1) > MAX_PIXELS {
        return Err("Clipboard images exceed the supported dimensions.".into());
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Png);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    let rgba = reader.decode().map_err(|_| "Invalid clipboard PNG.")?.to_rgba8();
    Ok(arboard::ImageData {
        width: rgba.width() as usize, height: rgba.height() as usize, bytes: Cow::Owned(rgba.into_raw()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn payload(width: u32, height: u32) -> Value {
        let mut output = Cursor::new(Vec::new());
        image::RgbaImage::from_pixel(width, height, image::Rgba([1, 2, 3, 255]))
            .write_to(&mut output, image::ImageFormat::Png).unwrap();
        json!({"mimeType":"image/png", "data":base64::engine::general_purpose::STANDARD.encode(output.into_inner())})
    }
    #[test]
    fn clipboard_png_decodes_bounded_rgba_and_rejects_unsupported_payloads() {
        let decoded = decode_png(&payload(2, 1)).unwrap();
        assert_eq!((decoded.width, decoded.height), (2, 1));
        assert_eq!(decoded.bytes.as_ref(), &[1, 2, 3, 255, 1, 2, 3, 255]);
        let encoded = encode_png(decoded).unwrap();
        let roundtrip = decode_png(&encoded).unwrap();
        assert_eq!(roundtrip.bytes.as_ref(), &[1, 2, 3, 255, 1, 2, 3, 255]);
        assert!(encode_png(arboard::ImageData { width: 2, height: 1, bytes: Cow::Owned(vec![1]) }).is_err());
        assert!(encode_png(arboard::ImageData { width: usize::MAX, height: 1, bytes: Cow::Owned(vec![]) }).is_err());
        assert!(decode_png(&json!({"mimeType":"image/svg+xml","data":"AAAA"})).is_err());
        assert!(decode_png(&json!({"mimeType":"image/png","data":"%%%"})).is_err());
        assert!(decode_png(&json!({"mimeType":"image/png","data":"AAAA","path":"/tmp/image"})).is_err());
        assert!(decode_png(&payload(4097, 1)).is_err());
    }
}
