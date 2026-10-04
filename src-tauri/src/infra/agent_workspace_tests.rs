use super::authority::{authorize_scope_state, invalidate_account_leases};
use super::*;
fn fixture() -> WorkspaceState {
    let mut state = WorkspaceState::default();
    state.leases.insert(
        "task-one".into(),
        Lease {
            account: "owner".into(),
            agent: "one".into(),
            window: "worker-one".into(),
            expires: Instant::now() + Duration::from_secs(20),
        },
    );
    state.leases.insert(
        "task-two".into(),
        Lease {
            account: "owner".into(),
            agent: "two".into(),
            window: "worker-two".into(),
            expires: Instant::now() + Duration::from_secs(20),
        },
    );
    state.scopes.insert(
        "notion".into(),
        Scope {
            agent: "one".into(),
            account: "owner".into(),
            window: "worker-one".into(),
            task: "task-one".into(),
        },
    );
    state.scopes.insert(
        "instagram".into(),
        Scope {
            agent: "two".into(),
            account: "owner".into(),
            window: "worker-two".into(),
            task: "task-two".into(),
        },
    );
    state
}
fn personal_request(task: &str, renew: bool) -> LeaseRequest {
    LeaseRequest {
        account_id: "owner".into(),
        agent_id: "one".into(),
        space_id: String::new(),
        task_id: task.into(),
        renew,
    }
}
#[test]
fn revealing_a_worker_requires_the_exact_owner_and_agent() {
    let mut state = fixture();
    state
        .windows
        .insert("owner:one".into(), "worker-one".into());
    state
        .windows
        .insert("other:one".into(), "worker-other".into());
    assert_eq!(
        owned_worker_window(&state, "owner", "one").unwrap(),
        "worker-one"
    );
    assert_eq!(
        owned_worker_window(&state, "other", "one").unwrap(),
        "worker-other"
    );
    assert!(owned_worker_window(&state, "owner", "two").is_err());
    assert!(owned_worker_window(&state, "", "one").is_err());
}
#[test]
fn worker_receipt_is_bound_to_its_window_and_cannot_be_replaced() {
    let mut state = fixture();
    state.receipts.insert(
        "queued".into(),
        WorkerReceipt {
            account: "owner".into(),
            agent: "one".into(),
            window: "worker-one".into(),
            result: None,
        },
    );
    state.pending.insert(
        "owner:one".into(),
        VecDeque::from([serde_json::json!({"queueId":"queued"})]),
    );
    let result = serde_json::json!({"invocationId":"run","taskId":"task-one"});
    assert!(acknowledge_worker(&mut state, "worker-two", "queued", result.clone()).is_err());
    assert!(state.receipts["queued"].result.is_none());
    assert!(acknowledge_worker(&mut state, "worker-one", "queued", result.clone()).is_ok());
    assert!(state.pending["owner:one"].is_empty());
    assert!(acknowledge_worker(
        &mut state,
        "worker-one",
        "queued",
        serde_json::json!({"invocationId":"other"})
    )
    .is_ok());
    assert_eq!(state.receipts["queued"].result, Some(result));
    invalidate_account_leases(&mut state);
    assert!(state.receipts.is_empty());
    assert!(acknowledge_worker(&mut state, "worker-one", "queued", serde_json::json!({})).is_err());
}
#[test]
fn personal_tasks_acquire_and_renew_without_space() {
    let mut state = WorkspaceState::default();
    assert!(acquire_lease(&mut state, "main", personal_request("task", false)).is_ok());
    assert!(acquire_lease(&mut state, "main", personal_request("task", true)).is_ok());
    assert!(acquire_lease(&mut state, "worker", personal_request("other", false)).is_err());
    assert!(acquire_lease(&mut state, "worker", personal_request("task", true)).is_err());
    let mut retarget = personal_request("task", true);
    retarget.space_id = "historical".into();
    assert!(acquire_lease(&mut state, "main", retarget).is_ok());
    let mut retarget = personal_request("task", true);
    retarget.account_id = "other".into();
    assert!(acquire_lease(&mut state, "main", retarget).is_err());
    state.leases.get_mut("task").unwrap().expires = Instant::now() - Duration::from_secs(1);
    assert!(acquire_lease(&mut state, "main", personal_request("task", true)).is_err());
    assert!(acquire_lease(&mut state, "main", personal_request("new", false)).is_ok());
}
#[test]
fn personal_task_still_requires_account_agent_and_task_identity() {
    let mut state = WorkspaceState::default();
    for field in 0..3 {
        let mut request = personal_request("task", false);
        match field {
            0 => request.account_id.clear(),
            1 => request.agent_id.clear(),
            _ => request.task_id.clear(),
        }
        assert!(acquire_lease(&mut state, "main", request).is_err());
    }
    assert!(state.leases.is_empty());
}
#[test]
fn rebound_leases_cannot_exchange_accounts() {
    let mut state = fixture();
    state.leases.get_mut("task-one").unwrap().account = "other".into();
    assert!(authorize_scope_state(&state, "notion", "one", "task-one").is_err());
    assert!(authorize_scope_state(&state, "instagram", "two", "task-two").is_ok());
}
#[test]
fn scoped_authority_denials_identify_the_boundary_without_private_identifiers() {
    let mut state = fixture();
    assert_eq!(
        authorize_scope_state(&state, "notion", "one", "wrong-task").unwrap_err(),
        "agent_task_paused:scope_task_mismatch"
    );
    assert_eq!(
        authorize_scope_state(&state, "notion", "wrong-agent", "task-one").unwrap_err(),
        "agent_task_paused:scope_agent_mismatch"
    );
    state.leases.get_mut("task-one").unwrap().account = "other-account".into();
    assert_eq!(
        authorize_scope_state(&state, "notion", "one", "task-one").unwrap_err(),
        "agent_task_paused:native_lease_owner_mismatch"
    );
    state.leases.get_mut("task-one").unwrap().account = "owner".into();
    state.leases.get_mut("task-one").unwrap().expires = Instant::now() - Duration::from_secs(1);
    assert_eq!(
        authorize_scope_state(&state, "notion", "one", "task-one").unwrap_err(),
        "agent_task_paused:native_lease_expired"
    );
    state.leases.remove("task-one");
    assert_eq!(
        authorize_scope_state(&state, "notion", "one", "task-one").unwrap_err(),
        "agent_task_paused:native_lease_missing"
    );
}
#[test]
fn account_switch_revokes_tasks_without_reviving_legacy_scope_authority() {
    let mut state = fixture();
    assert_eq!(invalidate_account_leases(&mut state).len(), 2);
    assert!(state.leases.is_empty());
    assert!(state.scopes.contains_key("notion"));
    assert!(authorize_scope_state(&state, "notion", "one", "task-one").is_err());
    assert!(authorize_scope_state(&state, "instagram", "two", "task-two").is_err());
}

