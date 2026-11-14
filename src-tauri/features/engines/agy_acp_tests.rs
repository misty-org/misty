use super::*;

/// agy 1.5.9's `elicitation/create` for a `/grill-me` question (captured; path shortened).
const GRILL_ME_FORM: &str = r#"{"sessionId":"12284063-2e04-453e-816d-3dfe1ab05637","toolCallId":"call_17883791242525095433","mode":"form","message":"The agent has a question.","requestedSchema":{"type":"object","properties":{"q1":{"type":"string","title":"What should the filename and initial content of this tiny text file be?","oneOf":[{"const":"1","title":"(Recommended) hello.txt with \"Hello, world!\""},{"const":"2","title":"notes.txt with a brief placeholder"},{"const":"3","title":"README.md with a project title"}]},"q1_other":{"type":"string","title":"Other","description":"Optional free-form answer to: What should the filename and initial content of this tiny text file be?"}}}}"#;

const QUESTION: &str = "What should the filename and initial content of this tiny text file be?";

fn form() -> Vec<Value> {
    fields(&serde_json::from_str(GRILL_ME_FORM).unwrap()).expect("a form Misty reads")
}

#[test]
fn a_captured_question_form_becomes_one_card_question() {
    let fields = form();
    assert_eq!(fields.len(), 1, "the free-form field is the question's own");
    let field = &fields[0];
    assert_eq!(field["question"], QUESTION);
    assert_eq!(field["header"], "Q1");
    assert_eq!(field["multiSelect"], false);
    assert_eq!(
        field["options"][1]["label"],
        "notes.txt with a brief placeholder"
    );
    assert_eq!(field["values"], json!(["1", "2", "3"]));
    assert_eq!(field["other"], "q1_other");
}

/// The reply agy 1.5.9 took for that form: the picked option's value under its key.
#[test]
fn a_picked_label_answers_with_its_value() {
    let fields = Value::Array(form());
    let id = json!("1");
    let answers = json!({ QUESTION: "notes.txt with a brief placeholder" });
    let frame = answer_frame(&id, &fields, Some(&answers)).unwrap();
    assert_eq!(
        frame,
        json!({"jsonrpc": "2.0", "id": "1", "result": {"action": "accept", "content": {"q1": "2"}}})
    );
    let own = json!({ QUESTION: "todo.txt, empty" });
    let frame = answer_frame(&id, &fields, Some(&own)).unwrap();
    assert_eq!(
        frame["result"]["content"],
        json!({"q1_other": "todo.txt, empty"})
    );
    let skipped = answer_frame(&id, &fields, None).unwrap();
    assert_eq!(skipped["result"], json!({"action": "cancel"}));
}

#[test]
fn several_questions_keep_their_order_and_a_multi_select_takes_a_list() {
    let params = json!({"mode": "form", "message": "The agent has a question.", "requestedSchema": {
    "type": "object", "properties": {
        "q10": {"type": "string", "title": "Tenth?"},
        "q2": {"type": "array", "title": "Which parts?", "items": {"anyOf": [
            {"const": "1", "title": "Header"}, {"const": "2", "title": "Footer"}]}},
        "q2_other": {"type": "string", "title": "Other"},
    }}});
    let fields = fields(&params).unwrap();
    let order: Vec<&str> = fields.iter().map(|f| f["key"].as_str().unwrap()).collect();
    assert_eq!(order, ["q2", "q10"]);
    assert_eq!(fields[0]["multiSelect"], true);
    let answers = json!({"Which parts?": ["Footer", "Header", "Sidebar"], "Tenth?": "yes"});
    let frame = answer_frame(&json!(7), &Value::Array(fields), Some(&answers)).unwrap();
    assert_eq!(
        frame["result"]["content"],
        json!({"q2": ["2", "1"], "q2_other": "Sidebar", "q10": "yes"})
    );
}

