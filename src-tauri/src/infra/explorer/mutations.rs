use super::*;

impl ExplorerService {
    pub async fn create_item(
        &self,
        request: CreateItemRequest,
    ) -> ApiResult<ExplorerOperationResult> {
        self.create_item_impl(request, None, None).await
    }

    pub async fn create_item_with_cancellation(
        &self,
        request: CreateItemRequest,
        cancellation: Arc<AtomicBool>,
    ) -> ApiResult<ExplorerOperationResult> {
        self.create_item_impl(request, Some(cancellation.as_ref()), None)
            .await
    }

    pub async fn create_item_with_cancellation_transfer(
        &self,
        request: CreateItemRequest,
        cancellation: Arc<AtomicBool>,
        transfer_id: u64,
    ) -> ApiResult<ExplorerOperationResult> {
        self.create_item_impl(
            request,
            Some(cancellation.as_ref()),
            nonzero_transfer_id(transfer_id),
        )
        .await
    }

    pub(super) async fn create_item_impl(
        &self,
        request: CreateItemRequest,
        cancellation: Option<&AtomicBool>,
        existing_transfer_id: Option<u64>,
    ) -> ApiResult<ExplorerOperationResult> {
        ensure_not_canceled_if(cancellation)?;
        if let Some(target) = self.remote_target(&request.directory) {
            let name = validate_remote_name(&request.name)?.to_string();
            let remote_path = normalize_remote_path(&join_remote_path(&target.remote_path, &name))?;
            let mut record = FileTransferRecord::new(
                FileTransferType::Create,
                FileTransferItemType::Remote,
                &name,
            );
            record.remote_dest_name = target.remote_name.clone();
            record.remote_dest_path = remote_path.clone();
            record.detail_message = match request.kind {
                crate::domain::explorer::CreateItemKind::Folder => "Creating remote folder",
                crate::domain::explorer::CreateItemKind::File => "Creating remote file",
            }
            .to_string();
            let transfer_id = if existing_transfer_id.is_some() {
                existing_transfer_id
            } else {
                self.begin_transfer(record).await
            };
            let operation = match request.kind {
                crate::domain::explorer::CreateItemKind::Folder => self
                    .start_json_job(
                        "/api/remote/file/mkdir",
                        serde_json::json!({ "remote": target.remote_name, "path": remote_path }),
                        transfer_id,
                        cancellation,
                    )
                    .await
                    .map(|_| ()),
                crate::domain::explorer::CreateItemKind::File => self
                    .start_json_job(
                        "/api/remote/file/create",
                        serde_json::json!({ "remote": target.remote_name, "path": remote_path }),
                        transfer_id,
                        cancellation,
                    )
                    .await
                    .map(|_| ()),
            };
            self.finish_transfer(transfer_id, operation).await?;
            self.listing_cache
                .clear(&target.remote_name, &target.remote_path)
                .await?;
            return Ok(ExplorerOperationResult {
                affected_paths: vec![display_path(
                    &target.virtual_path(&self.mount_root).join(name),
                )],
                parent_path: Some(display_path(&target.virtual_path(&self.mount_root))),
            });
        }
        self.reject_virtual_mount_container(&request.directory, "create")?;
        let mut record = FileTransferRecord::new(
            FileTransferType::Create,
            FileTransferItemType::Local,
            request.name.clone(),
        );
        record.local_dest_path = display_path(&Path::new(&request.directory).join(&request.name));
        record.detail_message = "Creating local item".to_string();
        let transfer_id = if existing_transfer_id.is_some() {
            existing_transfer_id
        } else {
            self.begin_transfer(record).await
        };
        ensure_not_canceled_if(cancellation)?;
        let result = create_local_item_cancellable(request, cancellation).await;
        self.finish_transfer(transfer_id, result).await
    }

    pub(super) async fn create_empty_remote_file(
        &self,
        target: &RemoteBrowseTarget,
        name: &str,
        transfer_id: Option<u64>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        ensure_not_canceled_if(cancellation)?;
        tokio::fs::create_dir_all(&self.clipboard_text_cache_dir)
            .await
            .map_err(|error| {
                ApiError::Message(format!(
                    "Failed to prepare remote file cache {}: {error}",
                    self.clipboard_text_cache_dir.display()
                ))
            })?;
        let stage_path = self.clipboard_text_cache_dir.join(format!(
            "empty-{}-{}",
            now_epoch_ms(),
            sanitize_drag_file_name(name)
        ));
        tokio::fs::write(&stage_path, []).await.map_err(|error| {
            ApiError::Message(format!(
                "Failed to stage empty remote file {}: {error}",
                stage_path.display()
            ))
        })?;
        let result = self
            .upload_remote_file(super::remote_upload::RemoteUploadRequest {
                local_path: &stage_path,
                remote_name: &target.remote_name,
                remote_directory: &target.remote_path,
                item_name: name,
                transfer_id,
                progress: None,
                cancellation,
            })
            .await;
        let _ = tokio::fs::remove_file(&stage_path).await;
        result
    }

