// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/omp_acp.rs.
use super::*;
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
            pid: 4_000_000_077,
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
        engine_id: "omp".to_string(),
        run_id: "test-run".to_string(),
        db: None,
        followup: None,
    };
    (core, registry, emitter)
}

fn test_request() -> SendRequest {
    SendRequest {
        session_id: None,
        workspace: PathBuf::from("/tmp/ccgui-omp-acp-test"),
        prompt: "Make a plan".to_string(),
        prompt_contributions: Vec::new(),
        native_compact: false,
        images: Vec::new(),
        model: None,
        effort: None,
        service_tier: None,
        permission: Some("plan".to_string()),
        additional_dirs: Vec::new(),
        provider_id: None,
        mcp_servers: None,
        allowed_tools: None,
    }
}

fn elicitation_params(message: &str) -> Value {
    json!({
        "mode": "form",
        "sessionId": "s-1",
        "message": message,
        "requestedSchema": {
            "type": "object",
            "properties": { "value": { "type": "string", "enum": ["Approve and execute", "Refine plan"] } },
            "required": ["value"],
        },
    })
}

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("ccgui-omp-acp-test-{}-{tag}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn initialize_declares_elicitation_form_and_the_check_gates_it() {
    let params = omp_initialize_params();
    assert!(elicitation_form_declared(&params));
    assert_eq!(
        params["clientCapabilities"]["elicitation"],
        json!({ "form": {} })
    );
    assert!(!elicitation_form_declared(&initialize_params()));
    assert!(!elicitation_form_declared(&json!({
        "clientCapabilities": { "elicitation": { "form": null } }
    })));
}

#[test]
fn detects_only_the_plan_approval_elicitation() {
    assert!(is_plan_approval_elicitation(&elicitation_params(
        "Approve plan \"auth\" and start implementation?\n\n# Auth\n"
    )));
    let mut swapped = elicitation_params("Approve plan \"a\" and start implementation?\n\nx");
    swapped["requestedSchema"]["properties"]["value"]["enum"] =
        json!(["Refine plan", "Approve and execute"]);
    assert!(is_plan_approval_elicitation(&swapped));
    for params in [
        json!({ "mode": "form", "requestedSchema": { "properties": { "value": { "type": "string" } } } }),
        json!({ "mode": "form", "requestedSchema": { "properties": { "value": { "enum": ["Approve and execute"] } } } }),
        json!({ "mode": "form", "requestedSchema": { "properties": { "value": { "enum": ["Approve and execute ", "Refine plan"] } } } }),
        json!({ "mode": "url", "requestedSchema": { "properties": { "value": { "enum": ["Approve and execute", "Refine plan"] } } } }),
        json!({}),
    ] {
        assert!(
            !is_plan_approval_elicitation(&params),
            "misclassified: {params}"
        );
    }
}

#[test]
fn approval_frames_match_the_cli_labels_exactly() {
    let frames = approval_frames(&json!(9));
    assert_eq!(
        frames["approve"],
        json!({
            "jsonrpc": "2.0",
            "id": 9,
            "result": { "action": "accept", "content": { "value": "Approve and execute" } },
        })
    );
    assert_eq!(
        frames["changes"],
        json!({
            "jsonrpc": "2.0",
            "id": 9,
            "result": { "action": "accept", "content": { "value": "Refine plan" } },
        })
    );
    let frames = approval_frames(&json!("req-3"));
    assert_eq!(frames["approve"]["id"], json!("req-3"));
    assert_eq!(frames["changes"]["id"], json!("req-3"));
}

