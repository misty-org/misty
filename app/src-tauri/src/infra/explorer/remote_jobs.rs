use super::*;

impl ExplorerService {
    pub(super) async fn wait_for_job(
        &self,
        job_id: &str,
        transfer_id: Option<u64>,
        progress: Option<TransferProgress>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<RemoteJobStatus> {
        let started_at = Instant::now();
        let mut last_activity_at = started_at;
        let mut last_signature = String::new();
        loop {
            if cancellation.is_some_and(|token| token.load(Ordering::SeqCst)) {
                let _ = self.cancel_remote_job(job_id).await;
                return Err(ApiError::Message("Operation canceled.".to_string()));
            }
            let elapsed = started_at.elapsed();
            if elapsed > REMOTE_JOB_MAX_WAIT {
                let _ = self.cancel_remote_job(job_id).await;
                return Err(ApiError::Message(format!(
                    "Remote operation timed out after {} hours",
                    REMOTE_JOB_MAX_WAIT.as_secs() / 3600
                )));
            }
            if last_activity_at.elapsed() > REMOTE_JOB_STALE_TIMEOUT {
                let _ = self.cancel_remote_job(job_id).await;
                return Err(ApiError::Message(format!(
                    "Remote operation timed out after {} minutes without progress",
                    REMOTE_JOB_STALE_TIMEOUT.as_secs() / 60
                )));
            }
            let response = self
                .proxy
                .get(&format!("/api/remote/file/jobs/{job_id}"))
                .await?;
            let status: RemoteJobStatus = response_json(response, "poll remote job").await?;
            let signature = format!(
                "{}:{}:{}:{}:{}",
                status.state,
                status.phase,
                status.bytes_completed,
                status.bytes_total,
                status.message
            );
            if signature != last_signature {
                last_signature = signature;
                last_activity_at = Instant::now();
            }
            if let Some(transfer_id) = transfer_id {
                let _ = self
                    .transfers
                    .update_progress_with_speed(
                        transfer_id,
                        remote_job_transferred_bytes(&status, progress),
                        remote_job_total_bytes(&status, progress),
                        status.bytes_per_second,
                    )
                    .await;
                let detail = if status.message.is_empty() {
                    status.phase.clone()
                } else {
                    status.message.clone()
                };
                if !detail.is_empty() {
                    let _ = self.transfers.update_detail(transfer_id, detail).await;
                }
            }
            match status.state.as_str() {
                "succeeded" => return Ok(status),
                "failed" | "canceled" | "cancelled" => {
                    let message = if status.message.is_empty() {
                        format!("Remote {} job {}", status.operation, status.state)
                    } else {
                        status.message
                    };
                    return Err(ApiError::Message(message));
                }
                _ => tokio::time::sleep(Duration::from_millis(150)).await,
            }
        }
    }

    pub(super) async fn cancel_remote_job(&self, job_id: &str) -> ApiResult<()> {
        let path = remote_job_path(job_id);
        #[cfg(test)]
        if let Some(log) = &self.remote_job_cancellation_log {
            log.lock().await.push(format!("DELETE {path}"));
            return Ok(());
        }
        let response = self.proxy.delete(&path).await?;
        if response.status().is_success() || response.status().as_u16() == 404 {
            Ok(())
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            Err(ApiError::Message(if body.is_empty() {
                format!(
                    "Failed to cancel remote job {job_id} (HTTP {})",
                    status.as_u16()
                )
            } else {
                body
            }))
        }
    }

    pub(super) async fn start_json_job(
        &self,
        path: &str,
        body: serde_json::Value,
        transfer_id: Option<u64>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<RemoteJobStatus> {
        ensure_not_canceled_if(cancellation)?;
        let response = self.proxy.post_json(path, &body).await?;
        let start: RemoteJobStart = response_json(response, "start remote operation").await?;
        if start.job_id.trim().is_empty() {
            return Err(ApiError::Message(
                "Remote operation did not return a job id".to_string(),
            ));
        }
        self.wait_for_job(&start.job_id, transfer_id, None, cancellation)
            .await
    }

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

    pub(super) fn remote_target(&self, path: &str) -> Option<RemoteBrowseTarget> {
        RemoteBrowseTarget::from_virtual_path(&self.mount_root, Path::new(path))
    }

    pub fn remote_target_for_path(&self, path: &str) -> Option<RemoteBrowseTarget> {
        self.remote_target(path)
    }

    pub(super) fn reject_virtual_mount_container(
        &self,
        path: &str,
        operation: &str,
    ) -> ApiResult<()> {
        let path = Path::new(path);
        if path == self.mount_root || path.starts_with(&self.mount_root) {
            return Err(ApiError::Message(format!(
                "Remote {operation} is not available in this migration build yet."
            )));
        }
        Ok(())
    }
}
