use super::*;

impl ExplorerService {
    pub(super) async fn download_remote_file(
        &self,
        source: &RemoteBrowseTarget,
        destination: &Path,
        transfer_id: Option<u64>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        ensure_not_canceled_if(cancellation)?;
        let mut direct_download_error = None;
        match self
            .proxy
            .start_download_to_file_with_cancellation(
                &source.remote_name,
                &source.remote_path,
                destination,
                cancellation,
            )
            .await
        {
            Ok(Some(response)) => {
                let direct_result = async {
                    let start: RemoteJobStart =
                        response_json(response, "start embedded remote download").await?;
                    self.wait_for_job(&start.job_id, transfer_id, None, cancellation)
                        .await?;
                    ensure_not_canceled_if(cancellation)?;
                    if downloaded_file_exists(destination).await {
                        return Ok(());
                    }
                    Err(ApiError::Message(format!(
                        "Embedded direct download completed but did not create {}",
                        destination.display()
                    )))
                }
                .await;
                match direct_result {
                    Ok(()) => return Ok(()),
                    Err(error) => direct_download_error = Some(error.to_string()),
                }
            }
            Ok(None) => {}
            Err(error) => direct_download_error = Some(error.to_string()),
        }
        let response = self
            .proxy
            .get_with_query(
                "/api/remote/file/download",
                &[
                    ("remote", source.remote_name.as_str()),
                    ("path", source.remote_path.as_str()),
                ],
            )
            .await?;
        let start: RemoteJobStart = response_json(response, "start remote download").await?;
        self.wait_for_job(&start.job_id, transfer_id, None, cancellation)
            .await?;
        ensure_not_canceled_if(cancellation)?;
        self.proxy
            .download_to_file_with_cancellation(
                &format!("/api/remote/file/jobs/{}/result/download", start.job_id),
                destination,
                cancellation,
            )
            .await?;
        ensure_not_canceled_if(cancellation)?;
        if downloaded_file_exists(destination).await {
            return Ok(());
        }
        let detail = direct_download_error
            .map(|error| format!(" Direct download also failed: {error}"))
            .unwrap_or_default();
        Err(ApiError::Message(format!(
            "Remote download completed but did not create {}.{detail}",
            destination.display()
        )))
    }

    pub(super) async fn download_remote_directory(
        &self,
        source: &RemoteBrowseTarget,
        destination: &Path,
        transfer_id: Option<u64>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        ensure_not_canceled_if(cancellation)?;
        match self
            .proxy
            .start_download_directory_to_path_with_cancellation(
                &source.remote_name,
                &source.remote_path,
                destination,
                cancellation,
            )
            .await?
        {
            Some(response) => {
                let start: RemoteJobStart =
                    response_json(response, "start embedded remote directory download").await?;
                self.wait_for_job(&start.job_id, transfer_id, None, cancellation)
                    .await?;
                ensure_not_canceled_if(cancellation)?;
                if downloaded_directory_exists(destination).await {
                    Ok(())
                } else {
                    Err(ApiError::Message(format!(
                        "Embedded direct download completed but did not create {}",
                        destination.display()
                    )))
                }
            }
            None => Err(ApiError::Message(
                "Embedded direct directory download is unavailable.".to_string(),
            )),
        }
    }

    pub(super) async fn fetch_remote_items(
        &self,
        target: &RemoteBrowseTarget,
    ) -> ApiResult<Vec<RemoteListItem>> {
        let response = self
            .proxy
            .get_with_query(
                "/api/remote/file/list",
                &[
                    ("remote", target.remote_name.as_str()),
                    ("path", target.remote_path.as_str()),
                ],
            )
            .await?;
        let start: RemoteJobStart = response_json(response, "start remote list").await?;
        self.wait_for_job(&start.job_id, None, None, None).await?;
        let response = self
            .proxy
            .get(&format!(
                "/api/remote/file/jobs/{}/result/list",
                start.job_id
            ))
            .await?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(ApiError::Message(if body.is_empty() {
                format!(
                    "Failed to load remote list result (HTTP {})",
                    status.as_u16()
                )
            } else {
                body
            }));
        }
        let items = serde_json::from_str::<Vec<RemoteListItem>>(&body).map_err(|error| {
            ApiError::Message(format!("Failed to parse remote list result: {error}"))
        })?;
        let items = dedupe_remote_list_items(target, items)?;
        let cache_body = serde_json::to_vec(&items).map_err(|error| {
            ApiError::Message(format!("Failed to encode remote list cache: {error}"))
        })?;
        self.listing_cache
            .save(&target.remote_name, &target.remote_path, &cache_body)
            .await?;
        Ok(items)
    }

    pub(super) async fn delete_remote_target(
        &self,
        target: &RemoteBrowseTarget,
        transfer_id: Option<u64>,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        ensure_not_canceled_if(cancellation)?;
        let response = self
            .proxy
            .delete_with_query(
                "/api/remote/file",
                &[
                    ("remote", target.remote_name.as_str()),
                    ("path", target.remote_path.as_str()),
                ],
            )
            .await?;
        let start: RemoteJobStart = response_json(response, "start remote delete").await?;
        self.wait_for_job(&start.job_id, transfer_id, None, cancellation)
            .await?;
        self.listing_cache
            .clear(&target.remote_name, &target.remote_path)
            .await?;
        self.listing_cache
            .clear(
                &target.remote_name,
                &remote_parent_path(&target.remote_path),
            )
            .await?;
        Ok(())
    }
}
