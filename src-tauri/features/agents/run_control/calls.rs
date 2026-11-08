//! This computer's model calls outside runs, on the crate. The renderer sees the codes and statuses
//! in `DeviceCallFailure`.
use agent_runs::device::DEVICE_CALL_NAMES;
use serde::Serialize;
use serde_json::Value;

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
