//! Runs one tool call in the run, holding device and user-action waits on durable hooks. Every attempt
//! keeps the call's effect identity.
use std::{sync::Arc, time::Instant};

use futures_util::future::BoxFuture;

use super::{
    control_plane::RuntimeIdentity,
    device_hooks::DeviceHooks,
    js_json::JsValue,
    local_tools::{run_local_tool, LocalToolHost},
    logger::Logger,
    tool_errors::classify_tool_transport_error,
    tool_gateway::{GatewayCall, ToolGateway},
    run::step::step,
    runtime_errors::{recoverable_tool_error, rethrow_step_error, RuntimeError, StepFailure},
    tool_execution::{continue_tool_execution, ToolContinuation, ToolExecutionResponse},
    tool_transport::{object, string},
};

/// A wait a call was in when the run last saved, so a restart keeps waiting on the same token.
#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
pub(crate) struct SavedWait {
    pub(crate) attempt: u32,
    /// The intervention's id; `None` for a device wait.
    pub(crate) intervention: Option<String>,
}

/// Where a call records that it's waiting.
pub(crate) trait CallEnvironment: Send + Sync {
    fn waiting<'a>(&'a self, call_id: &'a str, wait: Option<SavedWait>) -> BoxFuture<'a, Result<(), RuntimeError>>;
}

pub(crate) struct ToolCallDeps<'a> {
    pub(crate) identity: &'a RuntimeIdentity,
    pub(crate) gateway: &'a dyn ToolGateway,
    pub(crate) local: Option<&'a dyn LocalToolHost>,
    /// The run's saved turn, which tells a provider's reused call id from a repeat after a restart.
    pub(crate) turn: i64,
    pub(crate) hooks: &'a Arc<DeviceHooks>,
    pub(crate) environment: &'a dyn CallEnvironment,
    pub(crate) logger: &'a Logger,
}

pub(crate) fn device_token(run_id: &str, call_id: &str, attempt: u32) -> String {
    format!("misty-device:{run_id}:{call_id}:wait:{attempt}")
}

struct Continuation<'a> {
    deps: &'a ToolCallDeps<'a>,
    call_id: &'a str,
    name: &'a str,
    input: &'a JsValue,
    resumed: Option<SavedWait>,
    // The intervention the latest answer asked for, for saving its wait.
    intervention: Option<String>,
}

impl Continuation<'_> {
    fn token(&self, attempt: u32) -> String {
        device_token(&self.deps.identity.misty_run_id, self.call_id, attempt)
    }

    async fn wait(&mut self, attempt: u32, intervention: Option<String>) -> Result<bool, RuntimeError> {
        let met_earlier = self.resumed.as_ref().is_some_and(|saved| attempt < saved.attempt);
        // Earlier waits of a resumed call were met, or it wouldn't have gone on.
        if met_earlier {
            return Ok(true);
        }
        let token = self.token(attempt);
        let waiter = self.deps.hooks.create(&token);
        self.deps.environment.waiting(self.call_id, Some(SavedWait { attempt, intervention })).await?;
        let available = waiter.await;
        self.resumed = None;
        self.deps.environment.waiting(self.call_id, None).await?;
        Ok(available)
    }
}

impl ToolContinuation for Continuation<'_> {
    fn request(&mut self, attempt: u32) -> BoxFuture<'_, Result<ToolExecutionResponse, RuntimeError>> {
        Box::pin(async move {
            // A restart skips what the saved wait already went through, and never repeats a request
            // that was answered with that wait.
            if let Some(saved) = self.resumed.as_ref().filter(|saved| attempt <= saved.attempt) {
                return Ok(match saved.intervention.as_ref().filter(|_| attempt == saved.attempt) {
                    Some(id) => {
                        self.intervention = Some(id.clone());
                        ToolExecutionResponse {
                            intervention_wait: Some(object([("id", string(id.as_str())), ("action", string("review")), ("reason", string("resumed"))])),
                            ..ToolExecutionResponse::default()
                        }
                    }
                    None => ToolExecutionResponse { device_wait: Some(JsValue::Bool(true)), ..ToolExecutionResponse::default() },
                });
            }
            let token = self.token(attempt);
            let (deps, call_id, name, input) = (self.deps, self.call_id, self.name, self.input);
            let response = step("requestToolExecution", 2, || {
                let token = token.clone();
                async move { request_tool_execution(deps, call_id, name, input, &token).await }
            })
            .await?;
            self.intervention = response.intervention_wait.as_ref().and_then(|wait| wait.get("id")).and_then(JsValue::as_str).map(str::to_owned);
            Ok(response)
        })
    }

    fn device(&mut self, attempt: u32) -> BoxFuture<'_, Result<bool, RuntimeError>> {
        Box::pin(self.wait(attempt, None))
    }

    // Wake tokens are opaque. Only what's outside the model's reach answers one (`resume_device`).
    fn intervention(&mut self, attempt: u32) -> Option<BoxFuture<'_, Result<bool, RuntimeError>>> {
        let id = self.intervention.take();
        Some(Box::pin(self.wait(attempt, id)))
    }
}

/// `executeTool`. `resumed` is the wait the call was in when the run last saved.
pub(crate) async fn execute_tool(deps: &ToolCallDeps<'_>, call_id: &str, name: &str, input: &JsValue, resumed: Option<SavedWait>) -> Result<JsValue, RuntimeError> {
    let mut continuation = Continuation { deps, call_id, name, input, resumed, intervention: None };
    continue_tool_execution(&mut continuation).await
}

async fn request_tool_execution(deps: &ToolCallDeps<'_>, call_id: &str, name: &str, input: &JsValue, token: &str) -> Result<ToolExecutionResponse, StepFailure> {
    let started = Instant::now();
    let outcome = async {
        let response = match deps.local.filter(|host| host.runs(name)) {
            Some(host) => run_local_tool(host, &deps.identity.misty_run_id, call_id, deps.turn, name, input).await,
            None => deps.gateway.call(GatewayCall { identity: deps.identity, call_id, name, input, device_hook_token: token }).await?,
        };
        // One line per call for timing; never arguments or results.
        let timing = object([
            ("run", string(deps.identity.misty_run_id.as_str())),
            ("call", string(call_id)),
            ("tool", string(name)),
            ("tool_ms", JsValue::Number(started.elapsed().as_millis() as f64)),
        ]);
        deps.logger.line("tool_timing", &timing);
        Ok::<_, RuntimeError>(response)
    }
    .await;
    let error = match outcome {
        Ok(response) => return Ok(response),
        Err(error) => error,
    };
    if let Some(recoverable) = recoverable_tool_error(&error) {
        return Ok(ToolExecutionResponse::tool_error(&recoverable.code, &recoverable.message));
    }
    if let RuntimeError::ControlPlane(failure) = &error {
        if !failure.transient {
            let denied = failure.status == 401 || failure.status == 403;
            return Ok(if denied {
                ToolExecutionResponse::tool_error("permission_denied", "This run is no longer authorized to use that tool.")
            } else {
                ToolExecutionResponse::tool_error("tool_unavailable", "That tool is not available for this run.")
            });
        }
    }
    let failure = classify_tool_transport_error(&error);
    if failure.recognized && !failure.transient {
        return Ok(ToolExecutionResponse::tool_error(failure.code, failure.message));
    }
    Err(rethrow_step_error(error))
}