    pub async fn rename_item(
        &self,
        request: RenameItemRequest,
    ) -> ApiResult<ExplorerOperationResult> {
        self.rename_item_impl(request, None, None).await
    }

    pub async fn rename_item_with_cancellation(
        &self,
        request: RenameItemRequest,
        cancellation: Arc<AtomicBool>,
    ) -> ApiResult<ExplorerOperationResult> {
        self.rename_item_impl(request, Some(cancellation.as_ref()), None)
            .await
    }

    pub async fn rename_item_with_cancellation_transfer(
        &self,
        request: RenameItemRequest,
        cancellation: Arc<AtomicBool>,
        transfer_id: u64,
    ) -> ApiResult<ExplorerOperationResult> {
        self.rename_item_impl(
            request,
            Some(cancellation.as_ref()),
            nonzero_transfer_id(transfer_id),
        )
        .await
    }

    pub(super) async fn rename_item_impl(
        &self,
        request: RenameItemRequest,
        cancellation: Option<&AtomicBool>,
        existing_transfer_id: Option<u64>,
    ) -> ApiResult<ExplorerOperationResult> {
        ensure_not_canceled_if(cancellation)?;
        if let Some(source) = self.remote_target(&request.path) {
            if source.remote_path == "/" {
                return Err(ApiError::Message(
                    "Rename remotes from the Providers workspace.".to_string(),
                ));
            }
            let name = validate_remote_name(&request.new_name)?;
            let parent = remote_parent_path(&source.remote_path);
            let destination_path = normalize_remote_path(&join_remote_path(&parent, name))?;
            let mut record = FileTransferRecord::new(
                FileTransferType::Rename,
                FileTransferItemType::Remote,
                name,
            );
            record.remote_source_name = source.remote_name.clone();
            record.remote_source_path = source.remote_path.clone();
            record.remote_dest_name = source.remote_name.clone();
            record.remote_dest_path = destination_path.clone();
            record.detail_message = "Renaming remote item".to_string();
            let transfer_id = if existing_transfer_id.is_some() {
                existing_transfer_id
            } else {
                self.begin_transfer(record).await
            };
            let operation = if request.source_is_directory.unwrap_or(false) {
                self.start_json_job(
                    "/api/remote/file/move",
                    serde_json::json!({
                        "source_remote": source.remote_name,
                        "source_path": source.remote_path,
                        "dest_remote": source.remote_name,
                        "dest_path": destination_path,
                    }),
                    transfer_id,
                    cancellation,
                )
                .await
            } else {
                self.start_json_job(
                    "/api/remote/file/rename",
                    serde_json::json!({
                        "remote": source.remote_name,
                        "old_path": source.remote_path,
                        "new_path": destination_path,
                    }),
                    transfer_id,
                    cancellation,
                )
                .await
            };
            self.finish_transfer(transfer_id, operation).await?;
            self.listing_cache
                .clear(&source.remote_name, &parent)
                .await?;
            let parent_target = RemoteBrowseTarget {
                provider_type: source.provider_type.clone(),
                remote_name: source.remote_name.clone(),
                remote_path: parent,
            };
            return Ok(ExplorerOperationResult {
                affected_paths: vec![display_path(
                    &parent_target.virtual_path(&self.mount_root).join(name),
                )],
                parent_path: Some(display_path(&parent_target.virtual_path(&self.mount_root))),
            });
        }
        self.reject_virtual_mount_container(&request.path, "rename")?;
        let destination = Path::new(&request.path)
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join(&request.new_name);
        let mut record = FileTransferRecord::new(
            FileTransferType::Rename,
            FileTransferItemType::Local,
            request.new_name.clone(),
        );
        record.local_source_path = request.path.clone();
        record.local_dest_path = display_path(&destination);
        record.total_bytes = local_item_size(
            Path::new(&request.path),
            request.source_is_directory.unwrap_or(false),
        )
        .await;
        record.detail_message = "Renaming local item".to_string();
        let transfer_id = if existing_transfer_id.is_some() {
            existing_transfer_id
        } else {
            self.begin_transfer(record).await
        };
        ensure_not_canceled_if(cancellation)?;
        let result = rename_local_item_cancellable(request, cancellation).await;
        self.finish_transfer(transfer_id, result).await
    }

