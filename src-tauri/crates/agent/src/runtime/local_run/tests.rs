use super::*;

#[derive(Default)]
struct Host {
    events: Mutex<Vec<Value>>,
    unconfirmed: bool,
}

impl LocalRunHost for Host {
    fn publish(&self, _run_id: &str, event: Value) {
        self.events.lock().unwrap().push(event);
    }

    fn has_unconfirmed_effects<'a>(&'a self, _run_id: &'a str) -> BoxFuture<'a, bool> {
        let unconfirmed = self.unconfirmed;
        Box::pin(async move { unconfirmed })
    }
}

struct Planner;

impl RunPlanner for Planner {
    fn context(&self, request: &Value, device: &Value) -> Result<Value, RuntimeError> {
        Ok(json!({ "system": "s", "prompt": request["prompt"], "model": device["model_id"] }))
    }

    fn catalog(&self, _request: &Value) -> Vec<CatalogTool> {
        Vec::new()
    }

    fn notes(&self, _request: &Value, summary: &str, model: &str) -> Option<Value> {
        Some(json!({ "summary": summary, "model": model }))
    }
}

struct Folder(std::path::PathBuf);

impl Drop for Folder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct Fixture {
    _folder: Folder,
    host: Arc<Host>,
    control: LocalControlPlane,
    identity: RuntimeIdentity,
}

fn fixture(unconfirmed: bool) -> Fixture {
    let folder = Folder(std::env::temp_dir().join(format!("misty-local-run-{}", hex::encode(rand::random::<[u8; 8]>()))));
    let host = Arc::new(Host { events: Mutex::default(), unconfirmed });
    let control = LocalControlPlane::new(host.clone(), Arc::new(Planner), &folder.0).unwrap();
    control.save_request("run", json!({ "prompt": "Find joggers" })).unwrap();
    let identity = RuntimeIdentity { misty_run_id: "run".into(), runtime_run_id: "w".into() };
    Fixture { _folder: folder, host, control, identity }
}

impl Fixture {
    async fn ask(&self, action: &'static str, payload: Value) -> Result<Value, RuntimeError> {
        let answer = self.control.request(&self.identity, action, js_of(&payload).unwrap(), "key".into()).await?;
        Ok(value_of(&answer))
    }

    fn kinds(&self) -> Vec<String> {
        self.host.events.lock().unwrap().iter().map(|event| event["type"].as_str().unwrap().to_owned()).collect()
    }
}

#[tokio::test]
async fn activating_tells_the_chat_the_run_started() {
    let run = fixture(false);
    run.ask("activate", json!({})).await.unwrap();
    assert_eq!(run.kinds(), ["invocation.started", "assistant.status"]);
    let events = run.host.events.lock().unwrap();
    assert_eq!(events[0]["id"], "run:1");
    assert_eq!(events[1]["id"], "run:2");
    assert_eq!(events[0]["runId"], "run");
}

#[tokio::test]
async fn the_context_comes_from_the_saved_request() {
    let run = fixture(false);
    let context = run.ask("context", json!({ "model_id": "m" })).await.unwrap();
    assert_eq!(context["prompt"], "Find joggers");
    assert_eq!(context["model"], "m");
}

#[tokio::test]
async fn the_budget_keeps_one_deadline_and_says_what_the_loop_reads() {
    let run = fixture(false);
    let first = run.ask("budget", json!({ "begin": true })).await.unwrap();
    assert_eq!(first["version"], 1);
    assert_eq!(first["active"], true);
    assert!(first["remaining_ms"].as_i64().unwrap() <= EXECUTION_LIMIT_MS);
    let second = run.ask("budget", json!({ "begin": true })).await.unwrap();
    assert_eq!(first["deadline"], second["deadline"]);
    let parsed: crate::runtime::model_budget::ExecutionBudget = serde_json::from_value(first).unwrap();
    assert!(crate::runtime::model_budget::model_timeout(&parsed, now_ms()).is_ok());
}

