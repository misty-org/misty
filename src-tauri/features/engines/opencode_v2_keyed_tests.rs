//! Misty's 2.x turn path on a keyed, priced provider: a custom OpenAI-compatible provider in a
//! scratch OpenCode config, pointed at a fake provider on loopback, so nothing is spent.

use std::path::Path;

use super::fake_provider::{fake_provider, FakeProvider, Seen, SLOW_MARK, TOOL_MARK};
use super::live_tests::{of_kind, start_live_turn, tap_raw_events, text_of, Collected};
use super::*;

const PAID_KEY: &str = "sk-misty-fake-paid";
const FREE_KEY: &str = "sk-misty-fake-free";
/// The model Misty picks, as `provider/model`; its config key is `pricey`, its upstream id this.
const MODEL: &str = "fakepaid/pricey";
const UPSTREAM_MODEL: &str = "upstream-pricey-v1";
const WINDOW: u64 = 123_456;
/// What the fake provider reports for every call: 1000 prompt tokens (400 of them cached), 50
/// out. At $3 in, $15 out and $0.30 cached per million, OpenCode prices one step at this.
const STEP_COST: f64 = (600.0 * 3.0 + 50.0 * 15.0 + 400.0 * 0.3) / 1_000_000.0;

/// OpenCode's config, data, state and cache under `root` (and HOME, so nothing falls back to the
/// user's own), with `config` as its global config. The server Misty starts inherits these.
fn isolate_opencode(root: &Path, config: &Value) {
    for (name, dir) in [
        ("HOME", "home"),
        ("XDG_CONFIG_HOME", "config"),
        ("XDG_DATA_HOME", "data"),
        ("XDG_STATE_HOME", "state"),
        ("XDG_CACHE_HOME", "cache"),
    ] {
        let dir = root.join(dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var(name, &dir);
    }
    let config_dir = root.join("config").join("opencode");
    std::fs::create_dir_all(&config_dir).unwrap();
    std::fs::write(config_dir.join("opencode.json"), config.to_string()).unwrap();
    for name in [
        "OPENCODE_CONFIG",
        "OPENCODE_CONFIG_CONTENT",
        "OPENCODE_CONFIG_DIR",
        "OPENCODE_DB",
    ] {
        std::env::remove_var(name);
    }
    for name in [
        "OPENCODE_DISABLE_AUTOUPDATE",
        "OPENCODE_DISABLE_CLAUDE_CODE",
        "OPENCODE_DISABLE_MODELS_FETCH",
    ] {
        std::env::set_var(name, "1");
    }
}

/// Two custom providers: the session starts on the free one (the config's default), so Misty's
/// pick has to switch it to the paid one, priced and with its own window.
fn keyed_config(paid: &FakeProvider, free: &FakeProvider) -> Value {
    json!({
        "$schema": "https://opencode.ai/config.json",
        "model": "fakefree/plain",
        "small_model": "fakefree/plain",
        "enabled_providers": ["fakepaid", "fakefree"],
        "provider": {
            "fakepaid": {
                "npm": "@ai-sdk/openai-compatible",
                "name": "Fake paid",
                "options": { "baseURL": paid.base_url, "apiKey": PAID_KEY },
                "models": { "pricey": {
                    "id": UPSTREAM_MODEL, "name": "Pricey", "tool_call": true,
                    "cost": { "input": 3, "output": 15, "cache_read": 0.3, "cache_write": 3.75 },
                    "limit": { "context": WINDOW, "output": 8192 },
                } },
            },
            "fakefree": {
                "npm": "@ai-sdk/openai-compatible",
                "name": "Fake free",
                "options": { "baseURL": free.base_url, "apiKey": FREE_KEY },
                "models": { "plain": {
                    "name": "Plain", "tool_call": true, "limit": { "context": 50_000, "output": 4096 },
                } },
            },
        },
    })
}

/// Stops the server Misty started and drops the scratch folder, even when an assert fails.
struct Cleanup(
    Arc<opencode_server::OpencodeServerState>,
    std::path::PathBuf,
);

impl Drop for Cleanup {
    fn drop(&mut self) {
        self.0.kill_spawned();
        let _ = std::fs::remove_dir_all(&self.1);
    }
}

fn cost_of(usage: &Value) -> f64 {
    usage["cost_usd"].as_f64().unwrap_or(-1.0)
}

/// A turn on a keyed, priced provider through Misty's real path, spending nothing: text, a tool
/// and a stop mid-turn, with the window, the cache, the cost and the key checked end to end.
/// `OPENCODE_BIN=/path/to/opencode cargo test --lib live_v2_keyed_provider -- --ignored --nocapture`
#[tokio::test]
#[ignore]
async fn live_v2_keyed_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let bin = std::env::var("OPENCODE_BIN").expect("OPENCODE_BIN");
    let root = std::env::temp_dir().join(format!("misty-opencode-keyed-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let folder = root.join("work");
    std::fs::create_dir_all(&folder).unwrap();
    let folder = folder.canonicalize().unwrap();
    std::fs::write(folder.join("notes.txt"), "hello\n").unwrap();
    let notes = folder.join("notes.txt").to_string_lossy().to_string();
    let directory = folder.to_string_lossy().to_string();
    let paid = fake_provider(PAID_KEY, notes.clone()).await;
    let free = fake_provider(FREE_KEY, notes).await;
    let refused = reqwest::Client::new()
        .post(format!("{}/chat/completions", paid.base_url))
        .json(&json!({ "model": UPSTREAM_MODEL, "messages": [] }))
        .send()
        .await
        .unwrap();
    assert_eq!(
        refused.status(),
        401,
        "the fake took a request without the key"
    );
    paid.seen.lock().unwrap().clear();
    isolate_opencode(&root, &keyed_config(&paid, &free));

    let server = Arc::new(opencode_server::OpencodeServerState::default());
    let _cleanup = Cleanup(Arc::clone(&server), root.clone());
    let origin = opencode_server::ensure_server(&server, &bin, 1)
        .await
        .expect("server");
    assert!(opencode_server::is_v2(&origin));
    let models = call(Method::GET, &origin, "/api/model", Some(&directory), None)
        .await
        .expect("models");
    let listed = data(&models)
        .as_array()
        .and_then(|all| {
            all.iter()
                .find(|m| m["providerID"] == "fakepaid" && m["id"] == "pricey")
                .cloned()
        })
        .unwrap_or_else(|| panic!("the custom provider's model isn't listed: {models}"));
    assert_eq!(listed["limit"]["context"], WINDOW, "{listed}");
    assert_eq!(listed["cost"][0]["input"], 3, "not priced: {listed}");
    tap_raw_events(&origin);
    crate::engines::gate::install(|_run, _tool, _input| {
        Box::pin(async { crate::engines::gate::Decision::Allow })
    });

    eprintln!("== 1. streamed text");
    let prompt = "Reply with just the word: pong";
    let kinds = start_live_turn(&server, &bin, &folder, None, prompt, MODEL, 11)
        .finish()
        .await;
    let session = of_kind(&kinds, "session")
        .first()
        .and_then(|s| s.as_str())
        .expect("no session")
        .to_string();
    assert_eq!(text_of(&kinds), "pong", "{kinds:?}");
    let usage = of_kind(&kinds, "usage");
    let last = usage.last().expect("no usage");
    assert_eq!(last["model_context_window"], WINDOW, "{last}");
    assert_eq!(last["input_tokens"], 600, "{last}");
    assert_eq!(last["cache_read_input_tokens"], 400, "{last}");
    assert_eq!(last["output_tokens"], 50, "{last}");
    assert_eq!(
        crate::engines::bridge::context_usage(last),
        (Some(1050), Some(WINDOW)),
        "{last}"
    );
    assert!((cost_of(last) - STEP_COST).abs() < 1e-9, "{last}");
    assert_eq!(of_kind(&kinds, "done").len(), 1, "{kinds:?}");
    assert!(of_kind(&kinds, "error").is_empty(), "{kinds:?}");
    assert!(of_kind(&kinds, "warn").is_empty(), "{kinds:?}");

    eprintln!("== 2. a tool");
    let prompt = format!("{TOOL_MARK}: read notes.txt with your read tool and say what it holds.");
    let turn = start_live_turn(
        &server,
        &bin,
        &folder,
        Some(session.clone()),
        &prompt,
        MODEL,
        12,
    );
    let kinds = turn.finish().await;
    let tools: Vec<&Value> = of_kind(&kinds, "message")
        .into_iter()
        .filter(|m| m["role"] == "tool")
        .collect();
    assert!(
        tools
            .iter()
            .any(|t| t["patch"] != true && t["text"] == "read"),
        "no read call: {kinds:?}"
    );
    assert!(
        tools.iter().any(|t| t["patch"] == true
            && t["text"] == "read"
            && t["result"].to_string().contains("hello")),
        "no read result with the file's text: {kinds:?}"
    );
    assert_eq!(text_of(&kinds), "notes.txt says hello", "{kinds:?}");
    // Two steps (the call, then the answer), so the turn cost two steps' worth.
    let usage = of_kind(&kinds, "usage");
    let last = usage.last().expect("no usage");
    assert!(usage.len() >= 2, "{kinds:?}");
    assert!((cost_of(last) - 2.0 * STEP_COST).abs() < 1e-9, "{last}");
    assert_eq!(last["model_context_window"], WINDOW, "{last}");
    assert_eq!(of_kind(&kinds, "done").len(), 1, "{kinds:?}");
    assert!(of_kind(&kinds, "error").is_empty(), "{kinds:?}");

    eprintln!("== 3. stop mid-turn");
    let prompt = format!("{SLOW_MARK}: count to 400.");
    let turn = start_live_turn(
        &server,
        &bin,
        &folder,
        Some(session.clone()),
        &prompt,
        MODEL,
        13,
    );
    for _ in 0..600 {
        if !text_of(&turn.emitter.kinds()).is_empty() || turn.handle.is_finished() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    turn.killed.store(true, Ordering::SeqCst);
    let kinds = turn.finish().await;
    assert!(!text_of(&kinds).is_empty(), "{kinds:?}");
    assert!(
        !text_of(&kinds).contains("\n400"),
        "ran to the end: {kinds:?}"
    );
    assert_eq!(of_kind(&kinds, "done").len(), 1, "{kinds:?}");
    assert!(of_kind(&kinds, "error").is_empty(), "{kinds:?}");
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

    // Every step went to the paid provider, on its upstream model id, with its key.
    let paid_seen = paid.seen.lock().unwrap().clone();
    let free_seen = free.seen.lock().unwrap().clone();
    eprintln!("  paid saw {paid_seen:?}\n  free saw {free_seen:?}");
    let steps: Vec<&Seen> = paid_seen.iter().filter(|s| s.tools).collect();
    assert!(steps.len() >= 4, "{paid_seen:?}");
    let bearer = format!("Bearer {PAID_KEY}");
    assert!(
        paid_seen
            .iter()
            .all(|s| s.authorization.as_deref() == Some(bearer.as_str())
                && s.model == UPSTREAM_MODEL),
        "{paid_seen:?}"
    );
    assert!(
        free_seen.iter().all(|s| !s.tools),
        "a step stayed on the default provider: {free_seen:?}"
    );
}

/// Each `session.step.ended` prices its own step; the usage Misty reports carries the turn's
/// total so far, and nothing when the model has no prices.
#[tokio::test]
async fn step_costs_add_up_over_the_turn() {
    use crate::engines::support::event_sink::EventSink;
    let core = TurnCore {
        sink: EventSink::new(Arc::new(Collected::default())),
        registry: Arc::new(crate::engines::ProcessRegistry::default()),
        engine_id: "opencode".to_string(),
        run_id: "oc-cost".to_string(),
        db: None,
        followup: None,
    };
    let mut state = TurnState::new(None);
    let mut view = View::default();
    view.context_windows.insert(MODEL.to_string(), WINDOW);
    let tokens =
        json!({ "input": 600, "output": 50, "reasoning": 0, "cache": { "read": 400, "write": 0 } });
    let started = json!({ "type": "session.step.started",
        "data": { "sessionID": "ses_1", "model": { "id": "pricey", "providerID": "fakepaid" } } });
    let origin = "http://127.0.0.1:1";
    let free = json!({ "type": "session.step.ended",
        "data": { "sessionID": "ses_1", "tokens": tokens } });
    let priced = json!({ "type": "session.step.ended",
        "data": { "sessionID": "ses_1", "tokens": tokens, "cost": STEP_COST } });
    for (n, frame) in [&started, &free, &started, &priced, &started, &priced]
        .into_iter()
        .enumerate()
    {
        events::handle_event(
            &core, &mut state, &mut view, frame, origin, "/", "ses_1", "ask",
        )
        .await;
        if n == 1 {
            // A model with no prices reports no cost.
            assert!(view.last_usage.as_ref().unwrap().get("cost_usd").is_none());
        }
    }
    let last = view.last_usage.clone().unwrap();
    assert!((cost_of(&last) - 2.0 * STEP_COST).abs() < 1e-12, "{last}");
    assert_eq!(last["model_context_window"], WINDOW, "{last}");
}
