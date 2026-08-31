use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use serde_json::Value;

use crate::infra::{direct_cloud::DirectCloudEngine, environment::AppEnvironmentService};

#[derive(Clone)]
pub struct StorageRuntimeService {
    inner: Arc<StorageRuntimeInner>,
}

struct StorageRuntimeInner {
    call_lock: Mutex<()>,
    jobs: Mutex<HashMap<String, StorageJob>>,
    config_path: PathBuf,
    engine: DirectCloudEngine,
    ready: bool,
    error: Option<String>,
}

#[derive(Debug, Clone)]
struct StorageJob {
    engine_id: i64,
    operation: String,
    remote: String,
    result_kind: Option<String>,
    destination_path: Option<String>,
    provider_type: Option<String>,
    provider_reconnect: bool,
    pending_option_state: Option<String>,
}

const MAX_ACTIVE_JOBS: usize = 4;
const MAX_ACTIVE_JOBS_PER_REMOTE: usize = 2;
const MAX_JOB_HISTORY: usize = 256;
const SUPPORTED_PROVIDERS: [&str; 3] = ["drive", "onedrive", "dropbox"];
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageRuntimeSnapshot {
    pub ready: bool,
    pub error: Option<String>,
    pub version: &'static str,
}

impl StorageRuntimeService {
    pub fn start(environment: &AppEnvironmentService) -> Self {
        let config_dir = environment.home_dir().join(".misty").join("cloud");
        let config_path = config_dir.join("connections.json");
        let startup = (|| -> Result<DirectCloudEngine, String> {
            std::fs::create_dir_all(&config_dir).map_err(|error| {
                format!("Could not create storage configuration directory: {error}")
            })?;
            if !config_path.exists() {
                std::fs::write(&config_path, b"").map_err(|error| {
                    format!("Could not initialize storage configuration: {error}")
                })?;
            }
            DirectCloudEngine::new(config_path.clone())
        })();
        let (engine, ready, error) = match startup {
            Ok(engine) => (engine, true, None),
            Err(error) => (
                DirectCloudEngine::unavailable(config_path.clone()),
                false,
                Some(error),
            ),
        };
        Self {
            inner: Arc::new(StorageRuntimeInner {
                call_lock: Mutex::new(()),
                jobs: Mutex::new(HashMap::new()),
                config_path,
                engine,
                ready,
                error,
            }),
        }
    }

    pub fn snapshot(&self) -> StorageRuntimeSnapshot {
        StorageRuntimeSnapshot {
            ready: self.inner.ready,
            error: self.inner.error.clone(),
            version: "direct-v1",
        }
    }

    pub fn config_path(&self) -> &std::path::Path {
        &self.inner.config_path
    }

    pub fn call(&self, method: &str, input: Value) -> Result<Value, String> {
        if !self.inner.ready {
            return Err(self
                .inner
                .error
                .clone()
                .unwrap_or_else(|| "Storage service is unavailable.".to_owned()));
        }
        let _guard = self
            .inner
            .call_lock
            .lock()
            .map_err(|_| "Storage service call lock is unavailable.".to_owned())?;
        self.inner.engine.call(method, input)
    }

