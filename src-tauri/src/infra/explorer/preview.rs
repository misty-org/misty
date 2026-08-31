use super::*;

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePreviewRequest {
    pub path: String,
    pub bytes: Vec<u8>,
    #[serde(default)]
    pub save_as_copy: bool,
}

impl ExplorerService {
    pub async fn save_preview_item(
        &self,
        request: SavePreviewRequest,
    ) -> ApiResult<ExplorerOperationResult> {
        const MAX_EDIT_BYTES: usize = 100 * 1024 * 1024;
        if request.bytes.is_empty() {
            return Err(ApiError::Message("The edited file is empty.".to_string()));
        }
        if request.bytes.len() > MAX_EDIT_BYTES {
            return Err(ApiError::Message(
                "Edited files are limited to 100 MB.".to_string(),
            ));
        }
        if self.remote_target(&request.path).is_some() {
            return Err(ApiError::Message(
                "Save a copy locally before editing a remote file.".to_string(),
            ));
        }
        self.reject_virtual_mount_container(&request.path, "save")?;
        let source = PathBuf::from(&request.path);
        let metadata = tokio::fs::metadata(&source).await.map_err(|error| {
            ApiError::Message(format!("Failed to inspect {}: {error}", source.display()))
        })?;
        if !metadata.is_file() {
            return Err(ApiError::Message("Only files can be saved.".to_string()));
        }
        if !request.save_as_copy && metadata.permissions().readonly() {
            return Err(ApiError::Message(format!(
                "{} is read-only. Save a copy instead.",
                source.display()
            )));
        }
        let destination = if request.save_as_copy {
            available_preview_copy_path(&source).await?
        } else {
            source.clone()
        };
        write_preview_destination(&destination, &request.bytes, request.save_as_copy).await?;
        Ok(ExplorerOperationResult {
            affected_paths: vec![display_path(&destination)],
            parent_path: destination.parent().map(display_path),
        })
    }

    pub async fn preview_item(&self, path: &str) -> ApiResult<ExplorerPreviewPayload> {
        if let Some(source) = self.remote_target(path) {
            let parent = RemoteBrowseTarget {
                provider_type: source.provider_type.clone(),
                remote_name: source.remote_name.clone(),
                remote_path: remote_parent_path(&source.remote_path),
            };
            let items = self.fetch_remote_items(&parent).await?;
            let Some((size_bytes, remote_modified)) =
                remote_preview_metadata_from_items(&parent, &source.remote_path, &items)?
            else {
                return Err(ApiError::Message(format!(
                    "Remote file {} was not found.",
                    source.remote_path
                )));
            };
            let remote_modified = if remote_modified.trim().is_empty() {
                None
            } else {
                Some(remote_modified)
            };
            let prepared = self
                .prepare_remote_file_for_local_use(
                    &source,
                    Some(size_bytes),
                    remote_modified.as_deref(),
                    "Preparing remote file for preview",
                    false,
                    None,
                )
                .await?;
            return self
                .preview_local_item(Path::new(&prepared.local_path))
                .await;
        }
        self.reject_virtual_mount_container(path, "preview")?;
        self.preview_local_item(Path::new(path)).await
    }