    pub async fn delete_items(
        &self,
        request: DeleteItemsRequest,
    ) -> ApiResult<ExplorerOperationResult> {
        self.delete_items_impl(request, None, None).await
    }

    pub async fn delete_items_with_cancellation(
        &self,
        request: DeleteItemsRequest,
        cancellation: Arc<AtomicBool>,
    ) -> ApiResult<ExplorerOperationResult> {
        self.delete_items_impl(request, Some(cancellation.as_ref()), None)
            .await
    }

    pub async fn delete_items_with_cancellation_transfer(
        &self,
        request: DeleteItemsRequest,
        cancellation: Arc<AtomicBool>,
        transfer_id: u64,
    ) -> ApiResult<ExplorerOperationResult> {
        self.delete_items_impl(
            request,
            Some(cancellation.as_ref()),
            nonzero_transfer_id(transfer_id),
        )
        .await
    }

    pub(super) async fn delete_items_impl(
        &self,
        request: DeleteItemsRequest,
        cancellation: Option<&AtomicBool>,
        existing_transfer_id: Option<u64>,
    ) -> ApiResult<ExplorerOperationResult> {
        ensure_not_canceled_if(cancellation)?;
        let permanent = request.permanent;
        let mut local_paths = Vec::new();
        let mut affected_paths = Vec::new();
        let mut parent_path = None;
        for path in request.paths {
            ensure_not_canceled_if(cancellation)?;
            if let Some(target) = self.remote_target(&path) {
                if !permanent {
                    return Err(ApiError::Message(
                        "Remote items can only be deleted permanently.".to_string(),
                    ));
                }
                if target.remote_path == "/" {
                    return Err(ApiError::Message(
                        "Disconnect remotes from the Providers workspace.".to_string(),
                    ));
                }
                let file_name = Path::new(&target.remote_path)
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or(&target.remote_path)
                    .to_string();
                let mut record = FileTransferRecord::new(
                    FileTransferType::Delete,
                    FileTransferItemType::Remote,
                    file_name,
                );
                record.remote_source_name = target.remote_name.clone();
                record.remote_source_path = target.remote_path.clone();
                record.detail_message = "Deleting remote item".to_string();
                let transfer_id = if existing_transfer_id.is_some() {
                    existing_transfer_id
                } else {
                    self.begin_transfer(record).await
                };
                self.finish_transfer(
                    transfer_id,
                    self.delete_remote_target(&target, transfer_id, cancellation)
                        .await,
                )
                .await?;
                ensure_not_canceled_if(cancellation)?;
                let virtual_path = target.virtual_path(&self.mount_root);
                parent_path.get_or_insert_with(|| {
                    virtual_path.parent().map(display_path).unwrap_or_default()
                });
                affected_paths.push(display_path(&virtual_path));
            } else {
                self.reject_virtual_mount_container(&path, "delete")?;
                local_paths.push(path);
            }
        }
        for local_path in local_paths {
            ensure_not_canceled_if(cancellation)?;
            let file_name = Path::new(&local_path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(&local_path)
                .to_string();
            let metadata = tokio::fs::symlink_metadata(&local_path).await.ok();
            let mut record = FileTransferRecord::new(
                FileTransferType::Delete,
                FileTransferItemType::Local,
                file_name,
            );
            record.local_source_path = local_path.clone();
            record.total_bytes = metadata
                .as_ref()
                .filter(|metadata| metadata.is_file())
                .map(|metadata| metadata.len().min(i64::MAX as u64) as i64)
                .unwrap_or_default();
            record.detail_message = if permanent {
                "Deleting local item".to_string()
            } else {
                "Moving local item to Trash".to_string()
            };
            let transfer_id = if existing_transfer_id.is_some() {
                existing_transfer_id
            } else {
                self.begin_transfer(record).await
            };
            let local_result = if permanent {
                delete_local_path_cancellable(Path::new(&local_path), cancellation).await
            } else {
                trash_local_path_cancellable(Path::new(&local_path), &self.trash_dir, cancellation)
                    .await
                    .map(|_| ())
            }
            .map(|()| ExplorerOperationResult {
                affected_paths: vec![local_path.clone()],
                parent_path: Path::new(&local_path).parent().map(display_path),
            });
            let local_result = self.finish_transfer(transfer_id, local_result).await?;
            if parent_path.is_none() {
                parent_path = local_result.parent_path.clone();
            }
            affected_paths.extend(local_result.affected_paths);
        }
        Ok(ExplorerOperationResult {
            affected_paths,
            parent_path,
        })
    }
}