    pub fn invoke(&self, method: &str, params: Value) -> Result<Value, String> {
        match method {
            "remote.health" => self.health(),
            "remote.types" => Ok(serde_json::json!([
                {"type":"drive","name":"Google Drive"},
                {"type":"onedrive","name":"Microsoft OneDrive"},
                {"type":"dropbox","name":"Dropbox"}
            ])),
            "remote.workflows" => self.workflows(),
            "remote.workflow" => {
                let provider_type = string_param(&params, "type")?;
                self.workflows()?
                    .as_array()
                    .and_then(|items| {
                        items.iter().find(|item| {
                            item.get("type").and_then(Value::as_str) == Some(&provider_type)
                        })
                    })
                    .cloned()
                    .ok_or_else(|| "That storage provider is not supported by Misty.".to_owned())
            }
            "remote.list" => self.remotes(),
            "remote.status" => self.remote_statuses(),
            "remote.storage" | "remote.storage.debug" => self.remote_usages(),
            "remote.config.get" => {
                let name = self.allowed_remote_param(&params, "name")?;
                self.call("config/get", serde_json::json!({"name":name}))
            }
            "remote.config.update" => {
                let name = self.allowed_remote_param(&params, "name")?;
                self.call("config/update", serde_json::json!({
                    "name": name,
                    "parameters": params.get("parameters").cloned().unwrap_or_else(|| serde_json::json!({})),
                    "opt": params.get("opt").cloned().unwrap_or_else(|| serde_json::json!({"nonInteractive":true,"continue":true}))
                }))
            }
            "remote.config.paths" => self.call("config/paths", serde_json::json!({})),
            "remote.config.start" => self.start_provider_config(params, false),
            "remote.config.reconnect" | "remote.config.repair" => {
                self.start_provider_config(params, true)
            }
            "remote.config.continue" => self.continue_provider_config(params),
            "remote.delete" => {
                let name = self.allowed_remote_param(&params, "name")?;
                self.call("config/delete", serde_json::json!({"name":name}))?;
                Ok(serde_json::json!({"ok":true}))
            }
            "remote.rename" => self.rename_remote(params),
            "remote.about" => {
                let name = params
                    .get("name")
                    .and_then(Value::as_str)
                    .or_else(|| params.get("fs").and_then(Value::as_str))
                    .unwrap_or_default()
                    .trim_end_matches(':')
                    .to_owned();
                self.ensure_allowed_remote(&name)?;
                self.call(
                    "operations/about",
                    with_no_retry(serde_json::json!({"fs":format!("{name}:")})),
                )
            }
            "remote.file.list" => {
                let remote = self.allowed_remote_param(&params, "remote")?;
                let path = clean_path(
                    params
                        .get("path")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                );
                self.start_job(
                    "operations/list",
                    serde_json::json!({"fs":format!("{remote}:"),"remote":path}),
                    "list",
                    &remote,
                    Some("list"),
                    None,
                )
            }
            "remote.file.size" => {
                let remote = self.allowed_remote_param(&params, "remote")?;
                let path = clean_path(
                    params
                        .get("path")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                );
                self.call(
                    "operations/size",
                    with_no_retry(serde_json::json!({"fs":format!("{remote}:{path}")})),
                )
            }
            "remote.file.upload_from_path" => self.start_upload(params, false),
            "remote.file.upload_directory_from_path" => self.start_upload(params, true),
            "remote.file.download" | "remote.file.download_to_path" => self.start_download(params),
            "remote.file.mkdir" => {
                self.start_simple_remote_job("operations/mkdir", params, "mkdir")
            }
            "remote.file.create" => self.start_create_file(params),
            "remote.file.delete" => self.start_delete(params),
            "remote.file.rename" => self.start_rename(params),
            "remote.file.copy" => self.start_transfer(params, false),
            "remote.file.move" => self.start_transfer(params, true),
            "remote.file.job" => self.job_status(&string_param(&params, "job_id")?),
            "remote.file.job.cancel" => self.cancel_job(&string_param(&params, "job_id")?),
            "remote.file.result.list" => self.job_result(&string_param(&params, "job_id")?, "list"),
            "remote.file.result.download_path" => {
                self.download_result(&string_param(&params, "job_id")?)
            }
            "remote.verify.start" => self.start_verify(params),
            "remote.verify.result" => self.job_result(&string_param(&params, "job_id")?, "verify"),
            "remote.backend.actions" | "remote.backend.run" => {
                Err("Raw storage backend commands are not available in Misty.".to_owned())
            }
            "remote.config.security" => self.call(
                "misty/config-security",
                serde_json::json!({"password_present":params.get("password_present").and_then(Value::as_bool).unwrap_or(false)}),
            ),
            "remote.config.harden" => self.call("misty/config-harden", params),
            _ => Err(format!("Storage method {method} is not supported.")),
        }
    }

    fn health(&self) -> Result<Value, String> {
        let remotes = self.remotes()?.as_array().map_or(0, Vec::len);
        Ok(
            serde_json::json!({"ready":self.inner.ready,"version":"direct-v1","connected_providers":remotes,"available_providers":3}),
        )
    }

    fn config_dump(&self) -> Result<serde_json::Map<String, Value>, String> {
        self.call("config/dump", serde_json::json!({}))?
            .as_object()
            .cloned()
            .ok_or_else(|| "Storage configuration was invalid.".to_owned())
    }

    fn remotes(&self) -> Result<Value, String> {
        let entries = self
            .config_dump()?
            .into_iter()
            .filter_map(|(name, config)| {
                let provider_type = config.get("type").and_then(Value::as_str)?.to_owned();
                supported_provider(&provider_type).then(|| {
                    crate::infra::direct_cloud::configured_remote(name, provider_type, &config)
                })
            })
            .collect::<Vec<_>>();
        Ok(Value::Array(entries))
    }

