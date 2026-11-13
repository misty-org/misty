use super::*;

#[test]
fn the_same_provider_id_in_a_later_turn_is_another_call() {
    let call = |turn| LocalToolCall {
        run_id: "r".into(),
        call_id: "call_1".into(),
        turn,
        name: "note.update".into(),
        input: json!({}),
    };
    assert_ne!(journal_key(&call(1)), journal_key(&call(2)));
    assert_eq!(journal_key(&call(1)), journal_key(&call(1)));
}

#[test]
fn every_read_only_tool_is_a_local_one() {
    for name in READ_ONLY {
        assert!(LOCAL_TOOLS.contains(name), "{name}");
    }
}

#[test]
fn a_window_answer_reads_each_state() {
    let read = |text: &str| serde_json::from_str::<Answer>(text).unwrap();
    assert!(matches!(
        read(r#"{"state":"done","result":{"a":1}}"#),
        Answer::Done { .. }
    ));
    assert!(matches!(
        read(r#"{"state":"failed","code":"c","message":"m"}"#),
        Answer::Failed { .. }
    ));
    assert!(matches!(
        read(r#"{"state":"uncertain","message":"m"}"#),
        Answer::Uncertain { .. }
    ));
}

fn call(replay: Option<Value>) -> PendingCall {
    PendingCall {
        send: oneshot::channel().0,
        replay,
    }
}

#[test]
fn a_reload_asks_again_only_what_is_safe_to_repeat() {
    assert!(repeats_safely("agent.delegate"));
    assert!(repeats_safely("agent.wait"));
    assert!(repeats_safely("note.read"));
    assert!(!repeats_safely("log.work.write"));
    assert!(!repeats_safely("shell.run"));
    assert!(!repeats_safely("message.send"));
}

#[test]
fn a_write_ends_at_a_reload_and_a_repeatable_call_goes_on() {
    let mut calls = HashMap::from([
        ("write".to_owned(), call(None)),
        ("read".to_owned(), call(Some(json!({ "id": "read" })))),
    ]);
    assert_eq!(after_page_load(&mut calls), [json!({ "id": "read" })]);
    assert!(calls.contains_key("read") && !calls.contains_key("write"));
}
