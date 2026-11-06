//! The generate-content request body. Ported from `GoogleLanguageModel.getArgs`.
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Number, Value};

use super::{
    capabilities::{is_gemma, thinking_config, uses_gemini_3_features},
    messages,
    parts::{Content, SystemInstruction},
    schema::to_openapi,
};
use crate::sdk::{
    call::{CallOptions, ResponseFormat, ToolChoice, ToolDefinition},
    error::ModelError,
    providers::{media::js_number, ordered::Ordered, ordered_ext::OrderedExt},
};

const PROVIDER: &str = "google.generative-ai";
const SAFETY_CATEGORIES: [&str; 4] = [
    "HARM_CATEGORY_HATE_SPEECH",
    "HARM_CATEGORY_DANGEROUS_CONTENT",
    "HARM_CATEGORY_HARASSMENT",
    "HARM_CATEGORY_SEXUALLY_EXPLICIT",
];

/// What Misty may set under `providerOptions.google`. An option that doesn't fit is refused, as the
/// SDK's schema refuses it.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleOptions {
    response_modalities: Option<Vec<String>>,
    thinking_config: Option<ThinkingConfig>,
    cached_content: Option<String>,
    structured_outputs: Option<bool>,
    safety_settings: Option<Vec<SafetySetting>>,
    threshold: Option<String>,
    audio_timestamp: Option<bool>,
    labels: Option<Map<String, Value>>,
    media_resolution: Option<String>,
    retrieval_config: Option<Value>,
    stream_function_call_arguments: Option<bool>,
    service_tier: Option<String>,
    shared_request_type: Option<String>,
    request_type: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThinkingConfig {
    thinking_budget: Option<Number>,
    include_thoughts: Option<bool>,
    thinking_level: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct SafetySetting {
    category: String,
    threshold: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerationConfig<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    max_output_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "js_number")]
    temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "js_number")]
    top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stop_sequences: Option<&'a [String]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    seed: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_mime_type: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_schema: Option<Ordered>,
    #[serde(skip_serializing_if = "Option::is_none")]
    audio_timestamp: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_modalities: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thinking_config: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    media_resolution: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct GoogleRequest<'a> {
    generation_config: GenerationConfig<'a>,
    contents: Vec<Content>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system_instruction: Option<SystemInstruction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    safety_settings: Option<Vec<SafetySetting>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<[ToolList; 1]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_config: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cached_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    labels: Option<Map<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    service_tier: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolList {
    function_declarations: Vec<FunctionDeclaration>,
}

#[derive(Serialize)]
struct FunctionDeclaration {
    name: String,
    description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    parameters: Option<Ordered>,
}

fn other_warning(message: String) -> Value {
    json!({ "type": "other", "message": message })
}

/// `prepareTools`, for function tools.
fn prepare_tools(
    tools: &[ToolDefinition],
    choice: Option<&ToolChoice>,
) -> Result<(Option<[ToolList; 1]>, Option<Value>), ModelError> {
    if tools.is_empty() {
        return Ok((None, None));
    }
    let mut declarations = Vec::with_capacity(tools.len());
    for tool in tools {
        declarations.push(FunctionDeclaration {
            name: tool.name.clone(),
            description: tool.description.clone().unwrap_or_default(),
            parameters: to_openapi(&Ordered::from_raw(&tool.input_schema))?,
        });
    }
    let strict = tools.iter().any(|tool| tool.strict == Some(true));
    let config = |value: Value| Some(json!({ "functionCallingConfig": value }));
    let tool_config = match choice {
        None => strict.then(|| json!({ "functionCallingConfig": { "mode": "VALIDATED" } })),
        Some(ToolChoice::Auto) => config(json!({ "mode": if strict { "VALIDATED" } else { "AUTO" } })),
        Some(ToolChoice::None) => config(json!({ "mode": "NONE" })),
        Some(ToolChoice::Required) => config(json!({ "mode": "ANY" })),
        Some(ToolChoice::Tool { tool_name }) => config(json!({ "mode": "ANY", "allowedFunctionNames": [tool_name] })),
    };
    Ok((Some([ToolList { function_declarations: declarations }]), tool_config))
}

