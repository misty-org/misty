// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/reader.rs.
//! PlanReviewReady's dispatch contract: stored with a revision, the parked context flat at
//! the top level {revision, route, frames, ...} (as respond_plan_review reads it), no native
//! context in the event payload; a failed store settles as Error and parks nothing.
use super::*;
use crate::engines::ChildEntry;
use std::collections::HashMap;

#[derive(Default)]
struct Collector(Mutex<Vec<Value>>);
impl event_sink::Emit for Collector {
    fn emit_json(&self, _: &str, raw: &str) {
        self.0
            .lock()
            .unwrap()
            .extend(serde_json::from_str::<Vec<Value>>(raw).unwrap());
    }
}

fn ready_core(
    tag: &str,
    drop_table: bool,
) -> (TurnCore, Arc<Collector>, Arc<crate::engines::support::db::Db>) {
    let dir = std::env::temp_dir().join(format!(
        "ccgui-plan-dispatch-{tag}-{}-{}",
        std::process::id(),
        plan_review::now_ms()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let db = Arc::new(crate::engines::support::db::Db::open_at(&dir.join("app.db")).unwrap());
    if drop_table {
        db.0.lock()
            .execute("DROP TABLE cli_plan_reviews", [])
            .unwrap();
    }
    let collector = Arc::new(Collector::default());
    let core = TurnCore {
        sink: event_sink::EventSink::new(collector.clone()),
        registry: Arc::new(ProcessRegistry::default()),
        engine_id: "dsh".into(),
        run_id: "run-plan".into(),
        db: Some(Arc::clone(&db)),
        followup: None,
    };
    core.registry.insert(
        "run-plan".into(),
        ChildEntry {
            child: None,
            pid: 4242,
            run_id: "run-plan".into(),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            reader_abort: Arc::new(std::sync::OnceLock::new()),
            stdin: None,
            questions: Arc::new(Mutex::new(HashMap::new())),
            plans: Arc::new(Mutex::new(HashMap::new())),
        },
    );
    (core, collector, db)
}

fn review(plan_id: &str) -> plan_review::PlanReview {
    plan_review::PlanReview {
        plan_id: plan_id.into(),
        engine: "dsh".into(),
        session_id: "sess-plan".into(),
        workspace_path: "/tmp/ccgui-plan-dispatch-ws".into(),
        run_id: Some("run-plan".into()),
        revision: 0,
        title: "Dispatch plan".into(),
        content: "# Plan\n\nbody".into(),
        content_hash: plan_review::content_hash("# Plan\n\nbody"),
        complete: true,
        review_kind: plan_review::PlanReviewKind::NativeRequest,
        native_plan_id: Some("native-1".into()),
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

#[tokio::test]
async fn plan_review_ready_persists_parks_flat_and_emits_without_context() {
    let (core, collector, db) = ready_core("ok", false);
    let mut state = TurnState::new(Some("sess-plan".into()));
    core.dispatch_event(
        &mut state,
        EngineEvent::PlanReviewReady {
            record: Box::new(review("plan-x")),
            context: serde_json::json!({
                "route": "stdin",
                "frames": {"approve": {"ok": true}},
            }),
        },
    );
    core.sink.flush();

    // Stored: native code assigns the revision.
    let stored = plan_review::get_review(&db, "plan-x", 1)
        .unwrap()
        .expect("record persisted");
    assert_eq!(stored.revision, 1);
    assert_eq!(stored.status, plan_review::PlanStatus::AwaitingReview);

    // Parked: the context flat at the top with the injected revision, for respond to read.
    let entry = core.registry.get("run-plan").unwrap();
    let parked = entry.plans.lock().unwrap().get("plan-x").cloned().unwrap();
    assert_eq!(parked["revision"], 1);
    assert_eq!(parked["route"], "stdin");
    assert!(parked["frames"]["approve"]["ok"].as_bool().unwrap());

    // Event: the camelCase record, never the native reply context.
    let events = collector.0.lock().unwrap();
    let payload = events
        .iter()
        .find(|event| event["kind"].as_str() == Some("plan_review"))
        .expect("plan_review event emitted");
    assert_eq!(payload["data"]["planId"], "plan-x");
    assert_eq!(payload["data"]["revision"], 1);
    assert_eq!(payload["sessionId"], "sess-plan");
    assert!(payload["data"].get("context").is_none(), "{payload}");
    assert!(payload["data"].get("frames").is_none(), "{payload}");
}

#[tokio::test]
async fn a_persistence_failure_settles_as_error_without_parking() {
    let (core, collector, _db) = ready_core("fail", true);
    let mut state = TurnState::new(Some("sess-plan".into()));
    core.dispatch_event(
        &mut state,
        EngineEvent::PlanReviewReady {
            record: Box::new(review("plan-y")),
            context: serde_json::json!({"route": "stdin"}),
        },
    );
    core.sink.flush();

    // The store refuses the write: nothing parked, no plan_review, settled as Error, never
    // pretending the plan can be approved.
    let entry = core.registry.get("run-plan").unwrap();
    assert!(entry.plans.lock().unwrap().is_empty());
    let events = collector.0.lock().unwrap();
    assert!(
        events
            .iter()
            .all(|event| event["kind"].as_str() != Some("plan_review")),
        "{events:?}"
    );
    let error = events
        .iter()
        .find(|event| event["kind"].as_str() == Some("error"))
        .expect("persistence failure surfaces as error");
    assert!(
        error["data"]
            .as_str()
            .unwrap()
            .contains("could not be persisted"),
        "{error}"
    );
}
