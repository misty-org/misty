//! Run grants through the eval bridge (debug builds only): the workflow eval
//! (server/apps/agent-runtime/evals/workflows) asks this computer to sign the
//! same grants a chat sent from it would carry, so eval runs use it as their
//! device. Signing goes through the one path chats use.
use super::*;
use crate::app::device_job_commands::{sign_run_grants, RunGrantRequest};
use crate::app::runtime::MistyRuntime;
use tauri::Manager;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunGrants {
    api_base: String,
    account_id: String,
    grants: Vec<RunGrantRequest>,
}

pub(super) async fn run_grants(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let body = match request::<RunGrants>(&bridge, &headers, &body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let state = bridge.app.state::<MistyRuntime>();
    let signed = sign_run_grants(&state, &body.api_base, &body.account_id, body.grants).await;
    reply(signed.and_then(|records| serde_json::to_value(records).map_err(|error| error.to_string())))
}
