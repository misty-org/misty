//! Reading a transcript the way the TypeScript runtime read its `ModelMessage`s.
//!
//! The AI SDK lets a user message's content be a plain string, and `sdk::Message` always has parts.
//! The runtime builds its notes and steering as plain strings and only a request with files as parts
//! (always more than one), so here a user message with exactly one text part is a plain string.
use crate::sdk::{AssistantPart, Message, RawJson, ToolOutput, ToolResultPart, UserPart};

use super::js_json::JsValue;
#[allow(unused_imports)]
pub(crate) use super::transcript_json::{stringify_output, stringify_raw};

/// `{ role: "user", content: text }`.
pub(crate) fn user_message(text: impl Into<String>) -> Message {
    Message::User {
        content: vec![UserPart::Text { text: text.into() }],
        provider_options: None,
    }
}

/// The text of a user message whose content the TypeScript would hold as a string.
pub(crate) fn user_string(message: &Message) -> Option<&str> {
    match message {
        Message::User { content, .. } => match content.as_slice() {
            [UserPart::Text { text }] => Some(text),
            _ => None,
        },
        _ => None,
    }
}

/// A user message's text parts, with each other part as empty text, joined by a space.
pub(crate) fn user_parts_text(message: &Message) -> String {
    match message {
        Message::User { content, .. } => content
            .iter()
            .map(|part| match part {
                UserPart::Text { text } => text.as_str(),
                UserPart::File { .. } => "",
            })
            .collect::<Vec<_>>()
            .join(" "),
        _ => String::new(),
    }
}

/// Whether a user note starting with `prefix` is already in the transcript.
pub(crate) fn said(messages: &[Message], prefix: &str) -> bool {
    messages.iter().any(|message| user_string(message).is_some_and(|text| text.starts_with(prefix)))
}

/// One tool call or result, in transcript order.
pub(crate) enum ToolPart<'a> {
    Call { id: &'a str, name: &'a str, input: &'a RawJson },
    Result(&'a ToolResultPart),
}

pub(crate) fn tool_parts(messages: &[Message]) -> impl Iterator<Item = ToolPart<'_>> {
    messages.iter().flat_map(|message| -> Box<dyn Iterator<Item = ToolPart<'_>> + '_> {
        match message {
            Message::Assistant { content, .. } => Box::new(content.iter().filter_map(|part| match part {
                AssistantPart::ToolCall { tool_call_id, tool_name, input, .. } => Some(ToolPart::Call {
                    id: tool_call_id,
                    name: tool_name,
                    input,
                }),
                _ => None,
            })),
            Message::Tool { content, .. } => Box::new(content.iter().map(ToolPart::Result)),
            _ => Box::new(std::iter::empty()),
        }
    })
}

/// A tool call's input as parsed JSON. Input that can't be parsed reads as an empty object, which
/// is what the model gets back for it (`RawJson::empty_object`).
pub(crate) fn input_value(input: &RawJson) -> JsValue {
    JsValue::from_raw(input).unwrap_or(JsValue::Object(Vec::new()))
}

/// Whether a tool result reports a failure, by its output type or by what its JSON says.
pub(crate) fn failed(output: &ToolOutput) -> bool {
    match output {
        ToolOutput::ErrorText { .. } | ToolOutput::ErrorJson { .. } => true,
        ToolOutput::Json { value } => {
            let Some(body) = JsValue::from_raw(value) else {
                return false;
            };
            matches!(body.get("successful"), Some(JsValue::Bool(false))) || matches!(body.get("error"), Some(JsValue::String(_)))
        }
        _ => false,
    }
}

#[cfg(test)]
pub(crate) mod fixtures {
    use crate::sdk::{AssistantPart, Message, RawJson, ToolOutput, ToolResultPart};

    pub(crate) fn raw(text: &str) -> RawJson {
        RawJson::from_text(text.to_owned()).unwrap()
    }

    pub(crate) fn text_output(value: impl Into<String>) -> ToolOutput {
        ToolOutput::Text { value: value.into() }
    }

    pub(crate) fn json_output(value: &str) -> ToolOutput {
        ToolOutput::Json { value: raw(value) }
    }

    pub(crate) fn error_output(value: &str) -> ToolOutput {
        ToolOutput::ErrorText { value: value.to_owned() }
    }

    pub(crate) fn call_message(id: &str, name: &str, input: &str) -> Message {
        Message::Assistant {
            content: vec![AssistantPart::ToolCall {
                tool_call_id: id.to_owned(),
                tool_name: name.to_owned(),
                input: raw(input),
                provider_options: None,
            }],
            provider_options: None,
        }
    }

    pub(crate) fn result_message(id: &str, name: &str, output: ToolOutput) -> Message {
        Message::Tool {
            content: vec![ToolResultPart {
                kind: "tool-result".to_owned(),
                tool_call_id: id.to_owned(),
                tool_name: name.to_owned(),
                output,
            }],
            provider_options: None,
        }
    }

    pub(crate) fn assistant_text(text: &str) -> Message {
        Message::Assistant {
            content: vec![AssistantPart::Text { text: text.to_owned(), provider_options: None }],
            provider_options: None,
        }
    }

    /// One turn: the call and its result.
    pub(crate) fn turn(id: &str, name: &str, input: &str, output: ToolOutput) -> Vec<Message> {
        vec![call_message(id, name, input), result_message(id, name, output)]
    }

    /// Transcripts compared by value, since messages have no `PartialEq`.
    pub(crate) fn json(messages: &[Message]) -> String {
        serde_json::to_string(messages).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::*;
    use super::*;

    #[test]
    fn failures_read_from_the_output_type_or_its_json() {
        assert!(failed(&error_output("no")));
        assert!(failed(&json_output(r#"{"successful":false}"#)));
        assert!(failed(&json_output(r#"{"error":"no"}"#)));
        assert!(!failed(&json_output(r#"{"error":{"code":1},"successful":true}"#)));
        assert!(!failed(&text_output(r#"{"error":"only text"}"#)));
    }

    #[test]
    fn only_one_text_part_reads_as_a_plain_string() {
        assert_eq!(user_string(&user_message("a")), Some("a"));
        let two = Message::User {
            content: vec![UserPart::Text { text: "a".to_owned() }, UserPart::Text { text: "b".to_owned() }],
            provider_options: None,
        };
        assert_eq!(user_string(&two), None);
        assert_eq!(user_parts_text(&two), "a b");
    }
}
