use super::*;

impl ExplorerService {
    pub async fn paste_items(
        &self,
        request: PasteItemsRequest,
    ) -> ApiResult<ExplorerOperationResult> {
        self.paste_items_impl(request, None).await
    }

    pub(super) async fn paste_items_impl(
        &self,
        request: PasteItemsRequest,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<ExplorerOperationResult> {
        ensure_not_canceled_if(cancellation)?;
        self.validate_paste_paths(&request)?;
        tokio::task::spawn_blocking(move || paste_items(request))
            .await
            .map_err(|err| ApiError::Message(format!("Explorer worker failed: {err}")))?
    }

    pub async fn paste_items_with_cancellation(
        &self,
        request: PasteItemsRequest,
        cancellation: Arc<AtomicBool>,
    ) -> ApiResult<ExplorerOperationResult> {
        ensure_not_canceled(cancellation.as_ref())?;

        self.paste_local_items_with_cancellation(request, cancellation.as_ref())
            .await
    }

    pub(super) async fn paste_local_items_with_cancellation(
        &self,
        request: PasteItemsRequest,
        cancellation: &AtomicBool,
    ) -> ApiResult<ExplorerOperationResult> {
        if request.sources.is_empty() {
            return Err(ApiError::Message("Copy or cut an item first.".to_string()));
        }

        self.reject_virtual_mount_container(&request.destination_directory, "paste")?;
        let destination_directory =
            normalize_existing_local_dir(&request.destination_directory).await?;
        let target_name = if request.sources.len() == 1 {
            request
                .target_name
                .as_deref()
                .map(validate_local_file_name)
                .transpose()?
        } else {
            None
        };
        let mut affected_paths = Vec::new();
        self.validate_paste_paths(&request)?;

        for item in &request.sources {
            self.validate_paste_paths(&request)?;
            ensure_not_canceled(cancellation)?;
            let source = PathBuf::from(&item.path);
            let source_metadata = tokio::fs::symlink_metadata(&source)
                .await
                .map_err(|error| {
                    ApiError::Message(format!("Failed to inspect {}: {error}", source.display()))
                })?;
            let file_name = target_name
                .map(OsStr::new)
                .or_else(|| source.file_name())
                .ok_or_else(|| ApiError::Message(format!("Cannot paste {}.", source.display())))?;
            let destination = destination_directory.join(file_name);
            ensure_destination_available(&destination).await?;

            if source_metadata.is_dir()
                && !source_metadata.file_type().is_symlink()
                && destination_directory.starts_with(&source)
            {
                return Err(ApiError::Message(
                    "Cannot paste a folder into itself.".to_string(),
                ));
            }

            let result = match request.operation {
                crate::domain::explorer::ClipboardOperation::Copy => {
                    copy_local_path_cancellable(&source, &destination, cancellation).await
                }
                crate::domain::explorer::ClipboardOperation::Move => {
                    move_local_path_cancellable(&source, &destination, cancellation).await
                }
            };
            cleanup_partial_destination_on_cancel(
                &destination,
                source_metadata.is_dir() && !source_metadata.file_type().is_symlink(),
                result,
            )
            .await?;
            affected_paths.push(display_path(&destination));
        }

        Ok(ExplorerOperationResult {
            affected_paths,
            parent_path: Some(display_path(&destination_directory)),
        })
    }
}
