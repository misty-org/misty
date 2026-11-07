//! `test/model-calls.test.ts`, `model-test-call.test.ts` and `device-routing.test.ts`, and the routes'
//! edges, against a local provider.
#[path = "runtime_device_support/mod.rs"]
mod support;

use misty_agent::{
    runtime::device::{embed_call, model_call_failure, CallError, DeviceCallFailure, EmbedCall, DEVICE_CALL_NAMES, MAX_DEVICE_BODY_BYTES},
    sdk::{Credential, ModelRoute, ProviderId},
};
use serde_json::json;
use support::{calls, client, provider, Answer, Device};

fn route(provider: ProviderId, key: &str, base_url: Option<&str>) -> ModelRoute {
    ModelRoute { reasoning: Some("low".to_owned()), credential: Credential { provider, api_key: key.to_owned(), base_url: base_url.map(str::to_owned) } }
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

fn answers(content: &'static str) -> impl Fn(&support::Seen) -> Answer + Send + Sync + 'static {
    move |_| Answer::completion(&json!({ "content": content }))
}

fn local(base_url: &str) -> Device {
    Device::default().with_model("agent", "ollama/qwen3:14b").with_key(ProviderId::Ollama, "", base_url)
}

fn needs_a_model(failure: DeviceCallFailure) {
    assert_eq!(failure, DeviceCallFailure { status: 409, body: json!({ "code": "model_key_needed", "message": "Choose a model in Settings → Models." }) });
}

#[tokio::test]
async fn embeds_with_the_requested_dimensions() {
    let server = provider(|_| Answer::json(200, json!({ "data": [{ "embedding": [0.1, 0.2] }, { "embedding": [0.3, 0.4] }], "usage": { "prompt_tokens": 9 } }))).await;
    let route = route(ProviderId::Openai, "openai-fixture", Some(&server.base_url));
    let values = strings(&["first", "second"]);
    let embeddings = embed_call(&client(), EmbedCall { route: &route, model: "openai/text-embedding-3-small", values: &values, dimensions: Some(768), images: None }).await.unwrap();
    assert_eq!(embeddings, [[0.1, 0.2], [0.3, 0.4]]);
    let request = &server.requests()[0];
    assert_eq!(request.path, "/v1/embeddings");
    let body = request.json();
    assert_eq!(body["model"], "text-embedding-3-small");
    assert_eq!(body["input"], json!(["first", "second"]));
    assert_eq!(body["dimensions"], 768);
}

#[tokio::test]
async fn rejects_malformed_calls_before_any_provider_request() {
    let server = provider(|_| Answer::json(200, json!({}))).await;
    let route = route(ProviderId::Openai, "openai-fixture", Some(&server.base_url));
    let one = strings(&["a"]);
    let cases = [
        EmbedCall { route: &route, model: "no-slash", values: &one, dimensions: None, images: None },
        EmbedCall { route: &route, model: "openai/x", values: &[], dimensions: Some(768), images: None },
        EmbedCall { route: &route, model: "openai/x", values: &one, dimensions: Some(5000), images: None },
    ];
    for call in cases {
        assert_eq!(model_call_failure(&embed_call(&client(), call).await.unwrap_err()).status, 400);
    }
    // A body with no values, or the wrong types, is refused the same way through the route.
    let device = Device::default().with_model("embedding", "openai/x").with_key(ProviderId::Openai, "k", &server.base_url);
    assert_eq!(calls(device).embed(r#"{"values":[],"dimensions":768}"#).await.unwrap_err().status, 400);
    assert!(server.requests().is_empty());
}

#[tokio::test]
async fn asks_for_a_key_when_the_devices_key_is_for_another_provider() {
    let server = provider(|_| Answer::json(200, json!({}))).await;
    let other = route(ProviderId::Anthropic, "sk-ant-fixture", None);
    let values = strings(&["a"]);
    let error = embed_call(&client(), EmbedCall { route: &other, model: "openai/text-embedding-3-small", values: &values, dimensions: None, images: None }).await.unwrap_err();
    assert_eq!(model_call_failure(&error), DeviceCallFailure { status: 409, body: json!({ "code": "model_key_needed", "message": "Add a model key in Settings → Models." }) });
    assert!(server.requests().is_empty());
}

#[tokio::test]
async fn keeps_the_key_out_of_failures() {
    let key = "sk-device-secret-fixture";
    let server = provider(move |_| Answer::json(401, json!({ "error": { "message": format!("Incorrect API key provided: {key}") } }))).await;
    let route = route(ProviderId::Openai, key, Some(&server.base_url));
    let values = strings(&["a"]);
    let error = embed_call(&client(), EmbedCall { route: &route, model: "openai/text-embedding-3-small", values: &values, dimensions: None, images: None }).await.unwrap_err();
    let failure = model_call_failure(&error);
    assert!(!failure.body.to_string().contains(key));
    assert_eq!(failure.body["upstream_status"], 401);
    assert!(!format!("{error}").contains(key));
}

#[tokio::test]
async fn embeddings_of_the_wrong_size_are_refused() {
    let server = provider(|_| Answer::json(200, json!({ "data": [{ "embedding": [0.1] }] }))).await;
    let device = Device::default().with_model("embedding", "openai/e").with_key(ProviderId::Openai, "k", &server.base_url);
    let failure = calls(device).embed(r#"{"values":["a"],"dimensions":2}"#).await.unwrap_err();
    assert_eq!(failure, DeviceCallFailure { status: 422, body: json!({ "code": "embedding_dimensions", "message": "The embedding model must give 2-number vectors." }) });
}

#[tokio::test]
async fn the_model_test_passes_a_model_that_calls_tools_and_sees_screenshots() {
    let server = provider(|request| {
        let body = request.json();
        if body["messages"].to_string().contains("image_url") {
            return Answer::completion(&json!({ "content": "Red." }));
        }
        if !body["messages"].as_array().unwrap().iter().any(|message| message["role"] == "tool") {
            return Answer::completion(&json!({ "tool_calls": [{ "id": "call_1", "type": "function", "function": { "name": "stock", "arguments": r#"{"store":"North","product":"blue kettle"}"# } }] }));
        }
        Answer::completion(&json!({ "content": "The North store has 37." }))
    })
    .await;
    let result = calls(local(&server.base_url)).model_test("{}").await.unwrap();
    assert_eq!(result["model"], "ollama/qwen3:14b");
    assert_eq!(result["tools"]["ok"], true);
    assert_eq!(result["images"]["ok"], true);
}

#[tokio::test]
async fn the_model_test_says_which_check_a_weaker_model_fails() {
    let server = provider(|request| {
        let saw = request.json()["messages"].to_string().contains("image_url");
        Answer::completion(&json!({ "content": if saw { "I can't see images." } else { "I don't know." } }))
    })
    .await;
    let result = calls(local(&server.base_url)).model_test("{}").await.unwrap();
    assert_eq!(result["tools"], json!({ "ok": false, "detail": "It answered without calling the tool." }));
    assert_eq!(result["images"]["ok"], false);
}

#[tokio::test]
async fn the_model_test_reports_a_provider_error_on_the_check_it_hit() {
    let server = provider(|request| {
        if request.json()["messages"].to_string().contains("image_url") {
            Answer::json(400, json!({ "error": { "message": "no images here" } }))
        } else {
            Answer::completion(&json!({ "content": "I don't know." }))
        }
    })
    .await;
    let result = calls(local(&server.base_url)).model_test("{}").await.unwrap();
    assert_eq!(result["images"], json!({ "ok": false, "detail": "The model returned an error." }));
    assert_eq!(result["tools"]["ok"], false);
}

#[tokio::test]
async fn the_model_test_asks_for_a_model_when_the_device_has_none() {
    needs_a_model(calls(Device::default()).model_test("{}").await.unwrap_err());
}

#[tokio::test]
async fn routes_a_message_on_the_devices_fast_model() {
    let server = provider(answers(r#"{"route":"queue"}"#)).await;
    let result = calls(local(&server.base_url)).follow_up(r#"{"conversation":[],"new_message":"Then plan a separate trip"}"#).await.unwrap();
    assert_eq!(result, json!({ "route": "queue" }));
}

#[tokio::test]
async fn steers_when_the_answer_is_not_one_of_the_routes() {
    let server = provider(answers("I would stop.")).await;
    let result = calls(local(&server.base_url)).follow_up(r#"{"conversation":[{"request":"Book it","response":"Booking"}],"new_message":"Use Friday"}"#).await.unwrap();
    assert_eq!(result, json!({ "route": "steer" }));
}

#[tokio::test]
async fn following_up_asks_for_a_model_when_the_device_has_none() {
    needs_a_model(calls(Device::default()).follow_up(r#"{"conversation":[],"new_message":"Stop"}"#).await.unwrap_err());
}

const RESTORE: &str = r#"{"url":"https://shop.test/checkout","goal":[{"label":"Size","kind":"text","value":{"value":"M"}}],"controls":[{"ref":"1","role":"field","label":"Size"}],"history":[]}"#;

#[tokio::test]
async fn returns_one_action_on_a_control_the_page_has() {
    let server = provider(answers(r#"{"type":"type","ref":"1","value":"M"}"#)).await;
    assert_eq!(calls(local(&server.base_url)).restore_step(RESTORE).await.unwrap(), json!({ "action": { "type": "type", "ref": "1", "value": "M" } }));
}

#[tokio::test]
async fn ends_the_restore_on_a_control_the_page_does_not_have_or_a_reply_off_the_menu() {
    for reply in [r#"{"type":"click","ref":"9"}"#, r#"{"type":"submit","ref":"1"}"#] {
        let server = provider(answers(reply)).await;
        assert_eq!(calls(local(&server.base_url)).restore_step(RESTORE).await.unwrap(), json!({ "action": { "type": "done" } }));
    }
}

#[tokio::test]
async fn the_dispatcher_knows_each_route_and_refuses_the_rest() {
    for name in DEVICE_CALL_NAMES {
        // Each is known: with no model or a bad body it answers as a device call, never as a 404.
        let failure = calls(Device::default()).device_call(name, "[]").await.unwrap_err();
        assert!(failure.status == 400 || failure.status == 409, "{name}: {failure:?}");
    }
    assert_eq!(calls(Device::default()).device_call("nope", "{}").await.unwrap_err(), DeviceCallFailure { status: 404, body: json!({ "code": "not_found" }) });
}

#[tokio::test]
async fn bodies_are_limited_and_must_be_json() {
    let device = || Device::default();
    let too_large = " ".repeat(MAX_DEVICE_BODY_BYTES + 1);
    assert_eq!(calls(device()).cleanup(&too_large).await.unwrap_err().status, 413);
    assert_eq!(calls(device()).cleanup("{nope").await.unwrap_err().status, 400);
    assert_eq!(calls(device()).cleanup("5").await.unwrap_err().status, 400);
    assert_eq!(calls(device()).cleanup("").await.unwrap_err().status, 400);
    assert_eq!(MAX_DEVICE_BODY_BYTES, 41_943_040);
}

#[tokio::test]
async fn validation_comes_before_the_model_except_where_the_route_read_the_model_first() {
    let bad = "{}";
    // Parsed first, so a bad body is a 400 even with no model.
    for name in ["cleanup", "voice-transcription", "screen-model", "refine-point", "subtitle-context", "extract", "embed", "follow-up", "restore-step"] {
        assert_eq!(calls(Device::default()).device_call(name, bad).await.unwrap_err().status, 400, "{name}");
    }
    // These chose their model first, so the missing model is what they say.
    for name in ["day-summary", "voice-notes", "transcribe-diarized", "model-test"] {
        assert_eq!(calls(Device::default()).device_call(name, bad).await.unwrap_err().status, 409, "{name}");
    }
}

/// A provider that reads the schema natively gets it in the order the SDK wrote it, not sorted.
#[tokio::test]
async fn structured_replies_send_their_schema_with_its_keys_in_order() {
    let server = provider(|_| Answer::json(400, json!({ "error": { "message": "stop here" } }))).await;
    let device = || Device::default().with_model("agent", "openai/gpt").with_model("fast", "openai/gpt").with_key(ProviderId::Openai, "k", &server.base_url);
    let day = r#"{"date":"2026-10-14","items":[{"at":"09:12","kind":"page","title":"T"}]}"#;
    let notes = r#"{"mode":"notes","turns":[{"speaker":"A","start":0,"end":1,"text":"x"}]}"#;
    let extract = r#"{"instruction":"Get","schema":{"type":"object","required":["z","a"],"properties":{"z":{"type":"string"},"a":{"type":"number"}}},"url":"u","title":"t","markdown":"m"}"#;
    assert_eq!(calls(device()).day_summary(day).await.unwrap_err().status, 502);
    assert_eq!(calls(device()).voice_notes(notes).await.unwrap_err().status, 502);
    assert_eq!(calls(device()).extract(extract).await.unwrap_err().status, 502);
    let sent = server.requests();
    assert!(sent[0].text.contains(r##""schema":{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"markdown":{"type":"string"},"topics":{"maxItems":8,"type":"array","items":{"type":"string"}},"threads":{"maxItems":6,"type":"array","items":{"type":"object","properties":{"title":{"type":"string","maxLength":120},"items":{"maxItems":400,"type":"array","items":{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991}}},"required":["title","items"],"additionalProperties":false}},"next":{"maxItems":3,"type":"array","items":{"type":"string","maxLength":200}}},"required":["markdown","topics","threads","next"],"additionalProperties":false}"##), "{}", sent[0].text);
    assert!(sent[1].text.contains(r##""properties":{"title":{"type":"string"},"markdown":{"type":"string"},"actionItems""##), "{}", sent[1].text);
    assert!(sent[2].text.contains(r#""schema":{"type":"object","required":["z","a"],"properties":{"z":{"type":"string"},"a":{"type":"number"}}}"#), "{}", sent[2].text);
    assert!(sent[0].text.contains(r#""name":"day_summary""#));
    assert!(sent[1].text.contains(r#""name":"voice_notes""#));
    assert!(sent[2].text.contains(r#""name":"extraction""#));
}

#[tokio::test]
async fn a_call_that_runs_out_of_time_reads_as_a_provider_failure() {
    let failure = model_call_failure(&CallError::TimedOut);
    assert_eq!(failure.status, 502);
    assert_eq!(failure.body["upstream_status"], 0);
}
