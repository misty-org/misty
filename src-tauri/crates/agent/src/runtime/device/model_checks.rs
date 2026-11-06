//! Two quick checks that a model can be an agent here: it calls a tool and answers from the result,
//! and it sees a screenshot a tool returned (`model-checks.ts`). Settings › Models runs them on the
//! device's agent model.
use serde_json::{json, Value};

use super::super::js_json::JsValue;
use super::{
    failure::CallError,
    model_calls::{asking, limited, routed_generate, user_text},
    models::DeviceRole,
    DeviceCalls,
};
use crate::sdk::{
    AssistantPart, CallOptions, CollectedToolCall, FileData, Message, ModelRoute, OutputItem, RawJson, ToolChoice,
    ToolDefinition, ToolOutput, ToolResultPart,
};

/// A solid red 32 by 32 PNG, so the model has one unambiguous thing to see. These are the bytes the
/// TypeScript wrote, so the request stays as it was.
const RED_PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGO4IyJCU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAJ3LED3QqzauAAAAAElFTkSuQmCC";

const STOCK_SCHEMA: &str = r##"{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{"store":{"type":"string"},"product":{"type":"string"}},"required":["store","product"],"additionalProperties":false}"##;
const SCREENSHOT_SCHEMA: &str = r##"{"$schema":"http://json-schema.org/draft-07/schema#","type":"object","properties":{},"additionalProperties":false}"##;

const MAX_STEPS: usize = 4;

fn tool(name: &str, description: &str, schema: &str) -> Result<ToolDefinition, CallError> {
    Ok(ToolDefinition {
        kind: "function".to_owned(),
        name: name.to_owned(),
        description: Some(description.to_owned()),
        input_schema: RawJson::from_text(schema.to_owned()).map_err(|_| CallError::Unreadable("Invalid schema"))?,
        strict: None,
    })
}

fn checked_result(ok: bool, detail: &str) -> Value {
    json!({ "ok": ok, "detail": detail })
}

/// zod's name for what it got.
fn received(value: Option<&JsValue>) -> &'static str {
    match value {
        None => "undefined",
        Some(JsValue::Null) => "null",
        Some(JsValue::Bool(_)) => "boolean",
        Some(JsValue::Number(_)) => "number",
        Some(JsValue::String(_)) => "string",
        Some(JsValue::Array(_)) => "array",
        Some(JsValue::Object(_)) => "object",
    }
}

fn issue(expected: &str, path: Option<&str>, got: &str) -> String {
    let path = path.map_or("[]".to_owned(), |key| format!("[\n      \"{key}\"\n    ]"));
    format!(
        "  {{\n    \"expected\": \"{expected}\",\n    \"code\": \"invalid_type\",\n    \"path\": {path},\n    \"message\": \"Invalid input: expected {expected}, received {got}\"\n  }}"
    )
}

/// The store and product of a stock call, or what the SDK tells the model is wrong with its input.
fn read_stock_input(call: &CollectedToolCall) -> Result<(String, String), String> {
    let invalid = |cause: String| format!("AI_InvalidToolInputError: Invalid input for tool stock: {cause}");
    let parsed = if call.raw_input.trim().is_empty() { JsValue::parse("{}") } else { JsValue::parse(&call.raw_input) };
    let Some(parsed) = parsed else {
        // V8's own wording for bad JSON can't be reproduced here, so this says what it can.
        return Err(invalid(format!(
            "AI_JSONParseError: JSON parsing failed: Text: {}.\nError message: Unexpected token in JSON",
            call.raw_input
        )));
    };
    let mut issues = Vec::new();
    if parsed.is_object() {
        for key in ["store", "product"] {
            let field = parsed.get(key);
            if !matches!(field, Some(JsValue::String(_))) {
                issues.push(issue("string", Some(key), received(field)));
            }
        }
    } else {
        issues.push(issue("object", None, received(Some(&parsed))));
    }
    if !issues.is_empty() {
        return Err(invalid(format!(
            "AI_TypeValidationError: Type validation failed: Value: {}.\nError message: [\n{}\n]",
            parsed.stringify(),
            issues.join(",\n")
        )));
    }
    let text = |key: &str| parsed.get(key).and_then(JsValue::as_str).unwrap_or("").to_owned();
    Ok((text("store"), text("product")))
}

