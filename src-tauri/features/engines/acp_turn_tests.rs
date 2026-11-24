// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/grok_acp.rs.
use super::*;
use crate::engines::plan_review;
use crate::engines::registry::ChildEntry;
use crate::engines::support::event_sink::{Emit, EventSink};
use crate::engines::ProcessRegistry;
use std::sync::Mutex as StdMutex;

struct CollectingEmitter(StdMutex<Vec<String>>);

impl Emit for CollectingEmitter {
    fn emit_json(&self, _name: &str, raw_json: &str) {
        self.0.lock().unwrap().push(raw_json.to_string());
    }
}

fn test_core() -> (TurnCore, Arc<ProcessRegistry>, Arc<CollectingEmitter>) {
    let emitter = Arc::new(CollectingEmitter(StdMutex::new(Vec::new())));
    let registry = Arc::new(ProcessRegistry::default());
    registry.insert(
        "test-run".to_string(),
        ChildEntry {
            child: None,
            pid: 4_000_000_099,
            run_id: "test-run".to_string(),
            killed: Arc::new(AtomicBool::new(false)),
            reader_abort: Arc::new(std::sync::OnceLock::new()),
            stdin: None,
            questions: Arc::new(StdMutex::new(HashMap::new())),
            plans: Arc::new(StdMutex::new(HashMap::new())),
        },
    );
    let core = TurnCore {
        sink: EventSink::new(emitter.clone()),
        registry: Arc::clone(&registry),
        engine_id: "agy".to_string(),
        run_id: "test-run".to_string(),
        db: None,
        followup: None,
    };
    (core, registry, emitter)
}

fn form_params() -> Value {
    json!({"mode": "form", "toolCallId": "call-1", "message": "The agent has a question.", "requestedSchema": {
        "type": "object", "properties": {"q1": {
            "type": "string", "title": "Which drink?",
            "oneOf": [{"const": "1", "title": "Coffee"}, {"const": "2", "title": "Tea"}]
        }}
    }})
}

#[tokio::test]
async fn parked_form_answers_through_the_registry_context() {
    let (core, registry, emitter) = test_core();
    let mut state = TurnState::new(None);
    assert!(
        super::super::agy::park_question(&core, &mut state, &json!(7), &form_params()).is_none()
    );
    let parked = registry
        .get("test-run")
        .unwrap()
        .questions
        .lock()
        .unwrap()
        .get("7")
        .cloned()
        .expect("the ask stays parked until the user answers");
    assert_eq!(parked["questions"][0]["question"], json!("Which drink?"));
    core.sink.flush();
    let emitted = emitter.0.lock().unwrap().join(" ");
    assert!(emitted.contains("\"question\"") && emitted.contains("\"acp\""));
    let frame = answer_frame(&parked["acp"], Some(&json!({ "Which drink?": "Tea" }))).unwrap();
    assert_eq!(
        frame,
        json!({"jsonrpc": "2.0", "id": 7, "result": {"action": "accept", "content": {"q1": "2"}}})
    );
    let skipped = answer_frame(&parked["acp"], None).unwrap();
    assert_eq!(skipped["result"], json!({"action": "cancel"}));
    let declined =
        super::super::agy::park_question(&core, &mut state, &json!(8), &json!({})).unwrap();
    assert_eq!(declined["result"]["action"], "decline");
    assert_eq!(
        registry
            .get("test-run")
            .unwrap()
            .questions
            .lock()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn answer_frame_needs_the_request_id_and_its_form() {
    assert!(answer_frame(&json!({}), None).is_err());
    assert!(answer_frame(&json!({ "rpcId": 3 }), None).is_err());
}

#[test]
fn usage_preserves_context_occupancy_and_window() {
    assert_eq!(
        usage_update(
            &json!({"update": {"sessionUpdate": "usage_update", "used": 29000, "size": 262144}})
        ),
        Some(json!({"input_tokens": 29000, "used": 29000, "model_context_window": 262144}))
    );
    assert!(usage_update(&json!({"update": {"sessionUpdate": "agent_message_chunk"}})).is_none());
    let empty =
        usage_update(&json!({"update": {"sessionUpdate": "usage_update", "used": 0, "size": 1}}))
            .unwrap();
    assert_eq!(
        crate::engines::bridge::context_usage(&empty),
        (None, Some(1))
    );
}

#[tokio::test]
async fn settle_parked_expires_plan_reviews_under_every_run_key() {
    let dir = std::env::temp_dir().join(format!(
        "ccgui-acp-turn-settle-{}-{}",
        std::process::id(),
        plan_review::now_ms()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let db = crate::engines::support::db::Db::open_at(&dir.join("test.db")).unwrap();
    let review = plan_review::PlanReview {
        plan_id: "plan-1".into(),
        engine: "agy".into(),
        session_id: "s-1".into(),
        workspace_path: "/tmp/ws".into(),
        run_id: Some("test-run".into()),
        revision: 0,
        title: "Plan".into(),
        content: "# Steps".into(),
        content_hash: plan_review::content_hash("# Steps"),
        complete: true,
        review_kind: plan_review::PlanReviewKind::NativeRequest,
        native_plan_id: Some("7".into()),
        exec_permission: "plan".into(),
        status: plan_review::PlanStatus::AwaitingReview,
        execution: plan_review::PlanExecution::NotStarted,
        decision: None,
        decision_intent_at: None,
        applied_at: None,
        created_at: 0,
        updated_at: 0,
        superseded_by: None,
    };
    let revision = plan_review::record_review(&db, &review).unwrap();
    let (mut core, registry, emitter) = test_core();
    core.db = Some(Arc::new(db));
    let mut state = TurnState::new(None);
    registry
        .get("test-run")
        .unwrap()
        .plans
        .lock()
        .unwrap()
        .insert(
            "plan-1".to_string(),
            json!({ "revision": revision, "route": "stdin" }),
        );
    settle_parked(
        &core,
        &mut state,
        [Some("test-run".to_string()), None, None],
    );
    assert!(
        registry
            .get("test-run")
            .unwrap()
            .plans
            .lock()
            .unwrap()
            .is_empty(),
        "the parked context leaves the registry with the run"
    );
    let settled = plan_review::get_review(core.db.as_ref().unwrap(), "plan-1", revision)
        .unwrap()
        .unwrap();
    assert_eq!(settled.status, plan_review::PlanStatus::Expired);
    core.sink.flush();
    let emitted = emitter.0.lock().unwrap().join(" ");
    assert!(emitted.contains("plan_review_settled") && emitted.contains("expired"));
    std::fs::remove_dir_all(&dir).ok();
}

#[tokio::test]
async fn settle_parked_keeps_the_question_contract_and_no_ops_when_empty() {
    let (core, registry, emitter) = test_core();
    let mut state = TurnState::new(None);
    assert!(
        super::super::agy::park_question(&core, &mut state, &json!(7), &form_params()).is_none()
    );
    settle_parked(
        &core,
        &mut state,
        [Some("test-run".to_string()), None, None],
    );
    assert!(
        registry
            .get("test-run")
            .unwrap()
            .questions
            .lock()
            .unwrap()
            .is_empty(),
        "the ask is drained by the settle, not left parked"
    );
    core.sink.flush();
    assert!(emitter
        .0
        .lock()
        .unwrap()
        .join(" ")
        .contains("question_settled"));
    settle_parked(
        &core,
        &mut state,
        [Some("test-run".to_string()), None, None],
    );
}
