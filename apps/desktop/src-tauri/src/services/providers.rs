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
    #[serde(default, alias = "Name")]
    pub name: String,
    #[serde(
        default,
        alias = "title",
        alias = "question",
        alias = "display_name",
        alias = "FieldName"
    )]
    pub label: String,
    #[serde(default, alias = "Help")]
    pub help: String,
    #[serde(default, alias = "default", alias = "DefaultStr")]
    pub default_value: String,
    #[serde(default, alias = "Required")]
    pub required: bool,
    #[serde(default, alias = "IsPassword")]
    pub password: bool,
    #[serde(default)]
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderConfigMode {
    Add,
    Reconnect,
    Repair,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfigRequest {
    pub name: String,
    pub provider_type: String,
    #[serde(default)]
    pub parameters: BTreeMap<String, String>,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub result: String,
    pub mode: ProviderConfigMode,
    #[serde(default)]
    pub continuing: bool,
    #[serde(default)]
    pub continue_existing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfigStep {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub result: String,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub error: String,
    #[serde(default, rename = "authorizeUrl", alias = "authorize_url")]
    pub authorize_url: String,
    #[serde(default)]
    pub instructions: String,
    #[serde(
        default = "default_poll_after_ms",
        rename = "pollAfterMs",
        alias = "poll_after_ms"
    )]
    pub poll_after_ms: u64,
    #[serde(default, alias = "field", alias = "prompt")]
    pub option: Option<ProviderWorkflowOption>,
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
        let snapshot = self.inner.snapshot.read().await.clone();
        if snapshot.health.ready || snapshot.loading || !snapshot.workflows.is_empty() {
            return Ok(snapshot);
        }
        self.refresh().await
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
            let response = self
                .inner
                .proxy
                .post_json(
                    "/api/remote/rename",
                    &serde_json::json!({
                        "old_name": request.original_name,
                        "new_name": request.name,
                    }),
                )
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

    pub async fn configure_remote(
        &self,
        request: ProviderConfigRequest,
    ) -> ApiResult<ProviderConfigStep> {
        validate_config_request(&request)?;
        let endpoint = if request.continuing {
            "/api/remote/config/continue"
        } else {
            match request.mode {
                ProviderConfigMode::Add => "/api/remote/config/start",
                ProviderConfigMode::Reconnect => "/api/remote/config/reconnect",
                ProviderConfigMode::Repair => "/api/remote/config/repair",
            }
        };
        let body = provider_config_request_body(&request);
        let response = self.inner.proxy.post_json(endpoint, &body).await?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(proxy_response_error(
                status.as_u16(),
                &body,
                "Provider configuration failed",
            ));
        }
        let mut step = parse_provider_config_step(&body)?;
        if !step.error.is_empty() || step.kind == "error" {
            return Err(ApiError::Message(if step.error.is_empty() {
                "Provider configuration failed.".to_string()
            } else {
                std::mem::take(&mut step.error)
            }));
        }
        if step.done || step.kind == "done" {
            let _ = self.refresh().await;
        }
        Ok(step)
    }

    pub async fn disconnect_remote(&self, name: String) -> ApiResult<ProvidersSnapshot> {
        if name.trim().is_empty() {
            return Err(ApiError::Message(
                "Choose a remote to disconnect.".to_string(),
            ));
        }
        let response = self
            .inner
            .proxy
            .delete_with_query("/api/remote", &[("name", name.as_str())])
            .await?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(proxy_response_error(
                status.as_u16(),
                &body,
                "Failed to disconnect remote",
            ));
        }
        self.refresh().await
    }

    async fn refresh_inner(&self) -> ApiResult<ProvidersSnapshot> {
        let raw_health = self.inner.proxy.probe_remote_health().await?;
        let health = parse_health(&raw_health);

        let mut workflows = self
            .get_json::<Vec<ProviderWorkflow>>("/api/remote/workflows")
            .await
            .unwrap_or_default();
        if workflows.is_empty() && health.ready {
            workflows = default_provider_workflows();
        }
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
        let response = self.inner.proxy.get(path).await?;
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

fn validate_config_request(request: &ProviderConfigRequest) -> ApiResult<()> {
    if request.name.trim().is_empty() {
        return Err(ApiError::Message("Enter a remote name.".to_string()));
    }
    if request.name.contains(':') || request.name.contains('/') || request.name.contains('\\') {
        return Err(ApiError::Message(
            "Remote names cannot contain colons or path separators.".to_string(),
        ));
    }
    if request.provider_type.trim().is_empty() {
        return Err(ApiError::Message("Choose a provider.".to_string()));
    }
    Ok(())
}

fn provider_config_request_body(request: &ProviderConfigRequest) -> serde_json::Value {
    let mut body = serde_json::Map::new();
    body.insert(
        "name".to_string(),
        serde_json::Value::String(request.name.clone()),
    );
    body.insert(
        "type".to_string(),
        serde_json::Value::String(request.provider_type.clone()),
    );
    body.insert(
        "parameters".to_string(),
        serde_json::to_value(&request.parameters).unwrap_or_else(|_| serde_json::json!({})),
    );
    if request.continuing {
        body.insert(
            "state".to_string(),
            serde_json::Value::String(request.state.clone()),
        );
        body.insert(
            "result".to_string(),
            serde_json::Value::String(request.result.clone()),
        );
        if request.continue_existing {
            body.insert(
                "continue_existing".to_string(),
                serde_json::Value::Bool(true),
            );
        }
    }
    serde_json::Value::Object(body)
}

fn default_provider_workflows() -> Vec<ProviderWorkflow> {
    vec![
        ProviderWorkflow {
            provider_type: "drive".to_string(),
            name: "Google Drive".to_string(),
            description: "Connect a Google Drive remote with browser sign-in.".to_string(),
            options: vec![ProviderWorkflowOption {
                name: "scope".to_string(),
                label: "Scope".to_string(),
                help: "Access scope requested from Google Drive.".to_string(),
                default_value: "drive".to_string(),
                required: true,
                password: false,
                choices: vec![ProviderWorkflowChoice {
                    value: "drive".to_string(),
                    help: "Full Google Drive access".to_string(),
                }],
            }],
        },
        ProviderWorkflow {
            provider_type: "dropbox".to_string(),
            name: "Dropbox".to_string(),
            description: "Connect a Dropbox remote with browser sign-in.".to_string(),
            options: Vec::new(),
        },
        ProviderWorkflow {
            provider_type: "onedrive".to_string(),
            name: "OneDrive".to_string(),
            description: "Connect a Microsoft OneDrive remote with browser sign-in.".to_string(),
            options: Vec::new(),
        },
    ]
}

fn parse_provider_config_step(body: &str) -> ApiResult<ProviderConfigStep> {
    let mut value = serde_json::from_str::<serde_json::Value>(body)?;
    if let Some(object) = value.as_object_mut() {
        let option = object.get("option").cloned().or_else(|| {
            object
                .get("field")
                .or_else(|| object.get("prompt"))
                .or_else(|| {
                    object
                        .get("options")
                        .and_then(|options| options.as_array()?.first())
                })
                .cloned()
        });
        object.remove("field");
        object.remove("prompt");
        object.remove("options");
        if let Some(option) = option {
            object.insert("option".to_string(), option);
        }
    }
    let mut step = serde_json::from_value::<ProviderConfigStep>(value)?;
    if step.poll_after_ms == 0 {
        step.poll_after_ms = default_poll_after_ms();
    }
    Ok(step)
}

fn proxy_response_error(status: u16, body: &str, fallback: &str) -> ApiError {
    let message = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .or_else(|| value.get("message"))
                .and_then(|message| message.as_str())
                .map(ToOwned::to_owned)
        })
        .filter(|message| !message.is_empty())
        .or_else(|| (!body.trim().is_empty()).then(|| body.trim().to_string()))
        .unwrap_or_else(|| format!("{fallback} (HTTP {status})"));
    ApiError::Message(message)
}

