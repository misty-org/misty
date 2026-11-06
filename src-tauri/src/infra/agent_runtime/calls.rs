//! The runs the server queues for this computer and its model calls outside runs, on the crate. The
//! renderer and the server see the codes and statuses the runtime's routes answered with
//! (`RuntimeApiError::code`, `DeviceCallFailure`).
use misty_agent::runtime::{
    device::DEVICE_CALL_NAMES, AgentRuntime, RuntimeApiError, StartRequest,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A delivery as the server hands it over (`agent_runtime_device.go`).
#[derive(Deserialize)]
pub struct Delivery {
    pub(super) operation: String,
    pub(super) run_id: String,
    #[serde(default)]
    pub(super) runtime_run_id: String,
    #[serde(default)]
    pub(super) hook_token: String,
    #[serde(default)]
    pub(super) available: bool,
    #[serde(default)]
    pub(super) run_key: String,
    #[serde(default)]
    pub(super) adapter_version: String,
    #[serde(default)]
    pub(super) receipt_callback: String,
}

/// What the runtime did, for the server's finish call.
#[derive(Serialize, Default, Debug, PartialEq)]
pub struct Outcome {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) runtime_run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) error: Option<String>,
}

impl Outcome {
    fn failed(error: RuntimeApiError) -> Self {
        Self {
            error: Some(error.code().to_owned()),
            ..Self::default()
        }
    }

    /// An empty ID had no route to reach on the local server, which answered 404.
    fn no_route() -> Self {
        Self {
            error: Some("agent_runtime_404".to_owned()),
            ..Self::default()
        }
    }
}

/// The server's origin: the runtime calls its run routes at `/internal/agent-runtime/…`.
pub(super) fn origin(server: &str) -> Result<String, String> {
    let url = url::Url::parse(server).map_err(|_| "Invalid API URL")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Invalid API URL".into());
    }
    Ok(url.origin().ascii_serialization())
}

async fn apply(
    runtime: &AgentRuntime,
    delivery: Delivery,
    server: &str,
) -> Result<Outcome, String> {
    let empty_route = |id: &str| id.is_empty().then(Outcome::no_route);
    let outcome =
        match delivery.operation.as_str() {
            "invocation.start" => {
                let started = runtime
                    .start(StartRequest {
                        run_id: delivery.run_id,
                        callback_url: Some(origin(server)?),
                        // Sent as it arrived: only a value the server gave can be checked against this
                        // runtime's version, and an empty one is refused rather than assumed current.
                        adapter_version: Some(delivery.adapter_version),
                        run_key: delivery.run_key,
                        receipt_callback: delivery.receipt_callback,
                    })
                    .await;
                match started {
                    Ok(run) => Outcome {
                        runtime_run_id: Some(run.runtime_run_id),
                        ..Outcome::default()
                    },
                    Err(error) => Outcome::failed(error),
                }
            }
            "runtime.cancel" => empty_route(&delivery.runtime_run_id).unwrap_or_else(|| {
                match runtime.cancel(&delivery.runtime_run_id) {
                    Ok(()) => Outcome::default(),
                    Err(error) => Outcome::failed(error),
                }
            }),
            "runtime.reconcile" => empty_route(&delivery.runtime_run_id).unwrap_or_else(|| {
                match runtime.status(&delivery.runtime_run_id) {
                    Ok(status) => Outcome {
                        status: Some(status),
                        ..Outcome::default()
                    },
                    Err(error) => Outcome::failed(error),
                }
            }),
            "device.resume" | "intervention.resume" => empty_route(&delivery.hook_token)
                .unwrap_or_else(|| {
                    match runtime.resume_device(&delivery.hook_token, delivery.available) {
                        Ok(()) => Outcome::default(),
                        Err(error) => Outcome::failed(error),
                    }
                }),
            _ => return Err("Misty doesn't know this agent runtime delivery.".into()),
        };
    Ok(outcome)
}

/// Hands one delivery to the agent runtime on this computer, starting it when needed.
#[tauri::command]
pub async fn agent_runtime_deliver(
    app: tauri::AppHandle,
    delivery: Delivery,
    server: String,
) -> Result<Outcome, String> {
    #[cfg(debug_assertions)]
    if super::typescript_baseline::selected() {
        return super::typescript_baseline::deliver(&app, &delivery, &server).await;
    }
    let running = super::ensure(&app).await?;
    super::contained(async move { apply(&running.runtime, delivery, &server).await }).await?
}

/// What a device call answered: its status and body, so the renderer can tell a missing key
/// from a provider failure.
#[derive(Serialize)]
pub struct CallReply {
    pub(super) status: u16,
    pub(super) body: Value,
}

/// One model call on this computer's runtime, with this device's models and keys. The body is the
/// renderer's JSON as text, because a run's schema goes to the model in its own key order, and a
/// parsed `Value` would sort it.
#[tauri::command]
pub async fn agent_runtime_call(
    app: tauri::AppHandle,
    name: String,
    body: String,
) -> Result<CallReply, String> {
    if !DEVICE_CALL_NAMES.contains(&name.as_str()) {
        return Err("Misty doesn't know this model call.".into());
    }
    #[cfg(debug_assertions)]
    if super::typescript_baseline::selected() {
        return super::typescript_baseline::call(&app, &name, body).await;
    }
    let running = super::ensure(&app).await?;
    let answered = super::contained(async move { running.calls.device_call(&name, &body).await });
    Ok(match answered.await? {
        Ok(body) => CallReply { status: 200, body },
        Err(failure) => CallReply {
            status: failure.status,
            body: failure.body,
        },
    })
}

#[cfg(test)]
#[path = "calls_tests.rs"]
mod tests;
