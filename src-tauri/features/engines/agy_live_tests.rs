//! Misty's ACP turn path against the installed, signed-in Antigravity CLI, run by hand (ignored):
//! a text turn, a resumed turn whose file write asks Misty's gate, `/goal`, `/grill-me`
//! answered through its question card, and `/teamwork`, whose sub-agent's steps nest under its
//! call. Spends five tiny prompts on the cheapest Gemini model:
//! `cargo test --lib agy_acp_live -- --ignored --nocapture --test-threads 1`
//! (`AGY_BIN` names another binary; the default is the one Misty installs).
#![allow(clippy::disallowed_methods)] // Fixtures are built with the standard library.

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};

use crate::engines::registry::ChildEntry;
use crate::engines::support::event_sink::{Emit, EventSink};
use crate::engines::{Engine, ProcessRegistry, SendRequest, TurnCore};

const MODEL: &str = "gemini-3.8-flash-low";

#[derive(Default)]
struct Collected(Mutex<Vec<String>>);

impl Emit for Collected {
    fn emit_json(&self, _name: &str, raw_json: &str) {
        self.0.lock().unwrap().push(raw_json.to_string());
    }
}

impl Collected {
    fn kinds(&self) -> Vec<(String, Value)> {
        let mut out = Vec::new();
        for raw in self.0.lock().unwrap().iter() {
            let flushed: Value = serde_json::from_str(raw).unwrap_or(Value::Null);
            for value in flushed.as_array().cloned().unwrap_or_else(|| vec![flushed]) {
                out.push((
                    value["kind"].as_str().unwrap_or("").to_string(),
                    value["data"].clone(),
                ));
            }
        }
        out
    }
}

/// The person's real home, where the CLI keeps its sign-in (the test binary points HOME at a
/// scratch folder).
fn real_home() -> String {
    // SAFETY: getpwuid returns the calling user's static record, read before anything else.
    unsafe {
        let record = libc::getpwuid(libc::getuid());
        assert!(!record.is_null(), "the user's account record");
        std::ffi::CStr::from_ptr((*record).pw_dir)
            .to_string_lossy()
            .into_owned()
    }
}

struct LiveTurn {
    emitter: Arc<Collected>,
    registry: Arc<ProcessRegistry>,
    run_id: String,
    handle: tokio::task::JoinHandle<()>,
}

fn start(
    folder: &std::path::Path,
    session: Option<String>,
    prompt: &str,
    level: &str,
    n: u32,
) -> LiveTurn {
    let home = real_home();
    let bin =
        std::env::var("AGY_BIN").unwrap_or_else(|_| format!("{home}/.misty/engines/agy/bin/agy"));
    let emitter = Arc::new(Collected::default());
    let registry = Arc::new(ProcessRegistry::default());
    let run_id = format!("agy-live-{n}");
    let pid = 4_000_200_000 + n;
    let killed = Arc::new(AtomicBool::new(false));
    registry.insert(
        run_id.clone(),
        ChildEntry {
            child: None,
            pid,
            run_id: run_id.clone(),
            killed: Arc::clone(&killed),
            reader_abort: Arc::new(std::sync::OnceLock::new()),
            stdin: None,
            questions: Arc::new(Mutex::new(HashMap::new())),
            plans: Arc::new(Mutex::new(HashMap::new())),
        },
    );
    let core = TurnCore {
        sink: EventSink::new(emitter.clone()),
        registry: Arc::clone(&registry),
        engine_id: "agy".to_string(),
        run_id: run_id.clone(),
        db: None,
        followup: None,
    };
    let req = SendRequest {
        session_id: session,
        workspace: folder.to_path_buf(),
        prompt: prompt.to_string(),
        prompt_contributions: Vec::new(),
        native_compact: false,
        images: Vec::new(),
        model: Some(MODEL.to_string()),
        effort: None,
        service_tier: None,
        permission: Some(level.to_string()),
        additional_dirs: Vec::new(),
        provider_id: None,
        mcp_servers: None,
        allowed_tools: None,
    };
    let mut built = super::super::super::AgyEngine
        .host_command(&req, &bin)
        .unwrap();
    built.command.current_dir(folder).env("HOME", &home);
    let handle = tokio::spawn(crate::engines::grok_acp::run_acp_turn(
        core, req, built, killed, pid,
    ));
    LiveTurn {
        emitter,
        registry,
        run_id,
        handle,
    }
}