    fn remote_statuses(&self) -> Result<Value, String> {
        let entries = self
            .config_dump()?
            .into_iter()
            .filter_map(|(name, config)| {
                let provider_type = config.get("type").and_then(Value::as_str)?;
                if !supported_provider(provider_type) {
                    return None;
                }
                let authorized = ["access_token", "token"].iter().any(|key| {
                    config
                        .get(*key)
                        .and_then(Value::as_str)
                        .is_some_and(|value| !value.trim().is_empty())
                });
                Some(serde_json::json!({
                    "name": name,
                    "type": provider_type,
                    "status": if authorized { "connected" } else { "reauthorization_required" },
                    "status_label": if authorized { "Connected" } else { "Sign in required" },
                    "needs_reconnect": !authorized
                }))
            })
            .collect();
        Ok(Value::Array(entries))
    }

    fn remote_usages(&self) -> Result<Value, String> {
        let mut usages = Vec::new();
        for remote in self.remotes()?.as_array().cloned().unwrap_or_default() {
            let Some(name) = remote.get("name").and_then(Value::as_str) else {
                continue;
            };
            match self.call(
                "operations/about",
                with_no_retry(serde_json::json!({"fs":format!("{name}:")})),
            ) {
                Ok(mut usage) => {
                    if let Some(object) = usage.as_object_mut() {
                        object.insert("name".to_owned(), Value::String(name.to_owned()));
                    }
                    usages.push(usage);
                }
                Err(error) => usages.push(serde_json::json!({"name":name,"error":error})),
            }
        }
        Ok(Value::Array(usages))
    }