#[test]
fn acknowledging_a_correction_preserves_independent_queued_tasks() {
    let mut queue = VecDeque::from([
        serde_json::json!({"queueId":"independent"}),
        serde_json::json!({"queueId":"correction"}),
    ]);
    acknowledge(&mut queue, "unknown");
    assert_eq!(queue.len(), 2);
    acknowledge(&mut queue, "correction");
    assert_eq!(queue.len(), 1);
    assert_eq!(queue.front().unwrap()["queueId"], "independent");
}
#[test]
fn parallel_windows_cannot_exchange_authority() {
    let state = fixture();
    assert!(authorize_scope_state(&state, "notion", "one", "task-one").is_ok());
    assert!(authorize_scope_state(&state, "instagram", "two", "task-two").is_ok());
    assert!(authorize_scope_state(&state, "notion", "two", "task-two").is_err());
    assert!(authorize_scope_state(&state, "notion", "one", "task-two").is_err());
}
#[test]
fn cancellation_and_expiry_do_not_fall_back_to_legacy_scope_authority() {
    let mut state = fixture();
    state.leases.remove("task-one");
    assert!(authorize_scope_state(&state, "notion", "one", "task-one").is_err());
    state.leases.get_mut("task-two").unwrap().expires = Instant::now() - Duration::from_secs(1);
    assert!(authorize_scope_state(&state, "instagram", "two", "task-two").is_err());
}
#[test]
fn a_rebound_scope_rejects_pending_actions_from_the_prior_request() {
    let mut state = fixture();
    state.scopes.get_mut("notion").unwrap().task = "replacement".into();
    assert!(authorize_scope_state(&state, "notion", "one", "task-one").is_err());
}