#[test]
fn a_form_misty_cannot_read_is_declined() {
    assert!(fields(&json!({"mode": "url", "url": "https://example.com"})).is_none());
    assert!(fields(&json!({"mode": "form", "requestedSchema": {"properties": {}}})).is_none());
    let fields = Value::Array(form());
    let strict = json!([{ "key": "q1", "question": "Pick", "options": [{"label": "A"}],
        "values": ["1"], "multiSelect": false, "other": null }]);
    assert!(answer_frame(&json!(1), &strict, Some(&json!({"Pick": "B"}))).is_err());
    assert!(answer_frame(&json!(1), &fields, Some(&json!("x"))).is_err());
}

/// agy 1.5.9's `config_option_update` (trimmed): the model's family and its thinking level.
#[test]
fn a_reported_model_is_named_as_agy_models_names_it() {
    let update = json!({"sessionId": "s", "update": {"sessionUpdate": "config_option_update",
        "configOptions": [
            {"id": "model", "category": "model", "currentValue": "gemini-3.8-flash"},
            {"id": "thought_level", "category": "thought_level", "currentValue": "low"},
            {"id": "mode", "category": "mode", "currentValue": "plan"}]}});
    let state = with_model_id(session_state_update(&update).unwrap());
    assert_eq!(state.model.as_deref(), Some("gemini-3.8-flash-low"));
    assert_eq!(state.effort, None);
    assert_eq!(state.mode.as_deref(), Some("plan"));
    let claude = json!({"update": {"sessionUpdate": "config_option_update", "configOptions": [
        {"id": "model", "category": "model", "currentValue": "claude-sonnet-4-6"}]}});
    let state = with_model_id(session_state_update(&claude).unwrap());
    assert_eq!(state.model.as_deref(), Some("claude-sonnet-4-6"));
}

#[test]
fn effort_goes_to_the_nearest_level_the_model_offers() {
    let options = json!([{"id": "thought_level", "category": "thought_level", "options": [
        {"value": "low"}, {"value": "medium"}, {"value": "high"}]}]);
    assert_eq!(nearest_level("medium", &options).as_deref(), Some("medium"));
    assert_eq!(nearest_level("max", &options).as_deref(), Some("high"));
    assert_eq!(nearest_level("minimal", &options).as_deref(), Some("low"));
    assert_eq!(nearest_level("high", &json!([{"id": "model"}])), None);
    assert!(encodes_effort("gemini-3.8-flash-high"));
    assert!(encodes_effort("gpt-oss-120b-medium"));
    assert!(!encodes_effort("claude-sonnet-4-6"));
}

#[test]
fn modes_and_mcp_follow_the_run() {
    assert_eq!(mode_id(Some("manual")), "default");
    assert_eq!(mode_id(Some("auto")), "accept-edits");
    assert_eq!(mode_id(Some("plan")), "plan");
    assert_eq!(mode_id(Some("bypass")), "default");
    let agent = json!({"agentCapabilities": {"loadSession": true}});
    assert_eq!(
        mcp_capable(&agent)["agentCapabilities"]["mcpCapabilities"]["http"],
        true
    );
    assert_eq!(
        initialization()["clientCapabilities"]["elicitation"],
        json!({"form": {}})
    );
}

#[test]
fn misty_mounts_its_server_over_http() {
    let mut req = super::super::tests::req(None);
    req.mcp_servers = Some(
        json!({"misty": {"type": "http", "url": "http://127.0.0.1:1/mcp",
        "headers": {"Authorization": "Bearer t"}}}),
    );
    let agent = json!({"agentCapabilities": {"loadSession": true}});
    assert_eq!(
        crate::engines::gate::acp_mcp_servers(&req, &agent),
        json!([])
    );
    let servers = crate::engines::gate::acp_mcp_servers(&req, &mcp_capable(&agent));
    assert_eq!(servers[0]["type"], "http");
    assert_eq!(servers[0]["headers"][0]["name"], "Authorization");
}

#[path = "agy_live_tests.rs"]
mod live;
