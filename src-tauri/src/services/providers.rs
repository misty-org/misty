use std::{
    collections::BTreeMap,
    env, fs,
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::error::{ApiError, ApiResult};

use super::proxy::{ProxyResponse, ProxyService};

#[derive(Clone)]
pub struct ProviderService {
    inner: Arc<ProviderInner>,
}

struct ProviderInner {
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
    pub config_source: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkPathRequest {
    pub remote: String,
    pub path: String,
    #[serde(default)]
    pub expire: String,
    #[serde(default)]
    pub link_id: String,
    #[serde(default)]
    pub target_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct PublicLinkRecord {
    pub id: String,
    pub url: String,
    pub target_id: Option<String>,
    pub provider: String,
    pub path: String,
    pub role: Option<String>,
    pub scope: Option<String>,
    pub kind: Option<String>,
    pub expires_at: Option<String>,
    pub created_at: Option<String>,
    pub can_revoke: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct PublicLinkListResult {
    pub supported: bool,
    pub provider: String,
    #[serde(default)]
    pub links: Vec<PublicLinkRecord>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct PublicLinkActionResult {
    pub supported: bool,
    pub provider: String,
    pub link: Option<PublicLinkRecord>,
    pub message: Option<String>,
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

    pub async fn config_paths(&self) -> ApiResult<RcloneConfigPaths> {
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
                "Failed to load rclone config paths",
            ));
        }
        let parsed = serde_json::from_str::<serde_json::Value>(&body).unwrap_or_default();
        Ok(RcloneConfigPaths {
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

    pub async fn public_links(&self, request: LinkPathRequest) -> ApiResult<PublicLinkListResult> {
        self.post_json_value(
            "/api/remote/links/list",
            &serde_json::json!({
                "remote": request.remote,
                "path": request.path,
            }),
        )
        .await
    }

    pub async fn create_public_link(
        &self,
        request: LinkPathRequest,
    ) -> ApiResult<PublicLinkActionResult> {
        self.post_json_value(
            "/api/remote/links/create",
            &serde_json::json!({
                "remote": request.remote,
                "path": request.path,
                "expire": request.expire,
            }),
        )
        .await
    }

    pub async fn revoke_public_link(
        &self,
        request: LinkPathRequest,
    ) -> ApiResult<PublicLinkActionResult> {
        self.post_json_value(
            "/api/remote/links/revoke",
            &serde_json::json!({
                "remote": request.remote,
                "path": request.path,
                "link_id": request.link_id,
                "target_id": request.target_id,
            }),
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
        self.post_json_value(
            "/api/remote/config/security",
            &serde_json::json!({
                "password_present": crate::services::keychain::has_rclone_config_password(),
            }),
        )
        .await
    }

    pub async fn harden_config(&self) -> ApiResult<ConfigSecurityStatus> {
        let password = crate::services::keychain::ensure_rclone_config_password()?;
        self.post_json_value(
            "/api/remote/config/harden",
            &serde_json::json!({
                "current_password": "",
                "new_password": password,
            }),
        )
        .await
    }

    pub async fn repair_config_security(
        &self,
        password: String,
    ) -> ApiResult<ConfigSecurityStatus> {
        crate::services::keychain::store_rclone_config_password(password.trim())?;
        let mut status = self.config_security().await?;
        status.message = Some("Config unlock was repaired in macOS Keychain.".to_owned());
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
            return Err(provider_operation_error(
                status.as_u16(),
                &body,
                "Provider configuration failed",
            ));
        }
        let mut step = parse_provider_config_step(&body)?;
        if !step.error.is_empty() || step.kind == "error" {
            return Err(normalize_provider_config_error(ApiError::Message(
                if step.error.is_empty() {
                    "Provider configuration failed.".to_string()
                } else {
                    std::mem::take(&mut step.error)
                },
            )));
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

        let mut remotes: Vec<ProviderRemote> = raw_remotes
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
                }
            })
            .collect();
        append_external_config_remotes(&mut remotes);

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

fn append_external_config_remotes(remotes: &mut Vec<ProviderRemote>) {
    let existing_names = remotes
        .iter()
        .map(|remote| remote.name.to_lowercase())
        .collect::<std::collections::BTreeSet<_>>();
    for (name, provider_type) in read_standard_rclone_config_remotes() {
        if existing_names.contains(&name.to_lowercase()) {
            continue;
        }
        remotes.push(ProviderRemote {
            name,
            provider_type,
            status_label: "Import required".to_string(),
            needs_reconnect: true,
            error: Some(
                "This remote exists in the user rclone config, but Misty is not using that config. Reconnect or configure it in Misty to import it."
                    .to_string(),
            ),
            config_source: "user".to_string(),
        });
    }
}

fn read_standard_rclone_config_remotes() -> Vec<(String, String)> {
    let Some(path) = standard_rclone_config_path() else {
        return Vec::new();
    };
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };
    parse_rclone_config_sections(&content)
}

fn standard_rclone_config_path() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join(".config").join("rclone").join("rclone.conf"))
}

fn parse_rclone_config_sections(content: &str) -> Vec<(String, String)> {
    let mut remotes = Vec::new();
    let mut current_name = String::new();
    let mut current_type = String::new();
    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if let Some(section) = line
            .strip_prefix('[')
            .and_then(|value| value.strip_suffix(']'))
        {
            if !current_name.is_empty() {
                remotes.push((
                    std::mem::take(&mut current_name),
                    if current_type.is_empty() {
                        "unknown".to_string()
                    } else {
                        std::mem::take(&mut current_type)
                    },
                ));
            }
            current_name = section.trim().to_string();
            current_type.clear();
            continue;
        }
        if current_name.is_empty() {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if key.trim().eq_ignore_ascii_case("type") {
            current_type = value.trim().to_string();
        }
    }
    if !current_name.is_empty() {
        remotes.push((
            current_name,
            if current_type.is_empty() {
                "unknown".to_string()
            } else {
                current_type
            },
        ));
    }
    remotes
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
    let drive_scope = vec![ProviderWorkflowOption {
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
    }];
    vec![
        provider_workflow(
            "alias",
            "Alias",
            "Alias for an existing remote.",
            Vec::new(),
        ),
        provider_workflow(
            "hdfs",
            "HDFS",
            "Hadoop distributed file system.",
            Vec::new(),
        ),
        provider_workflow("local", "Local Disk", "Local disk backend.", Vec::new()),
        provider_workflow(
            "storj",
            "Storj",
            "Storj decentralized cloud storage.",
            Vec::new(),
        ),
        provider_workflow(
            "tardigrade",
            "Tardigrade",
            "Storj decentralized cloud storage.",
            Vec::new(),
        ),
        provider_workflow(
            "cloudinary",
            "Cloudinary",
            "Cloudinary media storage.",
            Vec::new(),
        ),
        provider_workflow("doi", "DOI datasets", "DOI dataset storage.", Vec::new()),
        provider_workflow("fichier", "1Fichier", "1Fichier cloud storage.", Vec::new()),
        provider_workflow("filelu", "FileLu", "FileLu cloud storage.", Vec::new()),
        provider_workflow("filescom", "Files.com", "Files.com storage.", Vec::new()),
        provider_workflow("ftp", "FTP", "FTP server.", Vec::new()),
        provider_workflow("http", "HTTP", "HTTP remote.", Vec::new()),
        provider_workflow(
            "imagekit",
            "ImageKit.io",
            "ImageKit.io storage.",
            Vec::new(),
        ),
        provider_workflow(
            "internetarchive",
            "Internet Archive",
            "Internet Archive storage.",
            Vec::new(),
        ),
        provider_workflow(
            "koofr",
            "Koofr",
            "Koofr, Digi Storage, and Koofr-compatible storage.",
            Vec::new(),
        ),
        provider_workflow("linkbox", "Linkbox", "Linkbox storage.", Vec::new()),
        provider_workflow("mega", "Mega", "Mega cloud storage.", Vec::new()),
        provider_workflow("opendrive", "OpenDrive", "OpenDrive storage.", Vec::new()),
        provider_workflow(
            "pixeldrain",
            "Pixeldrain",
            "Pixeldrain filesystem.",
            Vec::new(),
        ),
        provider_workflow(
            "protondrive",
            "Proton Drive",
            "Proton Drive storage.",
            Vec::new(),
        ),
        provider_workflow("seafile", "Seafile", "Seafile storage.", Vec::new()),
        provider_workflow("sftp", "SFTP", "SSH/SFTP remote.", Vec::new()),
        provider_workflow("sia", "Sia", "Sia decentralized cloud storage.", Vec::new()),
        provider_workflow("smb", "SMB / CIFS", "SMB / CIFS share.", Vec::new()),
        provider_workflow("ulozto", "Uloz.to", "Uloz.to storage.", Vec::new()),
        provider_workflow(
            "azurefiles",
            "Azure Files",
            "Microsoft Azure Files.",
            Vec::new(),
        ),
        provider_workflow(
            "crypt",
            "Crypt",
            "Encrypt or decrypt another remote.",
            Vec::new(),
        ),
        provider_workflow("filen", "Filen", "Filen cloud storage.", Vec::new()),
        provider_workflow("gofile", "Gofile", "Gofile storage.", Vec::new()),
        provider_workflow(
            "iclouddrive",
            "iCloud Drive",
            "iCloud Drive and Photos.",
            Vec::new(),
        ),
        provider_workflow("memory", "Memory", "In-memory object storage.", Vec::new()),
        provider_workflow(
            "netstorage",
            "Akamai NetStorage",
            "Akamai NetStorage.",
            Vec::new(),
        ),
        provider_workflow(
            "qingstor",
            "QingStor",
            "QingCloud Object Storage.",
            Vec::new(),
        ),
        provider_workflow("webdav", "WebDAV", "WebDAV-compatible storage.", Vec::new()),
        provider_workflow(
            "filefabric",
            "Enterprise File Fabric",
            "Enterprise File Fabric.",
            Vec::new(),
        ),
        provider_workflow(
            "azureblob",
            "Azure Blob",
            "Microsoft Azure Blob Storage.",
            Vec::new(),
        ),
        provider_workflow("drime", "Drime", "Drime storage.", Vec::new()),
        provider_workflow("quatrix", "Quatrix", "Quatrix by Maytech.", Vec::new()),
        provider_workflow("shade", "Shade FS", "Shade filesystem.", Vec::new()),
        provider_workflow("b2", "Backblaze B2", "Backblaze B2 storage.", Vec::new()),
        provider_workflow("cache", "Cache", "Cache another remote.", Vec::new()),
        provider_workflow(
            "chunker",
            "Chunker",
            "Transparently chunk or split large files.",
            Vec::new(),
        ),
        provider_workflow(
            "combine",
            "Combine",
            "Combine several remotes into one.",
            Vec::new(),
        ),
        provider_workflow(
            "hasher",
            "Hasher",
            "Better checksums for other remotes.",
            Vec::new(),
        ),
        provider_workflow(
            "oos",
            "Oracle Object Storage",
            "Oracle Cloud Infrastructure Object Storage.",
            Vec::new(),
        ),
        provider_workflow(
            "s3",
            "S3",
            "Amazon S3-compatible object storage.",
            Vec::new(),
        ),
        provider_workflow("sugarsync", "SugarSync", "SugarSync storage.", Vec::new()),
        provider_workflow(
            "swift",
            "OpenStack Swift",
            "OpenStack Swift and compatible cloud files.",
            Vec::new(),
        ),
        provider_workflow(
            "union",
            "Union",
            "Union merges several upstream filesystems.",
            Vec::new(),
        ),
        provider_workflow(
            "compress",
            "Compress",
            "Compress another remote.",
            Vec::new(),
        ),
        provider_workflow(
            "dropbox",
            "Dropbox",
            "Dropbox storage with browser sign-in.",
            Vec::new(),
        ),
        provider_workflow(
            "gphotos",
            "Google Photos",
            "Google Photos storage.",
            Vec::new(),
        ),
        provider_workflow("hidrive", "HiDrive", "HiDrive storage.", Vec::new()),
        provider_workflow(
            "huaweidrive",
            "Huawei Drive",
            "Huawei Drive storage.",
            Vec::new(),
        ),
        provider_workflow(
            "internxt",
            "Internxt Drive",
            "Internxt Drive storage.",
            Vec::new(),
        ),
        provider_workflow(
            "jottacloud",
            "Jottacloud",
            "Jottacloud storage.",
            Vec::new(),
        ),
        provider_workflow(
            "mailru",
            "Mail.ru Cloud",
            "Mail.ru Cloud storage.",
            Vec::new(),
        ),
        provider_workflow("onedrive", "OneDrive", "Microsoft OneDrive.", Vec::new()),
        provider_workflow("pcloud", "pCloud", "pCloud storage.", Vec::new()),
        provider_workflow("pikpak", "PikPak", "PikPak storage.", Vec::new()),
        provider_workflow(
            "premiumizeme",
            "premiumize.me",
            "premiumize.me storage.",
            Vec::new(),
        ),
        provider_workflow("putio", "Put.io", "Put.io storage.", Vec::new()),
        provider_workflow(
            "sharefile",
            "Citrix ShareFile",
            "Citrix ShareFile storage.",
            Vec::new(),
        ),
        provider_workflow("yandex", "Yandex Disk", "Yandex Disk storage.", Vec::new()),
        provider_workflow("zoho", "Zoho", "Zoho storage.", Vec::new()),
        provider_workflow("box", "Box", "Box storage.", Vec::new()),
        provider_workflow(
            "archive",
            "Archive",
            "Read archive files as remotes.",
            Vec::new(),
        ),
        provider_workflow(
            "drive",
            "Google Drive",
            "Google Drive with browser sign-in.",
            drive_scope,
        ),
        provider_workflow(
            "gcs",
            "Google Cloud Storage",
            "Google Cloud Storage.",
            Vec::new(),
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
    response: ProxyResponse,
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

        let body = provider_config_request_body(&request);

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

        assert!(workflows.len() >= 60);
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
        assert!(workflows
            .iter()
            .any(|workflow| workflow.provider_type == "s3"));
        assert!(workflows
            .iter()
            .any(|workflow| workflow.provider_type == "webdav"));
        assert!(workflows
            .iter()
            .any(|workflow| workflow.provider_type == "protondrive"));
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
    fn parses_standard_rclone_config_sections_without_secret_values() {
        let remotes = parse_rclone_config_sections(
            r#"
            # user config
            [temp]
            type = onedrive
            token = {"access_token":"secret"}

            [drop]
            type=dropbox
            client_secret = secret

            [legacy]
            "#,
        );

        assert_eq!(
            remotes,
            vec![
                ("temp".to_string(), "onedrive".to_string()),
                ("drop".to_string(), "dropbox".to_string()),
                ("legacy".to_string(), "unknown".to_string()),
            ],
        );
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
            r#"{"message":"rclone config update failed"}"#,
            "Provider operation failed",
        );
        let ApiError::Message(message) = error else {
            panic!("expected message error");
        };

        assert_eq!(message, "rclone config update failed");
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
