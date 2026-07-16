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
        if let Some(destination) = self.remote_target(&request.destination_directory) {
            let mut affected_paths = Vec::new();
            for item in &request.sources {
                ensure_not_canceled_if(cancellation)?;
                let source_name = request
                    .target_name
                    .as_deref()
                    .filter(|_| request.sources.len() == 1)
                    .map(validate_remote_name)
                    .transpose()?
                    .map(ToOwned::to_owned)
                    .or_else(|| {
                        Path::new(&item.path)
                            .file_name()
                            .and_then(|value| value.to_str())
                            .map(ToOwned::to_owned)
                    })
                    .ok_or_else(|| ApiError::Message("Source has no file name".to_string()))?;
                if ignored_upload_name(&source_name) {
                    continue;
                }
                let source_target = self.remote_target(&item.path);
                let transfer_type = if source_target.is_some() {
                    match request.operation {
                        crate::core::explorer::ClipboardOperation::Copy => FileTransferType::Copy,
                        crate::core::explorer::ClipboardOperation::Move => FileTransferType::Move,
                    }
                } else {
                    FileTransferType::Upload
                };
                let mut record = FileTransferRecord::new(
                    transfer_type,
                    if source_target.is_some() {
                        FileTransferItemType::Remote
                    } else {
                        FileTransferItemType::Local
                    },
                    &source_name,
                );
                record.remote_dest_name = destination.remote_name.clone();
                record.remote_dest_path = normalize_remote_path(&join_remote_path(
                    &destination.remote_path,
                    &source_name,
                ))?;
                if let Some(source) = &source_target {
                    record.remote_source_name = source.remote_name.clone();
                    record.remote_source_path = source.remote_path.clone();
                } else {
                    record.local_source_path = item.path.clone();
                    record.total_bytes =
                        local_item_size(Path::new(&item.path), item.is_directory).await;
                }
                record.detail_message = if source_target.is_some() {
                    "Transferring remote item".to_string()
                } else {
                    "Uploading local item".to_string()
                };
                let transfer_id = if existing_transfer_id.is_some() {
                    existing_transfer_id
                } else {
                    self.begin_transfer(record).await
                };

                let operation = if let Some(source) = source_target {
                    let destination_path = normalize_remote_path(&join_remote_path(
                        &destination.remote_path,
                        &source_name,
                    ))?;
                    let endpoint = match request.operation {
                        crate::core::explorer::ClipboardOperation::Copy => "/api/remote/file/copy",
                        crate::core::explorer::ClipboardOperation::Move => "/api/remote/file/move",
                    };
                    self.start_json_job(
                        endpoint,
                        serde_json::json!({
                            "source_remote": source.remote_name,
                            "source_path": source.remote_path,
                            "dest_remote": destination.remote_name,
                            "dest_path": destination_path,
                        }),
                        transfer_id,
                        cancellation,
                    )
                    .await
                    .map(|_| ())
                } else {
                    let upload = self
                        .upload_local_item(
                            Path::new(&item.path),
                            item.is_directory,
                            &destination,
                            &source_name,
                            transfer_id,
                            cancellation,
                        )
                        .await;
                    if upload.is_ok()
                        && matches!(
                            request.operation,
                            crate::core::explorer::ClipboardOperation::Move
                        )
                    {
                        remove_local_path(Path::new(&item.path), item.is_directory).await
                    } else {
                        upload
                    }
                };
                self.finish_transfer(transfer_id, operation).await?;
                ensure_not_canceled_if(cancellation)?;
                affected_paths.push(display_path(
                    &destination
                        .virtual_path(&self.mount_root)
                        .join(&source_name),
                ));
            }
            self.listing_cache
                .clear(&destination.remote_name, &destination.remote_path)
                .await?;
            return Ok(ExplorerOperationResult {
                affected_paths,
                parent_path: Some(display_path(&destination.virtual_path(&self.mount_root))),
            });
        }
        self.reject_virtual_mount_container(&request.destination_directory, "paste")?;
        if request
            .sources
            .iter()
            .any(|item| self.remote_target(&item.path).is_some())
        {
            let destination = PathBuf::from(&request.destination_directory);
            let mut affected_paths = Vec::new();
            for item in &request.sources {
                ensure_not_canceled_if(cancellation)?;
                let source = self.remote_target(&item.path).ok_or_else(|| {
                    ApiError::Message(
                        "A single paste cannot mix local and remote sources.".to_string(),
                    )
                })?;
                let name = request
                    .target_name
                    .as_deref()
                    .filter(|_| request.sources.len() == 1)
                    .map(validate_remote_name)
                    .transpose()?
                    .unwrap_or_else(|| {
                        Path::new(&source.remote_path)
                            .file_name()
                            .and_then(|value| value.to_str())
                            .unwrap_or(&source.remote_path)
                    });
                let local_path = destination.join(name);
                ensure_destination_available(&local_path).await?;
                let mut record = FileTransferRecord::new(
                    FileTransferType::Download,
                    FileTransferItemType::Remote,
                    name,
                );
                record.remote_source_name = source.remote_name.clone();
                record.remote_source_path = source.remote_path.clone();
                record.local_dest_path = display_path(&local_path);
                let cached_remote_file = if item.is_directory {
                    None
                } else {
                    self.cached_remote_file_for_paste(&source, item).await
                };
                record.detail_message = if cached_remote_file.is_some() {
                    "Copying cached remote item".to_string()
                } else {
                    "Downloading remote item".to_string()
                };
                let transfer_id = if existing_transfer_id.is_some() {
                    existing_transfer_id
                } else {
                    self.begin_transfer(record).await
                };
                let download = if let Some(cache_path) = cached_remote_file {
                    copy_cached_remote_file_to_destination(&cache_path, &local_path, cancellation)
                        .await
                } else {
                    self.download_remote_item(
                        &source,
                        item.is_directory,
                        &local_path,
                        transfer_id,
                        cancellation,
                    )
                    .await
                };
                let operation = if download.is_ok()
                    && matches!(
                        request.operation,
                        crate::core::explorer::ClipboardOperation::Move
                    ) {
                    self.delete_remote_target(&source, transfer_id, cancellation)
                        .await
                } else {
                    download
                };
                self.finish_transfer(transfer_id, operation).await?;
                ensure_not_canceled_if(cancellation)?;
                if !item.is_directory {
                    self.cache_downloaded_remote_file(
                        &source,
                        &local_path,
                        item.size_bytes,
                        item.remote_modified.as_deref(),
                    )
                    .await;
                }
                affected_paths.push(display_path(&local_path));
            }
            return Ok(ExplorerOperationResult {
                affected_paths,
                parent_path: Some(display_path(&destination)),
            });
        }
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
                    crate::core::explorer::ClipboardOperation::Copy => FileTransferType::Copy,
                    crate::core::explorer::ClipboardOperation::Move => FileTransferType::Move,
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
        if self.remote_target(&request.destination_directory).is_some()
            || request
                .sources
                .iter()
                .any(|item| self.remote_target(&item.path).is_some())
        {
            let result = self
                .paste_items_impl(request, Some(cancellation.as_ref()), None)
                .await;
            ensure_not_canceled(cancellation.as_ref())?;
            return result;
        }
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
        if self.remote_target(&request.destination_directory).is_some()
            || request
                .sources
                .iter()
                .any(|item| self.remote_target(&item.path).is_some())
        {
            let result = self
                .paste_items_impl(request, Some(cancellation.as_ref()), existing_transfer_id)
                .await;
            ensure_not_canceled(cancellation.as_ref())?;
            return result;
        }
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
        let mut transfer_ids = Vec::with_capacity(request.sources.len());

        for item in &request.sources {
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
                    crate::core::explorer::ClipboardOperation::Copy => FileTransferType::Copy,
                    crate::core::explorer::ClipboardOperation::Move => FileTransferType::Move,
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
                crate::core::explorer::ClipboardOperation::Copy => {
                    copy_local_path_cancellable(&source, &destination, cancellation).await
                }
                crate::core::explorer::ClipboardOperation::Move => {
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
