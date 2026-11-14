use super::events::{after_compaction, tool_text, usage_of};
use super::forms::{form_answer, render_form};
use super::*;

/// The form the question tool makes in 2.3.0 for two questions.
fn question_form() -> Value {
    json!({
        "id": "frm_1",
        "sessionID": "ses_1",
        "title": "Questions",
        "metadata": { "kind": "question" },
        "fields": [
            { "key": "q0", "title": "Target", "description": "Where to deploy?", "type": "string",
              "options": [{ "value": "staging", "label": "staging", "description": "pre" },
                          { "value": "prod", "label": "prod" }], "custom": true },
            { "key": "q1", "title": "Parts", "description": "Which parts?", "type": "multiselect",
              "options": [{ "value": "api", "label": "api" }, { "value": "web", "label": "web" }],
              "custom": true },
            { "key": "q2", "title": "Hidden", "type": "string", "hidden": true },
        ],
    })
}

#[test]
fn a_question_form_renders_as_cards() {
    let cards = render_form(&question_form());
    assert_eq!(cards.len(), 2);
    assert_eq!(cards[0]["question"], "Where to deploy?");
    assert_eq!(cards[0]["header"], "Target");
    assert_eq!(cards[0]["multiSelect"], false);
    assert_eq!(cards[0]["options"][0]["description"], "pre");
    assert_eq!(cards[1]["multiSelect"], true);
}

#[test]
fn card_answers_go_back_by_field_key() {
    let answer = form_answer(
        &question_form(),
        &json!({ "Where to deploy?": "prod", "Which parts?": ["api", "web"] }),
    )
    .expect("answer");
    assert_eq!(answer, json!({ "q0": "prod", "q1": ["api", "web"] }));
    // Free text goes as typed; an unanswered question is left out.
    let typed = form_answer(
        &question_form(),
        &json!({ "Where to deploy?": "on Wednesday" }),
    )
    .expect("answer");
    assert_eq!(typed, json!({ "q0": "on Wednesday" }));
}

#[test]
fn yes_no_and_number_fields_answer_in_their_types() {
    let form = json!({ "fields": [
        { "key": "ok", "title": "Go on?", "type": "boolean" },
        { "key": "n", "title": "How many?", "type": "integer" },
    ]});
    let cards = render_form(&form);
    assert_eq!(
        cards[0]["options"],
        json!([{ "label": "Yes" }, { "label": "No" }])
    );
    let answer = form_answer(&form, &json!({ "Go on?": "Yes", "How many?": "3" })).unwrap();
    assert_eq!(answer, json!({ "ok": true, "n": 3.0 }));
}

#[test]
fn events_belong_to_their_session() {
    let text = json!({ "type": "session.text.delta", "data": { "sessionID": "ses_1" } });
    let form = json!({ "type": "form.created", "data": { "form": { "sessionID": "ses_1" } } });
    let other = json!({ "type": "server.connected", "data": {} });
    assert_eq!(event_session(&text), Some("ses_1"));
    assert_eq!(event_session(&form), Some("ses_1"));
    assert_eq!(event_session(&other), None);
}

/// Misty's own launch and calls against a real 2.x install, at no cost (no prompt is sent):
/// `OPENCODE_BIN=/path/to/opencode cargo test --lib live_v2_server -- --ignored`.
#[tokio::test]
#[ignore]
async fn live_v2_server() {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let bin = std::env::var("OPENCODE_BIN").expect("OPENCODE_BIN");
    let folder = std::env::temp_dir().join("misty-opencode-v2-probe");
    std::fs::create_dir_all(&folder).unwrap();
    let directory = folder.to_string_lossy().to_string();
    let state = opencode_server::OpencodeServerState::default();
    // A port nothing answers on, so Misty starts its own server.
    let origin = opencode_server::ensure_server(&state, &bin, 1)
        .await
        .expect("server");
    assert!(opencode_server::is_v2(&origin));
    let commands = super::super::commands(&origin, &directory).await;
    assert!(commands.iter().any(|name| name == "review"), "{commands:?}");
    let created = call(
        Method::POST,
        &origin,
        "/api/session",
        None,
        Some(json!({ "location": { "directory": directory } })),
    )
    .await
    .expect("session");
    let session = data(&created)["id"].as_str().unwrap().to_string();
    call(
        Method::PATCH,
        &origin,
        &format!("/api/session/{session}"),
        None,
        Some(json!({ "title": "Probe" })),
    )
    .await
    .expect("rename");
    let shell = call(
        Method::POST,
        &origin,
        &format!("/api/session/{session}/shell"),
        None,
        Some(json!({ "command": "echo hi" })),
    )
    .await;
    assert!(shell.is_ok(), "{shell:?}");
    let listed = messages(&origin, &session).await.expect("messages");
    assert!(
        listed
            .iter()
            .any(|m| m["type"] == "shell" && m["output"]["output"] == "hi\n"),
        "{listed:?}"
    );
    let forked = call(
        Method::POST,
        &origin,
        &format!("/api/session/{session}/fork"),
        None,
        Some(json!({})),
    )
    .await
    .expect("fork");
    assert!(data(&forked)["id"].as_str().is_some());
    let (mut events, ready) = event_stream(&origin, session.clone());
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), ready)
            .await
            .ok()
            .and_then(Result::ok),
        Some(true)
    );
    call(
        Method::POST,
        &origin,
        &format!("/api/session/{session}/shell"),
        None,
        Some(json!({ "command": "true" })),
    )
    .await
    .expect("second shell");
    let frame = tokio::time::timeout(Duration::from_secs(5), events.recv())
        .await
        .expect("an event");
    assert_eq!(
        frame.as_ref().and_then(event_session),
        Some(session.as_str())
    );
    let windows = context_windows(&origin, &directory).await;
    assert!(!windows.is_empty());
    state.kill_spawned();
}

#[test]
fn step_tokens_become_the_usage_the_bar_reads() {
    // A 2.3.0 `session.step.ended` on a cached turn: most of the prompt is in the cache.
    let tokens = json!({ "input": 82, "output": 75, "reasoning": 3,
                         "cache": { "read": 5376, "write": 10 } });
    assert_eq!(
        usage_of(&tokens, Some(200_000)),
        json!({ "input_tokens": 82, "output_tokens": 75, "reasoning_tokens": 3,
                "cache_read_input_tokens": 5376, "cache_creation_input_tokens": 10,
                "model_context_window": 200_000 })
    );
    assert!(usage_of(&tokens, None)
        .get("model_context_window")
        .is_none());
}

#[test]
fn a_compaction_reports_no_context_size() {
    // 2.3.0's `session.compaction.ended` tokens are the summarizing call's: they read the context
    // from before, so the count clears while the tokens still count as spent.
    let tokens = json!({ "input": 580, "output": 165, "reasoning": 0,
                         "cache": { "read": 5504, "write": 0 } });
    let usage = after_compaction(usage_of(&tokens, Some(200_000)));
    assert_eq!(usage["used"], 0);
    assert_eq!(usage["output_tokens"], 165);
    assert_eq!(
        crate::engines::bridge::context_usage(&usage),
        (Some(0), Some(200_000))
    );
}

#[test]
fn tool_output_is_its_text_contents() {
    let event = json!({ "content": [
        { "type": "text", "text": "line one" },
        { "type": "file", "uri": "file:///a.png", "mime": "image/png", "name": "a.png" },
    ]});
    assert_eq!(tool_text(&event), "line one\na.png");
}
