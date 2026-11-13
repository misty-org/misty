use super::*;

fn journal() -> (tempfile::TempDir, Store) {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::at(directory.path().join("misty.db"));
    store.connect().unwrap();
    (directory, store)
}

fn write(store: &Store, call: &str, outcome: Option<&str>) {
    store
        .connect()
        .unwrap()
        .execute(
            "INSERT INTO agent_tool_journal (run_id, call_id, name, outcome, updated_at)
             VALUES ('r', ?1, 'browser.run', ?2, 0)",
            rusqlite::params![call, outcome],
        )
        .unwrap();
}

#[test]
fn a_run_with_only_settled_calls_is_confirmed() {
    let (_directory, store) = journal();
    assert!(!has_unconfirmed(&store, "r"));
    write(&store, "a", Some(r#"{"result":{"ok":true}}"#));
    write(&store, "b", Some(r#"{"code":"x","message":"m"}"#));
    assert!(!has_unconfirmed(&store, "r"));
}

#[test]
fn a_write_nobody_saw_end_or_that_ended_uncertain_is_not() {
    let (_directory, store) = journal();
    write(&store, "a", None);
    assert!(has_unconfirmed(&store, "r"));
    let (_other, store) = journal();
    write(
        &store,
        "a",
        Some(r#"{"result":{"status":"uncertain","message":"m"}}"#),
    );
    assert!(has_unconfirmed(&store, "r"));
}

#[test]
fn a_run_being_proposed_is_still_going_and_one_nobody_knows_is_missing() {
    let answer = [json!({ "type": "local.artifact_answer", "text": "{}" })];
    assert_eq!(follow_state(&answer, false), "running");
    assert_eq!(follow_state(&[], true), "running");
    assert_eq!(follow_state(&[], false), "missing");
    let ended = [
        answer[0].clone(),
        json!({ "type": "invocation.completed", "state": "completed" }),
    ];
    assert_eq!(follow_state(&ended, false), "completed");
}

#[test]
fn a_window_cannot_end_a_run_or_raise_a_card() {
    for kind in [
        "invocation.completed",
        "invocation.failed",
        "invocation.canceled",
        "app.request",
    ] {
        assert!(!publishable(kind), "{kind}");
    }
    for kind in [
        "screen.request",
        "plan.proposed",
        "assistant.message",
        "artifact.proposed",
    ] {
        assert!(publishable(kind), "{kind}");
    }
}

#[test]
fn only_a_run_waiting_for_its_proposal_can_be_ended_by_it() {
    let waiting = [json!({ "type": "local.artifact_answer", "text": "{}" })];
    assert!(may_end_proposal(&waiting, "invocation.completed"));
    assert!(may_end_proposal(&waiting, "invocation.failed"));
    assert!(!may_end_proposal(&waiting, "invocation.canceled"));
    assert!(!may_end_proposal(
        &[json!({ "type": "response.delta" })],
        "invocation.completed"
    ));
    let ended = [
        waiting[0].clone(),
        json!({ "type": "invocation.completed", "state": "completed" }),
    ];
    assert!(!may_end_proposal(&ended, "invocation.failed"));
}

#[test]
fn events_say_how_a_run_ended_and_are_kept_per_run() {
    keep("kept", &json!({ "type": "response.delta", "delta": "Hi" }));
    assert_eq!(ended_state(log().events.get("kept").unwrap()), None);
    keep(
        "kept",
        &json!({ "type": "invocation.completed", "state": "completed" }),
    );
    assert_eq!(
        ended_state(log().events.get("kept").unwrap()),
        Some("completed")
    );
    assert!(!log().events.contains_key("other"));
}
