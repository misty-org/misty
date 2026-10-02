use super::*;

impl ExplorerService {
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
            {
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
