use super::super::tool_errors::classify_tool_transport_error;
use super::super::tool_outcomes::{classify_tool_outcome, incomplete_tool_result_text, stopped_at_model_turn_limit, tool_failure_signature, OutcomeInput, ToolFailure};
use super::*;
use crate::js_json::JsValue;

fn control(status: u16, message: &str, code: Option<&str>) -> RuntimeError {
    ControlPlaneError::new(status, message, code).into()
}

fn code(error: RuntimeError) -> &'static str {
    classify_runtime_error(&error).code
}

#[test]
fn names_rate_limit_refusals_so_a_run_pauses_instead_of_failing_generically() {
    assert_eq!(code(RuntimeError::error("usage_limit_reached")), "usage_limit_reached");
    // A refusal is not transient: retrying the step at once cannot succeed.
    assert!(!ControlPlaneError::new(402, "limit", Some("usage_limit_reached")).transient);
    assert!(!ControlPlaneError::new(503, "down", Some("usage_limit_reached")).transient);
}

#[test]
fn preserves_a_safe_native_browser_failure_without_exposing_its_raw_details() {
    let visible = |text: &str| visible_error_message(&RuntimeError::error(text));
    assert_eq!(visible("browser_webview_unavailable: private diagnostic details"), "The local browser view is unavailable. Reopen the browser view and retry the task.");
    assert_eq!(visible("desktop_accessibility_required: private diagnostic"), "Allow the running Misty app in System Settings → Privacy & Security → Accessibility, then retry.");
    assert_eq!(visible("desktop_screen_recording_required: private diagnostic"), "Allow the running Misty app in System Settings → Privacy & Security → Screen Recording, then retry.");
    assert_eq!(visible("unclassified private diagnostic"), "The tool could not complete this action.");
}

#[test]
fn does_not_treat_tool_calls_at_the_step_limit_as_a_finished_answer() {
    assert!(stopped_at_model_turn_limit(20, "tool-calls", 20));
    assert!(stopped_at_model_turn_limit(20, "length", 20));
    assert!(!stopped_at_model_turn_limit(20, "stop", 20));
    assert!(!stopped_at_model_turn_limit(19, "tool-calls", 20));
}

#[test]
fn stops_on_a_durable_model_budget_limit_instead_of_retrying_it_as_invalid_input() {
    let error = control(422, "agent_model_turn_limit", Some("agent_model_turn_limit"));
    assert!(matches!(&error, RuntimeError::ControlPlane(failure) if !failure.transient));
    assert_eq!(recoverable_tool_error(&error), None);
    assert_eq!(code(error), "agent_model_turn_limit");
    assert_eq!(code(RuntimeError::error("agent_model_turn_limit")), "agent_model_turn_limit");
}

#[test]
fn treats_execution_time_exhaustion_as_a_terminal_budget_outcome() {
    let error = control(422, "agent_execution_time_limit", Some("agent_execution_time_limit"));
    assert!(matches!(&error, RuntimeError::ControlPlane(failure) if !failure.transient));
    assert_eq!(recoverable_tool_error(&error), None);
    assert_eq!(code(error.clone()), "agent_execution_time_limit");
    let outcome = classify_tool_outcome(&OutcomeInput { success: false, output: None, error: Some(&RuntimeError::text(error.to_string())), read_only: true, rejected: true });
    assert_eq!(outcome.kind(), "stop");
}

#[test]
fn retries_only_transient_control_plane_responses() {
    assert!(ControlPlaneError::new(503, "unavailable", None).transient);
    assert!(ControlPlaneError::new(429, "limited", None).transient);
    assert!(!ControlPlaneError::new(429, "usage_limit_reached", Some("usage_limit_reached")).transient);
    assert!(!ControlPlaneError::new(403, "revoked", None).transient);
}

#[test]
fn gives_timeouts_and_authorization_changes_stable_public_codes() {
    assert_eq!(code(RuntimeError::named("TimeoutError", "timed out")), "agent_runtime_timeout");
    assert_eq!(code(control(403, "grant removed", None)), "authorization_or_state_changed");
    assert_eq!(code(RuntimeError::error("provider failed")), "agent_runtime_failed");
    assert_eq!(
        classify_runtime_error(&RuntimeError::error("model_key_needed: Add a model key in Settings → Models.")),
        classified("model_key_needed", "Add a model key in Settings → Models.")
    );
    // Go refusing the run's route keeps its code through the step.
    assert_eq!(code(control(409, "model_key_needed: no key", Some("model_key_needed"))), "model_key_needed");
    assert_eq!(
        classify_runtime_error(&RuntimeError::named("GatewayInternalServerError", "Service temporarily unavailable. Please try again shortly.")),
        classified("model_gateway_unavailable", "The model provider is temporarily unavailable. Please try again shortly.")
    );
}

#[test]
fn preserves_provider_credit_exhaustion_through_workflow_errors() {
    let text = "A positive credit balance is required for all requests, including BYOK.";
    let gateway = RuntimeError::named("GatewayInternalServerError", text);
    for error in [
        RuntimeError::error(text),
        gateway.clone(),
        RuntimeError::error("Workflow step failed").with_cause(gateway),
        RuntimeError::text("insufficient_quota"),
    ] {
        assert_eq!(
            classify_runtime_error(&error),
            classified("model_provider_credit_exhausted", "The model provider says this key has no credit left. Add credit with the provider or use another key in Settings → Models.")
        );
    }
}

