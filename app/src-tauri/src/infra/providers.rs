use std::{
    collections::BTreeMap,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use super::storage::{StorageResponse, StorageService};
use crate::error::{ApiError, ApiResult};

const PROVIDER_AUTH_CANCEL_RESULT: &str = "cancel";

#[cfg(test)]
#[path = "providers/step_tests.rs"]
mod step_tests;

#[derive(Clone)]
pub struct ProviderService {
    inner: Arc<ProviderInner>,
}

struct ProviderInner {
    proxy: StorageService,
    snapshot: RwLock<ProvidersSnapshot>,
    active_config_sessions: RwLock<Vec<ActiveProviderConfigSession>>,
}

#[derive(Debug, Clone)]
struct ActiveProviderConfigSession {
    name: String,
    provider_type: String,
    parameters: BTreeMap<String, String>,
    state: String,
    mode: ProviderConfigMode,
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
    pub config_source: String,
    pub connection_id: Option<String>,
    pub connection_source: Option<String>,
    pub connected_account_id: Option<String>,
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
pub struct CloudConfigPaths {
    pub config_path: Option<String>,
    pub cache_path: Option<String>,
    pub temp_path: Option<String>,
    pub raw_json: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderConfigMode {
    Add,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerToolEndpoint {
    pub kind: String,
    #[serde(default)]
    pub remote: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TransferProfileOptions {
    #[serde(default)]
    pub transfers: u32,
    #[serde(default)]
    pub checkers: u32,
    #[serde(default)]
    pub bandwidth_limit: String,
    #[serde(default)]
    pub retries: u32,
    #[serde(default)]
    pub low_level_retries: u32,
    #[serde(default)]
    pub checksum: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VerifyOptions {
    #[serde(default)]
    pub one_way: bool,
    #[serde(default)]
    pub download: bool,
    #[serde(default)]
    pub profile: TransferProfileOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyStartRequest {
    pub source: PowerToolEndpoint,
    pub dest: PowerToolEndpoint,
    #[serde(default)]
    pub options: VerifyOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct ProviderJobStart {
    pub job_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct ProviderJobStatus {
    pub job_id: String,
    pub operation: String,
    pub state: String,
    pub phase: String,
    pub bytes_completed: i64,
    pub bytes_total: i64,
    #[serde(default)]
    pub bytes_per_second: f64,
    pub source_remote: Option<String>,
    pub source_path: Option<String>,
    pub dest_remote: Option<String>,
    pub dest_path: Option<String>,
    pub message: Option<String>,
    pub result_ready: bool,
    pub result_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct VerifyResult {
    pub success: bool,
    pub status: Option<String>,
    pub hash_type: Option<String>,
    #[serde(default)]
    pub missing_on_src: Vec<String>,
    #[serde(default)]
    pub missing_on_dst: Vec<String>,
    #[serde(default)]
    pub r#match: Vec<String>,
    #[serde(default)]
    pub differ: Vec<String>,
    #[serde(default)]
    pub error: Vec<String>,
    #[serde(default)]
    pub combined: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct BackendAction {
    pub id: String,
    pub label: String,
    pub description: String,
    pub provider: String,
    pub destructive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendRunRequest {
    pub remote: String,
    pub action_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct BackendActionResult {
    pub action_id: String,
    pub label: String,
    pub result: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct ConfigSecurityStatus {
    pub config_path: Option<String>,
    pub encrypted: bool,
    pub unlocked: bool,
    pub password_present: bool,
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawRemote {
    name: String,
    #[serde(default, rename = "type")]
    provider_type: String,
    #[serde(default)]
    connection_id: Option<String>,
    #[serde(default)]
    connection_source: Option<String>,
    #[serde(default)]
    connected_account_id: Option<String>,
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
    pub fn new(proxy: StorageService) -> Self {
        Self {
            inner: Arc::new(ProviderInner {
                proxy,
                snapshot: RwLock::new(ProvidersSnapshot::empty()),
                active_config_sessions: RwLock::new(Vec::new()),
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
        let config_response = self
            .inner
            .proxy
            .post_json(
                "/api/remote/config/get",
                &serde_json::json!({ "name": name }),
            )
            .await?;
        let config_status = config_response.status();
        let config_body = config_response.text().await.unwrap_or_default();
        if !config_status.is_success() {
            return Err(provider_operation_error(
                config_status.as_u16(),
                &config_body,
                "Failed to load remote config",
            ));
        }
        let mut config = parse_config_map(&config_body)?;
        config.remove("access_token");
        config.remove("token");
        config
            .entry("type".to_string())
            .or_insert_with(|| remote.provider_type.clone());

        let about_response = self
            .inner
            .proxy
            .post_json(
                "/api/remote/about",
                &serde_json::json!({ "fs": format!("{}:", remote.name) }),
            )
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

        let response = self
            .inner
            .proxy
            .post_json(
                "/api/remote/config/update",
                &serde_json::json!({
                    "name": request.name,
                    "parameters": request.parameters,
                    "opt": {
                        "nonInteractive": true,
                        "continue": true
                    }
                }),
            )
            .await?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(provider_operation_error(
                status.as_u16(),
                &body,
                "Failed to save remote config",
            ));
        }

        self.refresh().await?;
        self.select_remote(request.name).await
    }

    pub async fn test_remote(&self, name: String) -> ApiResult<RemoteTestResult> {
        let response = self
            .inner
            .proxy
            .post_json(
                "/api/remote/about",
                &serde_json::json!({ "fs": format!("{name}:") }),
            )
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
            Err(provider_operation_error(
                status.as_u16(),
                &body,
                "Connection failed",
            ))
        }
    }

    pub async fn config_paths(&self) -> ApiResult<CloudConfigPaths> {
        let response = self
            .inner
            .proxy
            .post_json("/api/remote/config/paths", &serde_json::json!({}))
            .await?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(provider_operation_error(
                status.as_u16(),
                &body,
                "Failed to load storage configuration paths",
            ));
        }
        let parsed = serde_json::from_str::<serde_json::Value>(&body).unwrap_or_default();
        Ok(CloudConfigPaths {
            config_path: json_string(&parsed, &["config", "config_path", "ConfigPath"]),
            cache_path: json_string(&parsed, &["cache", "cache_path", "CachePath"]),
            temp_path: json_string(&parsed, &["temp", "temp_path", "TempPath"]),
            raw_json: body,
        })
    }

    pub async fn start_verify(&self, request: VerifyStartRequest) -> ApiResult<ProviderJobStart> {
        let body = serde_json::json!({
            "source": endpoint_proxy_body(&request.source),
            "dest": endpoint_proxy_body(&request.dest),
            "options": {
                "one_way": request.options.one_way,
                "download": request.options.download,
                "profile": transfer_profile_proxy_body(&request.options.profile),
            }
        });
        self.post_json_value("/api/remote/verify/start", &body)
            .await
    }

    pub async fn job_status(&self, job_id: String) -> ApiResult<ProviderJobStatus> {
        let response = self
            .inner
            .proxy
            .get(&format!("/api/remote/file/jobs/{job_id}"))
            .await?;
        parse_proxy_response(response, "Failed to load provider job status").await
    }

    pub async fn cancel_job(&self, job_id: String) -> ApiResult<serde_json::Value> {
        let response = self
            .inner
            .proxy
            .delete(&format!("/api/remote/file/jobs/{job_id}"))
            .await?;
        parse_proxy_response(response, "Failed to cancel provider job").await
    }

    pub async fn verify_result(&self, job_id: String) -> ApiResult<VerifyResult> {
        self.post_json_value(
            "/api/remote/verify/result",
            &serde_json::json!({ "job_id": job_id }),
        )
        .await
    }

    pub async fn backend_actions(&self, remote: String) -> ApiResult<Vec<BackendAction>> {
        self.post_json_value(
            "/api/remote/backend/actions",
            &serde_json::json!({ "remote": remote }),
        )
        .await
    }

    pub async fn run_backend_action(
        &self,
        request: BackendRunRequest,
    ) -> ApiResult<BackendActionResult> {
        self.post_json_value(
            "/api/remote/backend/run",
            &serde_json::json!({
                "remote": request.remote,
                "action_id": request.action_id,
            }),
        )
        .await
    }

    pub async fn config_security(&self) -> ApiResult<ConfigSecurityStatus> {
        Ok(ConfigSecurityStatus {
            config_path: None,
            encrypted: true,
            unlocked: true,
            password_present: true,
            message: Some("Cloud OAuth credentials are encrypted by Misty.".to_owned()),
        })
    }

    pub async fn harden_config(&self) -> ApiResult<ConfigSecurityStatus> {
        self.config_security().await
    }

    pub async fn repair_config_security(
        &self,
        _password: String,
    ) -> ApiResult<ConfigSecurityStatus> {
        let mut status = self.config_security().await?;
        status.message =
            Some("Cloud OAuth credentials are managed by the Misty server.".to_owned());
        Ok(status)
    }

    async fn post_json_value<T: for<'de> Deserialize<'de>>(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> ApiResult<T> {
        let response = self.inner.proxy.post_json(path, body).await?;
        parse_proxy_response(response, "Provider tool failed").await
    }

    async fn cancel_active_config_sessions(&self) {
        let sessions = {
            let mut active_sessions = self.inner.active_config_sessions.write().await;
            std::mem::take(&mut *active_sessions)
        };
        for session in sessions {
            let request = ProviderConfigRequest {
                name: session.name,
                provider_type: session.provider_type,
                parameters: session.parameters,
                state: session.state,
                result: PROVIDER_AUTH_CANCEL_RESULT.to_string(),
                mode: session.mode,
                continuing: true,
                continue_existing: false,
            };
            let Ok(body) = provider_config_request_body(&request) else {
                continue;
            };
            let _ = self
                .inner
                .proxy
                .post_json("/api/remote/config/continue", &body)
                .await;
        }
    }

    async fn remember_config_session(
        &self,
        request: &ProviderConfigRequest,
        step: &ProviderConfigStep,
    ) {
        let state = step.state.trim();
        if state.is_empty()
            || step.done
            || step.kind == "done"
            || step.kind == "error"
            || !step.error.trim().is_empty()
        {
            return;
        }
        let next = ActiveProviderConfigSession {
            name: request.name.clone(),
            provider_type: request.provider_type.clone(),
            parameters: request.parameters.clone(),
            state: state.to_string(),
            mode: request.mode,
        };
        let mut active_sessions = self.inner.active_config_sessions.write().await;
        active_sessions.retain(|session| session.state != next.state);
        active_sessions.push(next);
    }

    async fn forget_config_session_state(&self, state: &str) {
        let state = state.trim();
        if state.is_empty() {
            return;
        }
        let mut active_sessions = self.inner.active_config_sessions.write().await;
        active_sessions.retain(|session| session.state != state);
    }

    pub async fn configure_remote(
        &self,
        request: ProviderConfigRequest,
    ) -> ApiResult<ProviderConfigStep> {
        validate_config_request(&request)?;
        if !request.continuing {
            self.cancel_active_config_sessions().await;
        }
        let is_cancel_continuation =
            request.continuing && request.result.trim() == PROVIDER_AUTH_CANCEL_RESULT;
        let endpoint = if request.continuing {
            "/api/remote/config/continue"
        } else {
            match request.mode {
                ProviderConfigMode::Add => "/api/remote/config/start",
                ProviderConfigMode::Repair => "/api/remote/config/repair",
            }
        };
        let body = provider_config_request_body(&request)?;
        let response = self.inner.proxy.post_json(endpoint, &body).await?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            if is_cancel_continuation {
                self.forget_config_session_state(&request.state).await;
            }
            return Err(provider_operation_error(
                status.as_u16(),
                &body,
                "Provider configuration failed",
            ));
        }
        let mut step = parse_provider_config_step(&body)?;
        if !step.error.is_empty() || step.kind == "error" {
            self.forget_config_session_state(&request.state).await;
            self.forget_config_session_state(&step.state).await;
            return Err(normalize_provider_config_error(ApiError::Message(
                if step.error.is_empty() {
                    "Provider configuration failed.".to_string()
                } else {
                    std::mem::take(&mut step.error)
                },
            )));
        }
        if step.done || step.kind == "done" {
            self.forget_config_session_state(&request.state).await;
            self.forget_config_session_state(&step.state).await;
            let _ = self.refresh().await;
        } else if is_cancel_continuation {
            self.forget_config_session_state(&request.state).await;
            self.forget_config_session_state(&step.state).await;
        } else {
            self.remember_config_session(&request, &step).await;
        }
        Ok(step)
    }

    pub async fn disconnect_remote(&self, name: String) -> ApiResult<ProvidersSnapshot> {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err(ApiError::Message("Choose a remote to delete.".to_string()));
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
                "Failed to delete remote",
            ));
        }
        self.refresh().await
    }

    async fn refresh_inner(&self) -> ApiResult<ProvidersSnapshot> {
        let raw_health = match self.inner.proxy.probe_remote_health().await {
            Ok(value) => value,
            Err(error) => return Ok(ProvidersSnapshot::unavailable(error.to_string())),
        };
        let mut health = parse_health(&raw_health);

        let mut workflows = self
            .get_json::<Vec<ProviderWorkflow>>("/api/remote/workflows")
            .await
            .unwrap_or_default();
        if health.ready {
            workflows = merge_provider_workflows(workflows, default_provider_workflows());
            health.available_providers = health.available_providers.max(workflows.len());
        }
        let raw_remotes = self
            .get_json::<Vec<RawRemote>>("/api/remote")
            .await
            .unwrap_or_default();
        let raw_statuses = self
            .get_json::<Vec<RawRemoteStatus>>("/api/remote/status")
            .await
            .unwrap_or_default();

        let remotes: Vec<ProviderRemote> = raw_remotes
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
                    config_source: "misty".to_string(),
                    connection_id: remote.connection_id,
                    connection_source: remote.connection_source,
                    connected_account_id: remote.connected_account_id,
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
        response.json::<T>().await
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

    fn unavailable(error: String) -> Self {
        let workflows = default_provider_workflows();
        Self {
            health: ProviderHealth {
                ready: false,
                port: None,
                version: None,
                uptime_seconds: 0,
                connected_providers: 0,
                available_providers: workflows.len(),
                error: Some(error.clone()),
            },
            remotes: Vec::new(),
            workflows,
            loading: false,
            error: Some(error),
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
            "Storage configuration did not return an object".to_string(),
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

fn provider_config_request_body(request: &ProviderConfigRequest) -> ApiResult<serde_json::Value> {
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
        serde_json::to_value(provider_config_parameters(request)?)?,
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
    Ok(serde_json::Value::Object(body))
}

fn provider_config_parameters(
    request: &ProviderConfigRequest,
) -> ApiResult<BTreeMap<String, String>> {
    Ok(request.parameters.clone())
}

fn default_provider_workflows() -> Vec<ProviderWorkflow> {
    vec![
        provider_workflow(
            "drive",
            "Google Drive",
            "Google Drive with secure browser sign-in.",
            vec![
                ProviderWorkflowOption {
                    name: "client_id".into(),
                    label: "OAuth client ID".into(),
                    help: "Advanced: use your own Google OAuth application.".into(),
                    default_value: String::new(),
                    required: false,
                    password: false,
                    choices: vec![],
                },
                ProviderWorkflowOption {
                    name: "client_secret".into(),
                    label: "OAuth client secret".into(),
                    help: "Advanced: secret for the custom OAuth application.".into(),
                    default_value: String::new(),
                    required: false,
                    password: true,
                    choices: vec![],
                },
            ],
        ),
        provider_workflow(
            "onedrive",
            "Microsoft OneDrive",
            "Microsoft OneDrive with secure browser sign-in.",
            vec![
                ProviderWorkflowOption {
                    name: "client_id".into(),
                    label: "OAuth client ID".into(),
                    help: "Advanced: use your own Microsoft OAuth application.".into(),
                    default_value: String::new(),
                    required: false,
                    password: false,
                    choices: vec![],
                },
                ProviderWorkflowOption {
                    name: "client_secret".into(),
                    label: "OAuth client secret".into(),
                    help: "Advanced: secret for the custom OAuth application.".into(),
                    default_value: String::new(),
                    required: false,
                    password: true,
                    choices: vec![],
                },
            ],
        ),
        provider_workflow(
            "dropbox",
            "Dropbox",
            "Dropbox with secure browser sign-in.",
            vec![
                ProviderWorkflowOption {
                    name: "client_id".into(),
                    label: "OAuth app key".into(),
                    help: "Advanced: use your own Dropbox OAuth application.".into(),
                    default_value: String::new(),
                    required: false,
                    password: false,
                    choices: vec![],
                },
                ProviderWorkflowOption {
                    name: "client_secret".into(),
                    label: "OAuth app secret".into(),
                    help: "Advanced: secret for the custom OAuth application.".into(),
                    default_value: String::new(),
                    required: false,
                    password: true,
                    choices: vec![],
                },
            ],
        ),
    ]
}

fn provider_workflow(
    provider_type: &str,
    name: &str,
    description: &str,
    options: Vec<ProviderWorkflowOption>,
) -> ProviderWorkflow {
    ProviderWorkflow {
        provider_type: provider_type.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        options,
    }
}

fn merge_provider_workflows(
    mut primary: Vec<ProviderWorkflow>,
    fallback: Vec<ProviderWorkflow>,
) -> Vec<ProviderWorkflow> {
    for workflow in fallback {
        let exists = primary.iter().any(|candidate| {
            candidate
                .provider_type
                .eq_ignore_ascii_case(&workflow.provider_type)
        });
        if !exists {
            primary.push(workflow);
        }
    }
    primary.sort_by(|left, right| {
        provider_workflow_rank(&left.provider_type)
            .cmp(&provider_workflow_rank(&right.provider_type))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    primary
}

fn provider_workflow_rank(provider_type: &str) -> u8 {
    match provider_type {
        "drive" | "dropbox" | "onedrive" | "box" | "s3" | "sftp" | "webdav" => 0,
        "alias" | "crypt" | "chunker" | "combine" | "compress" | "hasher" | "union" => 2,
        _ => 1,
    }
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
                .or_else(|| {
                    let has_inline_prompt_shape = object.contains_key("name")
                        && (object.contains_key("choices")
                            || object.contains_key("default")
                            || object.contains_key("defaultValue")
                            || object.contains_key("required"));
                    has_inline_prompt_shape.then(|| serde_json::Value::Object(object.clone()))
                })
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

async fn parse_proxy_response<T: for<'de> Deserialize<'de>>(
    response: StorageResponse,
    fallback: &str,
) -> ApiResult<T> {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(provider_operation_error(status.as_u16(), &body, fallback));
    }
    serde_json::from_str::<T>(&body).map_err(ApiError::from)
}

fn endpoint_proxy_body(endpoint: &PowerToolEndpoint) -> serde_json::Value {
    serde_json::json!({
        "kind": endpoint.kind,
        "remote": endpoint.remote,
        "path": endpoint.path,
    })
}

fn transfer_profile_proxy_body(profile: &TransferProfileOptions) -> serde_json::Value {
    serde_json::json!({
        "transfers": profile.transfers,
        "checkers": profile.checkers,
        "bandwidth_limit": profile.bandwidth_limit,
        "retries": profile.retries,
        "low_level_retries": profile.low_level_retries,
        "checksum": profile.checksum,
    })
}

fn provider_operation_error(status: u16, body: &str, fallback: &str) -> ApiError {
    normalize_provider_config_error(proxy_response_error(status, body, fallback))
}

fn normalize_provider_config_error(error: ApiError) -> ApiError {
    match error {
        ApiError::Message(message) if recoverable_provider_auth_error(&message) => ApiError::Message(
            "Provider authorization is still pending. Complete the browser sign-in, then return to Misty and try again.".to_string(),
        ),
        other => other,
    }
}

fn recoverable_provider_auth_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("authorization")
        || lower.contains("auth header")
        || lower.contains("unauthorized")
        || lower.contains("oauth")
        || lower.contains("token")
        || lower.contains("forbidden")
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
    fn provider_step_accepts_inline_prompt_shape() {
        let step = parse_provider_config_step(
            r#"{
                "kind":"post_auth_config",
                "name":"scope",
                "default":"drive",
                "required":true,
                "choices":[{"value":"drive","help":"Full Google Drive access"}]
            }"#,
        )
        .unwrap();
        let option = step.option.unwrap();
        assert_eq!(option.name, "scope");
        assert_eq!(option.default_value, "drive");
        assert!(option.required);
        assert_eq!(option.choices[0].value, "drive");
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

        let body = provider_config_request_body(&request).expect("build provider config body");

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

        let body = provider_config_request_body(&request).expect("build provider config body");

        assert_eq!(body["name"], "onedrive-misty");
        assert_eq!(body["type"], "onedrive");
        assert_eq!(body["state"], "state-token");
        assert_eq!(body["result"], "result-token");
        assert_eq!(body["continue_existing"], true);
    }

    #[test]
    fn provider_config_onedrive_repair_bootstrap_can_continue_existing() {
        let request = ProviderConfigRequest {
            name: "onedrive-misty".into(),
            provider_type: "onedrive".into(),
            parameters: BTreeMap::from([("config_type".to_string(), "onedrive".to_string())]),
            state: String::new(),
            result: String::new(),
            mode: ProviderConfigMode::Repair,
            continuing: true,
            continue_existing: true,
        };

        let body = provider_config_request_body(&request).expect("build provider config body");

        assert_eq!(body["name"], "onedrive-misty");
        assert_eq!(body["type"], "onedrive");
        assert_eq!(body["parameters"]["config_type"], "onedrive");
        assert_eq!(body["state"], "");
        assert_eq!(body["result"], "");
        assert_eq!(body["continue_existing"], true);
    }

    #[test]
    fn default_provider_workflows_include_supported_clouds() {
        let workflows = default_provider_workflows();

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
        assert_eq!(drive.options[0].name, "client_id");
        assert_eq!(drive.options[1].name, "client_secret");
        assert!(workflows.iter().all(|workflow| {
            workflow
                .options
                .iter()
                .map(|option| option.name.as_str())
                .eq(["client_id", "client_secret"])
        }));
        assert_eq!(workflows.len(), 3);
        assert!(workflows.iter().all(|workflow| matches!(
            workflow.provider_type.as_str(),
            "drive" | "onedrive" | "dropbox"
        )));
    }

    #[test]
    fn provider_workflow_merge_preserves_backend_specific_options() {
        let workflows = merge_provider_workflows(
            vec![ProviderWorkflow {
                provider_type: "drive".into(),
                name: "Proxy Drive".into(),
                description: "Proxy reported Drive workflow.".into(),
                options: vec![ProviderWorkflowOption {
                    name: "team_drive".into(),
                    label: "Team Drive".into(),
                    help: String::new(),
                    default_value: String::new(),
                    required: false,
                    password: false,
                    choices: Vec::new(),
                }],
            }],
            default_provider_workflows(),
        );
        let drive = workflows
            .iter()
            .find(|workflow| workflow.provider_type == "drive")
            .unwrap();
        assert_eq!(drive.name, "Proxy Drive");
        assert_eq!(drive.options[0].name, "team_drive");
        assert!(workflows
            .iter()
            .any(|workflow| workflow.provider_type == "dropbox"));
    }

    #[test]
    fn provider_config_auth_header_errors_are_recoverable_messages() {
        let error = normalize_provider_config_error(ApiError::Message(
            "Missing or invalid Authorization header".to_string(),
        ));
        let ApiError::Message(message) = error else {
            panic!("expected message error");
        };
        assert!(message.contains("authorization is still pending"));
        assert!(!message.contains("Authorization header"));
    }

    #[test]
    fn provider_runtime_auth_errors_are_normalized_from_json_bodies() {
        let error = provider_operation_error(
            401,
            r#"{"error":"oauth token expired: missing Authorization header"}"#,
            "Connection failed",
        );
        let ApiError::Message(message) = error else {
            panic!("expected message error");
        };

        assert!(message.contains("authorization is still pending"));
        assert!(!message.contains("Authorization header"));
        assert!(!message.contains("oauth token expired"));
    }

    #[test]
    fn provider_runtime_forbidden_auth_errors_are_recoverable_messages() {
        let error = provider_operation_error(
            403,
            r#"{"message":"forbidden: OAuth authorization has not completed"}"#,
            "Connection failed",
        );
        let ApiError::Message(message) = error else {
            panic!("expected message error");
        };

        assert!(message.contains("authorization is still pending"));
        assert!(!message.contains("forbidden"));
        assert!(!message.contains("OAuth authorization has not completed"));
    }

    #[test]
    fn provider_runtime_non_auth_errors_keep_proxy_message() {
        let error = provider_operation_error(
            500,
            r#"{"message":"cloud config update failed"}"#,
            "Provider operation failed",
        );
        let ApiError::Message(message) = error else {
            panic!("expected message error");
        };

        assert_eq!(message, "cloud config update failed");
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
