use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::RwLock;

use crate::error::{ApiError, ApiResult};
use crate::services::{environment::AppEnvironmentService, storage_runtime::StorageRuntimeService};

#[derive(Clone)]
pub struct StorageService {
    inner: Arc<StorageInner>,
}

struct StorageInner {
    storage_runtime: Option<StorageRuntimeService>,
    snapshot: RwLock<StorageSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSnapshot {
    pub ready: bool,
    pub status_code: Option<u16>,
    pub error: Option<String>,
}

pub struct StorageResponse {
    status: StatusCode,
    body: Vec<u8>,
}

impl StorageResponse {
    fn ok_json(value: Value) -> ApiResult<Self> {
        Self::from_json(StatusCode::OK, value)
    }

    fn from_json(status: StatusCode, value: Value) -> ApiResult<Self> {
        let body = serde_json::to_vec(&value)?;
        Ok(Self { status, body })
    }

    fn bytes(status: StatusCode, body: Vec<u8>) -> Self {
        Self { status, body }
    }

    pub fn status(&self) -> StatusCode {
        self.status
    }

    pub async fn text(self) -> ApiResult<String> {
        String::from_utf8(self.body).map_err(|error| {
            ApiError::Message(format!("Storage response was not valid UTF-8: {error}"))
        })
    }

