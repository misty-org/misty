//! The Messages request body and the warnings its call starts with. Ported from `getArgs` and
//! `prepareTools` in `@ai-sdk/anthropic`, for function tools and the options Misty sets.
use serde_json::{json, Value};

use super::{
    capabilities::{get_model_capabilities, resolve_reasoning, Capabilities, Thinking},
    cache_control::CacheControlValidator,
    prompt::convert_prompt,
    schema::sanitize_json_schema,
    tools::prepare_tools,
    wire::{MessagesRequest, OutputConfig, OutputFormat, ThinkingBody},
};
use crate::sdk::{
    call::{CallOptions, ResponseFormat},
    error::ModelError,
    providers::ordered::Ordered,
    raw_json::RawJson,
};

pub(super) struct BuiltRequest<'a> {
    pub body: MessagesRequest<'a>,
    pub warnings: Vec<Value>,
    pub betas: Vec<&'static str>,
    pub uses_json_response_tool: bool,
}

pub(super) fn unsupported(feature: &str, details: String) -> Value {
    json!({ "type": "unsupported", "feature": feature, "details": details })
}

pub(super) fn build<'a>(model: &'a str, options: &'a CallOptions) -> Result<BuiltRequest<'a>, ModelError> {
    let mut warnings = Vec::new();
    if options.seed.is_some() {
        warnings.push(json!({ "type": "unsupported", "feature": "seed" }));
    }
    let mut temperature = clamped_temperature(options.temperature, &mut warnings);
    let mut top_p = options.top_p;
    let schema = match &options.response_format {
        Some(ResponseFormat::Json { schema: Some(schema), .. }) => Some(schema),
        Some(ResponseFormat::Json { schema: None, .. }) => {
            warnings.push(unsupported(
                "responseFormat",
                "JSON response format requires a schema. The response format is ignored.".into(),
            ));
            None
        }
        _ => None,
    };
    let capabilities = get_model_capabilities(model);
    if !capabilities.is_known_model && options.max_output_tokens.is_none() {
        warnings.push(json!({
            "type": "compatibility",
            "feature": "maxOutputTokens",
            "details": format!(
                "The model \"{model}\" is unknown. The max output tokens have been limited to {}. Set maxOutputTokens explicitly to override this limit.",
                capabilities.max_output_tokens
            ),
        }));
    }
    if capabilities.rejects_sampling_parameters {
        let ignored = |name: &str| unsupported(name, format!("{name} is not supported by {model} and will be ignored"));
        if temperature.take().is_some() {
            warnings.push(ignored("temperature"));
        }
        if top_p.take().is_some() {
            warnings.push(ignored("topP"));
        }
    }
    let is_anthropic_model = capabilities.is_known_model || model.contains("claude-");
    let uses_native_schema = capabilities.supports_structured_output;
    let json_tool_schema = schema.filter(|_| !uses_native_schema);

    let mut validator = CacheControlValidator::default();
    let converted = convert_prompt(&options.prompt, &mut warnings, &mut validator)?;

    let reasoning = options
        .reasoning
        .as_deref()
        .filter(|reasoning| *reasoning != "provider-default")
        .and_then(|reasoning| resolve_reasoning(reasoning, &capabilities, &mut warnings));
    let (thinking, effort) = match reasoning {
        Some(config) => {
            let effort = config.effort.filter(|_| config.thinking != Thinking::Disabled);
            (Some(config.thinking), effort)
        }
        None => (None, None),
    };
    let is_thinking = matches!(thinking, Some(Thinking::Adaptive | Thinking::Enabled { .. }));
    let budget = match thinking {
        Some(Thinking::Enabled { budget_tokens }) => Some(budget_tokens),
        _ => None,
    };
    let requested_max = options.max_output_tokens.map(u64::from);
    let max_tokens = requested_max.unwrap_or(capabilities.max_output_tokens);
    let format = match schema.filter(|_| uses_native_schema) {
        Some(schema) => Some(OutputFormat { kind: "json_schema", schema: sanitized(schema)? }),
        None => None,
    };
    let output_config = (effort.is_some() || format.is_some()).then_some(OutputConfig { effort, format });

    let mut max_output = max_tokens;
    if is_thinking {
        if temperature.take().is_some() {
            warnings.push(unsupported("temperature", "temperature is not supported when thinking is enabled".into()));
        }
        if top_p.take().is_some() {
            warnings.push(unsupported("topP", "topP is not supported when thinking is enabled".into()));
        }
        max_output = max_tokens + budget.unwrap_or(0);
    } else if is_anthropic_model && top_p.is_some() && temperature.is_some() {
        warnings.push(unsupported(
            "topP",
            "topP is not supported when temperature is set. topP is ignored.".into(),
        ));
        top_p = None;
    }
    let max_output = limited_max_tokens(max_output, requested_max, model, &capabilities, &mut warnings);

    let (tools, tool_choice, tool_betas, tool_warnings) =
        prepare_tools(options, json_tool_schema, &capabilities, uses_native_schema);
    warnings.extend(tool_warnings);
    warnings.extend(validator.into_warnings());

    let mut betas = converted.betas;
    for beta in tool_betas {
        if !betas.contains(&beta) {
            betas.push(beta);
        }
    }
    Ok(BuiltRequest {
        body: MessagesRequest {
            model,
            max_tokens: max_output,
            temperature,
            top_p,
            stop_sequences: options.stop_sequences.as_deref(),
            thinking: thinking.map(|thinking| match thinking {
                Thinking::Enabled { budget_tokens } => ThinkingBody::Enabled { budget_tokens },
                Thinking::Adaptive => ThinkingBody::Adaptive { display: "summarized" },
                Thinking::Disabled => ThinkingBody::Disabled,
            }),
            output_config,
            system: converted.system,
            messages: converted.messages,
            tools,
            tool_choice,
            stream: true,
        },
        warnings,
        betas,
        uses_json_response_tool: json_tool_schema.is_some(),
    })
}

