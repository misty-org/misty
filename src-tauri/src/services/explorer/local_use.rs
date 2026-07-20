use super::*;

impl ExplorerService {
    pub async fn remote_virtual_path(
        &self,
        remote_name: &str,
        remote_path: &str,
    ) -> ApiResult<String> {
        let remote_path = normalize_remote_path(remote_path)?;
        let remotes = self.remote_inventory().await?;
        let remote = remotes
            .iter()
            .find(|remote| remote.name == remote_name)
            .ok_or_else(|| ApiError::Message(format!("Remote \"{remote_name}\" was not found.")))?;
        let target = RemoteBrowseTarget {
            provider_type: remote.provider_type.clone(),
            remote_name: remote.name.clone(),
            remote_path,
        };
        Ok(display_path(&target.virtual_path(&self.mount_root)))
    }

    pub async fn prepare_open_item(
        &self,
        request: PrepareOpenItemRequest,
    ) -> ApiResult<PreparedOpenItem> {
        let Some(source) = self.remote_target(&request.path) else {
            self.reject_virtual_mount_container(&request.path, "open")?;
            if !Path::new(&request.path).is_file() {
                return Err(ApiError::Message(format!(
                    "{} is not a file.",
                    request.path
                )));
            }
            return Ok(PreparedOpenItem {
                local_path: request.path,
                cached: true,
                source_path: None,
                cache_path: None,
                cache_hit: true,
            });
        };
        if self.item_is_directory(&request.path).await? != Some(false) {
            return Err(ApiError::Message(
                "Only remote files can be opened.".to_string(),
            ));
        }
        self.prepare_remote_file_for_local_use(
            &source,
            request.size_bytes,
            request.remote_modified.as_deref(),
            "Preparing remote file to open",
            false,
            None,
        )
        .await
    }

