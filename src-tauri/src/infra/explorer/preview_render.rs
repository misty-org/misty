use super::*;

#[cfg(target_os = "macos")]
pub(super) fn render_image_thumbnail_with_system_tool(
    path: &Path,
    thumbnail_path: &Path,
    max_dimension: u32,
) -> ApiResult<bool> {
    let status = Command::new("/usr/bin/sips")
        .arg("-s")
        .arg("format")
        .arg("png")
        .arg("-Z")
        .arg(normalize_image_thumbnail_dimension(max_dimension).to_string())
        .arg(path)
        .arg("--out")
        .arg(thumbnail_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    if let Ok(status) = status {
        if status.success()
            && std::fs::metadata(thumbnail_path)
                .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
        {
            return Ok(true);
        }
    }

    let _ = std::fs::remove_file(thumbnail_path);
    Ok(false)
}

#[cfg(not(target_os = "macos"))]
pub(super) fn render_image_thumbnail_with_system_tool(
    _path: &Path,
    _thumbnail_path: &Path,
    _max_dimension: u32,
) -> ApiResult<bool> {
    Ok(false)
}

pub(super) fn render_image_thumbnail_file_blocking(
    path: &Path,
    output_path: &Path,
    format: PreviewFormat,
    max_dimension: u32,
) -> ApiResult<GeneratedImageThumbnail> {
    {
        let _cache_file_lock = IMAGE_THUMBNAIL_CACHE_FILE_LOCK.lock().map_err(|error| {
            ApiError::Message(format!("Failed to lock thumbnail cache: {error}"))
        })?;
        if output_path.exists() {
            return Ok(GeneratedImageThumbnail {
                path: display_path(output_path),
                mime_type: "image/png".to_string(),
            });
        }
    }

    let temp_path = temporary_image_thumbnail_path(output_path);
    match format {
        PreviewFormat::Image(_) | PreviewFormat::TranscodeImage(_) => {
            let (width, height) = image_dimensions(path)?;
            validate_image_thumbnail_source(width, height)?;
            let rendered_with_system_tool = matches!(format, PreviewFormat::Image(_))
                && !is_gif_path(path)
                && render_image_thumbnail_with_system_tool(path, &temp_path, max_dimension)?;
            if !rendered_with_system_tool {
                let image = decode_image_thumbnail_source(path)?;
                let max_dimension = normalize_image_thumbnail_dimension(max_dimension);
                let thumbnail =
                    image.resize(max_dimension, max_dimension, IMAGE_THUMBNAIL_RESIZE_FILTER);
                if let Err(error) = write_image_thumbnail_png(&thumbnail, &temp_path) {
                    let _ = std::fs::remove_file(&temp_path);
                    return Err(error);
                }
            }
        }
        PreviewFormat::Psd => {
            let bytes = std::fs::read(path).map_err(|error| {
                ApiError::Message(format!(
                    "Failed to read PSD thumbnail {}: {error}",
                    path.display()
                ))
            })?;
            let bytes = transcode_psd_preview_png_with_dimension(&bytes, path, max_dimension)?;
            if let Err(error) = std::fs::write(&temp_path, bytes) {
                let _ = std::fs::remove_file(&temp_path);
                return Err(ApiError::Message(format!(
                    "Failed to write image thumbnail {}: {error}",
                    temp_path.display()
                )));
            }
        }
        PreviewFormat::Direct(_) | PreviewFormat::Pdf => {
            return Err(ApiError::Message(
                "This file type does not support image thumbnails.".to_string(),
            ));
        }
    };

    {
        let _cache_file_lock = IMAGE_THUMBNAIL_CACHE_FILE_LOCK.lock().map_err(|error| {
            ApiError::Message(format!("Failed to lock thumbnail cache: {error}"))
        })?;
        if output_path.exists() {
            let _ = std::fs::remove_file(&temp_path);
            return Ok(GeneratedImageThumbnail {
                path: display_path(output_path),
                mime_type: "image/png".to_string(),
            });
        }
        std::fs::rename(&temp_path, output_path).map_err(|error| {
            let _ = std::fs::remove_file(&temp_path);
            ApiError::Message(format!(
                "Failed to commit image thumbnail {}: {error}",
                output_path.display()
            ))
        })?;
    }
    Ok(GeneratedImageThumbnail {
        path: display_path(output_path),
        mime_type: "image/png".to_string(),
    })
}

pub(super) fn render_image_preview_png_blocking(
    path: &Path,
    image_format: image::ImageFormat,
) -> ApiResult<Vec<u8>> {
    render_image_preview_png_with_dimension_blocking(
        path,
        image_format,
        MAX_IMAGE_PREVIEW_DIMENSION,
    )
}

pub(super) fn render_image_preview_png_with_dimension_blocking(
    path: &Path,
    _image_format: image::ImageFormat,
    max_dimension: u32,
) -> ApiResult<Vec<u8>> {
    let image = decode_image_thumbnail_source(path)?;
    encode_preview_image_png_with_dimension(image, path, max_dimension)
}

pub(super) fn encode_preview_image_png(
    image: image::DynamicImage,
    path: &Path,
) -> ApiResult<Vec<u8>> {
    encode_preview_image_png_with_dimension(image, path, MAX_IMAGE_PREVIEW_DIMENSION)
}

pub(super) fn encode_preview_image_png_with_dimension(
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

pub(super) async fn read_preview_file(path: &Path) -> ApiResult<Vec<u8>> {
    tokio::fs::read(path).await.map_err(|error| {
        ApiError::Message(format!(
            "Failed to read preview file {}: {error}",
            path.display()
        ))
    })
}

pub(super) fn transcode_psd_preview_png(bytes: &[u8], path: &Path) -> ApiResult<Vec<u8>> {
    transcode_psd_preview_png_with_dimension(bytes, path, MAX_IMAGE_PREVIEW_DIMENSION)
}

pub(super) fn transcode_psd_preview_png_with_dimension(
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

pub(super) fn psd_pixels_to_rgba8(
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

pub(super) async fn render_pdf_preview_png(
    path: &Path,
    metadata: &std::fs::Metadata,
) -> ApiResult<Option<Vec<u8>>> {
    let Some(mutool) = find_mutool() else {
        return Ok(None);
    };
    let out_path = pdf_preview_path(path, metadata);
    if let Some(parent) = out_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            ApiError::Message(format!(
                "Failed to create PDF preview directory {}: {error}",
                parent.display()
            ))
        })?;
    }
    let status = Command::new(mutool)
        .arg("draw")
        .arg("-o")
        .arg(&out_path)
        .arg("-F")
        .arg("png")
        .arg("-r")
        .arg("140")
        .arg(path)
        .arg("1")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    if !status.is_ok_and(|status| status.success()) {
        return Ok(None);
    }
    match tokio::fs::read(&out_path).await {
        Ok(bytes) if !bytes.is_empty() => Ok(Some(bytes)),
        _ => Ok(None),
    }
}

pub(super) fn find_mutool() -> Option<&'static str> {
    if Command::new("sh")
        .arg("-c")
        .arg("command -v mutool >/dev/null 2>&1")
        .status()
        .is_ok_and(|status| status.success())
    {
        return Some("mutool");
    }
    #[cfg(target_os = "macos")]
    {
        if Path::new("/opt/homebrew/bin/mutool").is_file() {
            return Some("/opt/homebrew/bin/mutool");
        }
        if Path::new("/usr/local/bin/mutool").is_file() {
            return Some("/usr/local/bin/mutool");
        }
    }
    None
}

pub(super) fn pdf_preview_path(path: &Path, metadata: &std::fs::Metadata) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(metadata.len().to_le_bytes());
    if let Ok(modified) = metadata.modified() {
        if let Ok(duration) = modified.duration_since(UNIX_EPOCH) {
            hasher.update(duration.as_millis().to_le_bytes());
        }
    }
    let digest = hasher.finalize();
    std::env::temp_dir().join(format!("misty-preview-{}.png", hex::encode(&digest[..16])))
}
