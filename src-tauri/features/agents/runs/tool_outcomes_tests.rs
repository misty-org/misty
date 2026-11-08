use super::*;

fn json(text: &str) -> JsValue {
    JsValue::parse(text).unwrap()
}

fn returned(output: &JsValue, read_only: bool) -> ToolOutcome {
    classify_tool_outcome(&OutcomeInput { success: true, output: Some(output), error: None, read_only, rejected: false })
}

fn thrown(error: &str, read_only: bool, rejected: bool) -> ToolOutcome {
    classify_tool_outcome(&OutcomeInput { success: false, output: None, error: Some(&RuntimeError::text(error)), read_only, rejected })
}

#[test]
fn requires_complete_generated_artifacts_before_a_write() {
    assert!(EXECUTION_INSTRUCTIONS.contains("compose the complete final content before the write"));
    assert!(EXECUTION_INSTRUCTIONS.contains("title, format, count, length, and requested sections"));
    assert!(EXECUTION_INSTRUCTIONS.contains("Never create a placeholder, outline, partial draft, or empty shell"));
}

#[test]
fn returns_calls_that_had_no_effect_to_the_model() {
    assert_eq!(thrown("tool_execution_failed: pass space for this change", false, true).kind(), "retry");
    assert_eq!(thrown("Misty's tool service is temporarily unavailable.", true, false).kind(), "retry");
    assert_eq!(returned(&json(r#"{"status":"failure","reason":"not_found"}"#), false).kind(), "retry");
}

#[test]
fn stops_when_a_writes_outcome_is_unknown_or_needs_the_user() {
    for output in [r#"{"status":"uncertain"}"#, r#"{"status":"user_intervention_required"}"#, r#"{"denied":true}"#, r#"{"unavailable":true}"#] {
        assert_eq!(returned(&json(output), false).kind(), "stop");
    }
    assert_eq!(thrown("Misty could not reach its tool service.", false, false).kind(), "stop");
}

#[test]
fn stops_any_call_once_the_run_loses_its_authority_or_budget() {
    for error in [
        "permission_denied: This run is no longer authorized to use that tool.",
        "agent_execution_time_limit: allowance used",
        "tool_sequence_stopped: earlier failure",
        // The device the person picked dropped out: they pick another.
        "device_offline: Mac mini went offline. Pick another device and ask again.",
    ] {
        assert!(ends_run(error));
        assert_eq!(thrown(error, true, true).kind(), "stop");
    }
}

#[test]
fn hands_the_run_off_when_it_requests_a_screen() {
    assert_eq!(
        returned(&json(r#"{"status":"screen_requested","message":"Opening a browser."}"#), true),
        ToolOutcome::Handoff { reason: "Opening a browser.".to_owned() }
    );
    assert_eq!(returned(&json(r#"{"status":"open"}"#), true).kind(), "confirmed");
}

#[test]
fn hands_the_run_off_while_an_app_card_waits_for_the_user() {
    let connect = json(r#"{"status":"waiting_for_user","message":"for the model","user_message":"Connect Gmail with the card above."}"#);
    assert_eq!(returned(&connect, false), ToolOutcome::Handoff { reason: "Connect Gmail with the card above.".to_owned() });
    let ToolOutcome::Handoff { reason } = returned(&json(r#"{"status":"awaiting_approval"}"#), false) else {
        panic!("expected a handoff");
    };
    assert!(reason.contains("waiting for your approval"));
}

#[test]
fn hands_the_run_off_while_questions_or_a_proposed_plan_wait_for_the_user() {
    let asked = json(r#"{"status":"awaiting_answer","question_set":"question_1","user_message":"Answer the question above and Misty continues."}"#);
    assert_eq!(returned(&asked, true), ToolOutcome::Handoff { reason: "Answer the question above and Misty continues.".to_owned() });
    let ToolOutcome::Handoff { reason } = returned(&json(r#"{"status":"plan_proposed","plan":"plan_1","version":2}"#), true) else {
        panic!("expected a handoff");
    };
    assert!(reason.contains("Review the plan above"));
    // Answers that arrived while the run waited are an ordinary confirmed result.
    assert_eq!(returned(&json(r#"{"status":"answered","answers":[]}"#), true).kind(), "confirmed");
}

#[test]
fn does_not_treat_denied_or_unavailable_actions_as_confirmed() {
    assert!(unconfirmed_tool_result_reason(Some(&json(r#"{"denied":true}"#))).contains("not approved"));
    assert!(unconfirmed_tool_result_reason(Some(&json(r#"{"unavailable":true}"#))).contains("unavailable"));
    assert_eq!(unconfirmed_tool_result_reason(Some(&json(r#"{"id":"note-1"}"#))), "");
    assert_eq!(returned(&json(r#"{"id":"note-1"}"#), false).kind(), "confirmed");
}

#[test]
fn keeps_a_whole_answer_when_the_provider_named_the_stop_oddly_and_nothing_else() {
    let odd = Some("agent_response_incomplete");
    let answer = "All 13 tabs opened successfully and are kept open in your browser.";
    assert!(keeps_answer_after_odd_stop(odd, "other", answer, 0));
    assert!(!keeps_answer_after_odd_stop(odd, "length", answer, 0));
    assert!(!keeps_answer_after_odd_stop(odd, "other", answer, 1));
    assert!(!keeps_answer_after_odd_stop(odd, "other", "ok", 0));
    assert!(!keeps_answer_after_odd_stop(Some("agent_model_turn_limit"), "other", answer, 0));
    assert!(!keeps_answer_after_odd_stop(None, "stop", answer, 0));
}

#[test]
fn results_with_nothing_or_a_plain_value_read_as_in_javascript() {
    assert_eq!(unconfirmed_tool_result_reason(None), "The requested action returned no confirmed result.");
    for plain in ["null", "0", "false", "\"text\"", "[1]"] {
        assert_eq!(unconfirmed_tool_result_reason(Some(&json(plain))), "", "{plain}");
    }
    assert_eq!(unconfirmed_tool_result_reason(Some(&json(r#"{"status":"failure","tool_error":{"message":"  "}}"#))), "The requested action has not completed.");
    assert_eq!(unconfirmed_tool_result_reason(Some(&json(r#"{"status":"failure","tool_error":{"message":"no such note"}}"#))), "no such note");
}

#[test]
fn unfinished_results_name_why_and_a_finished_one_has_none() {
    assert_eq!(unfinished_model_result(true, 1, "stop", DEFAULT_TURN_LIMIT).unwrap().code, "agent_runtime_interrupted");
    assert_eq!(unfinished_model_result(false, 20, "tool-calls", DEFAULT_TURN_LIMIT).unwrap().code, "agent_model_turn_limit");
    assert_eq!(unfinished_model_result(false, 3, "stop", DEFAULT_TURN_LIMIT), None);
    assert!(unfinished_model_result(false, 3, "length", DEFAULT_TURN_LIMIT).unwrap().message.contains("response limit"));
    assert!(unfinished_model_result(false, 0, "stop", DEFAULT_TURN_LIMIT).unwrap().message.contains("did not finish"));
}

#[test]
fn the_final_text_is_the_last_step_with_any() {
    assert_eq!(final_text(&[Some(" first "), Some("  "), None]), "first");
    assert_eq!(final_text::<&str>(&[]), "");
}

#[test]
fn incomplete_text_lists_three_failures_at_most() {
    let failure = |name: &str, error: &str| ToolFailure { tool_name: name.to_owned(), error: error.to_owned() };
    assert_eq!(incomplete_tool_result_text(&[]), "I couldn't fully complete that request. A required action failed.");
    assert_eq!(
        incomplete_tool_result_text(&[failure("a.b_c", " "), failure("d", "x"), failure("e", "y"), failure("f", "z")]),
        "I couldn't fully complete that request. a b c: The action could not be completed.; d: x; e: y"
    );
}