    pub async fn json<T: serde::de::DeserializeOwned>(self) -> ApiResult<T> {
        Ok(serde_json::from_slice::<T>(&self.body)?)
    }
}

impl StorageService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        Self::new_with_storage_runtime(environment, None)
    }

    pub fn new_with_storage_runtime(
        environment: AppEnvironmentService,
        storage_runtime: Option<StorageRuntimeService>,
    ) -> Self {
        let _ = environment;
        let snapshot = StorageSnapshot {
            ready: false,
            status_code: None,
            error: None,
        };
        Self {
            inner: Arc::new(StorageInner {
                storage_runtime,
                snapshot: RwLock::new(snapshot),
            }),
        }
    }

    pub async fn snapshot(&self) -> StorageSnapshot {
        self.inner.snapshot.read().await.clone()
    }

    pub async fn probe_remote_health(&self) -> ApiResult<serde_json::Value> {
        let response = self.get("/api/remote/health").await?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let parsed = serde_json::from_str::<serde_json::Value>(&body).unwrap_or_else(|_| {
            serde_json::json!({
                "ready": status.is_success(),
                "error": body,
            })
        });
        {
            let mut snapshot = self.inner.snapshot.write().await;
            snapshot.ready = status.is_success()
                && parsed
                    .get("ready")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
            snapshot.status_code = Some(status.as_u16());
            snapshot.error = parsed
                .get("error")
                .and_then(|v| v.as_str())
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned);
        }
        Ok(parsed)
    }

    pub async fn get_with_query<Q>(&self, path: &str, query: &Q) -> ApiResult<StorageResponse>
    where
        Q: Serialize + ?Sized,
    {
        self.embedded_get_with_query(path, query).await
    }

    pub async fn get(&self, path: &str) -> ApiResult<StorageResponse> {
        self.embedded_get(path).await
    }

    pub async fn post_json(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> ApiResult<StorageResponse> {
        self.embedded_post_json(path, body).await
    }

    pub async fn delete_with_query<Q>(&self, path: &str, query: &Q) -> ApiResult<StorageResponse>
    where
        Q: Serialize + ?Sized,
    {
        self.embedded_delete_with_query(path, query).await
    }

    pub async fn delete(&self, path: &str) -> ApiResult<StorageResponse> {
        self.embedded_delete(path).await
    }

    async fn invoke_embedded(&self, method: &str, params: Value) -> ApiResult<StorageResponse> {
        let runtime = self.inner.storage_runtime.as_ref().ok_or_else(|| {
            ApiError::Unavailable("Storage service is not configured.".to_string())
        })?;
        let data = runtime.invoke(method, params).map_err(ApiError::Message)?;
        StorageResponse::ok_json(data)
    }

    async fn embedded_get(&self, path: &str) -> ApiResult<StorageResponse> {
        match path {
            "/api/remote/health" => {
                self.invoke_embedded("remote.health", serde_json::json!({}))
                    .await
            }
            "/api/remote/types" => {
                self.invoke_embedded("remote.types", serde_json::json!({}))
                    .await
            }
            "/api/remote/workflows" => {
                self.invoke_embedded("remote.workflows", serde_json::json!({}))
                    .await
            }
            "/api/remote" | "/api/remotes" => {
                self.invoke_embedded("remote.list", serde_json::json!({}))
                    .await
            }
            "/api/remote/status" | "/api/remotes/status" => {
                self.invoke_embedded("remote.status", serde_json::json!({}))
                    .await
            }
            "/api/remote/storage" | "/api/remotes/storage" => {
                self.invoke_embedded("remote.storage", serde_json::json!({}))
                    .await
            }
            "/api/remote/storage/debug" | "/api/remotes/storage/debug" => {
                self.invoke_embedded("remote.storage.debug", serde_json::json!({}))
                    .await
            }
            _ if path.starts_with("/api/remote/file/jobs/") => {
                self.embedded_remote_job_get(path).await
            }
            "/api/clipboard/devices" => {
                self.invoke_embedded("clipboard.devices", serde_json::json!({}))
                    .await
            }
            "/api/clipboard/latest" => {
                self.invoke_embedded("clipboard.latest", serde_json::json!({}))
                    .await
            }
            _ => Err(ApiError::Unavailable(format!(
                "Native storage service does not support GET {path}"
            ))),
        }
    }

    async fn embedded_get_with_query<Q>(&self, path: &str, query: &Q) -> ApiResult<StorageResponse>
    where
        Q: Serialize + ?Sized,
    {
        let params = query_params_value(query)?;
        match path {
            "/api/remote/workflow" | "/api/remotes/workflow" => {
                self.invoke_embedded("remote.workflow", params).await
            }
            "/api/remote/file/list" | "/api/remotes/file/list" => {
                self.invoke_embedded("remote.file.list", params).await
            }
            "/api/remote/file/size" | "/api/remotes/file/size" => {
                self.invoke_embedded("remote.file.size", params).await
            }
            "/api/remote/file/download" | "/api/remotes/file/download" => {
                self.invoke_embedded("remote.file.download", params).await
            }
            "/api/file-sync/entry" => self.invoke_embedded("file_sync.entry", params).await,
            "/api/file-sync/local" => self.invoke_embedded("file_sync.local", params).await,
            "/api/file-sync/remote" => self.invoke_embedded("file_sync.remote", params).await,
            "/api/file-sync/sync" => self.invoke_embedded("file_sync.sync", params).await,
            "/api/file-sync/local/id" => self.invoke_embedded("file_sync.local_id", params).await,
            "/api/file-sync/remote/id" => self.invoke_embedded("file_sync.remote_id", params).await,
            "/api/file-sync/provider/id" => {
                self.invoke_embedded("file_sync.provider_id", params).await
            }
            "/api/file-sync/remote/scan" => {
                self.invoke_embedded("file_sync.remote.scan", params).await
            }
            _ => Err(ApiError::Unavailable(format!(
                "Native storage service does not support GET {path} with query"
            ))),
        }
    }

    async fn embedded_post_json(&self, path: &str, body: &Value) -> ApiResult<StorageResponse> {
        let method = match path {
            "/api/remote/config/start" | "/api/remotes/config/start" => "remote.config.start",
            "/api/remote/config/continue" | "/api/remotes/config/continue" => {
                "remote.config.continue"
            }
            "/api/remote/config/repair" | "/api/remotes/config/repair" => "remote.config.repair",
            "/api/remote/config/get" | "/api/remotes/config/get" => "remote.config.get",
            "/api/remote/config/update" | "/api/remotes/config/update" => "remote.config.update",
            "/api/remote/config/paths" | "/api/remotes/config/paths" => "remote.config.paths",
            "/api/remote/config/security" | "/api/remotes/config/security" => {
                "remote.config.security"
            }
            "/api/remote/config/harden" | "/api/remotes/config/harden" => "remote.config.harden",
            "/api/remote/about" | "/api/remotes/about" => "remote.about",
            "/api/remote/rename" | "/api/remotes/rename" => "remote.rename",
            "/api/remote/verify/start" | "/api/remotes/verify/start" => "remote.verify.start",
            "/api/remote/verify/result" | "/api/remotes/verify/result" => "remote.verify.result",
            "/api/remote/backend/actions" | "/api/remotes/backend/actions" => {
                "remote.backend.actions"
            }
            "/api/remote/backend/run" | "/api/remotes/backend/run" => "remote.backend.run",
            "/api/remote/file/mkdir" | "/api/remotes/file/mkdir" => "remote.file.mkdir",
            "/api/remote/file/create" | "/api/remotes/file/create" => "remote.file.create",
            "/api/remote/file/rename" | "/api/remotes/file/rename" => "remote.file.rename",
            "/api/remote/file/copy" | "/api/remotes/file/copy" => "remote.file.copy",
            "/api/remote/file/move" | "/api/remotes/file/move" => "remote.file.move",
            "/api/file-sync/local" => "file_sync.upsert_local",
            "/api/file-sync/remote" => "file_sync.upsert_remote",
            "/api/file-sync/sync" => "file_sync.upsert_sync",
            "/api/file-sync/record" => "file_sync.record",
            "/api/file-sync/reset" => "file_sync.reset",
            "/api/file-sync/states/resolve" => "file_sync.states.resolve",
            "/api/clipboard/register" => "clipboard.register",
            "/api/clipboard/publish" => "clipboard.publish",
            _ => {
                return Err(ApiError::Unavailable(format!(
                    "Native storage service does not support POST {path}"
                )))
            }
        };
        self.invoke_embedded(method, body.clone()).await
    }

    async fn embedded_delete_with_query<Q>(
        &self,
        path: &str,
        query: &Q,
    ) -> ApiResult<StorageResponse>
    where
        Q: Serialize + ?Sized,
    {
        let params = query_params_value(query)?;
        match path {
            "/api/remote" | "/api/remotes" => self.invoke_embedded("remote.delete", params).await,
            "/api/remote/file" | "/api/remotes/file" => {
                self.invoke_embedded("remote.file.delete", params).await
            }
            _ => Err(ApiError::Unavailable(format!(
                "Native storage service does not support DELETE {path} with query"
            ))),
        }
    }

    async fn embedded_delete(&self, path: &str) -> ApiResult<StorageResponse> {
        if let Some(job_id) = remote_job_id(path) {
            return self
                .invoke_embedded(
                    "remote.file.job.cancel",
                    serde_json::json!({ "job_id": job_id }),
                )
                .await;
        }
        Err(ApiError::Unavailable(format!(
            "Native storage service does not support DELETE {path}"
        )))
    }

    async fn embedded_remote_job_get(&self, path: &str) -> ApiResult<StorageResponse> {
        let Some(job_id) = remote_job_id(path) else {
            return Err(ApiError::Message("Remote job id is required.".to_string()));
        };
        if path.ends_with("/result/list") {
            return self
                .invoke_embedded(
                    "remote.file.result.list",
                    serde_json::json!({ "job_id": job_id }),
                )
                .await;
        }
        if path.ends_with("/result/download") {
            return self
                .invoke_embedded(
                    "remote.file.result.download_path",
                    serde_json::json!({ "job_id": job_id }),
                )
                .await;
        }
        self.invoke_embedded("remote.file.job", serde_json::json!({ "job_id": job_id }))
            .await
    }

    pub async fn upload_file_with_cancellation(
        &self,
        remote: &str,
        remote_directory: &str,
        local_path: &Path,
        file_name: &str,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<StorageResponse> {
        ensure_not_canceled_if(cancellation)?;
        self.invoke_embedded(
            "remote.file.upload_from_path",
            serde_json::json!({
                "remote": remote,
                "path": remote_directory,
                "source_path": local_path.display().to_string(),
                "file_name": file_name,
            }),
        )
        .await
    }

    pub async fn upload_directory_with_cancellation(
        &self,
        remote: &str,
        remote_directory: &str,
        local_path: &Path,
        directory_name: &str,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<StorageResponse> {
        ensure_not_canceled_if(cancellation)?;
        self.invoke_embedded(
            "remote.file.upload_directory_from_path",
            serde_json::json!({
                "remote": remote,
                "path": remote_directory,
                "source_path": local_path.display().to_string(),
                "directory_name": directory_name,
            }),
        )
        .await
    }

    pub async fn start_download_to_file_with_cancellation(
        &self,
        remote: &str,
        remote_path: &str,
        destination: &Path,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<Option<StorageResponse>> {
        ensure_not_canceled_if(cancellation)?;
        let response = self
            .invoke_embedded(
                "remote.file.download_to_path",
                serde_json::json!({
                    "remote": remote,
                    "path": remote_path,
                    "destination_path": destination.display().to_string(),
                }),
            )
            .await?;
        Ok(Some(response))
    }

    pub async fn start_download_directory_to_path_with_cancellation(
        &self,
        remote: &str,
        remote_path: &str,
        destination: &Path,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<Option<StorageResponse>> {
        self.start_download_to_file_with_cancellation(
            remote,
            remote_path,
            destination,
            cancellation,
        )
        .await
    }

    pub async fn download_to_file_with_cancellation(
        &self,
        path: &str,
        destination: &Path,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
        ensure_not_canceled_if(cancellation)?;
        let response = self.embedded_get(path).await?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(ApiError::Message(if body.is_empty() {
                format!("Remote download failed (native {})", status.as_u16())
            } else {
                body
            }));
        }
        let value = serde_json::from_str::<Value>(&body)?;
        let source_path = value.get("path").and_then(Value::as_str).ok_or_else(|| {
            ApiError::Message("Embedded download result did not include a path.".to_string())
        })?;
        if let Some(parent) = destination.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|error| {
                ApiError::Message(format!("Failed to create {}: {error}", parent.display()))
            })?;
        }
        tokio::fs::copy(source_path, destination)
            .await
            .map_err(|error| {
                ApiError::Message(format!(
                    "Failed to copy native download result to {}: {error}",
                    destination.display()
                ))
            })?;
        ensure_not_canceled_if(cancellation)?;
        Ok(())
    }
}

fn query_params_value<Q>(query: &Q) -> ApiResult<Value>
where
    Q: Serialize + ?Sized,
{
    let value = serde_json::to_value(query)?;
    match value {
        Value::Array(entries) => {
            let mut object = serde_json::Map::new();
            for entry in entries {
                match entry {
                    Value::Array(pair) if pair.len() == 2 => {
                        let key = value_to_query_string(&pair[0]);
                        let value = value_to_query_string(&pair[1]);
                        object.insert(key, Value::String(value));
                    }
                    Value::Object(mut pair) => {
                        let key = pair
                            .remove("0")
                            .or_else(|| pair.remove("key"))
                            .map(|value| value_to_query_string(&value));
                        let value = pair
                            .remove("1")
                            .or_else(|| pair.remove("value"))
                            .map(|value| value_to_query_string(&value));
                        if let (Some(key), Some(value)) = (key, value) {
                            object.insert(key, Value::String(value));
                        }
                    }
                    _ => {}
                }
            }
            Ok(Value::Object(object))
        }
        Value::Object(_) => Ok(value),
        _ => Ok(serde_json::json!({})),
    }
}

fn value_to_query_string(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn remote_job_id(path: &str) -> Option<&str> {
    let marker = "/api/remote/file/jobs/";
    let rest = path.strip_prefix(marker)?;
    let id = rest.split('/').next().unwrap_or_default();
    (!id.is_empty()).then_some(id)
}

fn ensure_not_canceled(cancellation: &AtomicBool) -> ApiResult<()> {
    if cancellation.load(Ordering::SeqCst) {
        return Err(ApiError::Message("Operation canceled.".to_string()));
    }
    Ok(())
}

fn ensure_not_canceled_if(cancellation: Option<&AtomicBool>) -> ApiResult<()> {
    if let Some(cancellation) = cancellation {
        ensure_not_canceled(cancellation)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::StorageService;
    use crate::error::ApiError;
    use crate::services::environment::AppEnvironmentService;
    use std::{
        path::Path,
        sync::atomic::{AtomicBool, Ordering},
    };

    #[tokio::test]
    async fn pre_canceled_upload_returns_canceled_before_runtime_lookup() {
        let storage = StorageService::new(AppEnvironmentService::new());
        let cancellation = AtomicBool::new(true);

        let result = storage
            .upload_file_with_cancellation(
                "drive",
                "/",
                Path::new("/definitely/missing/misty-upload.bin"),
                "misty-upload.bin",
                Some(&cancellation),
            )
            .await;

        assert!(matches!(
            result,
            Err(ApiError::Message(message)) if message.eq_ignore_ascii_case("Operation canceled.")
        ));
        assert!(cancellation.load(Ordering::SeqCst));
    }
}
