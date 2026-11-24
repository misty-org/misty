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

fn ask_params() -> Value {
    json!({
        "sessionId": "s-1",
        "toolCallId": "call-1",
        "questions": [{
            "question": "Which drink?",
            "options": [
                { "label": "Coffee", "description": "Espresso" },
                { "label": "Tea", "description": "Green tea" },
            ],
            "multiSelect": null,
        }],
        "mode": "default",
    })
}

#[test]
fn normalizes_questions_onto_the_card_contract() {
    let questions = normalize_questions(&ask_params());
    assert_eq!(
        questions,
        vec![json!({
            "question": "Which drink?",
            "header": "Q1",
            "multiSelect": false,
            "options": [
                { "label": "Coffee", "description": "Espresso" },
                { "label": "Tea", "description": "Green tea" },
            ],
        })]
    );
    let questions = normalize_questions(&json!({
        "questions": [
            { "question": "a", "header": " Scope ", "multiSelect": true, "options": [] },
            { "question": "b" },
        ]
    }));
    assert_eq!(questions[0]["header"], json!("Scope"));
    assert_eq!(questions[0]["multiSelect"], json!(true));
    assert_eq!(questions[1]["header"], json!("Q2"));
    assert_eq!(questions[1]["options"], json!([]));
    assert!(normalize_questions(&json!({})).is_empty());
}

#[test]
fn answer_frame_round_trips_the_request_id() {
    let parked = json!({ "rpcId": 7 });
    let answers = json!({ "Which drink?": "Coffee" });
    assert_eq!(
        answer_frame(&parked, Some(&answers)).unwrap(),
        json!({
            "jsonrpc": "2.0",
            "id": 7,
            "result": { "outcome": "accepted", "answers": { "Which drink?": "Coffee" } },
        })
    );
    let parked = json!({ "rpcId": "req-9" });
    let answers = json!({ "Which drinks?": ["Coffee", "Tea"] });
    let frame = answer_frame(&parked, Some(&answers)).unwrap();
    assert_eq!(frame["id"], json!("req-9"));
    assert_eq!(
        frame["result"]["answers"]["Which drinks?"],
        json!(["Coffee", "Tea"])
    );
    let frame = answer_frame(&json!({ "rpcId": 1 }), Some(&json!({}))).unwrap();
    assert_eq!(
        frame["result"],
        json!({ "outcome": "accepted", "answers": {} })
    );
}

#[test]
fn answer_frame_dismisses_and_rejects_malformed_answers() {
    let parked = json!({ "rpcId": 3 });
    assert_eq!(
        answer_frame(&parked, None).unwrap(),
        json!({ "jsonrpc": "2.0", "id": 3, "result": { "outcome": "cancelled" } })
    );
    assert!(answer_frame(&json!({}), None).is_err());
    assert!(answer_frame(&json!({ "rpcId": 3 }), Some(&json!(["Coffee"]))).is_err());
    assert!(answer_frame(&parked, Some(&json!({ "Which drink?": 2 }))).is_err());
    assert!(answer_frame(&parked, Some(&json!({ "Which drink?": [1] }))).is_err());
}

#[tokio::test]
async fn grok_question_answers_through_the_registry_context() {
    let (mut core, registry, emitter) = test_core();
    core.engine_id = "grok".into();
    let mut state = TurnState::new(None);
    assert!(park_question(&core, &mut state, &json!(7), &ask_params()).is_none());
    let parked = registry
        .get("test-run")
        .unwrap()
        .questions
        .lock()
        .unwrap()
        .get("7")
        .cloned()
        .expect("the ask stays parked until the user answers");
    assert_eq!(
        parked["questions"],
        json!(normalize_questions(&ask_params()))
    );
    core.sink.flush();
    let emitted = emitter.0.lock().unwrap().join(" ");
    assert!(emitted.contains("\"question\"") && emitted.contains("\"acp\""));
    let frame = answer_frame(&parked["acp"], Some(&json!({ "Which drink?": "Tea" }))).unwrap();
    assert_eq!(frame["id"], json!(7));
    assert_eq!(frame["result"]["answers"]["Which drink?"], json!("Tea"));
    assert!(park_question(&core, &mut state, &json!(8), &json!({ "questions": [] })).is_some());
}

#[tokio::test]
async fn kimi_form_parks_all_questions_with_reply_context() {
    let (mut core, registry, emitter) = test_core();
    core.engine_id = "kimi".into();
    let mut state = TurnState::new(None);
    let params = json!({"mode": "form", "toolCallId": "ask-1", "message": "选哪种？", "requestedSchema": {
        "required": ["q0"], "properties": {"q0": {
            "type": "string", "title": "选择", "oneOf": [{"const": "A"}, {"const": "B"}]
        }}
    }});
    assert!(super::super::kimi_acp::park_question(&core, &mut state, &json!(8), &params).is_none());
    let entry = registry.get("test-run").unwrap();
    let parked = entry.questions.lock().unwrap()["8"].clone();
    assert_eq!(parked["questions"][0]["allowOther"], false);
    let frame =
        super::super::kimi_acp::answer_frame(&parked["kimiAcp"], Some(&json!({"选哪种？": "B"})))
            .unwrap();
    assert_eq!(frame["result"]["content"], json!({"q0": "B"}));
    core.sink.flush();
    assert!(emitter.0.lock().unwrap().join(" ").contains("kimiAcp"));
    let decline =
        super::super::kimi_acp::park_question(&core, &mut state, &json!(9), &json!({})).unwrap();
    assert_eq!(decline["result"]["action"], "decline");
    assert_eq!(entry.questions.lock().unwrap().len(), 1);
}

#[test]
fn session_id_comes_from_the_handshake_shape_grok_returns() {
    assert_eq!(
        extract_session_id(&json!({ "sessionId": "s-new", "models": {} })),
        Some("s-new".to_string())
    );
    assert_eq!(
        extract_session_id(&json!({ "_meta": { "sessionId": "s-loaded" } })),
        Some("s-loaded".to_string())
    );
    assert_eq!(extract_session_id(&json!({ "session_id": " " })), None);
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
