//! The runtime's API, called directly by the app where `index.ts` had routes. Each method keeps the
//! checks its route made and answers with the same codes. Runs are tokio tasks: a panic in one fails
//! that run and reports it, and leaves the app and the other runs alone.
use std::{
    collections::HashMap,
    io,
    sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError},
};

use regex::Regex;
use serde_json::Value;
use tokio::task::{AbortHandle, JoinError};

use super::{
    agent_api::{AgentRuntimeOptions, ResumedRuns, RuntimeApiError, StartRequest, StartedRun},
    control_plane::{control_plane_url, ControlPlane, HttpControlPlane, RunKey, RuntimeIdentity},
    control_plane_steps::{complete, HarnessCompletion},
    device::{DeviceCalls, DeviceModels},
    device_hooks::DeviceHooks,
    device_models::DeviceModelStore,
    js_regex::js_regex,
    mcp_runtime::{HttpMcpGateway, McpGateway},
    mcp_sessions::McpSessions,
    run::{
        deps::{DesktopDevice, DeviceModelAccess, DeviceTurnModels, RunDeps},
        run_start::{identity_of, new_stored},
        space_task_agent::{run_space_task_agent, RunResult},
        store::{LoadedRun, RunStore, StoredRun, UnreadableRun},
    },
    runtime_errors::RuntimeError,
    start_receipt::{start_with_receipt, HARNESS_VERSION},
    text::js_len,
    tool_transport::{object, string},
    web_search::search_step::{SearchEndpoints, WebSearchCache},
};

// The opaque prefix tells the server which authorization and data record owns the run; it doesn't
// change execution.
static RUN_ID: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^(?:run|invocation)_[0-9a-f-]{36}$", false));
static RUN_KEY: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^[A-Za-z0-9+/]{43}=$", false));
const FINISHED_KEPT: usize = 1024;

struct RunEntry {
    misty_run_id: String,
    status: &'static str,
    abort: Option<AbortHandle>,
}

struct Inner {
    deps: Arc<RunDeps>,
    models: Arc<DeviceModelStore>,
    internal_api_base: Option<String>,
    runs: Mutex<HashMap<String, RunEntry>>,
    finished_order: Mutex<Vec<String>>,
}

