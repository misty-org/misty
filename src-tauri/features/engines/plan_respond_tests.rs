// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/mod.rs.
//! Delivery tests for respond_plan_review: approve/request-changes frames really reach the child's
//! stdin, a failed write reverts to awaiting review, a repeated submit conflicts. Parking a context
//! needs the pub(crate) registry insert, so these live in the crate; IPC shape and fail-closed are in
//! tests/plan_review.rs.
use super::*;
use crate::engines::plan_review::{self, PlanDecision, PlanReview};
use serde_json::json;
use std::sync::{Arc, Mutex};
use tauri::Manager;

fn build_state(
    tag: &str,
) -> (
    tauri::App<tauri::test::MockRuntime>,
    Arc<crate::engines::support::db::Db>,
) {
    let app = tauri::test::mock_builder()
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let dir = std::env::temp_dir().join(format!(
        "ccgui-plan-respond-{tag}-{}-{:?}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let db = Arc::new(crate::engines::support::db::Db::open_at(&dir.join("app.db")).unwrap());
    struct Quiet;
    impl crate::engines::support::event_sink::Emit for Quiet {
        fn emit_json(&self, _: &str, _: &str) {}
    }
    app.manage(crate::engines::support::EngineState {
        db: Arc::clone(&db),
        sink: crate::engines::support::event_sink::EventSink::new(Arc::new(Quiet)),
        processes: Arc::new(registry::ProcessRegistry::default()),
        dsh_host: Arc::new(crate::engines::support::dsh_host::DshHostState::default()),
        opencode_server: Arc::new(opencode_server::OpencodeServerState::default()),
    });
    (app, db)
}

fn review(plan_id: &str, session_id: &str) -> PlanReview {
    PlanReview {
        plan_id: plan_id.into(),
        engine: "dsh".into(),
        session_id: session_id.into(),
        workspace_path: "/tmp/ccgui-plan-respond-ws".into(),
        run_id: None,
        revision: 0,
        title: "Test plan".into(),
        content: "# Plan\n\ndo the thing".into(),
        content_hash: plan_review::content_hash("# Plan\n\ndo the thing"),
        complete: true,
        review_kind: plan_review::PlanReviewKind::NativeRequest,
        native_plan_id: Some(format!("native-{plan_id}")),
        exec_permission: "auto".into(),
        status: plan_review::PlanStatus::AwaitingReview,
        execution: plan_review::PlanExecution::NotStarted,
        decision: None,
        decision_intent_at: None,
        applied_at: None,
        created_at: 0,
        updated_at: 0,
        superseded_by: None,
    }
}

/// Parks a native_request context and, optionally, attaches a real stdin.
fn park(
    app: &tauri::App<tauri::test::MockRuntime>,
    key: &str,
    plan_id: &str,
    stdin: Option<Arc<tokio::sync::Mutex<Option<tokio::process::ChildStdin>>>>,
    extra: serde_json::Value,
) {
    let state = app.state::<crate::engines::support::EngineState>();
    let mut parked = json!({
        "revision": 1,
        "route": "stdin",
        "frames": {
            "approve": {"jsonrpc": "2.0", "id": 9, "result": {"outcome": "approved"}},
            "changes": {"jsonrpc": "2.0", "id": 9, "result": {"outcome": "changes", "custom": PLAN_FEEDBACK_PLACEHOLDER}},
        },
    });
    if let Some(obj) = extra.as_object() {
        for (k, v) in obj {
            parked[k] = v.clone();
        }
    }
    let mut plans = std::collections::HashMap::new();
    plans.insert(plan_id.to_string(), parked);
    state.processes.insert(
        key.to_string(),
        registry::ChildEntry {
            child: None,
            pid: 4242,
            run_id: key.to_string(),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            reader_abort: Arc::new(std::sync::OnceLock::new()),
            stdin,
            questions: Arc::new(Mutex::new(std::collections::HashMap::new())),
            plans: Arc::new(Mutex::new(plans)),
        },
    );
}

/// A child that copies stdin to stdout unchanged; stdout goes to a file. Returns (child, stdin,
/// output path). Unix uses `cat`; Windows has no `cat`, and `more` pages and expands tabs. These cases
/// assert the frames the app writes to the native process, and any rewrite would void them, so
/// PowerShell copies the standard streams byte for byte.
fn frame_sink_command() -> tokio::process::Command {
    if cfg!(windows) {
        let mut command = tokio::process::Command::new("powershell");
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Console]::OpenStandardInput().CopyTo([Console]::OpenStandardOutput())",
        ]);
        command
    } else {
        tokio::process::Command::new("cat")
    }
}

fn spawn_frame_sink(
    tag: &str,
) -> (
    tokio::process::Child,
    Arc<tokio::sync::Mutex<Option<tokio::process::ChildStdin>>>,
    std::path::PathBuf,
) {
    let out_path =
        std::env::temp_dir().join(format!("ccgui-plan-frames-{tag}-{}", std::process::id()));
    let out_file = std::fs::File::create(&out_path).unwrap();
    let mut child = frame_sink_command()
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::from(out_file))
        .spawn()
        .unwrap();
    let stdin = Arc::new(tokio::sync::Mutex::new(child.stdin.take()));
    (child, stdin, out_path)
}

async fn drain_frames(
    app: &tauri::App<tauri::test::MockRuntime>,
    key: &str,
    mut child: tokio::process::Child,
    out_path: &std::path::Path,
) -> String {
    let entry = app
        .state::<crate::engines::support::EngineState>()
        .processes
        .get(key)
        .unwrap();
    if let Some(stdin) = entry.stdin {
        *stdin.lock().await = None;
    }
    child.wait().await.unwrap();
    std::fs::read_to_string(out_path).unwrap()
}

