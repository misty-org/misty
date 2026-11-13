use super::*;

fn json(text: &str) -> JsValue {
    JsValue::parse(text).unwrap()
}

fn response(text: &str) -> ToolExecutionResponse {
    ToolExecutionResponse::from_json(&json(text)).unwrap()
}

/// A continuation that plays back replies and counts what it was asked.
struct Scripted {
    replies: Vec<ToolExecutionResponse>,
    device: bool,
    intervention: Option<bool>,
    requests: u32,
    devices: u32,
    interventions: u32,
}

fn scripted(replies: &[&str], device: bool, intervention: Option<bool>) -> Scripted {
    Scripted { replies: replies.iter().map(|text| response(text)).collect(), device, intervention, requests: 0, devices: 0, interventions: 0 }
}

impl ToolContinuation for Scripted {
    fn request(&mut self, attempt: u32) -> BoxFuture<'_, Result<ToolExecutionResponse, RuntimeError>> {
        self.requests += 1;
        let reply = self.replies.get(attempt as usize).or(self.replies.last()).cloned().unwrap();
        Box::pin(async move { Ok(reply) })
    }
    fn device(&mut self, _attempt: u32) -> BoxFuture<'_, Result<bool, RuntimeError>> {
        self.devices += 1;
        let met = self.device;
        Box::pin(async move { Ok(met) })
    }
    fn intervention(&mut self, _attempt: u32) -> Option<BoxFuture<'_, Result<bool, RuntimeError>>> {
        let met = self.intervention?;
        self.interventions += 1;
        Some(Box::pin(async move { Ok(met) }))
    }
}

#[tokio::test]
async fn rechecks_every_outcome_after_repeated_device_waits() {
    let mut calls = scripted(&[r#"{"device_wait":true}"#, r#"{"device_wait":true}"#, r#"{"result":{"messageId":"sent-once"}}"#], true, None);
    assert_eq!(continue_tool_execution(&mut calls).await.unwrap(), json(r#"{"messageId":"sent-once"}"#));
    assert_eq!((calls.requests, calls.devices), (3, 2));
}

#[tokio::test]
async fn never_confirms_absent_results_after_a_wait() {
    let mut calls = scripted(&[r#"{"device_wait":true}"#, "{}"], true, None);
    assert!(continue_tool_execution(&mut calls).await.unwrap_err().to_string().contains("missing_tool_result"));
}

#[tokio::test]
async fn stops_immediately_on_device_expiry() {
    let mut calls = scripted(&[r#"{"device_wait":true}"#], false, None);
    let result = continue_tool_execution(&mut calls).await.unwrap();
    assert_eq!(result.get("unavailable"), Some(&JsValue::Bool(true)));
    assert_eq!(calls.requests, 1);
}

#[tokio::test]
async fn does_not_suppress_errors_or_accept_contradictory_waits() {
    for reply in [
        r#"{"tool_error":{"code":"revoked","message":"Access revoked"}}"#,
        r#"{"device_wait":true,"intervention_wait":{"id":"a","action":"sign_in","reason":"Sign in"}}"#,
    ] {
        assert!(continue_tool_execution(&mut scripted(&[reply], true, None)).await.is_err());
    }
}

#[test]
fn rejects_a_wait_mixed_with_a_success_and_malformed_wait_identities() {
    let outcome = |text: &str| normalize_tool_outcome(&response(text));
    assert!(outcome(r#"{"device_wait":true,"result":{"sent":true}}"#).unwrap_err().to_string().contains("contradictory"));
    assert!(outcome(r#"{"intervention_wait":{"id":"","action":"sign_in","reason":"Sign in"}}"#).unwrap_err().to_string().contains("malformed"));
    assert!(matches!(outcome(r#"{"result":{"status":"uncertain","effectId":"send"}}"#).unwrap(), HarnessToolOutcome::Uncertain(_)));
    assert!(matches!(outcome(r#"{"result":{"status":"user_intervention_required","action":"sign_in"}}"#).unwrap(), HarnessToolOutcome::UserInterventionRequired(_)));
}

#[tokio::test]
async fn continues_the_same_request_through_device_and_repeated_user_action_waits() {
    let mut calls = scripted(
        &[
            r#"{"device_wait":true}"#,
            r#"{"intervention_wait":{"id":"login","action":"sign_in","reason":"Sign in"}}"#,
            r#"{"intervention_wait":{"id":"account","action":"account_confirmation","reason":"Check account"}}"#,
            r#"{"result":{"ready":true,"requiresFreshInspection":true}}"#,
        ],
        true,
        Some(true),
    );
    assert_eq!(continue_tool_execution(&mut calls).await.unwrap().get("ready"), Some(&JsValue::Bool(true)));
    assert_eq!(calls.interventions, 2);
    let mut declined = scripted(&[r#"{"intervention_wait":{"id":"login","action":"sign_in","reason":"Sign in"}}"#], true, Some(false));
    let result = continue_tool_execution(&mut declined).await.unwrap();
    assert_eq!(result.stringify(), r#"{"denied":true,"reason":"user_action_declined_or_expired","waitId":"login"}"#);
    assert_eq!(declined.requests, 1);
}

#[tokio::test]
async fn a_wait_with_no_adapter_and_endless_waits_both_fail() {
    let wait = r#"{"intervention_wait":{"id":"a","action":"review","reason":"Look"}}"#;
    assert!(continue_tool_execution(&mut scripted(&[wait], true, None)).await.unwrap_err().to_string().contains("intervention_adapter_unavailable"));
    let mut endless = scripted(&[r#"{"device_wait":true}"#], true, None);
    assert!(continue_tool_execution(&mut endless).await.unwrap_err().to_string().contains("tool_wait_limit"));
    assert_eq!(endless.requests, 64);
}

#[test]
fn a_null_result_counts_and_only_definite_rejections_had_no_effect() {
    assert_eq!(normalize_tool_outcome(&response(r#"{"result":null}"#)).unwrap(), HarnessToolOutcome::Success(JsValue::Null));
    assert!(ToolExecutionResponse::from_json(&json("[]")).is_err());
    let rejected = |code: &str| rejected_without_effect(&RuntimeError::ToolRejected { code: code.to_owned(), message: "m".to_owned() });
    assert!(rejected("revoked"));
    assert!(!rejected("invalid_tool_outcome"));
    assert!(!rejected("missing_tool_result"));
    assert!(!rejected_without_effect(&RuntimeError::error("revoked")));
    assert_eq!(RuntimeError::ToolRejected { code: "a".to_owned(), message: "b".to_owned() }.to_string(), "a: b");
}

#[tokio::test]
async fn a_device_call_settles_like_a_gateway_call() {
    let done = settle_device_call(ToolExecutionResponse::result(json(r#"{"ok":true}"#))).await.unwrap();
    assert_eq!(done.stringify(), r#"{"ok":true}"#);
    let failed = settle_device_call(ToolExecutionResponse::tool_error("invalid_arguments", "web.fetch needs a url.")).await.unwrap_err();
    assert!(rejected_without_effect(&failed));
    assert_eq!(failed.to_string(), "invalid_arguments: web.fetch needs a url.");
}