    pub async fn generate_image_thumbnail(
        &self,
        path: &str,
        max_dimension: u32,
        modified_ms: Option<u64>,
        remote_modified: Option<&str>,
        size_bytes: Option<u64>,
    ) -> ApiResult<GeneratedImageThumbnail> {
        if let Some(source) = self.remote_target(path) {
            let (cache_size_bytes, prepare_size_bytes, remote_modified) =
                if let Some(size_bytes) = size_bytes {
                    (
                        size_bytes,
                        i64::try_from(size_bytes).ok(),
                        remote_modified.map(str::to_string),
                    )
                } else {
                    let parent = RemoteBrowseTarget {
                        provider_type: source.provider_type.clone(),
                        remote_name: source.remote_name.clone(),
                        remote_path: remote_parent_path(&source.remote_path),
                    };
                    let items = self.fetch_remote_items(&parent).await?;
                    let Some((size_bytes, remote_modified)) =
                        remote_preview_metadata_from_items(&parent, &source.remote_path, &items)?
                    else {
                        return Err(ApiError::Message(format!(
                            "Remote file {} was not found.",
                            source.remote_path
                        )));
                    };
                    (
                        u64::try_from(size_bytes).unwrap_or_default(),
                        Some(size_bytes),
                        Some(remote_modified),
                    )
                };
            let remote_modified = if remote_modified
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty()
            {
                None
            } else {
                remote_modified
            };
            let prepared = self
                .prepare_remote_file_for_local_use(
                    &source,
                    prepare_size_bytes,
                    remote_modified.as_deref(),
                    "Preparing remote file thumbnail",
                    false,
                    None,
                )
                .await?;
            let identity = ImageThumbnailIdentity {
                path: path.to_string(),
                size_bytes: cache_size_bytes,
                modified_fingerprint: remote_modified,
            };
            return self
                .generate_local_image_thumbnail(
                    Path::new(&prepared.local_path),
                    max_dimension,
                    Some(identity),
                )
                .await;
        }
        self.reject_virtual_mount_container(path, "thumbnail")?;
        let identity = size_bytes.map(|size_bytes| ImageThumbnailIdentity {
            path: path.to_string(),
            size_bytes,
            modified_fingerprint: modified_ms.map(|value| value.to_string()),
        });
        self.generate_local_image_thumbnail(Path::new(path), max_dimension, identity)
            .await
    }

    pub(super) async fn generate_local_image_thumbnail(
        &self,
        path: &Path,
        max_dimension: u32,
        identity: Option<ImageThumbnailIdentity>,
    ) -> ApiResult<GeneratedImageThumbnail> {
        let format = image_thumbnail_format(path).ok_or_else(|| {
            ApiError::Message("This file type does not support image thumbnails.".to_string())
        })?;
        let metadata = tokio::fs::metadata(path).await.map_err(|error| {
            ApiError::Message(format!(
                "Failed to inspect image thumbnail file {}: {error}",
                path.display()
            ))
        })?;
        if !metadata.is_file() {
            return Err(ApiError::Message(
                "Only files can be thumbnailed.".to_string(),
            ));
        }
        let max_dimension = normalize_image_thumbnail_dimension(max_dimension);
        let identity =
            identity.unwrap_or_else(|| ImageThumbnailIdentity::from_metadata(path, &metadata));
        let thumbnail_path =
            image_thumbnail_cache_path(&self.image_thumbnail_cache_dir, &identity, max_dimension);
        if tokio::fs::metadata(&thumbnail_path)
            .await
            .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
        {
            return Ok(GeneratedImageThumbnail {
                path: display_path(&thumbnail_path),
                mime_type: "image/png".to_string(),
            });
        }
        if let Some(parent) = thumbnail_path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|error| {
                ApiError::Message(format!(
                    "Failed to create image thumbnail cache {}: {error}",
                    parent.display()
                ))
            })?;
        }
        let source_path = path.to_path_buf();
        let output_path = thumbnail_path.clone();
        let rendered = tokio::task::spawn_blocking(move || {
            render_image_thumbnail_file_blocking(&source_path, &output_path, format, max_dimension)
        })
        .await
        .map_err(|error| ApiError::Message(format!("Image thumbnail worker failed: {error}")))??;
        Ok(rendered)
    }

    pub(super) async fn preview_local_item(
        &self,
        path: &Path,
    ) -> ApiResult<ExplorerPreviewPayload> {
        let format = preview_format(path).ok_or_else(|| {
            ApiError::Message("This file type does not support preview.".to_string())
        })?;
        let metadata = tokio::fs::metadata(path).await.map_err(|error| {
            ApiError::Message(format!(
                "Failed to inspect preview file {}: {error}",
                path.display()
            ))
        })?;
        if !metadata.is_file() {
            return Err(ApiError::Message(
                "Only files can be previewed.".to_string(),
            ));
        }
        match format {
            PreviewFormat::Pdf => {
                let bytes = read_preview_file(path).await?;
                Ok(ExplorerPreviewPayload {
                    mime_type: "application/pdf".to_string(),
                    bytes,
                })
            }
            PreviewFormat::Image(image_format) => {
                let path = path.to_path_buf();
                let bytes = tokio::task::spawn_blocking(move || {
                    render_image_preview_png_blocking(&path, image_format)
                })
                .await
                .map_err(|error| {
                    ApiError::Message(format!("Image preview worker failed: {error}"))
                })??;
                Ok(ExplorerPreviewPayload {
                    mime_type: "image/png".to_string(),
                    bytes,
                })
            }
            PreviewFormat::Direct(mime_type) => {
                let bytes = read_preview_file(path).await?;
                Ok(ExplorerPreviewPayload {
                    mime_type: mime_type.to_string(),
                    bytes,
                })
            }
            PreviewFormat::TranscodeImage(image_format) => {
                let path = path.to_path_buf();
                let bytes = tokio::task::spawn_blocking(move || {
                    render_image_preview_png_blocking(&path, image_format)
                })
                .await
                .map_err(|error| {
                    ApiError::Message(format!("Image preview worker failed: {error}"))
                })??;
                Ok(ExplorerPreviewPayload {
                    mime_type: "image/png".to_string(),
                    bytes,
                })
            }
            PreviewFormat::Psd => {
                let bytes = read_preview_file(path).await?;
                Ok(ExplorerPreviewPayload {
                    mime_type: "image/png".to_string(),
                    bytes: transcode_psd_preview_png(&bytes, path)?,
                })
            }
        }
    }
}

