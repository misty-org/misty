use super::*;
use crate::domain::connected_devices::DEVICE_PROTOCOL_VERSION;
use std::sync::atomic::{AtomicUsize, Ordering};

fn claims() -> PeerTicketClaims {
    PeerTicketClaims {
        iss: "misty-api".to_owned(),
        aud: DEVICE_PROTOCOL_VERSION.to_owned(),
        jti: "ticket".to_owned(),
        pair_id: "pair".to_owned(),
        source_device_id: "source-device".to_owned(),
        source_endpoint_id: "source-endpoint".to_owned(),
        target_device_id: "target-device".to_owned(),
        target_endpoint_id: "target-endpoint".to_owned(),
        protocol_version: DEVICE_PROTOCOL_VERSION.to_owned(),
        permissions: Vec::new(),
        iat: unix_now() - 1,
        exp: unix_now() + 60,
    }
}

fn request(request_id: &str) -> OpenWorkspaceRouteRequest {
    OpenWorkspaceRouteRequest {
        request_id: request_id.to_owned(),
        route: "/terminal".to_owned(),
        surface: WorkspaceRouteSurface::Terminal,
        sent_at: chrono::Utc::now().to_rfc3339(),
        source_device_id: "source-device".to_owned(),
        source_device_name: "Misty Laptop".to_owned(),
    }
}

#[test]
fn workspace_routes_validate_and_are_idempotent() {
    let request_id = uuid::Uuid::new_v4().to_string();
    let calls = Arc::new(AtomicUsize::new(0));
    let handler_calls = calls.clone();
    let handler: Arc<RwLock<Option<Arc<dyn Fn(OpenWorkspaceRouteRequest) -> bool + Send + Sync>>>> =
        Arc::new(RwLock::new(Some(Arc::new(move |_| {
            handler_calls.fetch_add(1, Ordering::SeqCst);
            true
        }))));
    let results = Arc::new(Mutex::new(HashMap::new()));

    let first = handle_workspace_route_request(
        &request_id,
        &claims(),
        request(&request_id),
        &handler,
        &results,
    )
    .expect("first route");
    let duplicate = handle_workspace_route_request(
        &request_id,
        &claims(),
        request(&request_id),
        &handler,
        &results,
    )
    .expect("duplicate route");

    assert_eq!(first.status, OpenWorkspaceRouteStatus::Opened);
    assert_eq!(duplicate, first);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn workspace_routes_reject_mismatches_and_expiry() {
    let handler: Arc<RwLock<Option<Arc<dyn Fn(OpenWorkspaceRouteRequest) -> bool + Send + Sync>>>> =
        Arc::new(RwLock::new(Some(Arc::new(|_| true))));
    let results = Arc::new(Mutex::new(HashMap::new()));
    let mismatch_id = uuid::Uuid::new_v4().to_string();
    let mut mismatch = request(&mismatch_id);
    mismatch.route = "/code".to_owned();
    let rejected =
        handle_workspace_route_request(&mismatch_id, &claims(), mismatch, &handler, &results)
            .expect("rejected route");
    assert_eq!(rejected.status, OpenWorkspaceRouteStatus::Rejected);

    let expired_id = uuid::Uuid::new_v4().to_string();
    let mut expired = request(&expired_id);
    expired.sent_at = (chrono::Utc::now() - chrono::Duration::minutes(5)).to_rfc3339();
    let result =
        handle_workspace_route_request(&expired_id, &claims(), expired, &handler, &results)
            .expect("expired route");
    assert_eq!(result.status, OpenWorkspaceRouteStatus::Expired);
}
