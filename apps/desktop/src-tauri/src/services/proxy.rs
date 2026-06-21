use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use reqwest::{Method, RequestBuilder, Response, StatusCode};
use rusqlite::{Connection, OptionalExtension};
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
    database_path: std::path::PathBuf,
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
        let database_path = environment.proxy_token_db_path();
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
                database_path,
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
        self.send_authenticated(Method::GET, &url, |request| request.query(query))
            .await
    }

    pub async fn get(&self, path: &str) -> ApiResult<reqwest::Response> {
        let url = self.url(path)?;
        self.send_authenticated(Method::GET, &url, |request| request)
            .await
    }

    pub async fn post_json(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> ApiResult<reqwest::Response> {
        let url = self.url(path)?;
        self.send_authenticated(Method::POST, &url, |request| request.json(body))
            .await
    }

    pub async fn delete_with_query<Q>(&self, path: &str, query: &Q) -> ApiResult<reqwest::Response>
    where
        Q: Serialize + ?Sized,
    {
        let url = self.url(path)?;
        self.send_authenticated(Method::DELETE, &url, |request| request.query(query))
            .await
    }

    pub async fn delete(&self, path: &str) -> ApiResult<reqwest::Response> {
        let url = self.url(path)?;
        self.send_authenticated(Method::DELETE, &url, |request| request)
            .await
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
        let request = self
            .with_current_auth(self.inner.client.post(url).multipart(form))
            .await;
        Ok(request.send().await?)
    }

    async fn send_authenticated<F>(
        &self,
        method: Method,
        url: &str,
        configure: F,
    ) -> ApiResult<Response>
    where
        F: Fn(RequestBuilder) -> RequestBuilder,
    {
        let send = |token: Option<&str>| {
            let mut request = self.inner.client.request(method.clone(), url);
            if let Some(token) = token {
                request = request.bearer_auth(token);
            }
            configure(request)
        };

        let token = self.current_or_refresh_access_token().await;
        let response = send(token.as_deref()).send().await?;
        if response.status() != StatusCode::UNAUTHORIZED || !self.refresh_access_token().await {
            return Ok(response);
        }
        let token = self.current_access_token().await;
        Ok(send(token.as_deref()).send().await?)
    }

    async fn with_current_auth(&self, request: RequestBuilder) -> RequestBuilder {
        match self.current_or_refresh_access_token().await {
            Some(token) => request.bearer_auth(token),
            None => request,
        }
    }

    async fn current_or_refresh_access_token(&self) -> Option<String> {
        if let Some(token) = self.current_access_token().await {
            return Some(token);
        }
        if self.refresh_access_token().await {
            return self.current_access_token().await;
        }
        None
    }

    async fn current_access_token(&self) -> Option<String> {
        let database_path = self.inner.database_path.clone();
        tokio::task::spawn_blocking(move || read_current_access_token(&database_path))
            .await
            .ok()
            .flatten()
    }

    async fn refresh_access_token(&self) -> bool {
        let Ok(url) = self.url("/api/session/refresh") else {
            return false;
        };
        self.inner
            .client
            .post(url)
            .send()
            .await
            .is_ok_and(|response| response.status().is_success())
    }

    pub async fn download_to_file_with_cancellation(
        &self,
        path: &str,
        destination: &Path,
        cancellation: Option<&AtomicBool>,
    ) -> ApiResult<()> {
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
            if cancellation.is_some_and(|token| token.load(Ordering::SeqCst)) {
                return Err(ApiError::Message("Operation canceled.".to_string()));
            }
            output.write_all(&chunk).await.map_err(|error| {
                ApiError::Message(format!(
                    "Failed to write {}: {error}",
                    destination.display()
                ))
            })?;
        }
        if cancellation.is_some_and(|token| token.load(Ordering::SeqCst)) {
            return Err(ApiError::Message("Operation canceled.".to_string()));
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

fn read_current_access_token(database_path: &Path) -> Option<String> {
    if !database_path.exists() {
        return None;
    }
    let connection =
        Connection::open_with_flags(database_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .ok()?;
    connection
        .query_row(
            r#"
                SELECT token
                FROM access_tokens
                WHERE revoked = 0
                  AND datetime(expires_at) > datetime('now')
                ORDER BY datetime(created_at) DESC
                LIMIT 1
            "#,
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
        .filter(|token| !token.is_empty())
}

#[cfg(test)]
mod tests {
    use super::read_current_access_token;
    use rusqlite::Connection;

    #[test]
    fn reads_latest_unexpired_proxy_access_token() {
        let path = std::env::temp_dir().join(format!(
            "misty-proxy-token-{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                r#"
                    CREATE TABLE access_tokens (
                        id TEXT PRIMARY KEY,
                        token TEXT NOT NULL,
                        expires_at TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        revoked INTEGER NOT NULL DEFAULT 0
                    );
                    INSERT INTO access_tokens VALUES
                        ('expired', 'old', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z', 0),
                        ('revoked', 'bad', '2999-01-01T00:00:00Z', '2024-01-01T00:00:00Z', 1),
                        ('current', 'good', '2999-01-01T00:00:00Z', '2025-01-01T00:00:00Z', 0);
                "#,
            )
            .unwrap();
        drop(connection);

        assert_eq!(read_current_access_token(&path).as_deref(), Some("good"));
        let _ = std::fs::remove_file(path);
    }
}