pub struct AgentRuntime {
    inner: Arc<Inner>,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Inner {
    fn live(&self, misty_run_id: &str) -> bool {
        locked(&self.runs).values().any(|entry| entry.misty_run_id == misty_run_id && entry.abort.is_some())
    }

    fn settle(&self, runtime_run_id: &str, status: &'static str) {
        if let Some(entry) = locked(&self.runs).get_mut(runtime_run_id) {
            entry.status = status;
            entry.abort = None;
        }
        // Finished runs are remembered for `status` while the app stays open, up to a point.
        let mut order = locked(&self.finished_order);
        order.push(runtime_run_id.to_owned());
        if order.len() > FINISHED_KEPT {
            let oldest = order.remove(0);
            locked(&self.runs).remove(&oldest);
        }
    }

    fn scrubbed(&self, text: &str) -> String {
        self.models.scrubbed(text)
    }

    fn report_route_error(&self, operation: &str, error: &RuntimeError) {
        self.deps.logger.text(&format!("{operation} failed {}", self.scrubbed(&error.to_string())));
    }

    fn delete_file(&self, misty_run_id: &str) {
        if let Err(error) = self.deps.store.delete(misty_run_id) {
            self.deps.logger.text(&format!("run_store_delete_failed {} {}", misty_run_id, error.kind()));
        }
    }

    /// Reports a run that can't continue: its file doesn't read, or it panicked.
    async fn report_failed(&self, identity: &RuntimeIdentity, code: &str, message: &str) -> Result<(), RuntimeError> {
        let failed = HarnessCompletion::ended("failed", "", code, message);
        complete(self.deps.control.as_ref(), self.deps.device.as_ref(), identity, &failed, None, None).await
    }

    fn forget_run(&self, identity: &RuntimeIdentity) {
        self.deps.hooks.forget_run(&identity.misty_run_id);
        self.deps.gateway.close(identity);
    }

    async fn settle_task(self: Arc<Self>, identity: RuntimeIdentity, ended: Result<Result<RunResult, RuntimeError>, JoinError>) {
        let status = match ended {
            Ok(Ok(_)) => "completed",
            Ok(Err(error)) => {
                self.deps.logger.line("run_failed", &object([("run", string(identity.misty_run_id.as_str())), ("error", string(self.scrubbed(&error.to_string())))]));
                "failed"
            }
            Err(join) if join.is_panic() => {
                // What a panic says can't be trusted to be free of keys, so only that it happened is logged.
                self.deps.logger.line("run_panicked", &object([("run", string(identity.misty_run_id.as_str()))]));
                if let Err(error) = self.report_failed(&identity, "agent_runtime_failed", "Misty could not complete this request.").await {
                    self.report_route_error("run panic report", &error);
                }
                "failed"
            }
            // Cancelled, or the app is closing: the file stays for the next start unless `cancel` took it.
            Err(_) => return,
        };
        self.delete_file(&identity.misty_run_id);
        self.forget_run(&identity);
        self.settle(&identity.runtime_run_id, status);
    }

    fn spawn_run(self: &Arc<Self>, stored: StoredRun) {
        let identity = identity_of(&stored);
        let task = tokio::spawn(run_space_task_agent(self.deps.clone(), stored));
        locked(&self.runs).insert(identity.runtime_run_id.clone(), RunEntry { misty_run_id: identity.misty_run_id.clone(), status: "running", abort: Some(task.abort_handle()) });
        let inner = self.clone();
        tokio::spawn(async move {
            let ended = task.await;
            inner.settle_task(identity, ended).await;
        });
    }

    async fn save_new(&self, stored: StoredRun) -> Result<StoredRun, RuntimeError> {
        let store = self.deps.store.clone();
        let saving = stored.clone();
        let saved = tokio::task::spawn_blocking(move || store.save(&saving)).await;
        match saved {
            Ok(Ok(())) => Ok(stored),
            _ => Err(RuntimeError::error("run_store_failed: the run could not be saved")),
        }
    }

    /// A file that doesn't read fails its run plainly and is reported when its identity can still be
    /// read: the report is signed with the run's own key. A report that didn't arrive keeps the file,
    /// to try again at the next start.
    async fn fail_unreadable(&self, unreadable: UnreadableRun) {
        let UnreadableRun { misty_run_id, runtime_run_id, control_plane_url, run_key } = unreadable;
        self.deps.logger.line("run_store_unreadable", &object([("run", string(misty_run_id.as_str()))]));
        let (Some(runtime_run_id), Some(control_plane_url), Some(run_key)) = (runtime_run_id, control_plane_url, run_key) else {
            self.delete_file(&misty_run_id);
            return;
        };
        let identity = RuntimeIdentity { misty_run_id: misty_run_id.clone(), runtime_run_id: runtime_run_id.clone(), control_plane_url, run_key: RunKey::new(run_key) };
        match self.report_failed(&identity, "agent_runtime_failed", "Misty could not complete this request.").await {
            Ok(()) => {
                self.delete_file(&misty_run_id);
                locked(&self.runs).insert(runtime_run_id.clone(), RunEntry { misty_run_id, status: "failed", abort: None });
                self.settle(&runtime_run_id, "failed");
            }
            Err(error) => self.report_route_error("run store report", &error),
        }
    }
}

impl AgentRuntime {
    pub fn new(options: AgentRuntimeOptions) -> io::Result<Self> {
        let AgentRuntimeOptions { data_dir, client, logger, internal_api_base, before_tool } = options;
        let models = Arc::new(DeviceModelStore::default());
        let control: Arc<dyn ControlPlane> = Arc::new(HttpControlPlane { client: client.clone() });
        let gateway: Arc<dyn McpGateway> = Arc::new(HttpMcpGateway { http: client.clone(), sessions: McpSessions::default() });
        let device = DesktopDevice { models: models.clone(), calls: DeviceCalls::new(models.clone() as Arc<dyn DeviceModels>, client.clone()) };
        let deps = RunDeps {
            control,
            gateway,
            models: Arc::new(DeviceTurnModels { models: models.clone(), http: client.clone() }),
            access: Arc::new(DeviceModelAccess { models: models.clone(), http: client.clone() }),
            device: Arc::new(device),
            hooks: Arc::new(DeviceHooks::default()),
            store: Arc::new(RunStore::open(&data_dir)?),
            logger,
            http: client,
            search_cache: WebSearchCache::default(),
            search_endpoints: SearchEndpoints::default(),
            clock: Arc::new(super::clock::now_ms),
            before_tool,
        };
        Ok(Self { inner: Arc::new(Inner { deps: Arc::new(deps), models, internal_api_base, runs: Mutex::default(), finished_order: Mutex::default() }) })
    }

    /// The device's models, for the app's other model calls.
    pub fn device_models(&self) -> Arc<dyn DeviceModels> {
        self.inner.models.clone()
    }

    /// Replaces the device's models; an empty body clears them.
    pub fn set_device_models(&self, value: &Value) -> Result<(), RuntimeApiError> {
        if self.inner.models.set(value) {
            Ok(())
        } else {
            Err(RuntimeApiError::InvalidModels)
        }
    }