impl LiveTurn {
    /// Answers the first question card that parks with its first option, through the same frame
    /// `answer_question` writes.
    async fn answer_first_question(&self) -> Option<Value> {
        for _ in 0..1800 {
            let parked = self.registry.get(&self.run_id).and_then(|entry| {
                let questions = entry.questions.lock().ok()?;
                questions.iter().next().map(|(k, v)| (k.clone(), v.clone()))
            });
            if let Some((request_id, input)) = parked {
                let question = input["questions"][0].clone();
                let label = question["options"][0]["label"].clone();
                let answers = json!({ question["question"].as_str().unwrap(): label });
                let frame =
                    crate::engines::grok_acp::answer_frame(&input["grokAcp"], Some(&answers))
                        .unwrap();
                eprintln!("  answering {request_id}: {frame}");
                self.registry
                    .write_line(&self.run_id, frame.to_string())
                    .await
                    .unwrap();
                if let Some(entry) = self.registry.get(&self.run_id) {
                    entry.questions.lock().unwrap().remove(&request_id);
                }
                return Some(input);
            }
            if self.handle.is_finished() {
                return None;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        None
    }

    async fn finish(self) -> Vec<(String, Value)> {
        tokio::time::timeout(Duration::from_secs(300), self.handle)
            .await
            .expect("the turn never settled")
            .expect("turn task");
        tokio::time::sleep(Duration::from_millis(400)).await;
        let kinds = self.emitter.kinds();
        for (kind, data) in &kinds {
            eprintln!(
                "  [{kind}] {}",
                data.to_string().chars().take(300).collect::<String>()
            );
        }
        kinds
    }
}

fn of_kind<'a>(kinds: &'a [(String, Value)], kind: &str) -> Vec<&'a Value> {
    kinds
        .iter()
        .filter(|(k, _)| k == kind)
        .map(|(_, d)| d)
        .collect()
}

fn text_of(kinds: &[(String, Value)]) -> String {
    of_kind(kinds, "delta")
        .into_iter()
        .filter_map(Value::as_str)
        .collect()
}

fn assert_done(kinds: &[(String, Value)]) {
    assert!(of_kind(kinds, "error").is_empty(), "{kinds:?}");
    assert!(!of_kind(kinds, "done").is_empty(), "{kinds:?}");
}

#[tokio::test]
#[ignore = "spends five tiny prompts on the signed-in Antigravity CLI"]
async fn agy_acp_live_turns() {
    let dir = tempfile::tempdir().unwrap();
    let folder = dir.path().canonicalize().unwrap();
    // Misty's gate answers each permission ask: here it allows it and remembers it.
    let asked: Arc<Mutex<Vec<(String, Value)>>> = Arc::default();
    {
        let asked = Arc::clone(&asked);
        crate::engines::gate::install(move |_run, tool, input| {
            eprintln!("  gate asked: {tool} {input}");
            asked.lock().unwrap().push((tool, input));
            Box::pin(async { crate::engines::gate::Decision::Allow })
        });
    }

    // Sub-agents are read from the CLI's own home (`agy_home`), which this process's scratch HOME
    // would hide. Only this ignored test runs in its process (`--test-threads 1`).
    std::env::set_var(
        "ANTIGRAVITY_HOME",
        format!("{}/.gemini/antigravity-cli", real_home()),
    );
    // `AGY_LIVE_STEPS=34` runs only those steps; 2 resumes 1's conversation when 1 runs.
    let steps = std::env::var("AGY_LIVE_STEPS").unwrap_or_else(|_| "12345".into());
    let session = if steps.contains('1') {
        Some(text(&folder).await)
    } else {
        None
    };
    if steps.contains('2') {
        write_that_asks(&folder, session, &asked).await;
    }
    if steps.contains('3') {
        goal(&folder).await;
    }
    if steps.contains('4') {
        grill_me(&folder).await;
    }
    if steps.contains('5') {
        teamwork(&folder).await;
    }
}

