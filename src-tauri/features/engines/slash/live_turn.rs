use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use serde_json::Value;

use crate::engines::gate::{self, Decision};
use crate::engines::support::event_sink::{Emit, ENGINE_EVENT_NAME};
use crate::engines::support::{self, EngineState};

static EVENTS: LazyLock<Mutex<Vec<Value>>> = LazyLock::new(Default::default);
static ALLOW: AtomicBool = AtomicBool::new(false);

struct Collect;

impl Emit for Collect {
    fn emit_json(&self, name: &str, raw_json: &str) {
        if name != ENGINE_EVENT_NAME {
            return;
        }
        let Ok(Value::Array(batch)) = serde_json::from_str::<Value>(raw_json) else {
            return;
        };
        EVENTS.lock().unwrap().extend(batch);
    }
}

pub(super) fn engines(allow: bool) -> &'static EngineState {
    ALLOW.store(allow, Ordering::SeqCst);
    if let Some(state) = support::state() {
        return state;
    }
    let root = tempfile::tempdir().expect("a scratch folder").keep();
    let store = database::store::Store::at(root.join("misty.db"));
    EngineState::open(&store, &root, Arc::new(Collect)).expect("the engine layer opens");
    gate::install(|run, tool, _input| {
        Box::pin(async move {
            let allow = ALLOW.load(Ordering::SeqCst);
            println!(
                "  gate: {tool} on {run} -> {}",
                if allow { "allow" } else { "deny" }
            );
            if allow {
                Decision::Allow
            } else {
                Decision::Deny("Denied by Misty's live test.".into())
            }
        })
    });
    support::state().expect("the engine state")
}

pub(super) async fn send(
    engine: &str,
    folder: &Path,
    session: Option<&str>,
    prompt: &str,
    model: &str,
    effort: Option<&str>,
    permission: &str,
) -> String {
    let state = support::state().expect("engines() first");
    let sent = crate::engines::send_message_inner(
        state,
        engine.to_string(),
        folder.to_string_lossy().into_owned(),
        session.map(str::to_string),
        prompt.to_string(),
        Vec::new(),
        None,
        Some(model.to_string()),
        effort.map(str::to_string),
        Some(permission.to_string()),
        None,
        None,
        None,
        None,
        crate::engines::LaunchExtras::default(),
    )
    .await
    .expect("the send starts");
    println!("run {} started", sent.run_id);
    sent.run_id
}

pub(super) fn events(run: &str) -> Vec<(String, Value)> {
    EVENTS
        .lock()
        .unwrap()
        .iter()
        .filter(|event| event["runId"] == run)
        .map(|event| {
            let kind = event["kind"].as_str().unwrap_or_default().to_string();
            (kind, event["data"].clone())
        })
        .collect()
}

pub(super) fn print(run: &str) {
    let mut text = String::new();
    for (kind, data) in events(run) {
        if kind == "delta" {
            text.push_str(data.as_str().unwrap_or_default());
            continue;
        }
        if !text.is_empty() {
            println!("  [text] {}", std::mem::take(&mut text));
        }
        let shown: String = data.to_string().chars().take(400).collect();
        println!("  [{kind}] {shown}");
    }
    if !text.is_empty() {
        println!("  [text] {text}");
    }
}

pub(super) async fn wait_for(
    run: &str,
    limit: Duration,
    what: &str,
    ready: impl Fn(&[(String, Value)]) -> bool,
) -> Vec<(String, Value)> {
    let deadline = tokio::time::Instant::now() + limit;
    loop {
        let seen = events(run);
        if ready(&seen) {
            return seen;
        }
        if tokio::time::Instant::now() >= deadline {
            print(run);
            panic!("timed out waiting for {what}");
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

pub(super) fn settled(events: &[(String, Value)]) -> bool {
    events
        .iter()
        .any(|(kind, _)| kind == "done" || kind == "error")
}

pub(super) fn session_of(events: &[(String, Value)]) -> Option<String> {
    events
        .iter()
        .rev()
        .find(|(kind, _)| kind == "session")
        .and_then(|(_, data)| data.as_str())
        .map(str::to_string)
}