fn tool_result(call: &CollectedToolCall, output: ToolOutput) -> ToolResultPart {
    ToolResultPart {
        kind: "tool-result".to_owned(),
        tool_call_id: call.tool_call_id.clone(),
        tool_name: call.tool_name.clone(),
        output,
    }
}

/// Runs what the model called, as `generateText` runs a tool with `execute`. A call it accepted goes
/// back to the model as zod left it, which is without any field the schema doesn't name.
fn run_stock_calls(calls: &[CollectedToolCall], content: &mut [AssistantPart]) -> Result<Vec<ToolResultPart>, CallError> {
    let mut results = Vec::with_capacity(calls.len());
    for call in calls {
        if call.tool_name != "stock" {
            let message = format!("AI_NoSuchToolError: Model tried to call unavailable tool '{}'. Available tools: stock.", call.tool_name);
            results.push(tool_result(call, ToolOutput::ErrorText { value: message }));
            continue;
        }
        match read_stock_input(call) {
            Err(message) => results.push(tool_result(call, ToolOutput::ErrorText { value: message })),
            Ok((store, product)) => {
                let strings = |text: &str| JsValue::String(text.to_owned()).stringify();
                let input = format!("{{\"store\":{},\"product\":{}}}", strings(&store), strings(&product));
                let input = RawJson::from_text(input).map_err(|_| CallError::Unreadable("Invalid tool input"))?;
                for part in content.iter_mut() {
                    if let AssistantPart::ToolCall { tool_call_id, input: kept, .. } = part {
                        if *tool_call_id == call.tool_call_id {
                            *kept = input.clone();
                        }
                    }
                }
                let units = if store.to_lowercase().contains("north") { 37 } else { 0 };
                let value = format!("{{\"store\":{},\"units\":{units}}}", strings(&store));
                let value = RawJson::from_text(value).map_err(|_| CallError::Unreadable("Invalid tool output"))?;
                results.push(tool_result(call, ToolOutput::Json { value }));
            }
        }
    }
    Ok(results)
}

/// Calls a stock tool and answers with the number it returned (37).
async fn tool_call_check(calls: &DeviceCalls, model: &str, route: &ModelRoute) -> Result<Value, CallError> {
    let tools = vec![tool("stock", "Look up how many units of a product a store has in stock.", STOCK_SCHEMA)?];
    let mut messages = vec![user_text(
        "How many units of the blue kettle does the North store have? Use the stock tool, then answer with the number.",
    )];
    let mut called = false;
    let mut text = String::new();
    for step in 0..MAX_STEPS {
        let options = CallOptions { tools: tools.clone(), ..asking(None, messages.clone(), 2_000) };
        let result = routed_generate(&calls.client, model, route, options, None).await?;
        called = called || result.turn.tool_calls.iter().any(|call| call.tool_name == "stock");
        text = result.turn.text.clone();
        if result.turn.tool_calls.is_empty() || step + 1 == MAX_STEPS {
            break;
        }
        let mut content = result.turn.content.clone();
        let results = run_stock_calls(&result.turn.tool_calls, &mut content)?;
        messages.push(Message::Assistant { content, provider_options: None });
        messages.push(Message::Tool { content: results, provider_options: None });
    }
    if !called {
        return Ok(checked_result(false, "It answered without calling the tool."));
    }
    if !text.contains("37") {
        return Ok(checked_result(false, "It called the tool but didn't use the result."));
    }
    Ok(checked_result(true, "It called a tool and answered from the result."))
}