    pub async fn start(&self, request: StartRequest) -> Result<StartedRun, RuntimeApiError> {
        let run_id = request.run_id.trim();
        if !RUN_ID.is_match(run_id) {
            return Err(RuntimeApiError::InvalidRunId);
        }
        if request.adapter_version.as_deref().is_some_and(|version| version != HARNESS_VERSION) {
            return Err(RuntimeApiError::HarnessVersionUnavailable);
        }
        // A start carries the run's own key and the receipt the server pinned for it.
        let run_key = request.run_key.trim();
        let receipt = request.receipt_callback.trim();
        if !RUN_KEY.is_match(run_key) || receipt.is_empty() || js_len(receipt) > 512 {
            return Err(RuntimeApiError::InvalidRunKey);
        }
        let started = self.start_checked(run_id, run_key, receipt, request.callback_url.as_deref()).await;
        match started {
            Ok(runtime_run_id) => Ok(StartedRun { runtime_run_id, adapter_version: HARNESS_VERSION }),
            Err(error) => {
                self.inner.report_route_error("workflow start", &error);
                Err(if error.to_string().starts_with("workflow_start_unconfirmed:") { RuntimeApiError::WorkflowStartUnconfirmed } else { RuntimeApiError::WorkflowStartFailed })
            }
        }
    }

    async fn start_checked(&self, run_id: &str, run_key: &str, receipt: &str, callback: Option<&str>) -> Result<String, RuntimeError> {
        let base = control_plane_url(callback, self.inner.internal_api_base.as_deref())?;
        let identity = RuntimeIdentity { misty_run_id: run_id.to_owned(), runtime_run_id: String::new(), control_plane_url: base, run_key: RunKey::new(run_key.to_owned()) };
        let inner = self.inner.clone();
        start_with_receipt(inner.deps.control.as_ref(), &identity, receipt, || async {
            let runtime_run_id = format!("wrun_{}", hex::encode(rand::random::<[u8; 16]>()));
            let submitted = RuntimeIdentity { runtime_run_id: runtime_run_id.clone(), ..identity.clone() };
            let stored = self.inner.save_new(new_stored(&submitted)).await?;
            self.inner.spawn_run(stored);
            Ok(runtime_run_id)
        })
        .await
    }

    /// `pending`, `running`, `completed`, `failed`, `cancelled` or `missing`. A finished run's status
    /// lasts while the app stays open; after a restart it reads as `missing`.
    pub fn status(&self, runtime_run_id: &str) -> Result<String, RuntimeApiError> {
        if runtime_run_id.is_empty() {
            return Err(RuntimeApiError::InvalidRuntimeRunId);
        }
        Ok(locked(&self.inner.runs).get(runtime_run_id).map_or("missing", |entry| entry.status).to_owned())
    }

    /// Stops a run and takes its file. Cancelling a run again, or one already over, changes nothing.
    pub fn cancel(&self, runtime_run_id: &str) -> Result<(), RuntimeApiError> {
        if runtime_run_id.is_empty() {
            return Err(RuntimeApiError::InvalidRuntimeRunId);
        }
        let mut runs = locked(&self.inner.runs);
        let Some(entry) = runs.get_mut(runtime_run_id) else {
            return Err(RuntimeApiError::WorkflowCancelFailed);
        };
        let Some(abort) = entry.abort.take() else {
            return Ok(());
        };
        abort.abort();
        entry.status = "cancelled";
        let misty_run_id = entry.misty_run_id.clone();
        drop(runs);
        self.inner.delete_file(&misty_run_id);
        self.inner.deps.hooks.forget_run(&misty_run_id);
        self.inner.settle(runtime_run_id, "cancelled");
        Ok(())
    }

    /// Answers a device or user-action wait. A token no live run can answer fails, as a hook gone does.
    pub fn resume_device(&self, token: &str, available: bool) -> Result<(), RuntimeApiError> {
        if token.is_empty() {
            return Err(RuntimeApiError::InvalidDeviceResume);
        }
        if self.inner.deps.hooks.resume(token, available, |run| self.inner.live(run)) {
            Ok(())
        } else {
            self.inner.deps.logger.text("device resumption failed");
            Err(RuntimeApiError::DeviceResumeFailed)
        }
    }

    /// Picks up every run left unfinished when the app last closed. A file that doesn't read fails
    /// only its own run.
    pub async fn resume_unfinished(&self) -> io::Result<ResumedRuns> {
        let store = self.inner.deps.store.clone();
        let loaded = tokio::task::spawn_blocking(move || store.load_all()).await.map_err(io::Error::other)??;
        let mut report = ResumedRuns::default();
        for run in loaded {
            match run {
                LoadedRun::Ready(stored) => {
                    if !self.inner.live(&stored.misty_run_id) {
                        report.resumed.push(stored.misty_run_id.clone());
                        self.inner.spawn_run(*stored);
                    }
                }
                LoadedRun::Unreadable(unreadable) => {
                    report.failed.push(unreadable.misty_run_id.clone());
                    self.inner.fail_unreadable(unreadable).await;
                }
            }
        }
        Ok(report)
    }

    /// Stops every run where it stands. Their files stay, and `resume_unfinished` picks them up.
    pub fn shutdown(&self) {
        for entry in locked(&self.inner.runs).values_mut() {
            if let Some(abort) = entry.abort.take() {
                abort.abort();
            }
        }
        self.inner.deps.store.close();
    }
}

impl Drop for AgentRuntime {
    fn drop(&mut self) {
        self.shutdown();
    }
}