    fn workflows(&self) -> Result<Value, String> {
        let providers = self.call("config/providers", serde_json::json!({}))?;
        let entries = providers
            .get("providers")
            .or_else(|| providers.get("Providers"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        Ok(Value::Array(
            entries.into_iter().filter_map(provider_workflow).collect(),
        ))
    }

    fn ensure_allowed_remote(&self, name: &str) -> Result<String, String> {
        let name = name.trim().trim_end_matches(':');
        if name.is_empty() {
            return Err("A storage connection is required.".to_owned());
        }
        let config = self.call("config/get", serde_json::json!({"name":name}))?;
        let provider_type = config
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if !supported_provider(provider_type) {
            return Err("That storage provider is not supported by Misty.".to_owned());
        }
        Ok(name.to_owned())
    }

    fn allowed_remote_param(&self, params: &Value, key: &str) -> Result<String, String> {
        self.ensure_allowed_remote(&string_param(params, key)?)
    }

    fn start_provider_config(&self, params: Value, reconnect: bool) -> Result<Value, String> {
        let name = string_param(&params, "name")?;
        self.enforce_job_limit(&name)?;
        let provider_type = if reconnect {
            self.ensure_allowed_remote(&name)?;
            self.call("config/get", serde_json::json!({"name":name}))?
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned()
        } else {
            string_param(&params, "type")?
        };
        if !supported_provider(&provider_type) {
            return Err("That storage provider is not supported by Misty.".to_owned());
        }
        let method = if reconnect {
            "config/update"
        } else {
            "config/create"
        };
        let _ = self.call("misty/authorization-reset", serde_json::json!({}));
        let parameters = provider_parameters(
            &provider_type,
            params
                .get("parameters")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({})),
        )?;
        let payload = serde_json::json!({
            "name":name,"type":provider_type,
            "parameters":parameters,
            "opt":{"nonInteractive":true},"_async":true
        });
        let response = self.call(method, payload)?;
        let engine_id = response
            .get("jobid")
            .and_then(Value::as_i64)
            .ok_or_else(|| "Storage authorization did not start.".to_owned())?;
        let id = uuid::Uuid::new_v4().to_string();
        self.inner
            .jobs
            .lock()
            .map_err(|_| "Storage jobs are unavailable.".to_owned())?
            .insert(
                id.clone(),
                StorageJob {
                    engine_id,
                    operation: "authorize".to_owned(),
                    remote: name.clone(),
                    result_kind: Some("provider".to_owned()),
                    destination_path: None,
                    provider_type: Some(provider_type),
                    provider_reconnect: reconnect,
                    pending_option_state: None,
                },
            );
        Ok(
            serde_json::json!({"kind":"browser_auth","name":name,"state":id,"result":"pending","done":false,"instructions":"Complete sign-in in the browser. Misty will not retry if authorization fails.","poll_after_ms":1000}),
        )
    }

    fn continue_provider_config(&self, params: Value) -> Result<Value, String> {
        let id = string_param(&params, "state")?;
        if params
            .get("result")
            .and_then(Value::as_str)
            .is_some_and(|v| v.eq_ignore_ascii_case("cancel"))
        {
            self.cancel_job(&id)?;
            return Ok(
                serde_json::json!({"kind":"error","state":id,"result":"cancel","done":false,"error":"Provider configuration was canceled."}),
            );
        }
        let session = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "Storage jobs are unavailable.".to_owned())?
            .get(&id)
            .cloned()
            .ok_or_else(|| "Storage authorization session was not found.".to_owned())?;
        let status = self.raw_job_status(&id)?;
        if !status
            .get("finished")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let authorize_url = self.authorization_url();
            return Ok(
                serde_json::json!({"kind":"browser_auth","state":id,"result":"pending","done":false,"authorize_url":authorize_url,"instructions":"Complete sign-in in the browser.","poll_after_ms":1000}),
            );
        }
        if !status
            .get("success")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return Ok(
                serde_json::json!({"kind":"error","state":id,"result":"error","done":false,"error":status.get("error").and_then(Value::as_str).unwrap_or("Provider authorization failed.")}),
            );
        }
        let output = status.get("output").cloned().unwrap_or(Value::Null);
        if let Some(option) = output.get("Option").filter(|value| !value.is_null()) {
            let option_state = output
                .get("State")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let answer = params
                .get("result")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim();
            let answering_pending_option = should_answer_provider_option(
                session.pending_option_state.as_deref(),
                option_state,
                answer,
            );
            if answering_pending_option {
                let provider_type = session
                    .provider_type
                    .as_deref()
                    .ok_or_else(|| "Provider type was not recorded.".to_owned())?;
                let parameters = provider_parameters(
                    provider_type,
                    params
                        .get("parameters")
                        .cloned()
                        .unwrap_or_else(|| serde_json::json!({})),
                )?;
                let method = if session.provider_reconnect {
                    "config/update"
                } else {
                    "config/create"
                };
                let _ = self.call("misty/authorization-reset", serde_json::json!({}));
                let mut request = serde_json::json!({
                    "name":session.remote,"type":provider_type,"parameters":parameters,
                    "opt":{"nonInteractive":true,"continue":true,"state":output.get("State").and_then(Value::as_str).unwrap_or_default(),"result":answer},
                    "_async":true
                });
                if session.provider_reconnect {
                    request.as_object_mut().expect("object").remove("type");
                }
                let response = self.call(method, request)?;
                let engine_id = response
                    .get("jobid")
                    .and_then(Value::as_i64)
                    .ok_or_else(|| {
                        "Storage authorization continuation did not start.".to_owned()
                    })?;
                if let Some(job) = self
                    .inner
                    .jobs
                    .lock()
                    .map_err(|_| "Storage jobs are unavailable.".to_owned())?
                    .get_mut(&id)
                {
                    job.engine_id = engine_id;
                    job.pending_option_state = None;
                }
                return Ok(
                    serde_json::json!({"kind":"browser_auth","state":id,"result":"pending","done":false,"instructions":"Finish the remaining provider configuration.","poll_after_ms":1000}),
                );
            }
            if let Some(job) = self
                .inner
                .jobs
                .lock()
                .map_err(|_| "Storage jobs are unavailable.".to_owned())?
                .get_mut(&id)
            {
                job.pending_option_state = Some(option_state.to_owned());
            }
            return Ok(
                serde_json::json!({"kind":"post_auth_config","state":id,"result":output.get("Result").cloned().unwrap_or(Value::Null),"done":false,"option":normalize_provider_option(option),"instructions":"Choose how this account should be configured."}),
            );
        }
        Ok(serde_json::json!({"kind":"done","state":id,"result":"done","done":true}))
    }

    fn authorization_url(&self) -> Option<String> {
        self.call("misty/authorization-url", serde_json::json!({}))
            .ok()?
            .get("url")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }

    fn rename_remote(&self, params: Value) -> Result<Value, String> {
        let old_name = self.allowed_remote_param(&params, "old_name")?;
        let new_name = string_param(&params, "new_name")?;
        let mut config = self.call("config/get", serde_json::json!({"name":old_name}))?;
        let provider_type = config
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        config.as_object_mut().map(|object| object.remove("type"));
        self.call("config/create", serde_json::json!({"name":new_name,"type":provider_type,"parameters":config,"opt":{"nonInteractive":true}}))?;
        self.call("config/delete", serde_json::json!({"name":old_name}))?;
        Ok(serde_json::json!({"ok":true}))
    }

    fn start_job(
        &self,
        method: &str,
        params: Value,
        operation: &str,
        remote: &str,
        result_kind: Option<&str>,
        destination_path: Option<String>,
    ) -> Result<Value, String> {
        self.enforce_job_limit(remote)?;
        let mut payload = with_no_retry(params);
        payload
            .as_object_mut()
            .expect("object")
            .insert("_async".to_owned(), Value::Bool(true));
        let response = self.call(method, payload)?;
        let engine_id = response
            .get("jobid")
            .and_then(Value::as_i64)
            .ok_or_else(|| "Storage operation did not return a job ID.".to_owned())?;
        let id = uuid::Uuid::new_v4().to_string();
        self.inner
            .jobs
            .lock()
            .map_err(|_| "Storage jobs are unavailable.".to_owned())?
            .insert(
                id.clone(),
                StorageJob {
                    engine_id,
                    operation: operation.to_owned(),
                    remote: remote.to_owned(),
                    result_kind: result_kind.map(ToOwned::to_owned),
                    destination_path,
                    provider_type: None,
                    provider_reconnect: false,
                    pending_option_state: None,
                },
            );
        Ok(serde_json::json!({"job_id":id}))
    }

    fn enforce_job_limit(&self, remote: &str) -> Result<(), String> {
        self.prune_job_history()?;
        let jobs = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "Storage jobs are unavailable.".to_owned())?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let active = jobs
            .into_iter()
            .filter(|job| {
                self.call("job/status", serde_json::json!({"jobid":job.engine_id}))
                    .ok()
                    .is_some_and(|s| !s.get("finished").and_then(Value::as_bool).unwrap_or(false))
            })
            .collect::<Vec<_>>();
        if active.len() >= MAX_ACTIVE_JOBS {
            return Err("Misty already has the maximum number of active storage operations. Wait or cancel one before starting another.".to_owned());
        }
        if active.iter().filter(|job| job.remote == remote).count() >= MAX_ACTIVE_JOBS_PER_REMOTE {
            return Err("This storage connection already has two active operations. Wait or cancel one before starting another.".to_owned());
        }
        Ok(())
    }

    fn prune_job_history(&self) -> Result<(), String> {
        let snapshot = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "Storage jobs are unavailable.".to_owned())?
            .iter()
            .map(|(id, job)| (id.clone(), job.engine_id))
            .collect::<Vec<_>>();
        if snapshot.len() < MAX_JOB_HISTORY {
            return Ok(());
        }
        let mut terminal = Vec::new();
        for (id, engine_id) in snapshot {
            let status = self.call("job/status", serde_json::json!({"jobid":engine_id}));
            if status
                .as_ref()
                .ok()
                .and_then(|value| value.get("finished"))
                .and_then(Value::as_bool)
                .unwrap_or(true)
            {
                terminal.push(id);
            }
        }
        let remove_count = terminal.len().min(MAX_JOB_HISTORY / 2);
        let mut jobs = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "Storage jobs are unavailable.".to_owned())?;
        for id in terminal.into_iter().take(remove_count) {
            jobs.remove(&id);
        }
        Ok(())
    }

    fn start_upload(&self, params: Value, directory: bool) -> Result<Value, String> {
        let remote = self.allowed_remote_param(&params, "remote")?;
        let source = string_param(&params, "source_path")?;
        let parent = clean_path(
            params
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        );
        let name_key = if directory {
            "directory_name"
        } else {
            "file_name"
        };
        let name = params
            .get(name_key)
            .and_then(Value::as_str)
            .filter(|v| !v.trim().is_empty())
            .map(ToOwned::to_owned)
            .or_else(|| {
                std::path::Path::new(&source)
                    .file_name()
                    .map(|v| v.to_string_lossy().into_owned())
            })
            .ok_or_else(|| "Upload name is required.".to_owned())?;
        if directory {
            self.start_job("sync/copy", serde_json::json!({"srcFs":{"type":"local","_root":source},"dstFs":format!("{}:{}",remote,join_path(&parent,&name)),"createEmptySrcDirs":true}), "upload", &remote, None, None)
        } else {
            let path = std::path::Path::new(&source);
            self.start_job("operations/copyfile", serde_json::json!({"srcFs":path.parent().unwrap_or_else(|| std::path::Path::new(".")).display().to_string(),"srcRemote":path.file_name().unwrap_or_default().to_string_lossy(),"dstFs":format!("{remote}:"),"dstRemote":join_path(&parent,&name)}), "upload", &remote, None, None)
        }
    }

    fn start_download(&self, params: Value) -> Result<Value, String> {
        let remote = self.allowed_remote_param(&params, "remote")?;
        let remote_path = clean_path(
            params
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        );
        let destination = params
            .get("destination_path")
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| {
                std::env::temp_dir()
                    .join(format!("misty-download-{}", uuid::Uuid::new_v4()))
                    .display()
                    .to_string()
            });
        let destination_path = std::path::Path::new(&destination);
        if let Some(parent) = destination_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Could not create download directory: {e}"))?;
        }
        self.start_job("operations/copyfile", serde_json::json!({"srcFs":format!("{remote}:"),"srcRemote":remote_path,"dstFs":destination_path.parent().unwrap_or_else(|| std::path::Path::new(".")).display().to_string(),"dstRemote":destination_path.file_name().unwrap_or_default().to_string_lossy()}), "download", &remote, Some("download"), Some(destination))
    }

    fn start_simple_remote_job(
        &self,
        method: &str,
        params: Value,
        operation: &str,
    ) -> Result<Value, String> {
        let remote = self.allowed_remote_param(&params, "remote")?;
        let path = clean_path(
            params
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        );
        self.start_job(
            method,
            serde_json::json!({"fs":format!("{remote}:"),"remote":path}),
            operation,
            &remote,
            None,
            None,
        )
    }

    fn start_create_file(&self, params: Value) -> Result<Value, String> {
        let remote = self.allowed_remote_param(&params, "remote")?;
        let remote_path = clean_path(
            params
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        );
        let staged = std::env::temp_dir().join(format!("misty-empty-{}", uuid::Uuid::new_v4()));
        std::fs::write(&staged, b"")
            .map_err(|error| format!("Could not stage new file: {error}"))?;
        self.start_job("operations/copyfile", serde_json::json!({"srcFs":staged.parent().unwrap().display().to_string(),"srcRemote":staged.file_name().unwrap().to_string_lossy(),"dstFs":format!("{remote}:"),"dstRemote":remote_path}), "create", &remote, None, None)
    }

    fn start_delete(&self, params: Value) -> Result<Value, String> {
        let remote = self.allowed_remote_param(&params, "remote")?;
        let path = clean_path(
            params
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        );
        let stat = self.call("operations/stat", with_no_retry(serde_json::json!({"fs":format!("{remote}:"),"remote":path,"opt":{"filesOnly":false}})))?;
        let is_dir = stat
            .get("item")
            .and_then(|v| v.get("IsDir").or_else(|| v.get("is_dir")))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        self.start_job(
            if is_dir {
                "operations/purge"
            } else {
                "operations/deletefile"
            },
            serde_json::json!({"fs":format!("{remote}:"),"remote":path}),
            "delete",
            &remote,
            None,
            None,
        )
    }

    fn start_rename(&self, params: Value) -> Result<Value, String> {
        let remote = self.allowed_remote_param(&params, "remote")?;
        self.start_job("operations/movefile", serde_json::json!({"srcFs":format!("{remote}:"),"srcRemote":clean_path(params.get("old_path").and_then(Value::as_str).unwrap_or_default()),"dstFs":format!("{remote}:"),"dstRemote":clean_path(params.get("new_path").and_then(Value::as_str).unwrap_or_default())}), "rename", &remote, None, None)
    }

    fn start_transfer(&self, params: Value, moving: bool) -> Result<Value, String> {
        let source = self.allowed_remote_param(&params, "source_remote")?;
        let destination = self.allowed_remote_param(&params, "dest_remote")?;
        let src_path = clean_path(
            params
                .get("source_path")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        );
        let dst_path = clean_path(
            params
                .get("dest_path")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        );
        let stat = self.call("operations/stat", with_no_retry(serde_json::json!({"fs":format!("{source}:"),"remote":src_path,"opt":{"filesOnly":false}})))?;
        let is_dir = stat
            .get("item")
            .and_then(|v| v.get("IsDir").or_else(|| v.get("is_dir")))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let method = if is_dir {
            if moving {
                "sync/move"
            } else {
                "sync/copy"
            }
        } else if moving {
            "operations/movefile"
        } else {
            "operations/copyfile"
        };
        let payload = if is_dir {
            serde_json::json!({"srcFs":format!("{source}:{src_path}"),"dstFs":format!("{destination}:{dst_path}"),"createEmptySrcDirs":true})
        } else {
            serde_json::json!({"srcFs":format!("{source}:"),"srcRemote":src_path,"dstFs":format!("{destination}:"),"dstRemote":dst_path})
        };
        self.start_job(
            method,
            payload,
            if moving { "move" } else { "copy" },
            &source,
            None,
            None,
        )
    }

    fn start_verify(&self, params: Value) -> Result<Value, String> {
        let source = params
            .get("source")
            .ok_or_else(|| "Verification source is required.".to_owned())?;
        let destination = params
            .get("dest")
            .ok_or_else(|| "Verification destination is required.".to_owned())?;
        let (source_fs, source_remote) = self.verification_endpoint(source)?;
        let (destination_fs, destination_remote) = self.verification_endpoint(destination)?;
        let remote = source_remote
            .or(destination_remote)
            .unwrap_or_else(|| "local".to_owned());
        let options = params
            .get("options")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        self.start_job(
            "operations/check",
            serde_json::json!({
                "srcFs":source_fs,
                "dstFs":destination_fs,
                "oneWay":options.get("oneWay").or_else(|| options.get("one_way")).and_then(Value::as_bool).unwrap_or(false),
                "download":options.get("download").and_then(Value::as_bool).unwrap_or(false)
            }),
            "verify",
            &remote,
            Some("verify"),
            None,
        )
    }

    fn verification_endpoint(&self, endpoint: &Value) -> Result<(String, Option<String>), String> {
        let kind = endpoint
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let path = endpoint
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if kind.eq_ignore_ascii_case("remote") {
            let remote = self.ensure_allowed_remote(
                endpoint
                    .get("remote")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )?;
            return Ok((format!("{}:{}", remote, clean_path(path)), Some(remote)));
        }
        if kind.eq_ignore_ascii_case("local") && !path.trim().is_empty() {
            return Ok((
                std::path::Path::new(path).to_string_lossy().into_owned(),
                None,
            ));
        }
        Err("Verification endpoint must be a local path or supported cloud connection.".to_owned())
    }

    fn raw_job_status(&self, id: &str) -> Result<Value, String> {
        let job = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "Storage jobs are unavailable.".to_owned())?
            .get(id)
            .cloned()
            .ok_or_else(|| "Storage job was not found.".to_owned())?;
        self.call("job/status", serde_json::json!({"jobid":job.engine_id}))
    }

    fn job_status(&self, id: &str) -> Result<Value, String> {
        let job = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "Storage jobs are unavailable.".to_owned())?
            .get(id)
            .cloned()
            .ok_or_else(|| "Storage job was not found.".to_owned())?;
        let status = self.call("job/status", serde_json::json!({"jobid":job.engine_id}))?;
        let finished = status
            .get("finished")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let success = status
            .get("success")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        Ok(
            serde_json::json!({"job_id":id,"state":if !finished{"running"}else if success{"succeeded"}else{"failed"},"phase":if finished{"completed"}else{"transferring"},"message":status.get("error").cloned().unwrap_or(Value::Null),"operation":job.operation}),
        )
    }

    fn cancel_job(&self, id: &str) -> Result<Value, String> {
        let job = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "Storage jobs are unavailable.".to_owned())?
            .get(id)
            .cloned()
            .ok_or_else(|| "Storage job was not found.".to_owned())?;
        self.call("job/stop", serde_json::json!({"jobid":job.engine_id}))?;
        Ok(serde_json::json!({"ok":true}))
    }

    fn job_result(&self, id: &str, kind: &str) -> Result<Value, String> {
        let job = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "Storage jobs are unavailable.".to_owned())?
            .get(id)
            .cloned()
            .ok_or_else(|| "Storage job was not found.".to_owned())?;
        if job.result_kind.as_deref() != Some(kind) {
            return Err("Storage job result was not found.".to_owned());
        }
        let status = self.call("job/status", serde_json::json!({"jobid":job.engine_id}))?;
        if !status
            .get("finished")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return Err("Storage job has not finished.".to_owned());
        }
        if !status
            .get("success")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return Err(status
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Storage job failed.")
                .to_owned());
        }
        let output = status.get("output").cloned().unwrap_or(Value::Null);
        if kind == "list" {
            return Ok(output
                .get("list")
                .or_else(|| output.get("List"))
                .cloned()
                .unwrap_or_else(|| Value::Array(Vec::new())));
        }
        Ok(output)
    }

    fn download_result(&self, id: &str) -> Result<Value, String> {
        let job = self
            .inner
            .jobs
            .lock()
            .map_err(|_| "Storage jobs are unavailable.".to_owned())?
            .get(id)
            .cloned()
            .ok_or_else(|| "Storage job was not found.".to_owned())?;
        let status = self.call("job/status", serde_json::json!({"jobid":job.engine_id}))?;
        if !status
            .get("finished")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || !status
                .get("success")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        {
            return Err("Download has not completed successfully.".to_owned());
        }
        Ok(serde_json::json!({"path":job.destination_path}))
    }
}

