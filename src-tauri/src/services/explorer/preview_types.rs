use super::*;

#[derive(Clone, Copy)]
pub(super) enum PreviewFormat {
    Image(image::ImageFormat),
    Direct(&'static str),
    TranscodeImage(image::ImageFormat),
    Pdf,
    Psd,
}

pub(super) struct ImageThumbnailIdentity {
    pub(super) path: String,
    pub(super) size_bytes: u64,
    pub(super) modified_fingerprint: Option<String>,
}

impl ImageThumbnailIdentity {
    pub(super) fn from_metadata(path: &Path, metadata: &std::fs::Metadata) -> Self {
        Self {
            path: display_path(path),
            size_bytes: metadata.len(),
            modified_fingerprint: metadata
                .modified()
                .ok()
                .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis().to_string()),
        }
    }
}

pub(super) fn preview_format(path: &Path) -> Option<PreviewFormat> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some(PreviewFormat::Image(image::ImageFormat::Png)),
        "jpg" | "jpeg" => Some(PreviewFormat::Image(image::ImageFormat::Jpeg)),
        "gif" => Some(PreviewFormat::Image(image::ImageFormat::Gif)),
        "bmp" => Some(PreviewFormat::Image(image::ImageFormat::Bmp)),
        "webp" => Some(PreviewFormat::Image(image::ImageFormat::WebP)),
        "svg" => Some(PreviewFormat::Direct("image/svg+xml")),
        "pdf" => Some(PreviewFormat::Pdf),
        "psd" => Some(PreviewFormat::Psd),
        "txt" | "text" | "log" | "md" | "markdown" | "toml" | "yaml" | "yml" | "ini" | "conf"
        | "cfg" | "csv" | "tsv" | "rs" | "go" | "js" | "jsx" | "ts" | "tsx" | "css" | "html"
        | "xml" | "sh" | "zsh" | "bash" | "fish" | "py" | "rb" | "java" | "c" | "h" | "cpp"
        | "hpp" | "swift" | "kt" | "sql" => {
            Some(PreviewFormat::Direct("text/plain; charset=utf-8"))
        }
        "json" | "jsonc" => Some(PreviewFormat::Direct("application/json; charset=utf-8")),
        "tga" => Some(PreviewFormat::TranscodeImage(image::ImageFormat::Tga)),
        "hdr" | "pic" => Some(PreviewFormat::TranscodeImage(image::ImageFormat::Hdr)),
        "pbm" | "pgm" | "pnm" | "ppm" => {
            Some(PreviewFormat::TranscodeImage(image::ImageFormat::Pnm))
        }
        _ => None,
    }
}

pub(super) fn image_thumbnail_format(path: &Path) -> Option<PreviewFormat> {
    match preview_format(path)? {
        PreviewFormat::Image(format) => Some(PreviewFormat::Image(format)),
        PreviewFormat::TranscodeImage(format) => Some(PreviewFormat::TranscodeImage(format)),
        PreviewFormat::Psd => Some(PreviewFormat::Psd),
        PreviewFormat::Direct(_) | PreviewFormat::Pdf => None,
    }
}

pub(super) fn normalize_image_thumbnail_dimension(max_dimension: u32) -> u32 {
    let dimension = if max_dimension == 0 {
        DEFAULT_IMAGE_THUMBNAIL_DIMENSION
    } else {
        max_dimension
    };
    dimension.clamp(1, MAX_GENERATED_IMAGE_THUMBNAIL_DIMENSION)
}

pub(super) fn normalize_image_preview_dimension(max_dimension: u32) -> u32 {
    let dimension = if max_dimension == 0 {
        MAX_IMAGE_PREVIEW_DIMENSION
    } else {
        max_dimension
    };
    dimension.clamp(1, MAX_IMAGE_PREVIEW_DIMENSION)
}

pub(super) fn image_thumbnail_cache_path(
    cache_dir: &Path,
    identity: &ImageThumbnailIdentity,
    max_dimension: u32,
) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(identity.path.as_bytes());
    hasher.update([0]);
    hasher.update(identity.size_bytes.to_le_bytes());
    hasher.update([0]);
    if let Some(modified_fingerprint) = &identity.modified_fingerprint {
        hasher.update(modified_fingerprint.as_bytes());
    }
    hasher.update([0]);
    hasher.update(max_dimension.to_le_bytes());
    let digest = hasher.finalize();
    cache_dir.join(format!(
        "misty-image-thumb-{}-{}.png",
        max_dimension,
        hex::encode(&digest[..16])
    ))
}

pub(super) fn thumbnail_decode_limits() -> Limits {
    Limits::no_limits()
}

pub(super) fn validate_image_thumbnail_source(width: u32, height: u32) -> ApiResult<()> {
    if width == 0 || height == 0 {
        return Err(ApiError::Message(
            "Image dimensions are invalid.".to_string(),
        ));
    }

    Ok(())
}

pub(super) fn image_dimensions(path: &Path) -> ApiResult<(u32, u32)> {
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
    reader.into_dimensions().map_err(|error| {
        ApiError::Message(format!(
            "Failed to read image thumbnail dimensions {}: {error}",
            path.display()
        ))
    })
}

pub(super) fn is_gif_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("gif"))
}

pub(super) fn decode_gif_first_frame(path: &Path) -> ApiResult<image::DynamicImage> {
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

pub(super) fn decode_image_thumbnail_source(path: &Path) -> ApiResult<image::DynamicImage> {
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

pub(super) fn temporary_image_thumbnail_path(output_path: &Path) -> PathBuf {
    let temporary_id = TEMPORARY_THUMBNAIL_COUNTER.fetch_add(1, Ordering::Relaxed);
    output_path.with_extension(format!("tmp-{temporary_id}"))
}

pub(super) fn write_image_thumbnail_png(
    thumbnail: &image::DynamicImage,
    thumbnail_path: &Path,
) -> ApiResult<()> {
    let file = File::create(thumbnail_path).map_err(|error| {
        ApiError::Message(format!(
            "Failed to create image thumbnail {}: {error}",
            thumbnail_path.display()
        ))
    })?;
    let writer = BufWriter::new(file);
    let encoder = PngEncoder::new_with_quality(
        writer,
        IMAGE_THUMBNAIL_PNG_COMPRESSION,
        IMAGE_THUMBNAIL_PNG_FILTER,
    );
    thumbnail.write_with_encoder(encoder).map_err(|error| {
        ApiError::Message(format!(
            "Failed to write image thumbnail {}: {error}",
            thumbnail_path.display()
        ))
    })
}
