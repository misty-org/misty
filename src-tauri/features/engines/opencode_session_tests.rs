// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/opencode_session.rs.
use super::*;

#[test]
fn a_command_is_its_name_and_what_follows() {
    assert_eq!(command_in(" /init "), Some(("init", "")));
    assert_eq!(
        command_in("/review the parser\nonly"),
        Some(("review", "the parser\nonly"))
    );
    assert_eq!(command_in("/usr/bin is a path"), None);
    assert_eq!(command_in("hello /init"), None);
    assert_eq!(command_in("/"), None);
}

fn asked() -> Value {
    json!({
        "id": "que_1",
        "sessionID": "ses_1",
        "questions": [
            { "question": "部署到哪?", "header": "目标",
              "options": [{ "label": "staging", "description": "预发" }, { "label": "prod" }] },
            { "question": "附带哪些组件?", "header": "组件", "multiple": true,
              "options": [{ "label": "api" }, { "label": "web" }, { "label": "worker" }] },
            { "question": "备注?", "header": "自由", "options": [] },
        ],
    })
}

#[test]
fn render_questions_maps_multiple_to_multiselect() {
    let rendered = render_questions(&asked());
    assert_eq!(rendered.len(), 3);
    assert_eq!(rendered[0]["header"], "目标");
    assert_eq!(rendered[0]["multiSelect"], false);
    assert_eq!(rendered[0]["options"][0]["description"], "预发");
    assert_eq!(rendered[1]["multiSelect"], true);
    assert_eq!(rendered[2]["options"], json!([]));
    // A missing header falls back.
    assert_eq!(
        render_questions(&json!({ "questions": [{ "question": "x" }] }))[0]["header"],
        "Question"
    );
    assert_eq!(render_questions(&json!({})), Vec::<Value>::new());
}

#[test]
fn reply_answers_orders_labels_and_free_text_per_question() {
    let answers = json!({
        "部署到哪?": "prod",
        "附带哪些组件?": ["api", "worker"],
        "备注?": "周三灰度",
    });
    let reply = reply_answers(&asked(), &answers).expect("reply");
    assert_eq!(
        reply,
        vec![
            vec!["prod".to_string()],
            vec!["api".to_string(), "worker".to_string()],
            vec!["周三灰度".to_string()],
        ]
    );
    // An unanswered question gets an empty array, in place.
    let partial = reply_answers(&asked(), &json!({})).expect("reply");
    assert_eq!(partial, vec![Vec::<String>::new(), Vec::new(), Vec::new()]);
    // A malformed context isn't silently swallowed.
    assert!(reply_answers(&json!({}), &answers).is_none());
}

