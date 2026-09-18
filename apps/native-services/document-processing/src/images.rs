use crate::{ApiError, ApiResult};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, ImageReader, Limits};
use std::path::Path;
const MAX_IMAGE_DIMENSION: u32 = 32_768;
const MAX_IMAGE_DECODE_ALLOC: u64 = 128 * 1024 * 1024;
pub fn render_private_image_preview(path: &Path, dimension: u32) -> ApiResult<(Vec<u8>, u32, u32)> {
    let mut reader = ImageReader::open(path)
        .map_err(|error| ApiError::Message(format!("Could not open image preview: {error}")))?
        .with_guessed_format()
        .map_err(|error| ApiError::Message(format!("Could not identify image preview: {error}")))?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_IMAGE_DIMENSION);
    limits.max_image_height = Some(MAX_IMAGE_DIMENSION);
    limits.max_alloc = Some(MAX_IMAGE_DECODE_ALLOC);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|error| {
        ApiError::Message(format!("Could not decode bounded image preview: {error}"))
    })?;
    let resized = decoded
        .resize(dimension, dimension, FilterType::Triangle)
        .to_rgb8();
    let (width, height) = resized.dimensions();
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, 82)
        .encode_image(&resized)
        .map_err(|error| {
            ApiError::Message(format!("Could not encode private image preview: {error}"))
        })?;
    Ok((bytes, width, height))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn produces_private_rgb_jpeg_with_preserved_aspect_ratio() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("input.png");
        image::RgbaImage::from_pixel(800, 400, image::Rgba([120, 50, 10, 100]))
            .save(&path)
            .unwrap();
        let (bytes, width, height) = render_private_image_preview(&path, 512).unwrap();
        assert_eq!((width, height), (512, 256));
        let decoded =
            image::load_from_memory_with_format(&bytes, image::ImageFormat::Jpeg).unwrap();
        assert_eq!(decoded.color(), image::ColorType::Rgb8);
        assert_eq!((decoded.width(), decoded.height()), (512, 256));
        std::fs::write(&path, b"corrupt input").unwrap();
        assert!(render_private_image_preview(&path, 512).is_err());
    }
}
