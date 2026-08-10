use super::*;

impl ExplorerService {
    pub(super) async fn upload_local_item(
        &self,
        source: &Path,
        is_directory: bool,
        destination: &RemoteBrowseTarget,
        source_name: &str,
        transfer_id: Option<u64>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        ensure_not_canceled_if(cancellation)?;
        let metadata = tokio::fs::symlink_metadata(source).await.map_err(|error| {
            ApiError::Message(format!("Failed to inspect {}: {error}", source.display()))
        })?;
        if is_directory != metadata.is_dir() {
            return Err(ApiError::Message(format!(
                "Source type changed before paste: {}",
                source.display()
            )));
        }
        if ignored_upload_name(source_name) {
            if let Some(transfer_id) = transfer_id {
                let _ = self
                    .transfers
                    .update_detail(
                        transfer_id,
                        format!("Skipped provider-disallowed metadata item {source_name}"),
                    )
                    .await;
            }
            return Ok(());
        }

        if !is_directory {
            return self
                .upload_remote_file(
                    source,
                    &destination.remote_name,
                    &destination.remote_path,
                    source_name,
                    transfer_id,
                    Some(TransferProgress {
                        base_bytes: 0,
                        total_bytes: metadata.len().min(i64::MAX as u64) as i64,
                    }),
                    cancellation,
                )
                .await;
        }

        let total_bytes = local_item_size(source, true).await;
        self.upload_remote_directory(
            source,
            &destination.remote_name,
            &destination.remote_path,
            source_name,
            transfer_id,
            Some(TransferProgress {
                base_bytes: 0,
                total_bytes,
            }),
            cancellation,
        )
        .await
    }

    pub(super) async fn upload_remote_file(
        &self,
        local_path: &Path,
        remote_name: &str,
        remote_directory: &str,
        file_name: &str,
        transfer_id: Option<u64>,
        progress: Option<TransferProgress>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        ensure_not_canceled_if(cancellation)?;
        if ignored_upload_name(file_name) {
            if let Some(transfer_id) = transfer_id {
                let _ = self
                    .transfers
                    .update_detail(
                        transfer_id,
                        format!("Skipped provider-disallowed metadata item {file_name}"),
                    )
                    .await;
            }
            return Ok(());
        }
        let response = self
            .proxy
            .upload_file_with_cancellation(
                remote_name,
                remote_directory,
                local_path,
                file_name,
                cancellation,
            )
            .await?;
        let start: RemoteJobStart = response_json(response, "start remote upload").await?;
        self.wait_for_job(&start.job_id, transfer_id, progress, cancellation)
            .await?;
        Ok(())
    }

    pub(super) async fn upload_remote_directory(
        &self,
        local_path: &Path,
        remote_name: &str,
        remote_directory: &str,
        directory_name: &str,
        transfer_id: Option<u64>,
        progress: Option<TransferProgress>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        ensure_not_canceled_if(cancellation)?;
        if ignored_upload_name(directory_name) {
            if let Some(transfer_id) = transfer_id {
                let _ = self
                    .transfers
                    .update_detail(
                        transfer_id,
                        format!("Skipped provider-disallowed metadata item {directory_name}"),
                    )
                    .await;
            }
            return Ok(());
        }
        let response = self
            .proxy
            .upload_directory_with_cancellation(
                remote_name,
                remote_directory,
                local_path,
                directory_name,
                cancellation,
            )
            .await?;
        let start: RemoteJobStart =
            response_json(response, "start remote directory upload").await?;
        self.wait_for_job(&start.job_id, transfer_id, progress, cancellation)
            .await?;
        Ok(())
    }

    pub(super) async fn create_remote_directory(
        &self,
        remote_name: &str,
        remote_path: &str,
        transfer_id: Option<u64>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        self.start_json_job(
            "/api/remote/file/mkdir",
            serde_json::json!({ "remote": remote_name, "path": remote_path }),
            transfer_id,
            cancellation,
        )
        .await?;
        Ok(())
    }

    pub(super) async fn download_remote_item(
        &self,
        source: &RemoteBrowseTarget,
        is_directory: bool,
        destination: &Path,
        transfer_id: Option<u64>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        ensure_not_canceled_if(cancellation)?;
        if !is_directory {
            return self
                .download_remote_file(source, destination, transfer_id, cancellation)
                .await;
        }

        self.download_remote_directory(source, destination, transfer_id, cancellation)
            .await
    }
}
