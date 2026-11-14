//! Misty's 2.x turn path against a real OpenCode install and a free model, run by hand (ignored).

use super::forms::render_form;
use super::*;

/// What one live turn collected: the run's engine events as `(kind, data)`.
#[derive(Default)]
pub(super) struct Collected(std::sync::Mutex<Vec<String>>);

impl crate::engines::support::event_sink::Emit for Collected {
    fn emit_json(&self, _name: &str, raw_json: &str) {
        self.0.lock().unwrap().push(raw_json.to_string());
    }
}

impl Collected {
    pub(super) fn kinds(&self) -> Vec<(String, Value)> {
        let mut out = Vec::new();
        for raw in self.0.lock().unwrap().iter() {
            let flushed: Value = serde_json::from_str(raw).unwrap_or(Value::Null);
            for value in flushed.as_array().cloned().unwrap_or_else(|| vec![flushed]) {
                let kind = value["kind"].as_str().unwrap_or("").to_string();
                out.push((kind, value["data"].clone()));
            }
        }
        out
    }
}

/// One live turn on Misty's real path (`run_server_turn_with_probe_port`), started on its own
/// task; the caller waits on the handle.
pub(super) struct LiveTurn {
    pub(super) emitter: Arc<Collected>,
    registry: Arc<crate::engines::ProcessRegistry>,
    pub(super) killed: Arc<AtomicBool>,
    run_id: String,
    pub(super) handle: tokio::task::JoinHandle<()>,
}

pub(super) fn start_live_turn(
    server: &Arc<opencode_server::OpencodeServerState>,
    bin: &str,
    folder: &std::path::Path,
    session_id: Option<String>,
    prompt: &str,
    model: &str,
    n: u32,
) -> LiveTurn {
    use crate::engines::registry::ChildEntry;
    use crate::engines::support::event_sink::EventSink;
    let emitter = Arc::new(Collected::default());
    let registry = Arc::new(crate::engines::ProcessRegistry::default());
    let run_id = format!("oc-live-{n}");
    let pid = 4_000_100_000 + n;
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
            questions: Arc::new(std::sync::Mutex::new(HashMap::new())),
            plans: Arc::new(std::sync::Mutex::new(HashMap::new())),
        },
    );
    let core = TurnCore {
        sink: EventSink::new(emitter.clone()),
        registry: Arc::clone(&registry),
        engine_id: "opencode".to_string(),
        run_id: run_id.clone(),
        db: None,
        followup: None,
    };
    let req = SendRequest {
        session_id,
        workspace: folder.to_path_buf(),
        prompt: prompt.to_string(),
        prompt_contributions: Vec::new(),
        native_compact: false,
        images: Vec::new(),
        model: Some(model.to_string()),
        effort: None,
        service_tier: None,
        permission: None,
        additional_dirs: Vec::new(),
        provider_id: None,
        mcp_servers: None,
        allowed_tools: None,
    };
    let handle = tokio::spawn(super::super::run_server_turn_with_probe_port(
        core,
        req,
        bin.to_string(),
        Arc::clone(server),
        Arc::clone(&killed),
        pid,
        1,
    ));
    LiveTurn {
        emitter,
        registry,
        killed,
        run_id,
        handle,
    }
}

impl LiveTurn {
    pub(super) async fn finish(self) -> Vec<(String, Value)> {
        tokio::time::timeout(Duration::from_secs(180), self.handle)
            .await
            .expect("the turn never settled")
            .expect("turn task");
        // The sink flushes on its own beat; give the last batch a moment.
        tokio::time::sleep(Duration::from_millis(400)).await;
        let kinds = self.emitter.kinds();
        for (kind, data) in &kinds {
            let line = data.to_string();
            eprintln!("  [{kind}] {}", line.chars().take(300).collect::<String>());
        }
        kinds
    }

    /// The parked question card's answer context, once one parks.
    async fn parked_question(&self) -> Option<(String, Value)> {
        for _ in 0..600 {
            let parked = self.registry.get(&self.run_id).and_then(|entry| {
                entry
                    .questions
                    .lock()
                    .ok()
                    .and_then(|q| q.iter().next().map(|(k, v)| (k.clone(), v.clone())))
            });
            if parked.is_some() {
                return parked;
            }
            if self.handle.is_finished() {
                return None;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        None
    }
}

pub(super) fn of_kind<'a>(kinds: &'a [(String, Value)], kind: &str) -> Vec<&'a Value> {
    kinds
        .iter()
        .filter(|(k, _)| k == kind)
        .map(|(_, d)| d)
        .collect()
}

pub(super) fn text_of(kinds: &[(String, Value)]) -> String {
    of_kind(kinds, "delta")
        .into_iter()
        .filter_map(Value::as_str)
        .collect()
}