#[test]
fn names_a_rejected_provider_key_without_echoing_it() {
    for error in [
        RuntimeError::error("Your API key has been invalidated."),
        RuntimeError::named("AI_APICallError", "Incorrect API key provided: sk-****."),
        RuntimeError::error("Workflow step failed").with_cause(RuntimeError::named("AI_APICallError", "Your API key has been invalidated.")),
    ] {
        assert_eq!(
            classify_runtime_error(&error),
            classified("model_provider_key_invalid", "The model provider rejected the API key. Check the key in Settings → Models.")
        );
    }
}

#[test]
fn tells_a_provider_outage_which_a_run_waits_out_from_other_failures() {
    assert!(provider_outage(&RuntimeError::named("AI_APICallError", "Internal Server Error")));
    assert!(provider_outage(&RuntimeError::error("Step \"doStreamStep\" failed after 3 retries: Too Many Requests")));
    assert!(!provider_outage(&RuntimeError::named("AI_APICallError", "invalid api key")));
    assert!(!provider_outage(&RuntimeError::error("agent_model_turn_limit")));
}

#[test]
fn recognizes_serialized_gateway_outages_without_returning_private_provider_data() {
    assert_eq!(
        classify_runtime_error(&RuntimeError::named("GatewayInternalServerError", "Service temporarily unavailable")),
        classified("model_gateway_unavailable", "The model provider is temporarily unavailable. Please try again shortly.")
    );
    // An owned value can't be circular, so the chain of causes stands in for one: the walk still
    // stops at its depth limit, past the phrase that would otherwise match.
    let mut deep = RuntimeError::error("timed out");
    for _ in 0..6 {
        deep = RuntimeError::error("unexpected failure").with_cause(deep);
    }
    assert_eq!(code(deep), "agent_runtime_failed");
}

#[test]
fn returns_correctable_validation_errors_to_the_model_without_workflow_internals() {
    assert_eq!(
        recoverable_tool_error(&control(422, "invalid_tool_input: dueAt must be an ISO 8601 date or timestamp", Some("invalid_tool_input"))),
        Some(RecoverableToolError { code: "invalid_tool_input".to_owned(), message: "dueAt must be an ISO 8601 date or timestamp".to_owned() })
    );
    assert_eq!(recoverable_tool_error(&control(403, "membership revoked", None)), None);
    assert_eq!(
        recoverable_tool_error(&control(422, "invalid_tool_input: pass space for this change; available: \"Personal\" (space_1)", Some("invalid_tool_input"))),
        Some(RecoverableToolError { code: "invalid_tool_input".to_owned(), message: "pass space for this change; available: \"Personal\" (space_1)".to_owned() })
    );
}

#[test]
fn never_retries_permanent_mcp_protocol_or_authorization_failures() {
    let unknown = classify_tool_transport_error(&RuntimeError::named("ProtocolError", "MCP error -32601: unknown tool \"note.read\""));
    assert_eq!((unknown.code, unknown.transient, unknown.recognized), ("tool_unavailable", false, true));
    let forbidden = classify_tool_transport_error(&RuntimeError::named("SdkHttpError", "forbidden").with_status(403));
    assert_eq!((forbidden.code, forbidden.transient), ("permission_denied", false));
}

#[test]
fn retries_only_transient_mcp_http_failures_with_a_bounded_delay() {
    let limited = classify_tool_transport_error(&RuntimeError::named("SdkHttpError", "limited").with_status(429));
    assert_eq!((limited.code, limited.transient, limited.retry_after_ms), ("rate_limited", true, 5_000));
}

#[test]
fn names_the_failed_action_without_claiming_success() {
    let visible = incomplete_tool_result_text(&[ToolFailure { tool_name: "task_create".to_owned(), error: "assignee could not be resolved".to_owned() }]);
    assert!(visible.contains("couldn't fully complete"));
    assert!(visible.contains("task create"));
    assert!(!visible.contains("success"));
}

#[test]
fn uses_stable_call_signatures() {
    let first = JsValue::parse(r#"{"b":2,"a":1}"#).unwrap();
    let second = JsValue::parse(r#"{"a":1,"b":2}"#).unwrap();
    assert_eq!(tool_failure_signature("note.read", &first), tool_failure_signature("note.read", &second));
}

#[test]
fn keeps_a_plan_limits_code_so_the_app_can_tell_the_person() {
    let message = "app_action_limit_reached: This account used its 1,000 app actions for this billing period.";
    assert_eq!(visible_error_message(&RuntimeError::error(message)), message);
    assert_eq!(
        visible_error_message(&RuntimeError::error("tool_execution_failed: app_action_limit_reached: done for the month")),
        "app_action_limit_reached: done for the month"
    );
}

#[test]
fn step_failures_retry_only_what_can_recover() {
    let fatal = |error| matches!(rethrow_step_error(error), StepFailure::Fatal(_));
    assert!(fatal(control(422, "x", Some("agent_model_turn_limit"))));
    assert!(fatal(control(409, "x", Some("model_key_needed"))));
    assert!(fatal(control(403, "x", None)));
    assert_eq!(
        rethrow_step_error(control(429, "x", None)),
        StepFailure::Retryable { message: "Misty's control plane is temporarily unavailable.".to_owned(), retry_after_ms: 5_000 }
    );
    assert_eq!(
        rethrow_step_error(RuntimeError::error("plain")),
        StepFailure::Retryable { message: "Misty could not reach its tool service.".to_owned(), retry_after_ms: 1_000 }
    );
    assert!(fatal(RuntimeError::named("SdkHttpError", "forbidden").with_status(403)));
}
