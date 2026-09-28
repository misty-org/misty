use super::*;

impl ExplorerService {
    pub async fn paste_items(
        &self,
        request: PasteItemsRequest,
    ) -> ApiResult<ExplorerOperationResult> {
        self.paste_items_impl(request, None, None).await
    }

    pub(super) async fn paste_items_impl(
        &self,
        request: PasteItemsRequest,
        cancellation: Option<&AtomicBool>,
        existing_transfer_id: Option<u64>,
    ) -> ApiResult<ExplorerOperationResult> {
        ensure_not_canceled_if(cancellation)?;
        self.validate_paste_paths(&request)?;
        let mut transfer_ids = Vec::with_capacity(request.sources.len());
        for item in &request.sources {
            let file_name = request
                .target_name
                .as_deref()
                .filter(|_| request.sources.len() == 1)
                .unwrap_or_else(|| {
                    Path::new(&item.path)
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or(&item.path)
                })
                .to_string();
            let mut record = FileTransferRecord::new(
                match request.operation {
                    crate::domain::explorer::ClipboardOperation::Copy => FileTransferType::Copy,
                    crate::domain::explorer::ClipboardOperation::Move => FileTransferType::Move,
                },
                FileTransferItemType::Local,
                &file_name,
            );
            record.local_source_path = item.path.clone();
            record.local_dest_path =
                display_path(&Path::new(&request.destination_directory).join(file_name));
            record.total_bytes = local_item_size(Path::new(&item.path), item.is_directory).await;
            record.detail_message = "Transferring local item".to_string();
            if let Some(id) = if existing_transfer_id.is_some() {
                existing_transfer_id
            } else {
                self.begin_transfer(record).await
            } {
                transfer_ids.push(id);
            }
        }
        let result = tokio::task::spawn_blocking(move || paste_items(request))
            .await
            .map_err(|err| ApiError::Message(format!("Explorer worker failed: {err}")))?;
        self.finish_transfers(&transfer_ids, result).await
    }

    pub async fn paste_items_with_cancellation(
        &self,
        request: PasteItemsRequest,
        cancellation: Arc<AtomicBool>,
    ) -> ApiResult<ExplorerOperationResult> {
        ensure_not_canceled(cancellation.as_ref())?;

        self.paste_local_items_with_cancellation(request, cancellation.as_ref(), None)
            .await
    }

    pub async fn paste_items_with_cancellation_transfer(
        &self,
        request: PasteItemsRequest,
        cancellation: Arc<AtomicBool>,
        transfer_id: u64,
    ) -> ApiResult<ExplorerOperationResult> {
        ensure_not_canceled(cancellation.as_ref())?;
        let existing_transfer_id = nonzero_transfer_id(transfer_id);

        self.paste_local_items_with_cancellation(
            request,
            cancellation.as_ref(),
            existing_transfer_id,
        )
        .await
    }

    pub(super) async fn paste_local_items_with_cancellation(
        &self,
        request: PasteItemsRequest,
        cancellation: &AtomicBool,
        existing_transfer_id: Option<u64>,
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
        let mut transfer_ids = Vec::with_capacity(request.sources.len());

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

            let file_name = file_name.to_string_lossy().to_string();
            let mut record = FileTransferRecord::new(
                match request.operation {
                    crate::domain::explorer::ClipboardOperation::Copy => FileTransferType::Copy,
                    crate::domain::explorer::ClipboardOperation::Move => FileTransferType::Move,
                },
                FileTransferItemType::Local,
                &file_name,
            );
            record.local_source_path = display_path(&source);
            record.local_dest_path = display_path(&destination);
            record.total_bytes = local_item_size(&source, item.is_directory).await;
            record.detail_message = "Transferring local item".to_string();
            if let Some(id) = if existing_transfer_id.is_some() {
                existing_transfer_id
            } else {
                self.begin_transfer(record).await
            } {
                transfer_ids.push(id);
            }

            let result = match request.operation {
                crate::domain::explorer::ClipboardOperation::Copy => {
                    copy_local_path_cancellable(&source, &destination, cancellation).await
                }
                crate::domain::explorer::ClipboardOperation::Move => {
                    move_local_path_cancellable(&source, &destination, cancellation).await
                }
            };
            let result = cleanup_partial_destination_on_cancel(
                &destination,
                source_metadata.is_dir() && !source_metadata.file_type().is_symlink(),
                result,
            )
            .await;
            self.finish_transfers(&transfer_ids, result).await?;
            transfer_ids.clear();
            affected_paths.push(display_path(&destination));
        }

        Ok(ExplorerOperationResult {
            affected_paths,
            parent_path: Some(display_path(&destination_directory)),
        })
    }
}
