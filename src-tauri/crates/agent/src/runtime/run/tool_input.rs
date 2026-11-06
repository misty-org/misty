//! What the `ai` package's `parseToolCall` does with a tool call before anyone sees it: reads its JSON,
//! checks it against the tool's schema, and turns anything wrong into an error the model can correct.
//! The call keeps its place in the transcript either way, with whatever input could be read.
use crate::{
    runtime::js_json::JsValue,
    sdk::{RawJson, ToolDefinition},
};

use super::{json_error::json_syntax_error, schema_check::schema_errors};

pub(crate) struct ParsedCall {
    /// The input as the assistant's message carries it: parsed JSON, or a string of what it wrote.
    pub(crate) input: RawJson,
    /// What the tool runs on, when the call is valid.
    pub(crate) value: JsValue,
    /// `getErrorMessage(error)` for a call that isn't.
    pub(crate) invalid: Option<String>,
}

fn has_forbidden_key(value: &JsValue) -> bool {
    match value {
        JsValue::Array(items) => items.iter().any(has_forbidden_key),
        JsValue::Object(fields) => fields.iter().any(|(key, field)| key == "__proto__" || (key == "constructor" && field.get("prototype").is_some()) || has_forbidden_key(field)),
        _ => false,
    }
}

/// `secureJsonParse`.
fn secure_parse(text: &str) -> Option<JsValue> {
    JsValue::parse(text).filter(|value| !has_forbidden_key(value))
}

fn as_raw(value: &JsValue) -> RawJson {
    RawJson::from_text(value.stringify()).unwrap_or_else(|_| RawJson::empty_object())
}

fn parse_failure(tool: &str, text: &str) -> String {
    format!("AI_InvalidToolInputError: Invalid input for tool {tool}: AI_JSONParseError: JSON parsing failed: Text: {text}.\nError message: SyntaxError: {}", json_syntax_error(text))
}

fn schema_failure(tool: &str, value: &JsValue, problem: &str) -> String {
    format!("AI_InvalidToolInputError: Invalid input for tool {tool}: AI_TypeValidationError: Type validation failed: Value: {}.\nError message: Error: {problem}", value.stringify())
}

/// `raw` is the JSON text the model wrote. `active` is what it was offered this turn.
pub(crate) fn parse_tool_call(name: &str, raw: &str, active: &[&ToolDefinition]) -> ParsedCall {
    let parsed = secure_parse(raw);
    // What the transcript shows when the call fails: what could be read, or the text itself.
    let carried = parsed.clone().unwrap_or_else(|| JsValue::String(raw.to_owned()));
    let invalid = |message: String| ParsedCall { input: as_raw(&carried), value: carried.clone(), invalid: Some(message) };
    let Some(tool) = active.iter().find(|tool| tool.name == name) else {
        let names: Vec<&str> = active.iter().map(|tool| tool.name.as_str()).collect();
        return invalid(format!("AI_NoSuchToolError: Model tried to call unavailable tool '{name}'. Available tools: {}.", names.join(", ")));
    };
    let empty = raw.trim().is_empty();
    let value = if empty {
        JsValue::Object(Vec::new())
    } else {
        match &parsed {
            Some(value) => value.clone(),
            None => return invalid(parse_failure(name, raw)),
        }
    };
    let schema = JsValue::from_raw(&tool.input_schema).unwrap_or(JsValue::Object(Vec::new()));
    if let Some(problem) = schema_errors(&schema, &value) {
        return invalid(schema_failure(name, &value, &problem));
    }
    ParsedCall { input: as_raw(&value), value, invalid: None }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool() -> ToolDefinition {
        ToolDefinition {
            kind: "function".to_owned(),
            name: "t".to_owned(),
            description: None,
            input_schema: RawJson::from_text(r#"{"type":"object","required":["a"],"properties":{"a":{"type":"string"}},"additionalProperties":false}"#.to_owned()).unwrap(),
            strict: None,
        }
    }

    #[test]
    fn a_valid_call_keeps_its_key_order_as_javascript_writes_it() {
        let schema = ToolDefinition { input_schema: RawJson::from_text("{}".to_owned()).unwrap(), ..tool() };
        let call = parse_tool_call("t", r#"{ "z" : 1, "a" : 2.50 }"#, &[&schema]);
        assert_eq!(call.invalid, None);
        assert_eq!(call.input.get(), r#"{"z":1,"a":2.5}"#);
    }

    #[test]
    fn an_unknown_tool_is_named_with_what_was_offered() {
        let definition = tool();
        let call = parse_tool_call("nope", "{}", &[&definition]);
        assert_eq!(call.invalid.unwrap(), "AI_NoSuchToolError: Model tried to call unavailable tool 'nope'. Available tools: t.");
    }

    #[test]
    fn input_that_does_not_fit_stays_in_the_transcript_with_the_reason() {
        let definition = tool();
        let call = parse_tool_call("t", r#"{"b":1}"#, &[&definition]);
        assert_eq!(call.input.get(), r#"{"b":1}"#);
        assert_eq!(call.invalid.unwrap(), "AI_InvalidToolInputError: Invalid input for tool t: AI_TypeValidationError: Type validation failed: Value: {\"b\":1}.\nError message: Error: data must have required property 'a'");
    }

    #[test]
    fn broken_json_stays_as_the_text_the_model_wrote() {
        let definition = tool();
        let call = parse_tool_call("t", "{oops", &[&definition]);
        assert_eq!(call.input.get(), r#""{oops""#);
        assert!(call.invalid.unwrap().contains("JSON parsing failed: Text: {oops."));
    }

    #[test]
    fn empty_input_counts_as_an_empty_object() {
        let definition = ToolDefinition { input_schema: RawJson::empty_object(), ..tool() };
        let call = parse_tool_call("t", "  ", &[&definition]);
        assert_eq!(call.invalid, None);
        assert_eq!(call.input.get(), "{}");
    }
}
