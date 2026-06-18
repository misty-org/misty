use std::{
    collections::BTreeMap,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::error::{ApiError, ApiResult};

use super::proxy::ProxyService;

#[derive(Clone)]
pub struct ProviderService {
    inner: Arc<ProviderInner>,
}

struct ProviderInner {
    client: reqwest::Client,
    proxy: ProxyService,
    snapshot: RwLock<ProvidersSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHealth {
    pub ready: bool,
    pub port: Option<String>,
    pub version: Option<String>,
    pub uptime_seconds: i64,
    pub connected_providers: usize,
    pub available_providers: usize,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRemote {
    pub name: String,
    #[serde(rename = "type")]
    pub provider_type: String,
    pub status_label: String,
    pub needs_reconnect: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderWorkflowChoice {
    pub value: String,
    pub help: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderWorkflowOption {
    pub name: String,
    pub label: String,
    pub help: String,
    pub default_value: String,
    pub required: bool,
    pub password: bool,
    pub choices: Vec<ProviderWorkflowChoice>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderWorkflow {
    #[serde(rename = "type")]
    pub provider_type: String,
    pub name: String,
    pub description: String,
    pub options: Vec<ProviderWorkflowOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvidersSnapshot {
    pub health: ProviderHealth,
    pub remotes: Vec<ProviderRemote>,
    pub workflows: Vec<ProviderWorkflow>,
    pub loading: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEditDraft {
    pub name: String,
    pub original_name: String,
    pub provider_type: String,
    pub config: BTreeMap<String, String>,
    pub about_json: Option<String>,
    pub last_checked_unix: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRemoteRequest {
    pub original_name: String,
    pub name: String,
    pub parameters: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteTestResult {
    pub success: bool,
    pub message: String,
    pub about_json: Option<String>,
    pub checked_unix: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RcloneConfigPaths {
    pub config_path: Option<String>,
    pub cache_path: Option<String>,
    pub temp_path: Option<String>,
    pub raw_json: String,
}

#[derive(Debug, Deserialize)]
struct RawRemote {
    name: String,
    #[serde(default, rename = "type")]
    provider_type: String,
}

#[derive(Debug, Deserialize)]
struct RawRemoteStatus {
    name: String,
    #[serde(default, rename = "type")]
    provider_type: String,
    #[serde(default)]
    status_label: Option<String>,
    #[serde(default)]
    needs_reconnect: bool,
    #[serde(default)]
    error: Option<String>,
}

impl ProviderService {
    pub fn new(proxy: ProxyService) -> Self {
        Self {
            inner: Arc::new(ProviderInner {
                client: reqwest::Client::new(),
                proxy,
                snapshot: RwLock::new(ProvidersSnapshot::empty()),
            }),
        }
    }

    pub async fn snapshot(&self) -> ApiResult<ProvidersSnapshot> {
        Ok(self.inner.snapshot.read().await.clone())
    }

    pub async fn refresh(&self) -> ApiResult<ProvidersSnapshot> {
        {
            let mut snapshot = self.inner.snapshot.write().await;
            snapshot.loading = true;
            snapshot.error = None;
        }

        let result = self.refresh_inner().await;
        let mut snapshot = self.inner.snapshot.write().await;
        snapshot.loading = false;
        match result {
            Ok(next) => {
                *snapshot = next;
                Ok(snapshot.clone())
            }
            Err(err) => {
                snapshot.error = Some(err.to_string());
                Err(err)
            }
        }
    }

    pub async fn select_remote(&self, name: String) -> ApiResult<RemoteEditDraft> {
        let snapshot = self.inner.snapshot.read().await.clone();
        let remote = snapshot
            .remotes
            .iter()
            .find(|remote| remote.name == name)
            .cloned()
            .ok_or_else(|| ApiError::Message(format!("Remote \"{name}\" was not found")))?;
        let rclone_rc_url = self.rclone_rc_url().await?;

        let config_response = self
            .inner
            .client
            .post(format!("{rclone_rc_url}/config/get"))
            .json(&serde_json::json!({ "name": name }))
            .send()
            .await?;
        let config_status = config_response.status();
        let config_body = config_response.text().await.unwrap_or_default();
        if !config_status.is_success() {
            return Err(ApiError::Message(if config_body.is_empty() {
                format!("Failed to load remote config ({})", config_status.as_u16())
            } else {
                config_body
            }));
        }
        let mut config = parse_config_map(&config_body)?;
        config
            .entry("type".to_string())
            .or_insert_with(|| remote.provider_type.clone());

        let about_response = self
            .inner
            .client
            .post(format!("{rclone_rc_url}/operations/about"))
            .json(&serde_json::json!({ "fs": format!("{}:", remote.name) }))
            .send()
            .await;
        let about_json = match about_response {
            Ok(response) if response.status().is_success() => response.text().await.ok(),
            _ => None,
        };

        Ok(RemoteEditDraft {
            name: remote.name.clone(),
            original_name: remote.name,
            provider_type: remote.provider_type,
            config,
            about_json,
            last_checked_unix: now_unix(),
        })
    }

    pub async fn save_remote(&self, request: SaveRemoteRequest) -> ApiResult<RemoteEditDraft> {
        validate_remote_name(&request)?;
        {
            let snapshot = self.inner.snapshot.read().await;
            if request.original_name != request.name
                && snapshot
                    .remotes
                    .iter()
                    .any(|remote| remote.name == request.name)
            {
                return Err(ApiError::Message(
                    "A remote with that name already exists.".to_string(),
                ));
            }
        }
        if request.original_name != request.name {
            let rename_url = self.inner.proxy.url("/api/remote/rename")?;
            let response = self
                .inner
                .client
                .post(rename_url)
                .json(&serde_json::json!({
                    "old_name": request.original_name,
                    "new_name": request.name,
                }))
                .send()
                .await?;
            if !response.status().is_success() {
                return Err(ApiError::Message(
                    response
                        .text()
                        .await
                        .unwrap_or_else(|_| "Failed to rename remote".to_string()),
                ));
            }
        }

        let rclone_rc_url = self.rclone_rc_url().await?;
        let response = self
            .inner
            .client
            .post(format!("{rclone_rc_url}/config/update"))
            .json(&serde_json::json!({
                "name": request.name,
                "parameters": request.parameters,
                "opt": {
                    "nonInteractive": true,
                    "continue": true
                }
            }))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(ApiError::Message(
                response
                    .text()
                    .await
                    .unwrap_or_else(|_| "Failed to save remote config".to_string()),
            ));
        }

        self.refresh().await?;
        self.select_remote(request.name).await
    }

    pub async fn test_remote(&self, name: String) -> ApiResult<RemoteTestResult> {
        let rclone_rc_url = self.rclone_rc_url().await?;
        let response = self
            .inner
            .client
            .post(format!("{rclone_rc_url}/operations/about"))
            .json(&serde_json::json!({ "fs": format!("{name}:") }))
            .send()
            .await?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if status.is_success() {
            Ok(RemoteTestResult {
                success: true,
                message: "Connection succeeded.".to_string(),
                about_json: Some(body),
                checked_unix: now_unix(),
            })
        } else {
            Err(ApiError::Message(if body.is_empty() {
                format!("Connection failed ({})", status.as_u16())
            } else {
                body
            }))
        }
    }

    pub async fn config_paths(&self) -> ApiResult<RcloneConfigPaths> {
        let rclone_rc_url = self.rclone_rc_url().await?;
        let response = self
            .inner
            .client
            .post(format!("{rclone_rc_url}/config/paths"))
            .json(&serde_json::json!({}))
            .send()
            .await?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(ApiError::Message(if body.is_empty() {
                format!("Failed to load rclone config paths ({})", status.as_u16())
            } else {
                body
            }));
        }
        let parsed = serde_json::from_str::<serde_json::Value>(&body).unwrap_or_default();
        Ok(RcloneConfigPaths {
            config_path: json_string(&parsed, &["config", "config_path", "ConfigPath"]),
            cache_path: json_string(&parsed, &["cache", "cache_path", "CachePath"]),
            temp_path: json_string(&parsed, &["temp", "temp_path", "TempPath"]),
            raw_json: body,
        })
    }

    async fn refresh_inner(&self) -> ApiResult<ProvidersSnapshot> {
        let raw_health = self.inner.proxy.probe_remote_health().await?;
        let health = parse_health(&raw_health);

        let workflows = self
            .get_json::<Vec<ProviderWorkflow>>("/api/remote/workflows")
            .await
            .unwrap_or_default();
        let raw_remotes = self
            .get_json::<Vec<RawRemote>>("/api/remote")
            .await
            .unwrap_or_default();
        let raw_statuses = self
            .get_json::<Vec<RawRemoteStatus>>("/api/remote/status")
            .await
            .unwrap_or_default();

        let remotes = raw_remotes
            .into_iter()
            .map(|remote| {
                let status = raw_statuses
                    .iter()
                    .find(|status| status.name == remote.name);
                ProviderRemote {
                    name: remote.name,
                    provider_type: if remote.provider_type.is_empty() {
                        status
                            .map(|value| value.provider_type.clone())
                            .unwrap_or_default()
                    } else {
                        remote.provider_type
                    },
                    status_label: status
                        .and_then(|value| value.status_label.clone())
                        .unwrap_or_else(|| "Connected".to_string()),
                    needs_reconnect: status.map(|value| value.needs_reconnect).unwrap_or(false),
                    error: status.and_then(|value| value.error.clone()),
                }
            })
            .collect();

        Ok(ProvidersSnapshot {
            health,
            remotes,
            workflows,
            loading: false,
            error: None,
        })
    }

    async fn get_json<T>(&self, path: &str) -> ApiResult<T>
    where
        T: serde::de::DeserializeOwned,
    {
        let url = self.inner.proxy.url(path)?;
        let response = self.inner.client.get(url).send().await?;
        if !response.status().is_success() {
            return Err(ApiError::Message(response.text().await.unwrap_or_default()));
        }
        Ok(response.json::<T>().await?)
    }

    async fn rclone_rc_url(&self) -> ApiResult<String> {
        let health = self.inner.proxy.probe_remote_health().await?;
        Ok(self.inner.proxy.rclone_rc_url_from_health(&health))
    }
}

impl ProvidersSnapshot {
    fn empty() -> Self {
        Self {
            health: ProviderHealth {
                ready: false,
                port: None,
                version: None,
                uptime_seconds: 0,
                connected_providers: 0,
                available_providers: 0,
                error: None,
            },
            remotes: Vec::new(),
            workflows: Vec::new(),
            loading: false,
            error: None,
        }
    }
}

fn parse_health(value: &serde_json::Value) -> ProviderHealth {
    ProviderHealth {
        ready: value
            .get("ready")
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
        port: value
            .get("port")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned),
        version: value
            .get("version")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned),
        uptime_seconds: value
            .get("uptime_seconds")
            .and_then(|value| value.as_i64())
            .unwrap_or_default(),
        connected_providers: value
            .get("connected_providers")
            .and_then(|value| value.as_u64())
            .unwrap_or_default() as usize,
        available_providers: value
            .get("available_providers")
            .and_then(|value| value.as_u64())
            .unwrap_or_default() as usize,
        error: value
            .get("error")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned),
    }
}

fn parse_config_map(body: &str) -> ApiResult<BTreeMap<String, String>> {
    let parsed = serde_json::from_str::<serde_json::Value>(body)?;
    let Some(object) = parsed.as_object() else {
        return Err(ApiError::Message(
            "rclone config/get did not return an object".to_string(),
        ));
    };
    let mut config = BTreeMap::new();
    for (key, value) in object {
        let text = match value {
            serde_json::Value::String(value) => value.clone(),
            serde_json::Value::Null => String::new(),
            other => other.to_string(),
        };
        config.insert(key.clone(), text);
    }
    Ok(config)
}

fn validate_remote_name(request: &SaveRemoteRequest) -> ApiResult<()> {
    if request.name.trim().is_empty() {
        return Err(ApiError::Message("Enter a remote name.".to_string()));
    }
    if request.name.contains(':') || request.name.contains('/') || request.name.contains('\\') {
        return Err(ApiError::Message(
            "Remote names cannot contain colons or path separators.".to_string(),
        ));
    }
    Ok(())
}

fn now_unix() -> Option<i64> {
    Some(SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs() as i64)
}

fn json_string(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(text) = value.get(*key).and_then(|value| value.as_str()) {
            if !text.is_empty() {
                return Some(text.to_string());
            }
        }
    }
    None
}