async fn text(folder: &std::path::Path) -> String {
    eprintln!("== 1. text, read-only");
    let kinds = start(folder, None, "Reply with just the word: pong", "plan", 1)
        .finish()
        .await;
    assert_done(&kinds);
    assert!(text_of(&kinds).to_lowercase().contains("pong"), "{kinds:?}");
    let session = of_kind(&kinds, "session")[0].as_str().unwrap().to_string();
    let usage = of_kind(&kinds, "usage");
    assert!(
        usage
            .iter()
            .any(|u| u["model_context_window"].as_u64().is_some()),
        "{usage:?}"
    );
    assert!(
        usage.iter().any(|u| u["inputTokens"].as_u64().is_some()),
        "{usage:?}"
    );
    let choices = of_kind(&kinds, "session_choice");
    assert!(choices.iter().all(|c| c["model"] == MODEL), "{choices:?}");
    session
}

async fn write_that_asks(
    folder: &std::path::Path,
    session: Option<String>,
    asked: &Mutex<Vec<(String, Value)>>,
) {
    eprintln!("== 2. a write that asks, resumed when 1 ran");
    let prompt = "Create a file named note.txt in this folder containing just: hi";
    let kinds = start(folder, session.clone(), prompt, "manual", 2)
        .finish()
        .await;
    assert_done(&kinds);
    // The resumed id is the run's own from the start, so only a changed one would be reported.
    assert!(
        of_kind(&kinds, "session")
            .iter()
            .all(|id| session.is_none() || **id == json!(session)),
        "the same conversation"
    );
    assert!(
        !asked.lock().unwrap().is_empty(),
        "the ask reached the gate"
    );
    assert!(folder.join("note.txt").is_file(), "the allowed write ran");
}

async fn goal(folder: &std::path::Path) {
    eprintln!("== 3. /goal");
    let kinds = start(folder, None, "/goal Reply with just: ok", "plan", 3)
        .finish()
        .await;
    assert_done(&kinds);
    assert!(text_of(&kinds).to_lowercase().contains("ok"), "{kinds:?}");
}

async fn grill_me(folder: &std::path::Path) {
    eprintln!("== 4. /grill-me");
    let prompt = "/grill-me I want to add one tiny text file here. Ask me exactly one question with options, then stop without changing anything.";
    let turn = start(folder, None, prompt, "plan", 4);
    let asked_card = turn.answer_first_question().await.expect("a question card");
    assert!(!asked_card["questions"][0]["options"]
        .as_array()
        .unwrap()
        .is_empty());
    let kinds = turn.finish().await;
    assert_done(&kinds);
    assert!(!of_kind(&kinds, "question").is_empty(), "{kinds:?}");
}

async fn teamwork(folder: &std::path::Path) {
    eprintln!("== 5. /teamwork");
    let kinds = start(folder, None, "/teamwork reply with just: hi", "plan", 5)
        .finish()
        .await;
    assert_done(&kinds);
    let messages = of_kind(&kinds, "message");
    let call = messages
        .iter()
        .find(|m| m["args"]["subagent_type"].is_string() && m["patch"].is_null())
        .unwrap_or_else(|| panic!("an invoke_subagent row: {kinds:?}"));
    let row = call["toolCallId"].as_str().expect("the row's id");
    assert!(call["args"]["prompt"].is_string(), "{call}");
    // Its sub-agent's steps come inside a scope naming that row.
    let at = kinds
        .iter()
        .position(|(kind, data)| kind == "scope" && data["parent"] == row)
        .unwrap_or_else(|| panic!("the sub-agent's rows: {kinds:?}"));
    let (kind, nested) = &kinds[at + 1];
    assert_eq!(kind, "message");
    assert_eq!(nested["role"], "tool");
    assert!(nested["toolCallId"].as_str().is_some_and(|id| id != row));
}