#[test]
fn parses_the_approval_message_and_binds_the_preview() {
    let (title, preview) = parse_approval_message(
        "Approve plan \"auth-refactor\" and start implementation?\n\n# 认证重构\n步骤一\n",
    )
    .expect("approval message");
    assert_eq!(title, "auth-refactor");
    assert_eq!(preview, "# 认证重构\n步骤一\n");
    assert!(parse_approval_message("选哪种？").is_none());
    assert!(parse_approval_message("Approve plan \"\" and start implementation?").is_none());
    assert!(parse_approval_message("Approve plan \"x\" and run?").is_none());

    let short = "a\nb\nc";
    assert!(preview_matches(short, "a\nb\nc"));
    assert!(!preview_matches(short, "a\nb\nc\n…"));
    let long: String = (1..=20).map(|n| format!("l{n}\n")).collect();
    let long = long.trim_end_matches('\n');
    let head12 = (1..=12)
        .map(|n| format!("l{n}"))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(preview_matches(long, &format!("{head12}\n…")));
    assert!(!preview_matches(long, &head12));
    assert!(!preview_matches(long, "l1\nl2\nCHANGED\n…"));
}

#[test]
fn slug_and_heading_follow_the_cli_rules() {
    assert_eq!(
        slug_from_title("auth-refactor"),
        Some("auth-refactor".into())
    );
    assert_eq!(slug_from_title("auth-plan"), Some("auth".into()));
    assert_eq!(slug_from_title("auth-PLAN"), Some("auth".into()));
    assert_eq!(slug_from_title("plan"), Some("plan".into()));
    assert_eq!(
        slug_from_title("My feature plan.md"),
        Some("My-feature".into())
    );
    assert_eq!(slug_from_title("!!!"), None);
    assert_eq!(first_heading("# 认证重构\n正文"), Some("认证重构".into()));
    assert_eq!(first_heading("## 二级\n# 一级"), Some("一级".into()));
    assert_eq!(first_heading("#noSpace\n正文"), None);
    assert_eq!(first_heading("没有标题"), None);
}

#[test]
fn session_dir_name_encoding_matches_the_cli() {
    let home = Path::new("/Users/alice");
    let tmp = Path::new("/private/var/folders/xx");
    assert_eq!(
        encode_session_dir_name(
            Path::new("/Users/alice/proj"),
            Some(home),
            tmp,
            Path::new("/Users/alice/proj")
        ),
        "-proj"
    );
    assert_eq!(encode_session_dir_name(home, Some(home), tmp, home), "-");
    assert_eq!(
        encode_session_dir_name(
            Path::new("/private/var/folders/xx/ws"),
            Some(home),
            tmp,
            Path::new("/private/var/folders/xx/ws")
        ),
        "-tmp-ws"
    );
    assert_eq!(
        encode_session_dir_name(
            Path::new("/Volumes/data/proj"),
            Some(home),
            tmp,
            Path::new("/Volumes/data/proj")
        ),
        "--Volumes-data-proj--"
    );
}

