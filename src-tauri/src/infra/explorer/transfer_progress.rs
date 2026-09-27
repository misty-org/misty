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
