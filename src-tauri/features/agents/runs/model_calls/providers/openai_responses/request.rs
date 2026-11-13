//! The Responses request body. Ported from `getArgs` and `prepareResponsesTools` in `@ai-sdk/openai`,
//! for function tools and the options Misty sets.
use serde::Serialize;
use serde_json::{json, Value};

use super::{
    capabilities::get_capabilities,
    input::{convert_input, InputItem},
};
use crate::model_calls::call::{CallOptions, ResponseFormat, ToolChoice, ToolDefinition};
use crate::model_calls::error::ModelError;
use crate::model_calls::providers::media::js_number;
use crate::model_calls::raw_json::RawJson;

#[derive(Serialize)]
pub(super) struct ResponsesRequest<'a> {
    model: &'a str,
    input: Vec<InputItem<'a>>,
    #[serde(serialize_with = "js_number", skip_serializing_if = "Option::is_none")]
    temperature: Option<f64>,
    #[serde(serialize_with = "js_number", skip_serializing_if = "Option::is_none")]
    top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_output_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<TextSettings<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    store: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    include: Option<[&'static str; 1]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<ReasoningSettings<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<FunctionTool<'a>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<ToolChoiceBody<'a>>,
    stream: bool,
}

#[derive(Serialize)]
struct TextSettings<'a> {
    format: TextFormat<'a>,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum TextFormat<'a> {
    JsonSchema {
        strict: bool,
        name: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<&'a str>,
        schema: &'a RawJson,
    },
    JsonObject,
}

#[derive(Serialize)]
struct ReasoningSettings<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    effort: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<&'static str>,
}

#[derive(Serialize)]
struct FunctionTool<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<&'a str>,
    parameters: &'a RawJson,
    #[serde(skip_serializing_if = "Option::is_none")]
    strict: Option<bool>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum ToolChoiceBody<'a> {
    Mode(&'static str),
    Named {
        #[serde(rename = "type")]
        kind: &'a str,
    },
    Function {
        #[serde(rename = "type")]
        kind: &'static str,
        name: &'a str,
    },
}

/// Tool names the API reads as its own built-in tools when one is chosen.
const BUILT_IN_TOOLS: [&str; 9] = [
    "code_interpreter",
    "file_search",
    "image_generation",
    "web_search_preview",
    "web_search",
    "mcp",
    "apply_patch",
    "computer",
    "programmatic_tool_calling",
];

fn tool_choice_body(choice: &ToolChoice) -> ToolChoiceBody<'_> {
    match choice {
        ToolChoice::Auto => ToolChoiceBody::Mode("auto"),
        ToolChoice::None => ToolChoiceBody::Mode("none"),
        ToolChoice::Required => ToolChoiceBody::Mode("required"),
        ToolChoice::Tool { tool_name } if BUILT_IN_TOOLS.contains(&tool_name.as_str()) => {
            ToolChoiceBody::Named { kind: tool_name }
        }
        ToolChoice::Tool { tool_name } => ToolChoiceBody::Function { kind: "function", name: tool_name },
    }
}

fn function_tool(tool: &ToolDefinition) -> FunctionTool<'_> {
    FunctionTool {
        kind: "function",
        name: &tool.name,
        description: tool.description.as_deref(),
        parameters: &tool.input_schema,
        strict: tool.strict,
    }
}

fn text_settings(format: Option<&ResponseFormat>) -> Option<TextSettings<'_>> {
    let Some(ResponseFormat::Json { name, description, schema }) = format else {
        return None;
    };
    Some(TextSettings {
        format: match schema {
            Some(schema) => TextFormat::JsonSchema {
                strict: true,
                name: name.as_deref().unwrap_or("response"),
                description: description.as_deref(),
                schema,
            },
            None => TextFormat::JsonObject,
        },
    })
}

/// Whether the call asked OpenAI to store its response, or left that to OpenAI's default.
pub(super) fn store_option(options: &CallOptions) -> Option<bool> {
    options.provider_options.as_ref()?.get("openai")?.get("store")?.as_bool()
}

