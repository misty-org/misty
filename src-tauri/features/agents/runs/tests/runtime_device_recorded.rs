//! Replays what the TypeScript runtime sent and answered for each device call, recorded with a fake
//! fetch into `tests/fixtures/runtime_device/recorded.json`: the same input has to reach the provider
//! as the same messages, limits and formats, and come back as the same answer or failure.
#[path = "runtime_device_support/mod.rs"]
mod support;

use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use agent_runs::{
    {
        device::{model_call_failure, DeviceCalls, DeviceModels},
        voice::{DeviceVoiceModels, VoiceModels},
    },
    model_calls::{Message, ProviderId},
};
use serde_json::{json, Value};
use support::{client, provider, Answer, Device, Seen};

fn recorded() -> Value {
    serde_json::from_str(include_str!("fixtures/runtime_device/recorded.json")).unwrap()
}

fn device(case: &Value, base_url: &str) -> Device {
    if case["provider"] == "openrouter" {
        let mut device = Device::default()
            .with_model("agent", "openrouter/agent/model")
            .with_model("fast", "openrouter/fast/model")
            .with_key(ProviderId::Openrouter, "k-openrouter-fixture", base_url);
        device.reasoning = Some("high".to_owned());
        device
    } else {
        Device::default()
            .with_model("agent", "ollama/agent-model")
            .with_model("fast", "ollama/fast-model")
            .with_key(ProviderId::Ollama, "", base_url)
    }
}

/// Each case's input as it was written, because a parsed `Value` would sort its keys.
fn raw_inputs() -> Vec<String> {
    #[derive(serde::Deserialize)]
    struct Case {
        input: Box<serde_json::value::RawValue>,
    }
    #[derive(serde::Deserialize)]
    struct Recording {
        cases: Vec<Case>,
    }
    let recording: Recording = serde_json::from_str(include_str!("fixtures/runtime_device/recorded.json")).unwrap();
    recording.cases.into_iter().map(|case| case.input.get().to_owned()).collect()
}

async fn run(case: &Value, raw_input: &str, calls: &DeviceCalls, voice: &DeviceVoiceModels) -> Result<Value, Value> {
    let input = &case["input"];
    let name = case["name"].as_str().unwrap();
    let text = |key: &str| input[key].as_str().unwrap().to_owned();
    let failed = |error| {
        let failure = model_call_failure(&error);
        json!({ "status": failure.status, "body": failure.body })
    };
    match name {
        "title-for" => calls.title_for(&text("message"), &text("reply")).await.map(Value::String).map_err(failed),
        "summary-for" => calls.summary_for(&text("previous"), &text("turns")).await.map(Value::String).map_err(failed),
        "voice-reply" => {
            let messages: Vec<Message> = input["history"]
                .as_array()
                .unwrap()
                .iter()
                .map(|message| {
                    let content = message["content"].as_str().unwrap();
                    serde_json::from_value(json!({ "role": message["role"], "content": [{ "type": "text", "text": content }] })).unwrap()
                })
                .collect();
            let tools: Vec<String> = serde_json::from_value(input["tools"].clone()).unwrap();
            let decision = voice.reply(&text("system"), messages, &tools).await.map_err(failed)?;
            let mut reply = serde_json::Map::new();
            for (key, value) in [("say", decision.say), ("tool", decision.tool), ("instruction", decision.instruction)] {
                if let Some(value) = value {
                    reply.insert(key.to_owned(), json!(value));
                }
            }
            Ok(Value::Object(reply))
        }
        _ => calls.device_call(name, raw_input).await.map_err(|failure| json!({ "status": failure.status, "body": failure.body })),
    }
}

/// The fields of a request that say what the model was asked. The stream-only ones differ on purpose:
/// the clients here always stream.
fn asked(request: &Value) -> Value {
    let mut kept = serde_json::Map::new();
    for key in ["model", "messages", "max_tokens", "response_format", "tools", "tool_choice"] {
        if let Some(field) = request.get(key) {
            kept.insert(key.to_owned(), field.clone());
        }
    }
    Value::Object(kept)
}

#[tokio::test]
async fn every_recorded_call_asks_and_answers_the_same() {
    let fixture = recorded();
    let inputs = raw_inputs();
    let mut checked = 0;
    for (index, case) in fixture["cases"].as_array().unwrap().iter().enumerate() {
        let label = format!("case {index} {}", case["name"]);
        let replies = case["replies"].as_array().cloned().unwrap_or_else(|| panic!("{label}: no replies"));
        let served = Arc::new(AtomicUsize::new(0));
        let counter = served.clone();
        let server = provider(move |_: &Seen| {
            let next = counter.fetch_add(1, Ordering::SeqCst);
            Answer::completion(&replies[next.min(replies.len() - 1)])
        })
        .await;
        let models: Arc<dyn DeviceModels> = Arc::new(device(case, &server.base_url));
        let calls = DeviceCalls::new(models.clone(), client());
        let voice = DeviceVoiceModels::new(models, client());
        let result = run(case, &inputs[index], &calls, &voice).await;
        match (&result, case.get("error")) {
            (Err(failure), Some(expected)) => assert_eq!(failure, expected, "{label}"),
            (Ok(output), None) => assert_eq!(output, &case["output"], "{label}"),
            (other, _) => panic!("{label}: {other:?}, recorded {} {}", case["output"], case["error"]),
        }
        let mut sent: Vec<String> = server.requests().iter().map(|request| asked(&request.json()).to_string()).collect();
        let mut expected: Vec<String> = case["requests"].as_array().unwrap().iter().map(|request| asked(request).to_string()).collect();
        // Calls made at once can reach the provider in either order.
        sent.sort();
        expected.sort();
        assert_eq!(sent.len(), expected.len(), "{label}");
        for (sent, expected) in sent.iter().zip(&expected) {
            assert_eq!(sent, expected, "{label}");
        }
        checked += 1;
    }
    assert_eq!(checked, fixture["cases"].as_array().unwrap().len());
}