fn sanitized(schema: &RawJson) -> Result<Ordered, ModelError> {
    let schema = Ordered::from_text(schema.get())
        .map_err(|error| ModelError::Unsupported(format!("The schema couldn't be read: {error}")))?;
    Ok(sanitize_json_schema(&schema))
}

fn clamped_temperature(temperature: Option<f64>, warnings: &mut Vec<Value>) -> Option<f64> {
    match temperature {
        Some(value) if value > 1.0 => {
            warnings.push(unsupported(
                "temperature",
                format!("{value} exceeds anthropic maximum of 1.0. clamped to 1.0"),
            ));
            Some(1.0)
        }
        Some(value) if value < 0.0 => {
            warnings.push(unsupported(
                "temperature",
                format!("{value} is below anthropic minimum of 0. clamped to 0"),
            ));
            Some(0.0)
        }
        other => other,
    }
}

/// Known models are capped, which lets a caller switch models without breaking.
fn limited_max_tokens(
    max_tokens: u64,
    requested: Option<u64>,
    model: &str,
    capabilities: &Capabilities,
    warnings: &mut Vec<Value>,
) -> u64 {
    let limit = capabilities.max_output_tokens;
    if !capabilities.is_known_model || max_tokens <= limit {
        return max_tokens;
    }
    if requested.is_some() {
        warnings.push(unsupported(
            "maxOutputTokens",
            format!(
                "{max_tokens} (maxOutputTokens + thinkingBudget) is greater than {model} {limit} max output tokens. The max output tokens have been limited to {limit}."
            ),
        ));
    }
    limit
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sdk::prompt::Message;

    fn options(text: &str) -> CallOptions {
        serde_json::from_str(text).unwrap()
    }

    /// A `Value` would sort these, and the next turn's prompt would then miss Anthropic's cache.
    #[test]
    fn keys_keep_their_order_all_the_way_to_the_wire() {
        let options = options(
            r#"{
                "prompt": [
                    { "role": "assistant", "content": [{ "type": "tool-call", "toolCallId": "t", "toolName": "look", "input": { "z": 1, "a": { "y": 2, "b": 3 } } }] },
                    { "role": "tool", "content": [{ "type": "tool-result", "toolCallId": "t", "toolName": "look", "output": { "type": "json", "value": { "z": 1, "a": 2 } } }] }
                ],
                "tools": [{ "name": "look", "inputSchema": { "type": "object", "properties": { "z": {}, "a": {} } } }],
                "responseFormat": { "type": "json", "schema": { "type": "object", "properties": { "z": {}, "a": {} } } }
            }"#,
        );
        let built = build("claude-sonnet-4-6", &options).unwrap();
        let written = serde_json::to_string(&built.body).unwrap();
        for piece in [
            r#""input":{"z":1,"a":{"y":2,"b":3}}"#,
            r#""content":"{\"z\":1,\"a\":2}""#,
            r#""input_schema":{"type":"object","properties":{"z":{},"a":{}}}"#,
            r#""schema":{"type":"object","properties":{"z":{},"a":{}},"additionalProperties":false}"#,
        ] {
            assert!(written.contains(piece), "{piece} not in {written}");
        }
    }

    #[test]
    fn body_keys_are_in_the_sdks_order() {
        let options = options(r#"{ "prompt": [{ "role": "user", "content": [{ "type": "text", "text": "Hi" }] }] }"#);
        let built = build("claude-sonnet-4-6", &options).unwrap();
        assert_eq!(
            serde_json::to_string(&built.body).unwrap(),
            r#"{"model":"claude-sonnet-4-6","max_tokens":128000,"messages":[{"role":"user","content":[{"type":"text","text":"Hi"}]}],"stream":true}"#,
        );
        assert!(matches!(options.prompt[0], Message::User { .. }));
    }

    #[test]
    fn an_unsupported_file_is_refused_before_sending() {
        let options = options(
            r#"{ "prompt": [{ "role": "user", "content": [{ "type": "file", "data": { "type": "data", "data": "aGVsbG8=" }, "mediaType": "audio/mpeg" }] }] }"#,
        );
        let error = build("claude-sonnet-4-6", &options).err().unwrap();
        assert_eq!(error.to_string(), "'media type: audio/mpeg' functionality not supported.");
    }
}