#[tokio::test]
async fn steering_hands_over_each_message_once_and_stops_when_closed() {
    let run = fixture(false);
    assert!(run.control.steer("run", "Use the blue ones").is_some());
    let answer = run.ask("steering", json!({ "boundary": "b", "close": false })).await.unwrap();
    // The sequence is the id the chat saw, so it can mark that message received.
    assert_eq!(answer["messages"], json!([{ "text": "Use the blue ones", "sequence": "run:1" }]));
    assert_eq!(answer["paused"], false);
    let again = run.ask("steering", json!({ "boundary": "c", "close": true })).await.unwrap();
    assert_eq!(again["messages"], json!([]));
    assert!(run.control.steer("run", "Too late").is_none());
    assert_eq!(run.kinds(), ["user.steering", "steering.received", "steering.closed"]);
}

#[tokio::test]
async fn a_late_message_keeps_a_finishing_run_listening() {
    let run = fixture(false);
    assert!(run.control.steer("run", "One more thing").is_some());
    let answer = run.ask("steering", json!({ "close": true })).await.unwrap();
    assert_eq!(answer["messages"].as_array().unwrap().len(), 1);
    assert!(run.control.steer("run", "And another").is_some());
}

#[tokio::test]
async fn a_paused_run_is_told_at_its_next_boundary() {
    let run = fixture(false);
    run.control.set_paused("run", true);
    assert_eq!(run.ask("steering", json!({})).await.unwrap()["paused"], true);
    run.control.set_paused("run", false);
    assert_eq!(run.ask("steering", json!({})).await.unwrap()["paused"], false);
}

#[tokio::test]
async fn checkpoints_become_the_chats_events() {
    let run = fixture(false);
    run.ask("events", json!({ "node_id": "tool:c", "state": "running", "phase": "using_note_read" })).await.unwrap();
    assert_eq!(run.kinds(), ["assistant.status", "tool.started"]);
}

#[tokio::test]
async fn completing_shows_the_answer_and_clears_the_run() {
    let run = fixture(false);
    run.ask("complete", json!({ "status": "success", "text": "Here.", "title": "Joggers", "summary": "Notes", "model": "m" })).await.unwrap();
    assert_eq!(run.kinds(), ["conversation.title", "conversation.notes", "assistant.message", "invocation.completed"]);
    assert!(run.ask("context", json!({})).await.is_err());
}

#[tokio::test]
async fn an_unknown_write_outcome_ends_the_run_unfinished() {
    let run = fixture(true);
    run.ask("complete", json!({ "status": "success", "text": "Done." })).await.unwrap();
    assert_eq!(run.kinds(), ["assistant.message", "invocation.failed"]);
}

#[tokio::test]
async fn a_proposal_request_hands_the_answer_to_the_app() {
    let run = fixture(false);
    run.control.save_request("run", json!({ "requested_artifact_kind": "text_patch" })).unwrap();
    run.ask("complete", json!({ "status": "success", "text": "{}" })).await.unwrap();
    assert_eq!(run.kinds(), ["local.artifact_answer"]);
}

#[tokio::test]
async fn cancelling_says_so_and_forgets_the_request() {
    let run = fixture(false);
    run.control.cancelled("run");
    assert_eq!(run.kinds(), ["invocation.canceled"]);
    assert!(run.ask("budget", json!({})).await.is_err());
}

#[tokio::test]
async fn a_tool_nobody_runs_is_unavailable_and_goes_nowhere() {
    let run = fixture(false);
    let control = Arc::new(run.control);
    let gateway = LocalGateway { control };
    let input = JsValue::parse("{}").unwrap();
    let response = gateway
        .call(GatewayCall { identity: &run.identity, call_id: "c", name: "x", input: &input, device_hook_token: "t" })
        .await
        .unwrap();
    assert!(response.tool_error.is_some());
}

#[cfg(unix)]
#[test]
fn a_runs_request_is_only_its_owners_to_read() {
    use std::os::unix::fs::PermissionsExt;
    let directory = std::env::temp_dir().join(format!("misty-run-requests-{}", std::process::id()));
    let path = directory.join("run-requests");
    create_private_dir(&path).unwrap();
    assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o700);
    let file = path.join("r.json");
    std::fs::write(&file, b"{}").unwrap();
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
    write_private(&file, b"{\"body\":1}").unwrap();
    assert_eq!(std::fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
    assert_eq!(std::fs::read(&file).unwrap(), b"{\"body\":1}");
    std::fs::remove_dir_all(&directory).unwrap();
}