fn supported_provider(value: &str) -> bool {
    SUPPORTED_PROVIDERS.contains(&value.trim())
}

fn should_answer_provider_option(
    pending_option_state: Option<&str>,
    option_state: &str,
    answer: &str,
) -> bool {
    pending_option_state == Some(option_state) && !answer.is_empty()
}

fn string_param(params: &Value, key: &str) -> Result<String, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("{key} is required"))
}
fn clean_path(value: &str) -> String {
    value.trim().trim_start_matches('/').to_owned()
}
fn join_path(parent: &str, child: &str) -> String {
    if parent.is_empty() {
        child.trim_start_matches('/').to_owned()
    } else {
        format!("{}/{}", parent.trim_matches('/'), child.trim_matches('/'))
    }
}
// These fields are maximum attempt counts in the engine. One means the
// original attempt only; no second attempt is made after a failure.
fn with_no_retry(mut value: Value) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "_config".to_owned(),
            serde_json::json!({"retries":1,"lowLevelRetries":1,"retriesSleep":0}),
        );
    }
    value
}

fn provider_workflow(provider: Value) -> Option<Value> {
    let provider_type = provider
        .get("Prefix")
        .or_else(|| provider.get("Name"))
        .and_then(Value::as_str)?;
    if !supported_provider(provider_type)
        || provider
            .get("Hide")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return None;
    }
    let options = provider
        .get("Options")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|option| normalize_provider_option(&option))
        .collect::<Vec<_>>();
    Some(
        serde_json::json!({"type":provider_type,"name":provider.get("Description").and_then(Value::as_str).unwrap_or(provider_type),"description":provider.get("Description").and_then(Value::as_str).unwrap_or_default(),"options":options}),
    )
}

