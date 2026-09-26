//! Explorer's PNG rendering lives in the downloaded Files processor.
use crate::{ApiError, ApiResult};
use image::{
    codecs::{
        gif::GifDecoder,
        png::{CompressionType, FilterType as PngFilterType, PngEncoder},
    },
    imageops::FilterType,
    ImageDecoder, ImageReader, Limits,
};
use std::{
    fs::File,
    io::{BufReader, Cursor},
    path::Path,
};
const MAX_IMAGE_PREVIEW_DIMENSION: u32 = 1600;
const IMAGE_THUMBNAIL_RESIZE_FILTER: FilterType = FilterType::Triangle;
const IMAGE_THUMBNAIL_PNG_COMPRESSION: CompressionType = CompressionType::Fast;
const IMAGE_THUMBNAIL_PNG_FILTER: PngFilterType = PngFilterType::Adaptive;
fn normalize_image_preview_dimension(dimension: u32) -> u32 {
    dimension.clamp(1, MAX_IMAGE_PREVIEW_DIMENSION)
}

/// Input/output paths are fixed by the protocol, never selected by an app.
pub fn render(path: &Path, dimension: u32) -> ApiResult<Vec<u8>> {
    if !(1..=MAX_IMAGE_PREVIEW_DIMENSION).contains(&dimension) {
        return Err(ApiError::Message(
            "Invalid Files preview dimensions.".into(),
        ));
    }
    if path
        .extension()
        .and_then(|v| v.to_str())
        .is_some_and(|v| v.eq_ignore_ascii_case("psd"))
    {
        let bytes =
            std::fs::read(path).map_err(|_| ApiError::Message("PSD input unavailable.".into()))?;
        transcode_psd_preview_png_with_dimension(&bytes, path, dimension)
    } else {
        let image = decode_image_thumbnail_source(path)?;
        validate_image_thumbnail_source(image.width(), image.height())?;
        encode_preview_image_png_with_dimension(image, path, dimension)
    }
}
fn thumbnail_decode_limits() -> Limits {
    Limits::no_limits()
}

fn validate_image_thumbnail_source(width: u32, height: u32) -> ApiResult<()> {
    if width == 0 || height == 0 {
        return Err(ApiError::Message(
            "Image dimensions are invalid.".to_string(),
        ));
    }

    Ok(())
}

fn is_gif_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("gif"))
}

fn decode_gif_first_frame(path: &Path) -> ApiResult<image::DynamicImage> {
    let file = File::open(path).map_err(|error| {
        ApiError::Message(format!(
            "Failed to open GIF thumbnail source {}: {error}",
            path.display()
        ))
    })?;
    let mut decoder = GifDecoder::new(BufReader::new(file)).map_err(|error| {
        ApiError::Message(format!(
            "Failed to read GIF thumbnail source {}: {error}",
            path.display()
        ))
    })?;
    decoder
        .set_limits(thumbnail_decode_limits())
        .map_err(|error| {
            ApiError::Message(format!(
                "Failed to set GIF thumbnail limits {}: {error}",
                path.display()
            ))
        })?;

    let (screen_width, screen_height) = decoder.dimensions();
    if screen_width == 0 || screen_height == 0 {
        return Err(ApiError::Message("GIF dimensions are invalid.".to_string()));
    }

    let mut buffer = vec![0u8; decoder.total_bytes() as usize];
    decoder.read_image(&mut buffer).map_err(|error| {
        ApiError::Message(format!(
            "Failed to decode GIF thumbnail frame {}: {error}",
            path.display()
        ))
    })?;
    let rgba_image = image::RgbaImage::from_raw(screen_width, screen_height, buffer)
        .ok_or_else(|| ApiError::Message("GIF frame canvas size is invalid.".to_string()))?;
    Ok(image::DynamicImage::ImageRgba8(rgba_image))
}

fn decode_image_thumbnail_source(path: &Path) -> ApiResult<image::DynamicImage> {
    if is_gif_path(path) {
        return decode_gif_first_frame(path);
    }

    let mut reader = ImageReader::open(path)
        .map_err(|error| {
            ApiError::Message(format!(
                "Failed to open image thumbnail source {}: {error}",
                path.display()
            ))
        })?
        .with_guessed_format()
        .map_err(|error| {
            ApiError::Message(format!(
                "Failed to detect image thumbnail format {}: {error}",
                path.display()
            ))
        })?;
    reader.limits(thumbnail_decode_limits());
    reader.decode().map_err(|error| {
        ApiError::Message(format!(
            "Failed to decode image thumbnail source {}: {error}",
            path.display()
        ))
    })
}

fn encode_preview_image_png_with_dimension(
    image: image::DynamicImage,
    path: &Path,
    max_dimension: u32,
) -> ApiResult<Vec<u8>> {
    let max_dimension = normalize_image_preview_dimension(max_dimension);
    let thumbnail = image.resize(max_dimension, max_dimension, IMAGE_THUMBNAIL_RESIZE_FILTER);
    let mut encoded = Cursor::new(Vec::new());
    let encoder = PngEncoder::new_with_quality(
        &mut encoded,
        IMAGE_THUMBNAIL_PNG_COMPRESSION,
        IMAGE_THUMBNAIL_PNG_FILTER,
    );
    thumbnail.write_with_encoder(encoder).map_err(|error| {
        ApiError::Message(format!(
            "Failed to encode preview image {}: {error}",
            path.display()
        ))
    })?;
    Ok(encoded.into_inner())
}

