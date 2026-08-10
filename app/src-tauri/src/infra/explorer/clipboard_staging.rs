use super::*;

impl ExplorerService {
    pub async fn stage_clipboard_text_paste(
        &self,
        request: PasteTextRequest,
    ) -> ApiResult<PasteItemsRequest> {
        if request.text.is_empty() {
            return Err(ApiError::Message("Clipboard text is empty.".to_string()));
        }
        let preferred_name =
            validate_remote_name(request.preferred_name.as_deref().unwrap_or("clipboard.txt"))?
                .to_string();
        tokio::fs::create_dir_all(&self.clipboard_text_cache_dir)
            .await
            .map_err(|error| {
                ApiError::Message(format!(
                    "Failed to prepare clipboard cache {}: {error}",
                    self.clipboard_text_cache_dir.display()
                ))
            })?;
        let source_path = self
            .clipboard_text_cache_dir
            .join(format!("clipboard-{}.txt", now_epoch_ms()));
        tokio::fs::write(&source_path, request.text)
            .await
            .map_err(|error| {
                ApiError::Message(format!(
                    "Failed to stage clipboard text {}: {error}",
                    source_path.display()
                ))
            })?;
        Ok(PasteItemsRequest {
            sources: vec![crate::domain::explorer::PasteItem {
                path: display_path(&source_path),
                is_directory: false,
                size_bytes: None,
                remote_modified: None,
            }],
            destination_directory: request.destination_directory,
            operation: crate::domain::explorer::ClipboardOperation::Copy,
            target_name: Some(preferred_name),
        })
    }

    pub async fn stage_clipboard_blob_paste(
        &self,
        request: PasteBlobRequest,
    ) -> ApiResult<PasteItemsRequest> {
        if request.bytes.is_empty() {
            return Err(ApiError::Message("Clipboard image is empty.".to_string()));
        }
        let preferred_name =
            validate_remote_name(request.preferred_name.as_deref().unwrap_or("clipboard.png"))?
                .to_string();
        tokio::fs::create_dir_all(&self.clipboard_blob_cache_dir)
            .await
            .map_err(|error| {
                ApiError::Message(format!(
                    "Failed to prepare clipboard cache {}: {error}",
                    self.clipboard_blob_cache_dir.display()
                ))
            })?;
        let source_path = self
            .clipboard_blob_cache_dir
            .join(format!("clipboard-{}.bin", now_epoch_ms()));
        tokio::fs::write(&source_path, request.bytes)
            .await
            .map_err(|error| {
                ApiError::Message(format!(
                    "Failed to stage clipboard image {}: {error}",
                    source_path.display()
                ))
            })?;
        Ok(PasteItemsRequest {
            sources: vec![crate::domain::explorer::PasteItem {
                path: display_path(&source_path),
                is_directory: false,
                size_bytes: None,
                remote_modified: None,
            }],
            destination_directory: request.destination_directory,
            operation: crate::domain::explorer::ClipboardOperation::Copy,
            target_name: Some(preferred_name),
        })
    }
}