/// Every frame the server streams, printed as it comes, so a live run shows the raw wire
/// beside what Misty made of it.
pub(super) fn tap_raw_events(origin: &str) {
    let origin = origin.to_owned();
    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let Ok(response) =
            opencode_server::request(&client, Method::GET, &origin, "/api/event", None)
                .send()
                .await
        else {
            return;
        };
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();
        while let Some(Ok(chunk)) = stream.next().await {
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(at) = buffer.find("\n\n") {
                let frame: String = buffer[..at].to_string();
                buffer.drain(..at + 2);
                for line in frame.lines() {
                    if let Some(raw) = line.strip_prefix("data:") {
                        let raw = raw.trim();
                        if raw.contains("\"session.text.delta\"")
                            || raw.contains("\"session.reasoning.delta\"")
                        {
                            continue;
                        }
                        eprintln!("    raw {}", raw.chars().take(700).collect::<String>());
                    }
                }
            }
        }
    });
}

/// Misty's whole 2.x turn path against a real model OpenCode serves for free without an account
/// (its own "zen" models, `apiKey: public`): streamed text, a tool, `/compact`, a permission ask,
/// a question form and a stop mid-turn. Spends a handful of tiny prompts:
/// `OPENCODE_BIN=/path/to/opencode cargo test --lib live_v2_turns -- --ignored --nocapture`
/// (`OPENCODE_FREE_MODEL` picks another free model; the default is the server's own default).
#[tokio::test]
#[ignore]
async fn live_v2_turns() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let bin = std::env::var("OPENCODE_BIN").expect("OPENCODE_BIN");
    let model =
        std::env::var("OPENCODE_FREE_MODEL").unwrap_or_else(|_| "opencode/big-pickle".into());
    let folder =
        std::env::temp_dir().join(format!("misty-opencode-v2-live-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("notes.txt"), "hello\n").unwrap();
    // OpenCode's agents ask before reading a `.env` file, so this one triggers a permission ask.
    std::fs::write(folder.join(".env"), "FAKE=1\n").unwrap();
    let directory = folder.to_string_lossy().to_string();
    let server = Arc::new(opencode_server::OpencodeServerState::default());
    let origin = opencode_server::ensure_server(&server, &bin, 1)
        .await
        .expect("server");
    assert!(opencode_server::is_v2(&origin));
    // The model must be one the server serves for nothing.
    let models = call(Method::GET, &origin, "/api/model", Some(&directory), None)
        .await
        .expect("models");
    let (provider, id) = model.split_once('/').unwrap();
    let listed = data(&models)
        .as_array()
        .and_then(|all| {
            all.iter()
                .find(|m| m["providerID"] == provider && m["id"] == id)
                .cloned()
        })
        .expect("the model isn't served");
    assert!(
        listed["cost"]
            .as_array()
            .is_some_and(|costs| costs.iter().all(|c| c["input"] == 0 && c["output"] == 0)),
        "not a free model: {listed}"
    );
    tap_raw_events(&origin);
    // Misty's gate answers permission asks; here it allows each and remembers what it saw.
    let asked: Arc<std::sync::Mutex<Vec<(String, Value)>>> = Arc::default();
    {
        let asked = Arc::clone(&asked);
        crate::engines::gate::install(move |_run, tool, input| {
            asked.lock().unwrap().push((tool, input));
            Box::pin(async { crate::engines::gate::Decision::Allow })
        });
    }

    eprintln!("== 1. streamed text");
    let turn = start_live_turn(
        &server,
        &bin,
        &folder,
        None,
        "Reply with just the word: pong",
        &model,
        1,
    );
    let kinds = turn.finish().await;
    let session = of_kind(&kinds, "session")
        .first()
        .and_then(|s| s.as_str())
        .expect("no session")
        .to_string();
    assert!(text_of(&kinds).to_lowercase().contains("pong"), "{kinds:?}");
    let usage = of_kind(&kinds, "usage");
    let last = usage.last().expect("no usage");
    assert!(last["model_context_window"].as_u64().is_some(), "{last}");
    assert!(last["input_tokens"].as_u64().unwrap_or(0) > 0, "{last}");
    let done = of_kind(&kinds, "done");
    assert_eq!(done.len(), 1, "{kinds:?}");
    assert!(of_kind(&kinds, "error").is_empty(), "{kinds:?}");

    eprintln!("== 2. a tool");
    let turn = start_live_turn(
        &server,
        &bin,
        &folder,
        Some(session.clone()),
        "Use a tool to list the files in the current folder, then reply with their names only.",
        &model,
        2,
    );
    let kinds = turn.finish().await;
    let tools: Vec<&Value> = of_kind(&kinds, "message")
        .into_iter()
        .filter(|m| m["role"] == "tool")
        .collect();
    assert!(
        tools
            .iter()
            .any(|t| t["patch"] != true && t["text"] != "tool"),
        "no named tool call: {kinds:?}"
    );
    assert!(
        tools
            .iter()
            .any(|t| t["patch"] == true && t["result"].to_string().contains("notes.txt")),
        "no tool result naming the file: {kinds:?}"
    );
    assert!(text_of(&kinds).contains("notes.txt"), "{kinds:?}");
    assert_eq!(of_kind(&kinds, "done").len(), 1);
    assert!(of_kind(&kinds, "error").is_empty(), "{kinds:?}");

    eprintln!("== 3. /compact");
    let turn = start_live_turn(
        &server,
        &bin,
        &folder,
        Some(session.clone()),
        "/compact",
        &model,
        3,
    );
    let kinds = turn.finish().await;
    assert_eq!(of_kind(&kinds, "done").len(), 1, "{kinds:?}");
    assert!(of_kind(&kinds, "error").is_empty(), "{kinds:?}");
    assert!(
        !text_of(&kinds).is_empty(),
        "the summary didn't stream: {kinds:?}"
    );
    // OpenCode reports no compacted size, so the last report clears the count; the summarizing
    // call's tokens still come with it.
    let usage = of_kind(&kinds, "usage");
    let last = usage.last().expect("no usage after /compact");
    assert!(last["model_context_window"].as_u64().is_some(), "{last}");
    assert_eq!(
        crate::engines::bridge::context_usage(last).0,
        Some(0),
        "{last}"
    );
    assert!(last["output_tokens"].as_u64().unwrap_or(0) > 0, "{last}");

    eprintln!("== 4. a permission ask (reading .env)");
    let turn = start_live_turn(
        &server,
        &bin,
        &folder,
        Some(session.clone()),
        "Read the file .env with your read tool and reply with its contents only.",
        &model,
        4,
    );
    let kinds = turn.finish().await;
    eprintln!("  gate saw: {:?}", asked.lock().unwrap());
    assert!(
        !asked.lock().unwrap().is_empty(),
        "no permission ask reached the gate"
    );
    assert!(
        text_of(&kinds).contains("FAKE=1"),
        "the allowed read didn't go through: {kinds:?}"
    );
    assert_eq!(of_kind(&kinds, "done").len(), 1, "{kinds:?}");
    assert!(of_kind(&kinds, "error").is_empty(), "{kinds:?}");

    eprintln!("== 5. a question form");
    let turn = start_live_turn(
        &server,
        &bin,
        &folder,
        Some(session.clone()),
        "Use your question tool to ask me: red or blue? Then reply with my answer only.",
        &model,
        5,
    );
    let (form_id, parked) = turn.parked_question().await.expect("no question parked");
    let context = parked["opencode"].clone();
    let cards = render_form(&context["form"]);
    let question = cards[0]["question"].as_str().unwrap().to_string();
    let answer = cards[0]["options"][0]["label"]
        .as_str()
        .unwrap_or("blue")
        .to_string();
    super::super::answer_question(&context, Some(&json!({ question: answer })))
        .await
        .expect("answer");
    let kinds = turn.finish().await;
    let asked_cards = of_kind(&kinds, "question");
    assert_eq!(asked_cards.len(), 1, "{kinds:?}");
    assert_eq!(asked_cards[0]["requestId"], form_id.as_str());
    assert!(
        of_kind(&kinds, "question_settled")
            .iter()
            .any(|d| d["requestId"] == form_id.as_str()),
        "{kinds:?}"
    );
    assert!(
        text_of(&kinds)
            .to_lowercase()
            .contains(&answer.to_lowercase()),
        "{kinds:?}"
    );
    assert_eq!(of_kind(&kinds, "done").len(), 1, "{kinds:?}");

    eprintln!("== 6. stop mid-turn");
    let turn = start_live_turn(
        &server,
        &bin,
        &folder,
        Some(session.clone()),
        "Write the numbers from 1 to 400, one per line, and nothing else.",
        &model,
        6,
    );
    for _ in 0..600 {
        if !text_of(&turn.emitter.kinds()).is_empty() || turn.handle.is_finished() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    turn.killed.store(true, Ordering::SeqCst);
    let kinds = turn.finish().await;
    let done = of_kind(&kinds, "done");
    assert_eq!(done.len(), 1, "{kinds:?}");
    assert!(of_kind(&kinds, "error").is_empty(), "{kinds:?}");
    // The server stops the turn too: the session's outcome says it was interrupted.
    let mut outcome = Value::Null;
    for _ in 0..50 {
        let info = call(
            Method::GET,
            &origin,
            &format!("/api/session/{session}"),
            None,
            None,
        )
        .await
        .expect("session");
        outcome = data(&info)["outcome"].clone();
        if outcome == "interrupted" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    assert_eq!(
        outcome, "interrupted",
        "the server kept the stopped turn going"
    );
    assert!(
        !text_of(&kinds).contains("\n400"),
        "the turn ran to the end before the stop: {kinds:?}"
    );
    server.kill_spawned();
    let _ = std::fs::remove_dir_all(&folder);
}