fn transcode_psd_preview_png_with_dimension(
    bytes: &[u8],
    path: &Path,
    max_dimension: u32,
) -> ApiResult<Vec<u8>> {
    use zune_psd::zune_core::{bytestream::ZCursor, result::DecodingResult};

    let mut decoder = zune_psd::PSDDecoder::new(ZCursor::new(bytes));
    let decoded = decoder.decode().map_err(|error| {
        ApiError::Message(format!(
            "Failed to decode PSD preview {}: {error:?}",
            path.display()
        ))
    })?;
    let (width, height) = decoder.dimensions().ok_or_else(|| {
        ApiError::Message(format!(
            "Failed to decode PSD preview {}: missing dimensions",
            path.display()
        ))
    })?;
    let color_space = decoder.colorspace().ok_or_else(|| {
        ApiError::Message(format!(
            "Failed to decode PSD preview {}: unsupported color space",
            path.display()
        ))
    })?;
    let rgba = match decoded {
        DecodingResult::U8(pixels) => psd_pixels_to_rgba8(&pixels, color_space),
        DecodingResult::U16(pixels) => {
            let pixels = pixels
                .into_iter()
                .map(|value| (value >> 8) as u8)
                .collect::<Vec<_>>();
            psd_pixels_to_rgba8(&pixels, color_space)
        }
        _ => None,
    }
    .ok_or_else(|| {
        ApiError::Message(format!(
            "Failed to decode PSD preview {}: unsupported pixel layout",
            path.display()
        ))
    })?;
    let image = image::RgbaImage::from_raw(width as u32, height as u32, rgba).ok_or_else(|| {
        ApiError::Message(format!(
            "Failed to decode PSD preview {}: invalid pixel buffer",
            path.display()
        ))
    })?;
    encode_preview_image_png_with_dimension(
        image::DynamicImage::ImageRgba8(image),
        path,
        max_dimension,
    )
}

fn psd_pixels_to_rgba8(
    pixels: &[u8],
    color_space: zune_psd::zune_core::colorspace::ColorSpace,
) -> Option<Vec<u8>> {
    use zune_psd::zune_core::colorspace::ColorSpace;

    let channels = color_space.num_components();
    if channels == 0 || pixels.len() % channels != 0 {
        return None;
    }
    let mut rgba = Vec::with_capacity((pixels.len() / channels) * 4);
    for chunk in pixels.chunks_exact(channels) {
        match color_space {
            ColorSpace::RGB => rgba.extend_from_slice(&[chunk[0], chunk[1], chunk[2], 255]),
            ColorSpace::RGBA => rgba.extend_from_slice(&[chunk[0], chunk[1], chunk[2], chunk[3]]),
            ColorSpace::Luma => rgba.extend_from_slice(&[chunk[0], chunk[0], chunk[0], 255]),
            ColorSpace::LumaA => rgba.extend_from_slice(&[chunk[0], chunk[0], chunk[0], chunk[1]]),
            _ => return None,
        }
    }
    Some(rgba)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn minimal_rgb_psd() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"8BPS");
        bytes.extend_from_slice(&1u16.to_be_bytes());
        bytes.extend_from_slice(&[0; 6]);
        bytes.extend_from_slice(&3u16.to_be_bytes());
        bytes.extend_from_slice(&1u32.to_be_bytes());
        bytes.extend_from_slice(&1u32.to_be_bytes());
        bytes.extend_from_slice(&8u16.to_be_bytes());
        bytes.extend_from_slice(&3u16.to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(&0u16.to_be_bytes());
        bytes.extend_from_slice(&[255, 0, 0]);
        bytes
    }

    #[test]
    fn preserves_alpha_psd_pnm_and_first_gif_frame() {
        let root = tempfile::tempdir().unwrap();
        let png = root.path().join("input.png");
        image::RgbaImage::from_pixel(40, 20, image::Rgba([255, 0, 0, 100]))
            .save(&png)
            .unwrap();
        let decode = |path: &Path| {
            image::load_from_memory_with_format(&render(path, 20).unwrap(), image::ImageFormat::Png)
                .unwrap()
                .to_rgba8()
        };
        let image = decode(&png);
        assert_eq!(image.dimensions(), (20, 10));
        assert_eq!(image.get_pixel(0, 0).0, [255, 0, 0, 100]);
        let psd = root.path().join("input.psd");
        std::fs::write(&psd, minimal_rgb_psd()).unwrap();
        assert_eq!(decode(&psd).get_pixel(0, 0).0, [255, 0, 0, 255]);
        let pnm = root.path().join("input.ppm");
        std::fs::write(&pnm, b"P3\n1 1\n255\n0 255 0\n").unwrap();
        assert_eq!(decode(&pnm).get_pixel(0, 0).0, [0, 255, 0, 255]);
        let gif = root.path().join("input.gif");
        {
            let mut encoder = image::codecs::gif::GifEncoder::new(File::create(&gif).unwrap());
            for color in [[255, 0, 0, 255], [0, 255, 0, 255]] {
                encoder
                    .encode_frame(image::Frame::new(image::RgbaImage::from_pixel(
                        10,
                        10,
                        image::Rgba(color),
                    )))
                    .unwrap();
            }
        }
        assert_eq!(decode(&gif).get_pixel(0, 0).0, [255, 0, 0, 255]);
        assert!(render(&png, 1601).is_err());
        assert!(render(&png, 0).is_err());
        std::fs::write(&png, b"corrupt").unwrap();
        assert!(render(&png, 20).is_err());
    }
}
