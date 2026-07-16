use super::*;

impl ExplorerService {
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
                if let Some(bytes) = render_pdf_preview_png(path, &metadata).await? {
                    return Ok(ExplorerPreviewPayload {
                        mime_type: "image/png".to_string(),
                        bytes,
                    });
                }
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