#[tokio::test]
async fn approve_delivers_the_native_frame_then_conflicts_on_repeat() {
    let (app, db) = build_state("approve");
    plan_review::record_review(&db, &review("plan-a", "sess-a")).unwrap();
    let (child, stdin, out_path) = spawn_frame_sink("approve");
    park(&app, "sess-a", "plan-a", Some(stdin), json!({}));

    let outcome = respond_plan_review(
        app.state::<crate::engines::support::EngineState>(),
        "plan-a".to_string(),
        1,
        PlanDecision::Approve,
        None,
    )
    .await
    .expect("approve must apply");
    let PlanRespondOutcome::Applied { review } = outcome else {
        panic!("approve must apply, got {outcome:?}");
    };
    assert_eq!(review.status, plan_review::PlanStatus::Approved);
    assert_eq!(review.execution, plan_review::PlanExecution::Starting);

    let written = drain_frames(&app, "sess-a", child, &out_path).await;
    assert!(written.contains("\"outcome\":\"approved\""), "{written}");

    // The parked context was removed; submitting the same revision again conflicts instead of running twice.
    let entry = app
        .state::<crate::engines::support::EngineState>()
        .processes
        .get("sess-a")
        .unwrap();
    assert!(entry.plans.lock().unwrap().is_empty());
    let again = respond_plan_review(
        app.state::<crate::engines::support::EngineState>(),
        "plan-a".to_string(),
        1,
        PlanDecision::Approve,
        None,
    )
    .await
    .expect("repeat respond must not error");
    assert!(
        matches!(again, PlanRespondOutcome::Conflict { .. }),
        "double submit must conflict: {again:?}"
    );
}

#[tokio::test]
async fn request_changes_substitutes_feedback_into_the_frame() {
    let (app, db) = build_state("changes");
    plan_review::record_review(&db, &review("plan-b", "sess-b")).unwrap();
    let (child, stdin, out_path) = spawn_frame_sink("changes");
    park(&app, "sess-b", "plan-b", Some(stdin), json!({}));

    let outcome = respond_plan_review(
        app.state::<crate::engines::support::EngineState>(),
        "plan-b".to_string(),
        1,
        PlanDecision::RequestChanges,
        Some("Narrow the scope, leave the auth module alone".to_string()),
    )
    .await
    .expect("changes must apply");
    let PlanRespondOutcome::Applied { review } = outcome else {
        panic!("changes must apply, got {outcome:?}");
    };
    assert_eq!(review.status, plan_review::PlanStatus::ChangesRequested);

    let written = drain_frames(&app, "sess-b", child, &out_path).await;
    assert!(
        written.contains("Narrow the scope, leave the auth module alone"),
        "{written}"
    );
    assert!(!written.contains(PLAN_FEEDBACK_PLACEHOLDER), "{written}");
}

#[tokio::test]
async fn a_closed_stdin_reverts_to_pending_and_keeps_the_intent() {
    let (app, db) = build_state("revert");
    plan_review::record_review(&db, &review("plan-c", "sess-c")).unwrap();
    // stdin is closed: the write fails, so an approval never reads as success.
    park(
        &app,
        "sess-c",
        "plan-c",
        Some(Arc::new(tokio::sync::Mutex::new(None))),
        json!({}),
    );

    let result = respond_plan_review(
        app.state::<crate::engines::support::EngineState>(),
        "plan-c".to_string(),
        1,
        PlanDecision::Approve,
        None,
    )
    .await;
    let Err(message) = result else {
        panic!("a closed stdin must fail the respond");
    };
    assert!(message.contains("NOT delivered"), "{message}");

    let reverted = plan_review::get_review(&db, "plan-c", 1).unwrap().unwrap();
    assert_eq!(reverted.status, plan_review::PlanStatus::AwaitingReview);
    assert_eq!(reverted.execution, plan_review::PlanExecution::NotStarted);
    assert!(reverted.decision_intent_at.is_some());
    assert!(reverted.applied_at.is_none());
    // The parked context stays, so the person can retry.
    let entry = app
        .state::<crate::engines::support::EngineState>()
        .processes
        .get("sess-c")
        .unwrap();
    assert!(entry.plans.lock().unwrap().contains_key("plan-c"));
}

#[tokio::test]
async fn a_changed_body_expires_the_revision_instead_of_executing() {
    let (app, db) = build_state("stale-body");
    plan_review::record_review(&db, &review("plan-d", "sess-d")).unwrap();
    let (_child, stdin, _out) = spawn_frame_sink("stale-body");
    // The body hash recorded with the parked context differs from the stored record: the body changed
    // during review, so expire first and ask for a fresh review, never running with the old body.
    park(
        &app,
        "sess-d",
        "plan-d",
        Some(stdin),
        json!({"contentHash": "different-hash"}),
    );

    let result = respond_plan_review(
        app.state::<crate::engines::support::EngineState>(),
        "plan-d".to_string(),
        1,
        PlanDecision::Approve,
        None,
    )
    .await;
    let Err(message) = result else {
        panic!("a changed body must not execute");
    };
    assert!(message.contains("expired"), "{message}");
    let expired = plan_review::get_review(&db, "plan-d", 1).unwrap().unwrap();
    assert_eq!(expired.status, plan_review::PlanStatus::Expired);
}
