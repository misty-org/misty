//! Run grants through the eval bridge (debug builds only): an eval asks this
//! computer to sign the same grants a chat sent from it would carry, so eval
//! runs use it as their device. Signing goes through the one path chats use.
use super::*;
use crate::app::runtime::MistyRuntime;
use crate::devices::commands::jobs::{sign_run_grants, RunGrantRequest};
use tauri::Manager;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunGrants {
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
    let signed = sign_run_grants(&state, body.grants).await;
    reply(
        signed.and_then(|records| serde_json::to_value(records).map_err(|error| error.to_string())),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunRequest {
    run_id: String,
}

/// What a run has said and how it stands, as a window following it reads it.
pub(super) async fn run_follow(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let body = match request::<RunRequest>(&bridge, &headers, &body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    reply(
        crate::agents::run_control::local_runs::read_follow(&bridge.app, &body.run_id)
            .await
            .and_then(|follow| serde_json::to_value(follow).map_err(|error| error.to_string())),
    )
}

/// Every call a run made and what each answered, for the judge's action history.
pub(super) async fn run_record(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let body = match request::<RunRequest>(&bridge, &headers, &body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let store = bridge.app.state::<MistyRuntime>().environment.store();
    let rows = tokio::task::spawn_blocking(move || {
        crate::agents::run_control::tool_journal::run_record(&store, &body.run_id)
    })
    .await
    .map_err(|error| error.to_string());
    reply(rows.map(Value::Array))
}

pub(super) async fn run_cancel(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let body = match request::<RunRequest>(&bridge, &headers, &body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let cancelled =
        crate::agents::run_control::local_runs::cancel_run(&bridge.app, &body.run_id).await;
    reply(cancelled.map(|()| json!({ "ok": true })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FolderChanges {
    key: String,
    scope_id: String,
}

/// Records "Allow changes" as `agents_allow_folder_changes` does after the person says yes, without
/// the native question a test can't click.
pub(super) async fn allow_folder_changes(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let body = match request::<FolderChanges>(&bridge, &headers, &body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let state = bridge.app.state::<MistyRuntime>();
    let done = state
        .agents
        .allow_folder_changes(body.key, body.scope_id)
        .await;
    reply(
        done.map(|()| json!({ "ok": true }))
            .map_err(|error| error.to_string()),
    )
}

#[derive(Deserialize)]
struct ShareFolder {
    path: String,
}

/// Shares a folder as `agents_share_folder` does, without the system picker a test can't click.
pub(super) async fn share_folder(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let body = match request::<ShareFolder>(&bridge, &headers, &body) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let state = bridge.app.state::<MistyRuntime>();
    let shared = state
        .agents
        .share_folder(body.path.into(), &[state.environment.misty_dir()])
        .await;
    reply(shared.map_err(|error| error.to_string()))
}