/// Builds the request, and the warnings the stream starts with.
pub(super) fn build<'a>(model: &'a str, options: &'a CallOptions) -> Result<(ResponsesRequest<'a>, Vec<Value>), ModelError> {
    let mut warnings = Vec::new();
    let store = store_option(options);
    if options.seed.is_some() {
        warnings.push(json!({ "type": "unsupported", "feature": "seed" }));
    }
    if options.stop_sequences.is_some() {
        warnings.push(json!({ "type": "unsupported", "feature": "stopSequences" }));
    }
    let capabilities = get_capabilities(model);
    let effort = options.reasoning.as_deref().filter(|effort| *effort != "provider-default");
    let summary = effort.filter(|effort| *effort != "none").map(|_| "detailed");
    let role = if capabilities.is_reasoning_model { "developer" } else { "system" };
    let input = convert_input(&options.prompt, role, store.unwrap_or(true), &mut warnings)?;
    // Reasoning can only come back on the next turn as its encrypted content when nothing is stored.
    let include = (store == Some(false) && capabilities.is_reasoning_model).then_some(["reasoning.encrypted_content"]);

    let mut temperature = options.temperature;
    let mut top_p = options.top_p;
    // With reasoning off, GPT-5.1 and later take sampling settings again.
    let keeps_sampling = effort == Some("none") && capabilities.supports_non_reasoning_parameters;
    if capabilities.is_reasoning_model && !keeps_sampling {
        let refused = |feature: &str, name: &str| {
            json!({
                "type": "unsupported",
                "feature": feature,
                "details": format!("{name} is not supported for reasoning models"),
            })
        };
        if temperature.take().is_some() {
            warnings.push(refused("temperature", "temperature"));
        }
        if top_p.take().is_some() {
            warnings.push(refused("topP", "topP"));
        }
    }
    let reasoning = (capabilities.is_reasoning_model && effort.is_some()).then_some(ReasoningSettings { effort, summary });
    let has_tools = !options.tools.is_empty();
    Ok((
        ResponsesRequest {
            model,
            input,
            temperature,
            top_p,
            max_output_tokens: options.max_output_tokens,
            text: text_settings(options.response_format.as_ref()),
            store,
            include,
            reasoning,
            tools: has_tools.then(|| options.tools.iter().map(function_tool).collect()),
            tool_choice: options.tool_choice.as_ref().filter(|_| has_tools).map(tool_choice_body),
            stream: true,
        },
        warnings,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A `Value` would sort these, and the next turn would then miss OpenAI's prompt cache.
    #[test]
    fn keys_keep_their_order_all_the_way_to_the_wire() {
        let options: CallOptions = serde_json::from_str(
            r#"{
                "prompt": [
                    { "role": "assistant", "content": [{ "type": "tool-call", "toolCallId": "t", "toolName": "look", "input": { "z": 1, "a": { "y": 2, "b": 3 } } }] },
                    { "role": "tool", "content": [{ "type": "tool-result", "toolCallId": "t", "toolName": "look", "output": { "type": "json", "value": { "z": 1, "a": 2 } } }] }
                ],
                "tools": [{ "name": "look", "inputSchema": { "type": "object", "properties": { "z": {}, "a": {} } } }],
                "responseFormat": { "type": "json", "schema": { "type": "object", "properties": { "z": {}, "a": {} } } }
            }"#,
        )
        .unwrap();
        let (body, _) = build("gpt-5.1", &options).unwrap();
        let written = serde_json::to_string(&body).unwrap();
        for piece in [
            r#""arguments":"{\"z\":1,\"a\":{\"y\":2,\"b\":3}}""#,
            r#""output":"{\"z\":1,\"a\":2}""#,
            r#""parameters":{"type":"object","properties":{"z":{},"a":{}}}"#,
            r#""schema":{"type":"object","properties":{"z":{},"a":{}}}"#,
        ] {
            assert!(written.contains(piece), "{piece} not in {written}");
        }
    }
}