/// End-to-end against a mock `opencode serve` on the default port:
/// health → session create → prompt_async → SSE (delta + question.asked)
/// → HTTP reply → idle → Done. Proves the whole driver path without a
/// live model.
#[tokio::test]
async fn serves_a_full_question_turn_against_a_mock_server() {
    use crate::engines::registry::ChildEntry;
    use crate::engines::support::event_sink::{Emit, EventSink};
    use crate::engines::ProcessRegistry;
    use std::sync::Mutex as StdMutex;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    struct CollectingEmitter(StdMutex<Vec<String>>);
    impl Emit for CollectingEmitter {
        fn emit_json(&self, _name: &str, raw_json: &str) {
            self.0.lock().unwrap().push(raw_json.to_string());
        }
    }

    async fn respond_json(socket: &mut tokio::net::TcpStream, body: &str) {
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = socket.write_all(response.as_bytes()).await;
    }

    let (reply_seen_tx, mut reply_seen) = mpsc::channel::<String>(1);
    // The mock server: one connection at a time, scripted responses.
    // A non-default port, so it never clashes with a real `opencode serve` (4096); the driver
    // adopts this mock through the same probe port.
    const MOCK_PORT: u16 = 4190;
    let listener = TcpListener::bind(("127.0.0.1", MOCK_PORT))
        .await
        .expect("mock server must bind its port");
    let server_task = tokio::spawn(async move {
        let mut sse_socket = None;
        loop {
            let (mut socket, _) = listener.accept().await.expect("accept");
            let mut head = Vec::new();
            let mut byte = [0u8; 1];
            // Read request line + headers (bodies are small; read per
            // content-length below).
            while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                if socket.read(&mut byte).await.unwrap_or(0) == 0 {
                    break;
                }
                head.push(byte[0]);
                if head.len() > 16384 {
                    break;
                }
            }
            let head = String::from_utf8_lossy(&head).to_string();
            let request_line = head.lines().next().unwrap_or("").to_string();
            // Header names are case-insensitive: a local proxy may rewrite it as Content-Length.
            let content_length: usize = head
                .lines()
                .find_map(|l| {
                    let (name, value) = l.split_once(':')?;
                    name.trim()
                        .eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse().ok())
                        .flatten()
                })
                .unwrap_or(0);
            let mut body = vec![0u8; content_length];
            if content_length > 0 {
                let _ = socket.read_exact(&mut body).await;
            }
            eprintln!("[mock] {request_line}");
            if request_line.starts_with("GET /global/health") {
                respond_json(&mut socket, r#"{"healthy":true,"version":"mock"}"#).await;
            } else if request_line.starts_with("POST /session?") {
                respond_json(&mut socket, r#"{"id":"ses_mock1","slug":"mock"}"#).await;
            } else if request_line.starts_with("GET /event") {
                // Chunked SSE stream; keep the socket for scripted frames.
                let _ = socket
                    .write_all(
                        b"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\n\r\n",
                    )
                    .await;
                sse_socket = Some(socket);
            } else if request_line.starts_with("POST /session/ses_mock1/prompt_async") {
                let _ = socket
                    .write_all(b"HTTP/1.1 204 No Content\r\nconnection: close\r\n\r\n")
                    .await;
                if let Some(sse) = sse_socket.as_mut() {
                    let frames = [
                        json!({"type":"message.part.updated","properties":{"sessionID":"ses_mock1","part":{"id":"p1","messageID":"m1","type":"text"}}}),
                        json!({"type":"message.part.delta","properties":{"sessionID":"ses_mock1","messageID":"m1","partID":"p1","field":"text","delta":"先问一个问题"}}),
                        json!({"type":"question.asked","properties":{"id":"que_mock","sessionID":"ses_mock1","questions":[{"question":"部署到哪?","header":"目标","options":[{"label":"staging"},{"label":"prod"}]}]}}),
                    ];
                    for frame in frames {
                        let data = format!("data: {frame}\n\n");
                        let chunk = format!("{:x}\r\n{data}\r\n", data.len());
                        let _ = sse.write_all(chunk.as_bytes()).await;
                    }
                }
            } else if request_line.starts_with("POST /question/que_mock/reply") {
                let _ = reply_seen_tx
                    .send(String::from_utf8_lossy(&body).to_string())
                    .await;
                respond_json(&mut socket, "true").await;
                if let Some(sse) = sse_socket.as_mut() {
                    let frames = [
                        json!({"type":"message.part.delta","properties":{"sessionID":"ses_mock1","messageID":"m1","partID":"p1","field":"text","delta":",已收到 prod"}}),
                        json!({"type":"session.status","properties":{"sessionID":"ses_mock1","status":{"type":"idle"}}}),
                    ];
                    for frame in frames {
                        let data = format!("data: {frame}\n\n");
                        let chunk = format!("{:x}\r\n{data}\r\n", data.len());
                        let _ = sse.write_all(chunk.as_bytes()).await;
                    }
                }
            } else {
                respond_json(&mut socket, r#"{"error":"unmocked"}"#).await;
            }
        }
    });

    let emitter = Arc::new(CollectingEmitter(StdMutex::new(Vec::new())));
    let registry = Arc::new(ProcessRegistry::default());
    let core = TurnCore {
        sink: EventSink::new(emitter.clone()),
        registry: Arc::clone(&registry),
        engine_id: "opencode".to_string(),
        run_id: "oc-test-run".to_string(),
        db: None,
        followup: None,
    };
    // The virtual registry entry the host path creates at send time.
    registry.insert(
        "oc-test-run".to_string(),
        ChildEntry {
            child: None,
            pid: 4_000_000_201,
            run_id: "oc-test-run".to_string(),
            killed: Arc::new(AtomicBool::new(false)),
            reader_abort: Arc::new(std::sync::OnceLock::new()),
            stdin: None,
            questions: Arc::new(StdMutex::new(HashMap::new())),
            plans: Arc::new(StdMutex::new(HashMap::new())),
        },
    );
    let req = SendRequest {
        session_id: None,
        workspace: std::path::PathBuf::from("/tmp"),
        prompt: "测试提问".to_string(),
        prompt_contributions: Vec::new(),
        native_compact: false,
        images: Vec::new(),
        model: None,
        effort: None,
        service_tier: None,
        permission: None,
        additional_dirs: Vec::new(),
        provider_id: None,
        mcp_servers: None,
        allowed_tools: None,
    };
    let turn = tokio::spawn(run_server_turn_with_probe_port(
        core,
        req,
        "opencode".to_string(),
        Arc::new(OpencodeServerState::default()),
        Arc::new(AtomicBool::new(false)),
        4_000_000_201,
        MOCK_PORT,
    ));
    // Wait for the question to park in the registry, then take answer_question's whole path:
    // read the parked context → reply_answers → POST /question/:id/reply.
    let mut parked = None;
    for _ in 0..40 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        parked = registry.get("oc-test-run").and_then(|entry| {
            entry
                .questions
                .lock()
                .ok()
                .and_then(|q| q.get("que_mock").cloned())
        });
        if parked.is_some() {
            break;
        }
    }
    let parked = parked.expect("question never parked");
    let context = parked.get("opencode").cloned().expect("answer context");
    let origin = context["origin"].as_str().unwrap().to_string();
    let directory = context["directory"].as_str().unwrap().to_string();
    let answers =
        reply_answers(&context["request"], &json!({ "部署到哪?": "prod" })).expect("reply answers");
    opencode_server::post(
        &origin,
        "/question/que_mock/reply",
        &directory,
        Some(json!({ "answers": answers })),
    )
    .await
    .expect("reply post");
    turn.await.expect("turn task");
    server_task.abort();

    let events = emitter.0.lock().unwrap().clone();
    let mut kinds = Vec::new();
    for raw in &events {
        let flushed: Value = serde_json::from_str(raw).expect("flushed batch must be JSON");
        for value in flushed.as_array().cloned().unwrap_or_else(|| vec![flushed]) {
            kinds.push((
                value
                    .get("kind")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                value.get("data").cloned().unwrap_or(Value::Null),
            ));
        }
    }
    // Session announced, deltas streamed, question parked, done settled.
    assert!(
        kinds
            .iter()
            .any(|(k, d)| k == "session" && d == "ses_mock1"),
        "{kinds:?}"
    );
    let deltas: String = kinds
        .iter()
        .filter(|(k, _)| k == "delta")
        .filter_map(|(_, d)| d.as_str())
        .collect();
    assert_eq!(deltas, "先问一个问题,已收到 prod", "{kinds:?}");
    let question = kinds
        .iter()
        .find(|(k, _)| k == "question")
        .map(|(_, d)| d.clone())
        .expect("no question event");
    assert_eq!(question["requestId"], "que_mock");
    assert_eq!(
        question["input"]["questions"][0]["options"][1]["label"],
        "prod"
    );
    assert!(kinds.iter().any(|(k, _)| k == "done"), "{kinds:?}");
    assert!(!kinds.iter().any(|(k, _)| k == "error"), "{kinds:?}");

    // The answered card must be out of the parked map (answer path removes
    // it before the turn-end drain ever sees it — same contract as the
    // answer_question command).
    let still_parked = registry.get("oc-test-run").and_then(|entry| {
        entry
            .questions
            .lock()
            .ok()
            .and_then(|q| q.get("que_mock").cloned())
    });
    // The reply was posted directly (mirroring answer_question), which
    // does not remove the parked copy; the drain settles it afterwards.
    assert!(
        still_parked.is_none(),
        "drain must settle the parked question"
    );
    // The mock saw the reply body the driver's mapping produced.
    let reply_body = reply_seen.try_recv().expect("mock saw no reply POST");
    let reply_json: Value = serde_json::from_str(&reply_body).expect("reply body json");
    assert_eq!(reply_json, json!({ "answers": [["prod"]] }));
}