async fn write_preview_destination(path: &Path, bytes: &[u8], create_new: bool) -> ApiResult<()> {
    if create_new {
        return write_preview_file(path, bytes, true).await;
    }
    let parent = path
        .parent()
        .ok_or_else(|| ApiError::Message("Cannot save a file at a filesystem root.".to_string()))?;
    let temporary = parent.join(format!(
        ".{}.misty-edit-{}.tmp",
        path.file_name().and_then(OsStr::to_str).unwrap_or("file"),
        uuid::Uuid::new_v4()
    ));
    if let Err(error) = write_preview_file(&temporary, bytes, true).await {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(error);
    }
    if let Err(error) = tokio::fs::rename(&temporary, path).await {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(ApiError::Message(format!(
            "Failed to replace {} safely: {error}",
            path.display()
        )));
    }
    Ok(())
}

async fn write_preview_file(path: &Path, bytes: &[u8], create_new: bool) -> ApiResult<()> {
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(create_new)
        .truncate(!create_new)
        .open(path)
        .await
        .map_err(|error| {
            ApiError::Message(format!("Failed to save {}: {error}", path.display()))
        })?;
    if let Err(error) = file.write_all(bytes).await {
        if create_new {
            let _ = tokio::fs::remove_file(path).await;
        }
        return Err(ApiError::Message(format!(
            "Failed to save {}: {error}",
            path.display()
        )));
    }
    file.flush().await.map_err(|error| {
        ApiError::Message(format!(
            "Failed to finish saving {}: {error}",
            path.display()
        ))
    })
}

async fn available_preview_copy_path(source: &Path) -> ApiResult<PathBuf> {
    let parent = source
        .parent()
        .ok_or_else(|| ApiError::Message("Cannot save a copy at a filesystem root.".to_string()))?;
    let stem = source
        .file_stem()
        .and_then(OsStr::to_str)
        .filter(|value| !value.is_empty())
        .unwrap_or("Edited file");
    let extension = source
        .extension()
        .and_then(OsStr::to_str)
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    for index in 1..=10_000_u32 {
        let suffix = if index == 1 {
            " copy".to_string()
        } else {
            format!(" copy {index}")
        };
        let candidate = parent.join(format!("{stem}{suffix}{extension}"));
        match tokio::fs::metadata(&candidate).await {
            Ok(_) => continue,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(candidate),
            Err(error) => {
                return Err(ApiError::Message(format!(
                    "Failed to inspect copy destination {}: {error}",
                    candidate.display()
                )))
            }
        }
    }
    Err(ApiError::Message(
        "Could not find an available name for the copy.".to_string(),
    ))
}
