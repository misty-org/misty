//! One real chat turn on Misty's own path, for the ignored live tests of the slash commands
//! that act on a turn's process or thread (`/tasks`, `/approve`): `send_message_inner`, the
//! engine's adapter, and its reader or app-server driver, as a chat's send runs them. The
//! engine events land here instead of in the run bridge.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use serde_json::Value;

use crate::engines::gate::{self, Decision};
use crate::engines::support::event_sink::{Emit, ENGINE_EVENT_NAME};
use crate::engines::support::{self, EngineState};

/// Every engine event of every run, in the order the sink flushed them.
static EVENTS: LazyLock<Mutex<Vec<Value>>> = LazyLock::new(Default::default);
/// What Misty's gate answers every permission ask an engine raises in these tests.
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

/// The engine layer, opened once for the test binary on a scratch database, as the app opens
/// it. Its gate answers every ask with `allow`, so a test decides what an engine may do
/// without a person to ask.
pub(super) fn engines(allow: bool) -> &'static EngineState {
    ALLOW.store(allow, Ordering::SeqCst);
    if let Some(state) = support::state() {
        return state;
    }
    let root = tempfile::tempdir()
        .expect("a scratch folder")
        .keep();
    let store = database::store::Store::at(root.join("misty.db"));
    EngineState::open(&store, &root, Arc::new(Collect)).expect("the engine layer opens");
    gate::install(|run, tool, _input| {
        Box::pin(async move {
            let allow = ALLOW.load(Ordering::SeqCst);
            println!("  gate: {tool} on {run} -> {}", if allow { "allow" } else { "deny" });
            if allow {
                Decision::Allow
            } else {
                Decision::Deny("Denied by Misty's live test.".into())
            }
        })
    });
    support::state().expect("the engine state")
}

/// Sends `prompt` as a chat's message on `engine`, in `folder`, the way the composer does.
/// Returns the run id.
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

/// The run's events so far, as `(kind, data)`.
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

/// Prints the run's events, delta text joined, for reading a live run.
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

/// Waits until `ready` holds for the run's events, and returns them. Fails after `limit`.
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

/// Whether the run settled its turn in the chat.
pub(super) fn settled(events: &[(String, Value)]) -> bool {
    events
        .iter()
        .any(|(kind, _)| kind == "done" || kind == "error")
}

/// The engine session (thread) id the run announced.
pub(super) fn session_of(events: &[(String, Value)]) -> Option<String> {
    events
        .iter()
        .rev()
        .find(|(kind, _)| kind == "session")
        .and_then(|(_, data)| data.as_str())
        .map(str::to_string)
}