/// `{ ...resolved, ...options.thinkingConfig }`.
fn merged_thinking(resolved: Option<Value>, options: Option<&ThinkingConfig>) -> Option<Value> {
    if resolved.is_none() && options.is_none() {
        return None;
    }
    let mut merged = match resolved {
        Some(Value::Object(fields)) => fields,
        _ => Map::new(),
    };
    if let Some(options) = options {
        if let Some(budget) = &options.thinking_budget {
            merged.insert("thinkingBudget".into(), json!(budget));
        }
        if let Some(include) = options.include_thoughts {
            merged.insert("includeThoughts".into(), json!(include));
        }
        if let Some(level) = &options.thinking_level {
            merged.insert("thinkingLevel".into(), json!(level));
        }
    }
    Some(Value::Object(merged))
}

/// Builds the request, and the warnings the stream starts with.
pub(super) fn build<'a>(model: &str, options: &'a CallOptions) -> Result<(GoogleRequest<'a>, Vec<Value>), ModelError> {
    let google: GoogleOptions = match options.provider_options.as_ref().and_then(|all| all.get("google")).filter(|value| !value.is_null()) {
        Some(value) => serde_json::from_value(value.clone())
            .map_err(|_| ModelError::Unsupported("invalid google provider options".into()))?,
        None => GoogleOptions::default(),
    };
    let mut warnings = Vec::new();
    if google.stream_function_call_arguments == Some(true) {
        warnings.push(other_warning(format!(
            "'streamFunctionCallArguments' is only supported on the Vertex AI API and will be ignored with the current Google provider ({PROVIDER}). See https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling#streaming-fc"
        )));
    }
    if google.shared_request_type.is_some() || google.request_type.is_some() {
        warnings.push(other_warning(format!(
            "'sharedRequestType' and 'requestType' are Vertex AI options and are ignored with the current Google provider ({PROVIDER})."
        )));
    }
    let converted = messages::convert(&options.prompt, is_gemma(model), uses_gemini_3_features(model), &mut warnings)?;
    let (tools, tool_config) = prepare_tools(&options.tools, options.tool_choice.as_ref())?;
    let resolved = thinking_config(options.reasoning.as_deref(), model, &mut warnings);
    let thinking = merged_thinking(resolved, google.thinking_config.as_ref());
    let safety_settings = google.safety_settings.or_else(|| {
        google.threshold.as_ref().map(|threshold| {
            SAFETY_CATEGORIES
                .iter()
                .map(|category| SafetySetting { category: (*category).to_owned(), threshold: threshold.clone() })
                .collect()
        })
    });
    let tool_config = match (tool_config, google.retrieval_config) {
        (None, None) => None,
        (Some(config), None) => Some(config),
        (config, Some(retrieval)) => {
            let mut merged = config.unwrap_or_else(|| json!({}));
            merged["retrievalConfig"] = retrieval;
            Some(merged)
        }
    };
    let mut response_schema = None;
    let mut response_mime_type = None;
    if let Some(ResponseFormat::Json { schema, .. }) = &options.response_format {
        response_mime_type = Some("application/json");
        // Google doesn't take every schema feature, so this option turns schemas off.
        if let Some(schema) = schema.as_ref().filter(|_| google.structured_outputs.unwrap_or(true)) {
            response_schema = to_openapi(&Ordered::from_raw(schema))?;
        }
    }
    Ok((
        GoogleRequest {
            generation_config: GenerationConfig {
                max_output_tokens: options.max_output_tokens,
                temperature: options.temperature,
                top_p: options.top_p,
                stop_sequences: options.stop_sequences.as_deref(),
                seed: options.seed,
                response_mime_type,
                response_schema,
                audio_timestamp: google.audio_timestamp.filter(|on| *on),
                response_modalities: google.response_modalities,
                thinking_config: thinking,
                media_resolution: google.media_resolution,
            },
            contents: converted.contents,
            system_instruction: converted.system_instruction,
            safety_settings,
            tools,
            tool_config,
            cached_content: google.cached_content,
            labels: google.labels,
            service_tier: google.service_tier,
        },
        warnings,
    ))
}
