use std::{
    collections::HashMap,
    io,
    sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError},
};

use regex::Regex;
use serde_json::Value;
use tokio::task::{AbortHandle, JoinError};

use super::{
    agent_api::{AgentRuntimeOptions, ResumedRuns, RuntimeApiError},
    control_plane::RuntimeIdentity,
    control_plane_steps::{complete, HarnessCompletion},
    device::{DeviceCalls, DeviceModels},
    device_hooks::DeviceHooks,
    device_models::DeviceModelStore,
    js_regex::js_regex,
    local_run::{planner::PromptPlanner, LocalControlPlane, LocalGateway},
    run::{
        deps::{DesktopDevice, DeviceModelAccess, DeviceTurnModels, RunDeps},
        run_start::{identity_of, new_stored},
        space_task_agent::{run_space_task_agent, RunResult},
        store::{LoadedRun, RunStore, StoredRun, UnreadableRun},
    },
    runtime_errors::RuntimeError,
    tool_transport::{object, string},
    web_search::search_step::{SearchEndpoints, WebSearchCache},
};

static RUN_ID: LazyLock<Regex> =
    LazyLock::new(|| js_regex(r"^(?:run|invocation)_[0-9a-f-]{36}$", false));
const FINISHED_KEPT: usize = 1024;

struct RunEntry {
    status: &'static str,
    abort: Option<AbortHandle>,
}

struct Inner {
    deps: Arc<RunDeps>,
    models: Arc<DeviceModelStore>,
    local: Arc<LocalControlPlane>,
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
        locked(&self.runs)
            .get(misty_run_id)
            .is_some_and(|entry| entry.abort.is_some())
    }

    fn settle(&self, misty_run_id: &str, status: &'static str) {
        if let Some(entry) = locked(&self.runs).get_mut(misty_run_id) {
            entry.status = status;
            entry.abort = None;
        }
        let mut order = locked(&self.finished_order);
        order.push(misty_run_id.to_owned());
        if order.len() > FINISHED_KEPT {
            let oldest = order.remove(0);
            let mut runs = locked(&self.runs);
            if runs.get(&oldest).is_some_and(|entry| entry.abort.is_none()) {
                runs.remove(&oldest);
            }
        }
    }

    fn scrubbed(&self, text: &str) -> String {
        self.models.scrubbed(text)
    }

    fn report_route_error(&self, operation: &str, error: &RuntimeError) {
        self.deps.logger.text(&format!(
            "{operation} failed {}",
            self.scrubbed(&error.to_string())
        ));
    }

    fn delete_file(&self, misty_run_id: &str) {
        if let Err(error) = self.deps.store.delete(misty_run_id) {
            self.deps.logger.text(&format!(
                "run_store_delete_failed {} {}",
                misty_run_id,
                error.kind()
            ));
        }
    }

    async fn report_failed(
        &self,
        identity: &RuntimeIdentity,
        code: &str,
        message: &str,
    ) -> Result<(), RuntimeError> {
        let failed = HarnessCompletion::ended("failed", "", code, message);
        complete(
            self.deps.control.as_ref(),
            self.deps.device.as_ref(),
            identity,
            &failed,
            None,
            None,
        )
        .await
    }

    async fn settle_task(
        self: Arc<Self>,
        identity: RuntimeIdentity,
        ended: Result<Result<RunResult, RuntimeError>, JoinError>,
    ) {
        let status = match ended {
            Ok(Ok(_)) => "completed",
            Ok(Err(error)) => {
                self.deps.logger.line(
                    "run_failed",
                    &object([
                        ("run", string(identity.misty_run_id.as_str())),
                        ("error", string(self.scrubbed(&error.to_string()))),
                    ]),
                );
                "failed"
            }
            Err(join) if join.is_panic() => {
                self.deps.logger.line(
                    "run_panicked",
                    &object([("run", string(identity.misty_run_id.as_str()))]),
                );
                if let Err(error) = self
                    .report_failed(
                        &identity,
                        "agent_runtime_failed",
                        "Misty could not complete this request.",
                    )
                    .await
                {
                    self.report_route_error("run panic report", &error);
                }
                "failed"
            }
            Err(_) => return,
        };
        self.delete_file(&identity.misty_run_id);
        self.deps.hooks.forget_run(&identity.misty_run_id);
        self.settle(&identity.misty_run_id, status);
    }

    fn spawn_run(self: &Arc<Self>, stored: StoredRun) {
        let identity = identity_of(&stored);
        let task = tokio::spawn(run_space_task_agent(self.deps.clone(), stored));
        locked(&self.runs).insert(
            identity.misty_run_id.clone(),
            RunEntry {
                status: "running",
                abort: Some(task.abort_handle()),
            },
        );
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
            _ => Err(RuntimeError::error(
                "run_store_failed: the run could not be saved",
            )),
        }
    }

    async fn fail_unreadable(&self, unreadable: UnreadableRun) {
        let UnreadableRun {
            misty_run_id,
            runtime_run_id,
        } = unreadable;
        self.deps.logger.line(
            "run_store_unreadable",
            &object([("run", string(misty_run_id.as_str()))]),
        );
        let Some(runtime_run_id) = runtime_run_id else {
            self.delete_file(&misty_run_id);
            return;
        };
        let identity = RuntimeIdentity {
            misty_run_id: misty_run_id.clone(),
            runtime_run_id,
        };
        match self
            .report_failed(
                &identity,
                "agent_runtime_failed",
                "Misty could not complete this request.",
            )
            .await
        {
            Ok(()) => {
                self.delete_file(&misty_run_id);
                locked(&self.runs).insert(
                    misty_run_id.clone(),
                    RunEntry {
                        status: "failed",
                        abort: None,
                    },
                );
                self.settle(&misty_run_id, "failed");
            }
            Err(error) => self.report_route_error("run store report", &error),
        }
    }
}