#[test]
fn whitelist_read_rejects_escape_oversize_and_missing() {
    let root = temp_dir("whitelist");
    let local = root.join("local");
    std::fs::create_dir_all(&local).unwrap();
    std::fs::write(local.join("auth-plan.md"), "# Auth\n").unwrap();

    assert_eq!(
        read_plan_candidate(&local, "auth-plan.md").unwrap(),
        Some("# Auth\n".to_string())
    );
    assert_eq!(read_plan_candidate(&local, "ghost-plan.md").unwrap(), None);
    assert!(read_plan_candidate(&local, "notes.md").is_err());
    assert!(read_plan_candidate(&local, "a/b-plan.md").is_err());
    assert!(read_plan_candidate(&local, "..\\x-plan.md").is_err());
    std::fs::write(local.join("huge-plan.md"), vec![b'x'; MAX_PLAN_BYTES + 1]).unwrap();
    let error = read_plan_candidate(&local, "huge-plan.md").unwrap_err();
    assert!(error.contains("1 MiB"), "{error}");

    #[cfg(unix)]
    {
        let outside = root.join("outside-plan.md");
        std::fs::write(&outside, "secret").unwrap();
        std::os::unix::fs::symlink(&outside, local.join("evil-plan.md")).unwrap();
        let error = read_plan_candidate(&local, "evil-plan.md").unwrap_err();
        assert!(error.contains("escapes"), "{error}");
    }
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn verified_plan_loads_only_when_the_preview_matches() {
    let root = temp_dir("verified");
    let local = root.join("local");
    std::fs::create_dir_all(&local).unwrap();
    let content = "# Auth 计划\n第一步\n第二步\n";
    std::fs::write(local.join("auth-plan.md"), content).unwrap();
    let params = elicitation_params(
        "Approve plan \"auth\" and start implementation?\n\n# Auth 计划\n第一步\n第二步\n",
    );
    let (loaded, title) = load_verified_plan(std::slice::from_ref(&local), &params).unwrap();
    assert_eq!(loaded, content);
    assert_eq!(title, "auth");
    assert!(loaded.contains("第一步"));

    let stale =
        elicitation_params("Approve plan \"auth\" and start implementation?\n\n# 别的计划\n");
    let error = load_verified_plan(std::slice::from_ref(&local), &stale).unwrap_err();
    assert!(error.contains("doesn't match"), "{error}");
    assert!(load_verified_plan(&[], &params).is_err());
    let empty = temp_dir("verified-empty");
    assert!(load_verified_plan(std::slice::from_ref(&empty), &params).is_err());
    let _ = std::fs::remove_dir_all(&root);
    let _ = std::fs::remove_dir_all(&empty);
}

#[test]
fn session_local_roots_scans_the_session_artifacts_dir() {
    let base = temp_dir("roots");
    let sessions_root = base.join("sessions");
    let workspace = base.join("ws");
    std::fs::create_dir_all(&workspace).unwrap();
    let encoded = session_dir_name(&workspace);
    let local = sessions_root
        .join(&encoded)
        .join("2026-09-24T10-00-00.000_01JTESTSESSION/local");
    std::fs::create_dir_all(&local).unwrap();
    std::fs::write(
        sessions_root
            .join(&encoded)
            .join("2026-09-24T10-00-00.000_01JTESTSESSION.jsonl"),
        "{}",
    )
    .unwrap();
    std::fs::create_dir_all(
        sessions_root
            .join(&encoded)
            .join("2026-09-24T09-00-00.000_01JOTHER/local"),
    )
    .unwrap();
    let locals = session_local_roots(&[sessions_root], &workspace, "01JTESTSESSION");
    assert_eq!(locals, vec![local]);
    let _ = std::fs::remove_dir_all(&base);
}

#[tokio::test]
async fn resume_is_refused_before_any_spawn() {
    let (core, _registry, emitter) = test_core();
    let mut req = test_request();
    req.session_id = Some("01JOLD".to_string());
    let built = BuiltCommand {
        command: tokio::process::Command::new("ccgui-definitely-not-a-real-binary"),
        stdin_payload: None,
        keep_stdin_open: false,
        cleanup_files: Vec::new(),
        preassigned_session_id: None,
    };
    run_acp_turn(
        core,
        req,
        built,
        Arc::new(AtomicBool::new(false)),
        4_000_000_077,
    )
    .await;
    let emitted = emitter.0.lock().unwrap().join(" ");
    assert!(emitted.contains("\"error\""), "{emitted}");
    assert!(emitted.contains("new session"), "{emitted}");
}

#[tokio::test]
async fn usage_update_sizes_the_context_and_the_turn_total_keeps_its_window() {
    let (core, _registry, emitter) = test_core();
    let mut state = TurnState::new(None);
    let mut view = TurnView::default();
    let update = json!({"sessionId": "s1", "update": {"sessionUpdate": "usage_update",
        "size": 128000, "used": 14777, "cost": {"amount": 0.01, "currency": "USD"}}});
    handle_session_update(&core, &mut state, &mut view, &update);
    assert_eq!(view.context_window, Some(128000));
    core.sink.flush();
    let emitted = emitter.0.lock().unwrap().join(" ");
    assert!(emitted.contains("\"used\":14777"), "{emitted}");
    let answer = json!({"stopReason": "end_turn", "usage": {"inputTokens": 300,
        "outputTokens": 200, "totalTokens": 40300, "cachedReadTokens": 39800}});
    let usage = prompt_usage(&answer, view.context_window).unwrap();
    assert_eq!(usage["model_context_window"], 128000);
    assert_eq!(
        crate::engines::bridge::context_usage(&usage),
        (Some(40300), Some(128000))
    );
}
