use super::*;

impl ExplorerService {
    pub async fn create_item_with_cancellation(
        &self,
        request: CreateItemRequest,
        cancellation: Arc<AtomicBool>,
    ) -> ApiResult<ExplorerOperationResult> {
        self.create_item_impl(request, Some(cancellation.as_ref()))
            .await
    }

    pub(super) async fn create_item_impl(
        &self,
        request: CreateItemRequest,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<ExplorerOperationResult> {
        ensure_not_canceled_if(cancellation)?;

        self.reject_virtual_mount_container(&request.directory, "create")?;
        ensure_not_canceled_if(cancellation)?;
        create_local_item_cancellable(request, cancellation).await
    }

    pub async fn rename_item_with_cancellation(
        &self,
        request: RenameItemRequest,
        cancellation: Arc<AtomicBool>,
    ) -> ApiResult<ExplorerOperationResult> {
        self.rename_item_impl(request, Some(cancellation.as_ref()))
            .await
    }

    pub(super) async fn rename_item_impl(
        &self,
        request: RenameItemRequest,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<ExplorerOperationResult> {
        ensure_not_canceled_if(cancellation)?;

        self.reject_virtual_mount_container(&request.path, "rename")?;
        ensure_not_canceled_if(cancellation)?;
        rename_local_item_cancellable(request, cancellation).await
    }

    pub async fn delete_items_with_cancellation(
        &self,
        request: DeleteItemsRequest,
        cancellation: Arc<AtomicBool>,
    ) -> ApiResult<ExplorerOperationResult> {
        self.delete_items_impl(request, Some(cancellation.as_ref()))
            .await
    }

    pub(super) async fn delete_items_impl(
        &self,
        request: DeleteItemsRequest,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<ExplorerOperationResult> {
        ensure_not_canceled_if(cancellation)?;
        let permanent = request.permanent;
        let mut local_paths = Vec::new();
        let mut affected_paths = Vec::new();
        let mut parent_path = None;
        for path in request.paths {
            ensure_not_canceled_if(cancellation)?;
            self.reject_virtual_mount_container(&path, "delete")?;
            local_paths.push(path);
        }
        for local_path in local_paths {
            ensure_not_canceled_if(cancellation)?;
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
            })?;
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
