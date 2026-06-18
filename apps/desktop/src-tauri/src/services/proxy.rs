use std::sync::Arc;

use serde::{Deserialize, Serialize};
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
}