    pub async fn prepare_drag_items(
        &self,
        request: PrepareDragItemsRequest,
    ) -> ApiResult<PreparedDragItemsResult> {
        let session_id = request.session_id.clone();
        let cancellation = if let Some(session_id) = &session_id {
            let mut cancellations = self.drag_preparation_cancellations.lock().await;
            Some(cancellations.entry(session_id.clone())
                .or_insert_with(|| Arc::new(AtomicBool::new(false)))
                .clone())
        } else { None };
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
            self.drag_preparation_cancellations.lock().await.remove(&session_id);
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
        let Some(source) = self.remote_target(&request.path) else {
            self.reject_virtual_mount_container(&request.path, "drag")?;
            let path = Path::new(&request.path);
            if !path.exists() {
                return Err(ApiError::Message(format!(
                    "{} does not exist.",
                    request.path
                )));
            }
            let is_directory = path.is_dir();
            return Ok(PreparedDragItem {
                source_path: request.path.clone(),
                local_path: request.path,
                is_directory,
                cached: true,
            });
        };

        let file_name = Path::new(&source.remote_path)
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("item")
            .to_string();
        let is_directory = request.is_directory;
        if !is_directory {
            let prepared = self
                .prepare_remote_file_for_local_use(
                    &source,
                    request.size_bytes,
                    request.remote_modified.as_deref(),
                    "Preparing remote file for drag-out",
                    true,
                    cancellation,
                )
                .await?;
            return Ok(PreparedDragItem {
                source_path: request.path,
                local_path: prepared.local_path,
                is_directory: false,
                cached: prepared.cached,
            });
        }

        cleanup_expired_drag_stage_dirs(&self.drag_stage_dir);
        let stage_path = self
            .drag_stage_dir
            .join(format!(
                "{}-{}",
                now_epoch_ms(),
                sanitize_drag_file_name(&file_name)
            ))
            .join(&file_name);
        if let Some(parent) = stage_path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|error| {
                ApiError::Message(format!(
                    "Failed to prepare drag cache {}: {error}",
                    parent.display()
                ))
            })?;
        }
        let _ = tokio::fs::remove_dir_all(&stage_path).await;
        let mut record = FileTransferRecord::new(
            FileTransferType::Download,
            FileTransferItemType::Remote,
            &file_name,
        );
        record.remote_source_name = source.remote_name.clone();
        record.remote_source_path = source.remote_path.clone();
        record.local_dest_path = display_path(&stage_path);
        record.total_bytes = request.size_bytes.unwrap_or_default();
        record.detail_message = "Preparing remote folder for drag-out".to_string();
        let transfer_id = self.begin_transfer(record).await;
        let result = self
            .download_remote_item(&source, true, &stage_path, transfer_id, cancellation)
            .await;
        if result.is_err() {
            let _ = tokio::fs::remove_dir_all(stage_path.parent().unwrap_or(&stage_path)).await;
        }
        self.finish_transfer(transfer_id, result).await?;

        Ok(PreparedDragItem {
            source_path: request.path,
            local_path: display_path(&stage_path),
            is_directory: true,
            cached: false,
        })
    }

    pub(super) async fn prepare_remote_file_for_local_use(
        &self,
        source: &RemoteBrowseTarget,
        size_bytes: Option<i64>,
        remote_modified: Option<&str>,
        _detail_message: &str,
        record_transfer: bool,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<PreparedOpenItem> {
        ensure_not_canceled_if(cancellation)?;
        let file_name = Path::new(&source.remote_path)
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| ApiError::Message("Remote file has no name.".to_string()))?
            .to_string();
        let cache_key = ClipboardRemoteFileCacheKey {
            remote_name: source.remote_name.clone(),
            remote_path: source.remote_path.clone(),
            size: size_bytes.unwrap_or_default(),
            last_modified: remote_modified.unwrap_or_default().to_string(),
            is_dir: false,
        };
        let final_path = source.virtual_path(&self.mount_root);
        if let Some(path) = self
            .remote_file_cache
            .lock()
            .await
            .lookup_remote_file(&cache_key)
        {
            return Ok(PreparedOpenItem {
                local_path: display_path(&path),
                cached: true,
                source_path: Some(display_path(&final_path)),
                cache_path: Some(display_path(&path)),
                cache_hit: true,
            });
        }
        if downloaded_file_exists(&final_path).await {
            let mut cache = self.remote_file_cache.lock().await;
            let local_path = cache
                .copy_remote_file_into_cache(&cache_key, &final_path, &file_name)
                .unwrap_or_else(|_| final_path.clone());
            return Ok(PreparedOpenItem {
                local_path: display_path(&local_path),
                cached: true,
                source_path: Some(display_path(&final_path)),
                cache_path: Some(display_path(&local_path)),
                cache_hit: true,
            });
        }

        let temp_path = self
            .remote_file_cache
            .lock()
            .await
            .temp_path_for(&ClipboardCache::remote_file_key(&cache_key), &file_name);
        let transfer_id = if record_transfer {
            let mut record = FileTransferRecord::new(
                FileTransferType::Download,
                FileTransferItemType::Remote,
                &file_name,
            );
            record.remote_source_name = source.remote_name.clone();
            record.remote_source_path = source.remote_path.clone();
            record.local_dest_path = display_path(&temp_path);
            record.total_bytes = size_bytes.unwrap_or_default();
            record.detail_message = _detail_message.to_string();
            self.begin_transfer(record).await
        } else {
            None
        };
        let result = self
            .download_remote_item(source, false, &temp_path, transfer_id, cancellation)
            .await;
        if let Err(error) = result {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return self.finish_transfer(transfer_id, Err(error)).await;
        }
        let mut cache_source_path = temp_path.clone();
        if !downloaded_file_exists(&temp_path).await {
            let _ = tokio::fs::remove_file(&temp_path).await;
            let retry_temp_path = self
                .remote_file_cache
                .lock()
                .await
                .temp_path_for(&ClipboardCache::remote_file_key(&cache_key), &file_name);
            let retry_result = self
                .download_remote_item(source, false, &retry_temp_path, transfer_id, cancellation)
                .await;
            if let Err(error) = retry_result {
                let _ = tokio::fs::remove_file(&retry_temp_path).await;
                return self.finish_transfer(transfer_id, Err(error)).await;
            }
            if !downloaded_file_exists(&retry_temp_path).await {
                let _ = tokio::fs::remove_file(&retry_temp_path).await;
                return self.finish_transfer(
                    transfer_id,
                    Err(ApiError::Message(format!(
                    "Remote download completed but did not create cached file for {file_name}. source={}, cache={}, cache_hit=false",
                    source.remote_path,
                    retry_temp_path.display()
                    ))),
                ).await;
            }
            cache_source_path = retry_temp_path;
        };
        let prepared = self
            .remote_file_cache
            .lock()
            .await
            .store_remote_file(&cache_key, &cache_source_path, &file_name)
            .map(|local_path| PreparedOpenItem {
                local_path: display_path(&local_path),
                cached: false,
                source_path: Some(display_path(&final_path)),
                cache_path: Some(display_path(&local_path)),
                cache_hit: false,
            })
            .map_err(|error| {
                ApiError::Message(format!("Failed to cache remote file {file_name}: {error}"))
            });
        self.finish_transfer(transfer_id, prepared).await
    }

    pub async fn cancel_drag_preparation(&self, session_id: &str) {
        self.drag_preparation_cancellations
            .lock()
            .await
            .entry(session_id.to_owned())
            .or_insert_with(|| Arc::new(AtomicBool::new(true)))
            .store(true, Ordering::Relaxed);
    }

    pub(super) async fn cached_remote_file_for_paste(
        &self,
        source: &RemoteBrowseTarget,
        item: &PasteItem,
    ) -> Option<PathBuf> {
        let cache_key = ClipboardRemoteFileCacheKey {
            remote_name: source.remote_name.clone(),
            remote_path: source.remote_path.clone(),
            size: item.size_bytes.unwrap_or_default(),
            last_modified: item
                .remote_modified
                .as_deref()
                .unwrap_or_default()
                .to_string(),
            is_dir: false,
        };
        self.remote_file_cache
            .lock()
            .await
            .lookup_remote_file(&cache_key)
    }

    pub(super) async fn cache_downloaded_remote_file(
        &self,
        source: &RemoteBrowseTarget,
        local_path: &Path,
        size_bytes: Option<i64>,
        remote_modified: Option<&str>,
    ) {
        let size = size_bytes.unwrap_or_else(|| {
            std::fs::metadata(local_path)
                .map(|metadata| metadata.len().min(i64::MAX as u64) as i64)
                .unwrap_or_default()
        });
        let cache_key = ClipboardRemoteFileCacheKey {
            remote_name: source.remote_name.clone(),
            remote_path: source.remote_path.clone(),
            size,
            last_modified: remote_modified.unwrap_or_default().to_string(),
            is_dir: false,
        };
        let file_name = Path::new(&source.remote_path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("item");
        let _ = self
            .remote_file_cache
            .lock()
            .await
            .copy_remote_file_into_cache(&cache_key, local_path, file_name);
    }
}