/// Reads the color of a screenshot returned by a tool (red).
async fn image_check(calls: &DeviceCalls, model: &str, route: &ModelRoute) -> Result<Value, CallError> {
    let messages = vec![
        user_text("Take a screenshot of the page, then tell me its single color in one word."),
        Message::Assistant {
            content: vec![AssistantPart::ToolCall {
                tool_call_id: "shot-1".to_owned(),
                tool_name: "browser_visual".to_owned(),
                input: RawJson::empty_object(),
                provider_options: None,
            }],
            provider_options: None,
        },
        Message::Tool {
            content: vec![ToolResultPart {
                kind: "tool-result".to_owned(),
                tool_call_id: "shot-1".to_owned(),
                tool_name: "browser_visual".to_owned(),
                output: ToolOutput::Content {
                    value: vec![
                        OutputItem::Text { text: r#"{"url":"https://example.test"}"#.to_owned() },
                        OutputItem::File { data: FileData::Data { data: RED_PNG.to_owned() }, media_type: "image/png".to_owned() },
                    ],
                },
            }],
            provider_options: None,
        },
    ];
    let options = CallOptions {
        tools: vec![tool("browser_visual", "Screenshot the page.", SCREENSHOT_SCHEMA)?],
        tool_choice: Some(ToolChoice::None),
        ..asking(None, messages, 1_000)
    };
    let result = routed_generate(&calls.client, model, route, options, None).await?;
    let saw_red = result.turn.text.to_ascii_lowercase().contains("red");
    Ok(if saw_red {
        checked_result(true, "It saw a screenshot.")
    } else {
        checked_result(false, "It couldn't tell what the screenshot showed.")
    })
}

/// Each check reports on its own, so one failing still shows the other. A missing key or model fails
/// the whole call like any other device call.
fn reported(result: Result<Value, CallError>) -> Result<Value, CallError> {
    match result {
        Err(CallError::Model(error @ crate::sdk::ModelError::Setup { .. })) => Err(CallError::Model(error)),
        Err(_) => Ok(checked_result(false, "The model returned an error.")),
        ok => ok,
    }
}

/// Settings › Models' check of the agent model: does it call tools and see screenshots, the two
/// things every agent run needs.
pub(super) async fn model_test_call(calls: &DeviceCalls) -> Result<Value, CallError> {
    let (model, route) = calls.on_device(DeviceRole::Agent)?;
    let tools = async { reported(limited(60_000, tool_call_check(calls, &model, &route)).await) };
    let images = async { reported(limited(60_000, image_check(calls, &model, &route)).await) };
    let (tools, images) = futures_util::future::try_join(tools, images).await?;
    Ok(json!({ "model": model, "tools": tools, "images": images }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(raw: &str) -> CollectedToolCall {
        CollectedToolCall {
            tool_call_id: "c".to_owned(),
            tool_name: "stock".to_owned(),
            raw_input: raw.to_owned(),
            input: RawJson::empty_object(),
            input_is_valid: true,
            provider_metadata: None,
        }
    }

    #[test]
    fn the_input_error_reads_as_the_sdk_writes_it() {
        assert_eq!(
            read_stock_input(&call(r#"{"store":"North"}"#)).unwrap_err(),
            "AI_InvalidToolInputError: Invalid input for tool stock: AI_TypeValidationError: Type validation failed: Value: {\"store\":\"North\"}.\nError message: [\n  {\n    \"expected\": \"string\",\n    \"code\": \"invalid_type\",\n    \"path\": [\n      \"product\"\n    ],\n    \"message\": \"Invalid input: expected string, received undefined\"\n  }\n]"
        );
        assert_eq!(read_stock_input(&call(r#"{"store":"a","product":"b","x":1}"#)).unwrap(), ("a".to_owned(), "b".to_owned()));
        assert!(read_stock_input(&call("")).is_err());
    }
}
