use super::*;

impl ExplorerService {
    pub async fn prepare_open_item(
        &self,
        request: PrepareOpenItemRequest,
    ) -> ApiResult<PreparedOpenItem> {
        self.reject_virtual_mount_container(&request.path, "open")?;
        if !Path::new(&request.path).is_file() {
            return Err(ApiError::Message(format!(
                "{} is not a file.",
                request.path
            )));
        }
        Ok(PreparedOpenItem {
            local_path: request.path,
            cached: true,
            source_path: None,
            cache_path: None,
            cache_hit: true,
        })
    }

    pub async fn prepare_drag_items(
        &self,
        request: PrepareDragItemsRequest,
    ) -> ApiResult<PreparedDragItemsResult> {
        let session_id = request.session_id.clone();
        let cancellation = if let Some(session_id) = &session_id {
            let mut cancellations = self.drag_preparation_cancellations.lock().await;
            Some(
                cancellations
                    .entry(session_id.clone())
                    .or_insert_with(|| Arc::new(AtomicBool::new(false)))
                    .clone(),
            )
        } else {
            None
        };
        let mut prepared = Vec::new();
        let mut skipped = Vec::new();
        for item in request.items {
            match self.prepare_drag_item(item, cancellation.as_deref()).await {
                Ok(item) => prepared.push(item),
                Err(error) => skipped.push(PreparedDragSkippedItem {
                    source_path: error.0,
                    reason: error.1,
                }),
            }
        }
        if let Some(session_id) = session_id {
            self.drag_preparation_cancellations
                .lock()
                .await
                .remove(&session_id);
        }
        Ok(PreparedDragItemsResult {
            items: prepared,
            skipped,
        })
    }

    pub(super) async fn prepare_drag_item(
        &self,
        request: PrepareDragItemRequest,
        cancellation: Option<&AtomicBool>,
    ) -> Result<PreparedDragItem, (String, String)> {
        let source_path = request.path.clone();
        match self.prepare_drag_item_inner(request, cancellation).await {
            Ok(item) => Ok(item),
            Err(error) => Err((source_path, error.to_string())),
        }
    }

    pub(super) async fn prepare_drag_item_inner(
        &self,
        request: PrepareDragItemRequest,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<PreparedDragItem> {
        ensure_not_canceled_if(cancellation)?;
        self.reject_virtual_mount_container(&request.path, "drag")?;
        let path = Path::new(&request.path);
        if !path.exists() {
            return Err(ApiError::Message(format!(
                "{} does not exist.",
                request.path
            )));
        }
        let is_directory = path.is_dir();
        Ok(PreparedDragItem {
            source_path: request.path.clone(),
            local_path: request.path,
            is_directory,
            cached: true,
        })
    }

    pub async fn cancel_drag_preparation(&self, session_id: &str) {
        self.drag_preparation_cancellations
            .lock()
            .await
            .entry(session_id.to_owned())
            .or_insert_with(|| Arc::new(AtomicBool::new(true)))
            .store(true, Ordering::Relaxed);
    }
}
