//! Following and cancelling a run through the bridge (debug builds only), as a window
//! following it does.
use super::*;

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