const fn default_poll_after_ms() -> u64 {
    1000
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_step_accepts_proxy_field_alias() {
        let step = parse_provider_config_step(
            r#"{
                "kind":"post_auth_config",
                "state":"state-1",
                "field":{"name":"drive_id","label":"Drive","required":true},
                "poll_after_ms":0
            }"#,
        )
        .unwrap();
        assert_eq!(step.kind, "post_auth_config");
        assert_eq!(step.state, "state-1");
        assert_eq!(step.option.unwrap().name, "drive_id");
        assert_eq!(step.poll_after_ms, 1000);
    }

    #[test]
    fn provider_step_accepts_first_options_entry() {
        let step = parse_provider_config_step(
            r#"{"kind":"post_auth_config","options":[{"name":"scope","defaultValue":"drive"}]}"#,
        )
        .unwrap();
        assert_eq!(step.option.unwrap().name, "scope");
    }

    #[test]
    fn provider_config_start_body_omits_continuation_fields() {
        let request = ProviderConfigRequest {
            name: "drive-misty".into(),
            provider_type: "drive".into(),
            parameters: BTreeMap::from([("scope".to_string(), "drive".to_string())]),
            state: "stale-state".into(),
            result: "stale-result".into(),
            mode: ProviderConfigMode::Add,
            continuing: false,
            continue_existing: false,
        };

        let body = provider_config_request_body(&request);

        assert_eq!(body["name"], "drive-misty");
        assert_eq!(body["type"], "drive");
        assert_eq!(body["parameters"]["scope"], "drive");
        assert!(body.get("state").is_none());
        assert!(body.get("result").is_none());
        assert!(body.get("continue_existing").is_none());
    }

    #[test]
    fn provider_config_continue_body_includes_state_and_only_true_continue_existing() {
        let request = ProviderConfigRequest {
            name: "onedrive-misty".into(),
            provider_type: "onedrive".into(),
            parameters: BTreeMap::new(),
            state: "state-token".into(),
            result: "result-token".into(),
            mode: ProviderConfigMode::Repair,
            continuing: true,
            continue_existing: true,
        };

        let body = provider_config_request_body(&request);

        assert_eq!(body["name"], "onedrive-misty");
        assert_eq!(body["type"], "onedrive");
        assert_eq!(body["state"], "state-token");
        assert_eq!(body["result"], "result-token");
        assert_eq!(body["continue_existing"], true);
    }

    #[test]
    fn default_provider_workflows_include_supported_clouds() {
        let workflows = default_provider_workflows();

        assert_eq!(workflows.len(), 3);
        assert!(workflows
            .iter()
            .any(|workflow| workflow.provider_type == "drive"));
        assert!(workflows
            .iter()
            .any(|workflow| workflow.provider_type == "dropbox"));
        assert!(workflows
            .iter()
            .any(|workflow| workflow.provider_type == "onedrive"));
        let drive = workflows
            .iter()
            .find(|workflow| workflow.provider_type == "drive")
            .unwrap();
        assert_eq!(drive.options[0].name, "scope");
        assert_eq!(drive.options[0].default_value, "drive");
    }

    #[test]
    fn provider_config_request_rejects_path_like_names() {
        let request = ProviderConfigRequest {
            name: "bad/name".into(),
            provider_type: "drive".into(),
            parameters: BTreeMap::new(),
            state: String::new(),
            result: String::new(),
            mode: ProviderConfigMode::Add,
            continuing: false,
            continue_existing: false,
        };
        assert!(validate_config_request(&request).is_err());
    }
}
