use super::*;

impl ExplorerService {
    pub(super) async fn begin_transfer(&self, record: FileTransferRecord) -> Option<u64> {
        self.transfers.start_transfer(record).await.ok()
    }

    pub(super) async fn finish_transfer<T>(
        &self,
        transfer_id: Option<u64>,
        result: ApiResult<T>,
    ) -> ApiResult<T> {
        match result {
            Ok(value) => {
                if let Some(transfer_id) = transfer_id {
                    let _ = self.transfers.complete_transfer(transfer_id).await;
                }
                Ok(value)
            }
            Err(error) => {
                if let Some(transfer_id) = transfer_id {
                    if is_cancellation_error(&error) {
                        let _ = self
                            .transfers
                            .cancel_transfer(transfer_id, "Canceled".to_string())
                            .await;
                    } else {
                        let _ = self
                            .transfers
                            .fail_transfer(transfer_id, error.to_string())
                            .await;
                    }
                }
                Err(error)
            }
        }
    }

    pub(super) async fn finish_transfers<T>(
        &self,
        transfer_ids: &[u64],
        result: ApiResult<T>,
    ) -> ApiResult<T> {
        match result {
            Ok(value) => {
                for transfer_id in transfer_ids {
                    let _ = self.transfers.complete_transfer(*transfer_id).await;
                }
                Ok(value)
            }
            Err(error) => {
                let message = error.to_string();
                for transfer_id in transfer_ids {
                    if is_cancellation_error(&error) {
                        let _ = self
                            .transfers
                            .cancel_transfer(*transfer_id, "Canceled".to_string())
                            .await;
                    } else {
                        let _ = self
                            .transfers
                            .fail_transfer(*transfer_id, message.clone())
                            .await;
                    }
                }
                Err(error)
            }
        }
    }

    pub(super) fn validate_paste_paths(&self, request: &PasteItemsRequest) -> ApiResult<()> {
        self.reject_virtual_mount_container(&request.destination_directory, "paste")?;
        for source in &request.sources {
            self.reject_virtual_mount_container(&source.path, "copy")?;
        }
        Ok(())
    }

    pub(super) fn reject_virtual_mount_container(
        &self,
        path: &str,
        operation: &str,
    ) -> ApiResult<()> {
        if path.contains("://") {
            return Err(ApiError::Message(
                "Choose a local folder or LAN device.".into(),
            ));
        }
        let path = Path::new(path);
        if path == self.mount_root || path.starts_with(&self.mount_root) {
            return Err(ApiError::Message(format!(
                "Cloud file locations are no longer supported. Choose a local folder or LAN device to {operation}."
            )));
        }
        Ok(())
    }
}

/// Throttles journal writes while preserving exact byte counts across a folder copy.
pub(super) struct LocalTransferProgress {
    service: TransferService,
    id: u64,
    total: i64,
    copied: i64,
    started: std::time::Instant,
    last_report: std::time::Instant,
}

impl LocalTransferProgress {
    pub(super) fn new(service: TransferService, id: u64, total: i64) -> Self {
        let now = std::time::Instant::now();
        Self {
            service,
            id,
            total,
            copied: 0,
            started: now,
            last_report: now,
        }
    }

    pub(super) async fn advance(&mut self, bytes: usize) {
        self.copied = self.copied.saturating_add(bytes as i64);
        if self.last_report.elapsed() >= std::time::Duration::from_millis(200) {
            self.flush().await;
        }
    }

    pub(super) async fn flush(&mut self) {
        let speed = self.copied as f64 / self.started.elapsed().as_secs_f64().max(0.001);
        let _ = self
            .service
            .update_progress_with_speed(self.id, self.copied, self.total.max(self.copied), speed)
            .await;
        self.last_report = std::time::Instant::now();
    }
}
