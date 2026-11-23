use super::*;

#[test]
fn the_same_provider_id_in_a_later_turn_is_another_call() {
    let call = |turn| LocalToolCall {
        run_id: "r".into(),
        call_id: "call_1".into(),
        turn,
        name: "file.update".into(),
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
        label: "old-host".to_owned(),
        routed: false,
        received: true,
    }
}

fn routed_call() -> PendingCall {
    sent_to("app-window", true).0
}

fn sent_to(label: &str, received: bool) -> (PendingCall, oneshot::Receiver<Answer>) {
    let (send, receive) = oneshot::channel();
    (
        PendingCall {
            send,
            replay: None,
            label: label.to_owned(),
            routed: true,
            received,
        },
        receive,
    )
}

#[test]
fn a_reload_asks_again_only_what_is_safe_to_repeat() {
    assert!(repeats_safely("agent.delegate"));
    assert!(repeats_safely("agent.wait"));
    assert!(repeats_safely("file.read"));
    assert!(!repeats_safely("file.create"));
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
    assert_eq!(
        after_page_load(&mut calls, "new-host"),
        [json!({ "id": "read" })]
    );
    assert!(calls.contains_key("read") && !calls.contains_key("write"));
    assert_eq!(calls["read"].label, "new-host");
}

#[test]
fn a_host_reload_leaves_calls_sent_to_an_apps_window_alone() {
    let mut calls = HashMap::from([("app".to_owned(), routed_call())]);
    assert!(after_page_load(&mut calls, "new-host").is_empty());
    assert_eq!(calls["app"].label, "app-window");
}

#[test]
fn a_reload_of_an_apps_window_ends_only_the_calls_sent_to_it() {
    let (sent, _sent) = sent_to("app-window", true);
    let (elsewhere, _elsewhere) = sent_to("other-window", true);
    let mut calls = HashMap::from([
        ("sent".to_owned(), sent),
        ("elsewhere".to_owned(), elsewhere),
        ("host".to_owned(), call(None)),
    ]);
    let ended = take_routed(&mut calls, "app-window");
    assert_eq!(ended.len(), 1);
    assert!(!calls.contains_key("sent"));
    assert!(calls.contains_key("elsewhere") && calls.contains_key("host"));
    assert!(take_routed(&mut calls, "old-host").is_empty());
}

#[test]
fn a_reload_is_uncertain_once_the_call_reached_the_window_and_a_refusal_before() {
    let (delivered, mut heard) = sent_to("app-window", true);
    let (unsent, mut unheard) = sent_to("app-window", false);
    for call in [delivered, unsent] {
        let _ = call.send.send(reloaded(call.received));
    }
    assert!(matches!(
        heard.try_recv(),
        Ok(Answer::Uncertain { message }) if message == APP_RELOADED
    ));
    assert!(matches!(
        unheard.try_recv(),
        Ok(Answer::Failed { code, message }) if code == "app_unavailable" && message == APP_RELOADED_UNSENT
    ));
}

#[test]
fn a_window_receipt_reads_apart_from_its_answer() {
    let read = |text: &str| serde_json::from_str::<Reply>(text).unwrap();
    assert!(matches!(
        read(r#"{"state":"received"}"#),
        Reply::Received(Receipt::Received)
    ));
    assert!(matches!(
        read(r#"{"state":"done","result":{}}"#),
        Reply::Answer(Answer::Done { .. })
    ));
    assert!(matches!(
        read(r#"{"state":"failed","code":"c","message":"m"}"#),
        Reply::Answer(Answer::Failed { .. })
    ));
}

#[test]
fn a_call_nobody_picked_up_ends_and_one_picked_up_goes_on() {
    let (unheard, _unheard) = sent_to("app-window", false);
    let (heard, _heard) = sent_to("app-window", false);
    let mut calls = HashMap::from([("unheard".to_owned(), unheard), ("heard".to_owned(), heard)]);
    mark_received(&mut calls, "heard");
    assert!(take_unreceived(&mut calls, "unheard"));
    assert!(!calls.contains_key("unheard"));
    assert!(!take_unreceived(&mut calls, "heard"));
    assert!(calls.contains_key("heard"));
    assert!(!take_unreceived(&mut calls, "missing"));
}

#[test]
fn a_reload_answers_the_calls_it_ends() {
    let (sent, mut heard) = sent_to("reloading-window", true);
    pending()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert("reloading-call".to_owned(), sent);
    window_reloaded("reloading-window");
    assert!(!pending()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .contains_key("reloading-call"));
    assert!(matches!(
        heard.try_recv(),
        Ok(Answer::Uncertain { message }) if message == APP_RELOADED
    ));
}
