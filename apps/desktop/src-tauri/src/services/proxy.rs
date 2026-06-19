use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::sync::RwLock;

use crate::error::{ApiError, ApiResult};
use crate::services::environment::AppEnvironmentService;

#[derive(Clone)]
pub struct ProxyService {
    inner: Arc<ProxyInner>,
}

struct ProxyInner {
    client: reqwest::Client,
    proxy_url: Option<String>,
    snapshot: RwLock<ProxySnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxySnapshot {
    pub proxy_url: Option<String>,
    pub ready: bool,
    pub status_code: Option<u16>,
    pub error: Option<String>,
}

impl ProxyService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        let proxy_url = environment.proxy_url();
        let snapshot = ProxySnapshot {
            proxy_url: proxy_url.clone(),
            ready: false,
            status_code: None,
            error: None,
        };
        Self {
            inner: Arc::new(ProxyInner {
                client: reqwest::Client::new(),
                proxy_url,
                snapshot: RwLock::new(snapshot),
            }),
        }
    }

    pub fn proxy_url(&self) -> Option<String> {
        self.inner.proxy_url.clone()
    }

    pub async fn snapshot(&self) -> ProxySnapshot {
        self.inner.snapshot.read().await.clone()
    }

    pub async fn probe_remote_health(&self) -> ApiResult<serde_json::Value> {
        let url = self.url("/api/remote/health")?;
        let response = self.inner.client.get(url).send().await?;
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

    pub fn url(&self, path: &str) -> ApiResult<String> {
        let base =
            self.inner.proxy_url.as_ref().ok_or_else(|| {
                ApiError::Unavailable("PROXY_SERVICE_URL not configured".to_string())
            })?;
        Ok(format!("{base}{path}"))
    }

    pub fn rclone_rc_url_from_health(&self, health: &serde_json::Value) -> String {
        let port = health
            .get("port")
            .and_then(|value| value.as_str())
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(5572);
        format!("http://127.0.0.1:{port}")
    }

    pub async fn get_with_query<Q>(&self, path: &str, query: &Q) -> ApiResult<reqwest::Response>
    where
        Q: Serialize + ?Sized,
    {
        let url = self.url(path)?;
        Ok(self.inner.client.get(url).query(query).send().await?)
    }

    pub async fn get(&self, path: &str) -> ApiResult<reqwest::Response> {
        let url = self.url(path)?;
        Ok(self.inner.client.get(url).send().await?)
    }

    pub async fn post_json(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> ApiResult<reqwest::Response> {
        let url = self.url(path)?;
        Ok(self.inner.client.post(url).json(body).send().await?)
    }

    pub async fn delete_with_query<Q>(&self, path: &str, query: &Q) -> ApiResult<reqwest::Response>
    where
        Q: Serialize + ?Sized,
    {
        let url = self.url(path)?;
        Ok(self.inner.client.delete(url).query(query).send().await?)
    }

    pub async fn upload_file(
        &self,
        remote: &str,
        remote_directory: &str,
        local_path: &Path,
        file_name: &str,
    ) -> ApiResult<reqwest::Response> {
        let url = self.url("/api/remote/file/upload")?;
        let file = reqwest::multipart::Part::file(local_path)
            .await
            .map_err(|error| {
                ApiError::Message(format!("Failed to open {}: {error}", local_path.display()))
            })?
            .file_name(file_name.to_string());
        let form = reqwest::multipart::Form::new()
            .text("remote", remote.to_string())
            .text("path", remote_directory.to_string())
            .part("file", file);
        Ok(self.inner.client.post(url).multipart(form).send().await?)
    }

    pub async fn download_to_file(&self, path: &str, destination: &Path) -> ApiResult<()> {
        let mut response = self.get(path).await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(ApiError::Message(if body.is_empty() {
                format!("Remote download failed (HTTP {})", status.as_u16())
            } else {
                body
            }));
        }
        if let Some(parent) = destination.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|error| {
                ApiError::Message(format!("Failed to create {}: {error}", parent.display()))
            })?;
        }
        let mut output = tokio::fs::File::create(destination)
            .await
            .map_err(|error| {
                ApiError::Message(format!(
                    "Failed to create {}: {error}",
                    destination.display()
                ))
            })?;
        while let Some(chunk) = response.chunk().await? {
            output.write_all(&chunk).await.map_err(|error| {
                ApiError::Message(format!(
                    "Failed to write {}: {error}",
                    destination.display()
                ))
            })?;
        }
        output.flush().await.map_err(|error| {
            ApiError::Message(format!(
                "Failed to flush {}: {error}",
                destination.display()
            ))
        })?;
        Ok(())
    }
}
