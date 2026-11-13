//! A model call start to finish, as the runtime uses the `ai` package's `generateText` and `Output`:
//! tries again after passing failures, adds the stream up, and reads structured output.
mod collect;
mod prompt;
mod retry;

use std::sync::Arc;

use serde_json::Value;

pub use collect::{collect_turn, CollectedToolCall, CollectedTurn};
pub use prompt::{prepare_call, to_model_prompt};
pub use retry::{with_retries, DEFAULT_MAX_RETRIES};

use super::{
    call::{CallOptions, ResponseFormat},
    error::ModelError,
    model::{LanguageModel, ModelStream},
    raw_json::RawJson,
};

/// Checks a parsed answer against what the caller expects.
pub type OutputValidator = Arc<dyn Fn(&Value) -> Result<(), String> + Send + Sync>;

/// `Output.object`: an answer in JSON that fits a schema.
#[derive(Clone)]
pub struct OutputObject {
    pub schema: RawJson,
    pub name: Option<String>,
    pub description: Option<String>,
    /// A schema given as plain JSON isn't checked by the SDK, only one with a validator is.
    pub validate: Option<OutputValidator>,
}

impl OutputObject {
    pub fn new(schema: RawJson) -> Self {
        Self { schema, name: None, description: None, validate: None }
    }

    pub fn named(mut self, name: &str) -> Self {
        self.name = Some(name.to_owned());
        self
    }
}

/// Settings for one [`generate_text`].
#[derive(Clone, Default)]
pub struct GenerateSettings {
    /// How many times to try again. `None` is the SDK's default of 2.
    pub max_retries: Option<u32>,
    pub output: Option<OutputObject>,
}

/// What [`generate_text`] gives back.
#[derive(Clone, Debug, Default)]
pub struct GenerateResult {
    pub turn: CollectedTurn,
    output: Option<Value>,
}

impl GenerateResult {
    /// The parsed answer, which exists only when the model finished by stopping.
    pub fn output(&self) -> Result<&Value, ModelError> {
        self.output.as_ref().ok_or_else(|| ModelError::NoOutput {
            name: "AI_NoOutputGeneratedError",
            message: "No output generated.".into(),
        })
    }
}

fn no_object(message: &str) -> ModelError {
    ModelError::NoOutput { name: "AI_NoObjectGeneratedError", message: message.to_owned() }
}

/// `Output.object`'s `parseCompleteOutput`. The parse is the SDK's `secureJsonParse`, and a parsed
/// `Value` is fine here because this answer doesn't go back to a model.
fn parse_object(text: &str, output: &OutputObject) -> Result<Value, ModelError> {
    let parsed: Value = serde_json::from_str(text)
        .ok()
        .filter(|value| !has_forbidden_key(value))
        .ok_or_else(|| no_object("No object generated: could not parse the response."))?;
    if let Some(validate) = &output.validate {
        validate(&parsed).map_err(|_| no_object("No object generated: response did not match schema."))?;
    }
    Ok(parsed)
}

fn has_forbidden_key(value: &Value) -> bool {
    match value {
        Value::Array(items) => items.iter().any(has_forbidden_key),
        Value::Object(fields) => fields.iter().any(|(key, field)| {
            key == "__proto__"
                || (key == "constructor" && field.get("prototype").is_some())
                || has_forbidden_key(field)
        }),
        _ => false,
    }
}

/// Starts a stream with the SDK's retries. They cover getting the stream started: once it's flowing
/// a failure arrives as an error part, as in `streamText`.
pub async fn start_stream(
    model: &dyn LanguageModel,
    options: CallOptions,
    max_retries: Option<u32>,
) -> Result<ModelStream, ModelError> {
    let options = prepare_call(options)?;
    with_retries(max_retries.unwrap_or(DEFAULT_MAX_RETRIES), || model.stream(options.clone())).await
}

/// A failure inside a stream fails the whole call, as a failed response does in the SDK's
/// `doGenerate`. Its body had started, so it reads as not worth retrying.
pub(crate) fn stream_failure(error: &Value) -> ModelError {
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .map_or_else(|| error.to_string(), str::to_owned);
    let status = error.get("statusCode").and_then(Value::as_u64).and_then(|code| u16::try_from(code).ok());
    ModelError::Api { status: status.unwrap_or(200), message, retryable: false, retry_after_ms: None }
}

/// `generateText` for one step: sends the call, adds up the answer and reads its output.
pub async fn generate_text(
    model: &dyn LanguageModel,
    mut options: CallOptions,
    settings: GenerateSettings,
) -> Result<GenerateResult, ModelError> {
    if let Some(output) = &settings.output {
        options.response_format = Some(ResponseFormat::Json {
            name: output.name.clone(),
            description: output.description.clone(),
            schema: Some(output.schema.clone()),
        });
    }
    let options = prepare_call(options)?;
    let max_retries = settings.max_retries.unwrap_or(DEFAULT_MAX_RETRIES);
    let turn = with_retries(max_retries, || model.generate(options.clone())).await?;
    let stopped = turn.finish_reason.as_ref().is_some_and(|reason| reason.unified == "stop");
    let output = match (&settings.output, stopped) {
        (Some(output), true) => Some(parse_object(&turn.text, output)?),
        (None, true) => Some(Value::String(turn.text.clone())),
        (_, false) => None,
    };
    Ok(GenerateResult { turn, output })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn output() -> OutputObject {
        OutputObject::new(RawJson::from_text(r#"{"type":"object"}"#.to_owned()).unwrap())
    }

    #[test]
    fn output_parsing_reports_what_went_wrong() {
        assert_eq!(parse_object(r#"{"a":1}"#, &output()).unwrap(), serde_json::json!({ "a": 1 }));
        let bad = parse_object("not json", &output()).unwrap_err();
        assert_eq!(bad.to_string(), "No object generated: could not parse the response.");
        let forbidden = parse_object(r#"{"__proto__":{"x":1}}"#, &output()).unwrap_err();
        assert_eq!(forbidden.to_string(), "No object generated: could not parse the response.");
        let constructor = parse_object(r#"[{"constructor":{"prototype":{}}}]"#, &output()).unwrap_err();
        assert_eq!(constructor.to_string(), "No object generated: could not parse the response.");
        assert!(parse_object(r#"{"constructor":{"name":"fine"}}"#, &output()).is_ok());
        let strict = OutputObject {
            validate: Some(Arc::new(|value: &Value| {
                if value.get("say").is_some() { Ok(()) } else { Err("missing say".into()) }
            })),
            ..output()
        };
        assert!(parse_object(r#"{"say":"hi"}"#, &strict).is_ok());
        let mismatch = parse_object(r#"{"nope":1}"#, &strict).unwrap_err();
        assert_eq!(mismatch.to_string(), "No object generated: response did not match schema.");
    }
}