impl AgentRuntime {
    pub fn new(options: AgentRuntimeOptions) -> io::Result<Self> {
        let AgentRuntimeOptions {
            data_dir,
            client,
            logger,
            page_reader,
            local_tools,
            run_host,
            before_tool,
        } = options;
        logger.use_for_process();
        let models = Arc::new(DeviceModelStore::default());
        let planner = Arc::new(PromptPlanner {
            models: models.clone(),
        });
        let local = Arc::new(LocalControlPlane::new(run_host, planner, &data_dir)?);
        let device = DesktopDevice {
            models: models.clone(),
            calls: DeviceCalls::new(models.clone() as Arc<dyn DeviceModels>, client.clone()),
        };
        let deps = RunDeps {
            control: local.clone(),
            gateway: Arc::new(LocalGateway {
                control: local.clone(),
            }),
            models: Arc::new(DeviceTurnModels {
                models: models.clone(),
                http: client.clone(),
            }),
            access: Arc::new(DeviceModelAccess {
                models: models.clone(),
                http: client.clone(),
            }),
            device: Arc::new(device),
            hooks: Arc::new(DeviceHooks::default()),
            store: Arc::new(RunStore::open(&data_dir)?),
            logger,
            http: client,
            search_cache: WebSearchCache::default(),
            search_endpoints: SearchEndpoints::default(),
            page_reader,
            local_tools,
            clock: Arc::new(super::clock::now_ms),
            before_tool,
        };
        Ok(Self {
            inner: Arc::new(Inner {
                deps: Arc::new(deps),
                models,
                local,
                runs: Mutex::default(),
                finished_order: Mutex::default(),
            }),
        })
    }

    pub fn device_models(&self) -> Arc<dyn DeviceModels> {
        self.inner.models.clone()
    }

    pub fn set_device_models(&self, value: &Value) -> Result<(), RuntimeApiError> {
        if self.inner.models.set(value) {
            Ok(())
        } else {
            Err(RuntimeApiError::InvalidModels)
        }
    }

    pub async fn start_local(&self, run_id: &str, body: Value) -> Result<(), RuntimeApiError> {
        if !RUN_ID.is_match(run_id) {
            return Err(RuntimeApiError::InvalidRunId);
        }
        if self.inner.live(run_id) {
            return Ok(());
        }
        self.inner
            .local
            .save_request(run_id, body)
            .map_err(|_| RuntimeApiError::WorkflowStartFailed)?;
        let identity = RuntimeIdentity {
            misty_run_id: run_id.to_owned(),
            runtime_run_id: format!("wrun_{}", hex::encode(rand::random::<[u8; 16]>())),
        };
        let stored = self
            .inner
            .save_new(new_stored(&identity))
            .await
            .map_err(|_| RuntimeApiError::WorkflowStartFailed)?;
        self.inner.spawn_run(stored);
        Ok(())
    }

    pub fn steer_local(&self, run_id: &str, text: &str) -> Option<String> {
        if !self.inner.live(run_id) {
            return None;
        }
        self.inner.local.steer(run_id, text)
    }

    pub fn pause_local(&self, run_id: &str, paused: bool) -> bool {
        let live = self.inner.live(run_id);
        if live {
            self.inner.local.set_paused(run_id, paused);
        }
        live
    }

    pub fn cancel_local(&self, run_id: &str) -> Result<(), RuntimeApiError> {
        let mut runs = locked(&self.inner.runs);
        let Some(abort) = runs.get_mut(run_id).and_then(|entry| entry.abort.take()) else {
            return Ok(());
        };
        abort.abort();
        if let Some(entry) = runs.get_mut(run_id) {
            entry.status = "cancelled";
        }
        drop(runs);
        self.inner.delete_file(run_id);
        self.inner.deps.hooks.forget_run(run_id);
        self.inner.settle(run_id, "cancelled");
        self.inner.local.cancelled(run_id);
        Ok(())
    }

    pub fn update_local_contexts(
        &self,
        run_id: &str,
        contexts: Value,
    ) -> Result<(), RuntimeApiError> {
        self.inner
            .local
            .update_contexts(run_id, contexts)
            .map_err(|_| RuntimeApiError::WorkflowStatusUnavailable)
    }

    pub fn local_request(&self, run_id: &str) -> Option<Value> {
        self.inner.local.saved_body(run_id)
    }

    pub fn saved_local_runs(&self) -> Vec<String> {
        self.inner.local.saved_runs()
    }

    pub fn local_run_live(&self, run_id: &str) -> bool {
        self.inner.live(run_id)
    }

    pub fn status(&self, run_id: &str) -> String {
        locked(&self.inner.runs)
            .get(run_id)
            .map_or("missing", |entry| entry.status)
            .to_owned()
    }

    pub fn resume_device(&self, token: &str, available: bool) -> Result<(), RuntimeApiError> {
        if token.is_empty() {
            return Err(RuntimeApiError::InvalidDeviceResume);
        }
        if self
            .inner
            .deps
            .hooks
            .resume(token, available, |run| self.inner.live(run))
        {
            Ok(())
        } else {
            self.inner.deps.logger.text("device resumption failed");
            Err(RuntimeApiError::DeviceResumeFailed)
        }
    }

    pub async fn resume_unfinished(&self) -> io::Result<ResumedRuns> {
        let store = self.inner.deps.store.clone();
        let loaded = tokio::task::spawn_blocking(move || store.load_all())
            .await
            .map_err(io::Error::other)??;
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