fn normalize_provider_option(option: &Value) -> Value {
    let choices = option.get("Examples").and_then(Value::as_array).cloned().unwrap_or_default().into_iter().map(|entry| serde_json::json!({"value":entry.get("Value").and_then(Value::as_str).unwrap_or_default(),"help":entry.get("Help").and_then(Value::as_str).unwrap_or_default()})).collect::<Vec<_>>();
    serde_json::json!({"name":option.get("Name").and_then(Value::as_str).unwrap_or_default(),"help":option.get("Help").and_then(Value::as_str).unwrap_or_default(),"default":option.get("DefaultStr").and_then(Value::as_str).unwrap_or_default(),"required":option.get("Required").and_then(Value::as_bool).unwrap_or(false),"password":option.get("IsPassword").and_then(Value::as_bool).unwrap_or(false),"advanced":option.get("Advanced").and_then(Value::as_bool).unwrap_or(false),"choices":choices})
}

fn provider_parameters(provider_type: &str, mut parameters: Value) -> Result<Value, String> {
    let object = parameters
        .as_object_mut()
        .ok_or_else(|| "Provider parameters must be an object.".to_owned())?;
    object
        .entry("config_is_local".to_owned())
        .or_insert_with(|| Value::String("true".to_owned()));
    if provider_type == "drive" {
        object
            .entry("config_change_team_drive".to_owned())
            .or_insert_with(|| Value::String("false".to_owned()));
    }
    let (id_key, secret_key) = match provider_type {
        "drive" => (
            "MISTY_GOOGLE_DRIVE_CLIENT_ID",
            "MISTY_GOOGLE_DRIVE_CLIENT_SECRET",
        ),
        "onedrive" => ("MISTY_ONEDRIVE_CLIENT_ID", "MISTY_ONEDRIVE_CLIENT_SECRET"),
        "dropbox" => ("MISTY_DROPBOX_CLIENT_ID", "MISTY_DROPBOX_CLIENT_SECRET"),
        _ => return Err("That storage provider is not supported by Misty.".to_owned()),
    };
    if object
        .get("client_id")
        .and_then(Value::as_str)
        .is_none_or(|value| value.trim().is_empty())
    {
        if let Ok(value) = std::env::var(id_key) {
            if !value.trim().is_empty() {
                object.insert("client_id".to_owned(), Value::String(value));
            }
        }
    }
    if object
        .get("client_secret")
        .and_then(Value::as_str)
        .is_none_or(|value| value.trim().is_empty())
    {
        if let Ok(value) = std::env::var(secret_key) {
            if !value.trim().is_empty() {
                object.insert("client_secret".to_owned(), Value::String(value));
            }
        }
    }
    Ok(parameters)
}

#[cfg(test)]
mod tests;