#[test]
fn parses_context_windows_from_merged_config() {
    let config = json!({
        "provider": {
            "qf": { "models": {
                "deepseek-v4.1-flash": {
                    "limit": { "context": 1_048_576, "output": 393_216 }
                },
                "no-limit": {}
            }},
            "opencode": { "models": {
                "big-pickle": { "limit": { "context": 200_000 } }
            }}
        }
    });
    let windows = parse_context_windows(&config);
    assert_eq!(windows.get("qf/deepseek-v4.1-flash"), Some(&1_048_576));
    assert_eq!(windows.get("opencode/big-pickle"), Some(&200_000));
    assert_eq!(windows.get("qf/no-limit"), None);
    assert!(parse_context_windows(&json!({})).is_empty());
    // The mock server's unmocked reply must not match or panic.
    assert!(parse_context_windows(&json!({ "error": "unmocked" })).is_empty());
}

#[test]
fn attaches_the_window_only_when_usage_omits_it() {
    let mut windows = HashMap::new();
    windows.insert("qf/deepseek-v4.1-flash".to_string(), 1_048_576u64);
    let info = json!({ "providerID": "qf", "modelID": "deepseek-v4.1-flash" });

    let usage = attach_context_window(json!({ "input": 12018, "output": 50 }), &info, &windows);
    assert_eq!(usage["model_context_window"], 1_048_576);

    // An engine-reported window wins; an unknown model stays untouched.
    let reported = attach_context_window(
        json!({ "input": 1, "model_context_window": 200_000 }),
        &info,
        &windows,
    );
    assert_eq!(reported["model_context_window"], 200_000);
    let unknown = attach_context_window(
        json!({ "input": 1 }),
        &json!({ "providerID": "other", "modelID": "x" }),
        &windows,
    );
    assert!(unknown.get("model_context_window").is_none());
}

#[test]
fn error_messages_come_out_of_nested_shapes() {
    assert_eq!(
        extract_error_message(&json!({
            "error": { "name": "APIError", "data": { "message": "invalid x-api-key" } }
        })),
        Some("invalid x-api-key".to_string())
    );
    assert_eq!(
        extract_error_message(&json!({ "error": "plain" })),
        Some("plain".to_string())
    );
    assert_eq!(extract_error_message(&json!({})), None);
}

#[test]
fn bypass_answers_permission_asks_always() {
    assert_eq!(permission_reply(Some("bypass")), "always");
    // Every other mode (and unresolved/unknown values) approves each
    // ask individually; the engine trait already falls back to "auto".
    assert_eq!(permission_reply(Some("auto")), "once");
    assert_eq!(permission_reply(Some("plan")), "once");
    assert_eq!(permission_reply(Some("manual")), "once");
    assert_eq!(permission_reply(None), "once");
}
