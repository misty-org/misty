//! `JSON.stringify` of a transcript, in the shape the TypeScript runtime held it. Budgets are tuned
//! on these sizes and some of this text reaches the model, so it isn't `sdk::Message`'s own JSON: a
//! plain user message is a string, and call inputs are parsed and written back without spaces.
use crate::model_calls::{AssistantPart, FileData, Message, OutputItem, RawJson, ToolOutput, ToolResultPart, UserPart};

use super::js_json::JsValue;
use super::transcript::user_string;

/// `JSON.stringify(input)`.
pub(crate) fn stringify_raw(raw: &RawJson) -> String {
    JsValue::from_raw(raw).map_or_else(|| raw.get().to_owned(), |value| value.stringify())
}

fn push_quoted(out: &mut String, text: &str) {
    out.push_str(&JsValue::String(text.to_owned()).stringify());
}

fn file_text(data: &FileData) -> &str {
    match data {
        FileData::Data { data } => data,
        FileData::Url { url } => url,
    }
}

fn push_field(out: &mut String, name: &str, value: &str) {
    out.push(',');
    push_quoted(out, name);
    out.push(':');
    push_quoted(out, value);
}

/// `JSON.stringify(output)`, in the shape the TypeScript runtime held. A screenshot there is an
/// `image-data` item, which the AI SDK only turned into a file part on its way to the provider.
pub(crate) fn stringify_output(output: &ToolOutput) -> String {
    let mut out = String::from("{");
    match output {
        ToolOutput::Text { value } => {
            out.push_str(r#""type":"text""#);
            push_field(&mut out, "value", value);
        }
        ToolOutput::ErrorText { value } => {
            out.push_str(r#""type":"error-text""#);
            push_field(&mut out, "value", value);
        }
        ToolOutput::Json { value } => {
            out.push_str(r#""type":"json","value":"#);
            out.push_str(&stringify_raw(value));
        }
        ToolOutput::ErrorJson { value } => {
            out.push_str(r#""type":"error-json","value":"#);
            out.push_str(&stringify_raw(value));
        }
        ToolOutput::ExecutionDenied { reason } => {
            out.push_str(r#""type":"execution-denied""#);
            if let Some(reason) = reason {
                push_field(&mut out, "reason", reason);
            }
        }
        ToolOutput::Content { value } => {
            out.push_str(r#""type":"content","value":["#);
            for (index, item) in value.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push('{');
                match item {
                    OutputItem::Text { text } => {
                        out.push_str(r#""type":"text""#);
                        push_field(&mut out, "text", text);
                    }
                    OutputItem::File { data, media_type } => {
                        out.push_str(r#""type":"#);
                        push_quoted(&mut out, output_item_kind(media_type));
                        push_field(&mut out, "data", file_text(data));
                        push_field(&mut out, "mediaType", media_type);
                    }
                }
                out.push('}');
            }
            out.push(']');
        }
    }
    out.push('}');
    out
}

/// A file item's type in the TypeScript runtime's transcript.
pub(crate) fn output_item_kind(media_type: &str) -> &'static str {
    if media_type.starts_with("image/") {
        "image-data"
    } else {
        "file"
    }
}

pub(crate) fn stringify_tool_result(part: &ToolResultPart) -> String {
    let mut out = String::from(r#"{"type":"tool-result""#);
    push_field(&mut out, "toolCallId", &part.tool_call_id);
    push_field(&mut out, "toolName", &part.tool_name);
    out.push_str(r#","output":"#);
    out.push_str(&stringify_output(&part.output));
    out.push('}');
    out
}

pub(crate) fn stringify_user_part(part: &UserPart) -> String {
    let mut out = String::from("{");
    match part {
        UserPart::Text { text } => {
            out.push_str(r#""type":"text""#);
            push_field(&mut out, "text", text);
        }
        UserPart::File { data, media_type } if media_type.starts_with("image/") => {
            out.push_str(r#""type":"image""#);
            push_field(&mut out, "image", file_text(data));
            push_field(&mut out, "mediaType", media_type);
        }
        UserPart::File { data, media_type } => {
            out.push_str(r#""type":"file""#);
            push_field(&mut out, "data", file_text(data));
            push_field(&mut out, "mediaType", media_type);
        }
    }
    out.push('}');
    out
}

pub(crate) fn stringify_assistant_part(part: &AssistantPart) -> String {
    let mut out = String::from("{");
    let options = match part {
        AssistantPart::Text { text, provider_options } => {
            out.push_str(r#""type":"text""#);
            push_field(&mut out, "text", text);
            provider_options
        }
        AssistantPart::Reasoning { text, provider_options } => {
            out.push_str(r#""type":"reasoning""#);
            push_field(&mut out, "text", text);
            provider_options
        }
        AssistantPart::ToolCall { tool_call_id, tool_name, input, provider_options } => {
            out.push_str(r#""type":"tool-call""#);
            push_field(&mut out, "toolCallId", tool_call_id);
            push_field(&mut out, "toolName", tool_name);
            out.push_str(r#","input":"#);
            out.push_str(&stringify_raw(input));
            provider_options
        }
    };
    if let Some(options) = options {
        out.push_str(r#","providerOptions":"#);
        out.push_str(&serde_json::to_string(options).unwrap_or_else(|_| "{}".to_owned()));
    }
    out.push('}');
    out
}

/// A message's role, as the TypeScript names it.
pub(crate) fn role(message: &Message) -> &'static str {
    match message {
        Message::System { .. } => "system",
        Message::User { .. } => "user",
        Message::Assistant { .. } => "assistant",
        Message::Tool { .. } => "tool",
    }
}

fn write_message(out: &mut String, message: &Message) {
    out.push_str(r#"{"role":"#);
    push_quoted(out, role(message));
    out.push_str(r#","content":"#);
    let join = |parts: Vec<String>| format!("[{}]", parts.join(","));
    let options = match message {
        Message::System { content, provider_options } => {
            push_quoted(out, content);
            provider_options
        }
        Message::User { content, provider_options } => {
            match user_string(message) {
                Some(text) => push_quoted(out, text),
                None => out.push_str(&join(content.iter().map(stringify_user_part).collect())),
            }
            provider_options
        }
        Message::Assistant { content, provider_options } => {
            out.push_str(&join(content.iter().map(stringify_assistant_part).collect()));
            provider_options
        }
        Message::Tool { content, provider_options } => {
            out.push_str(&join(content.iter().map(stringify_tool_result).collect()));
            provider_options
        }
    };
    if let Some(options) = options {
        out.push_str(r#","providerOptions":"#);
        out.push_str(&serde_json::to_string(options).unwrap_or_else(|_| "{}".to_owned()));
    }
    out.push('}');
}

/// `JSON.stringify(messages)`. Budgets are tuned on this size, so it has the TypeScript's shape.
pub(crate) fn stringify_messages(messages: &[Message]) -> String {
    let mut out = String::from("[");
    for (index, message) in messages.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        write_message(&mut out, message);
    }
    out.push(']');
    out
}

#[cfg(test)]
mod tests {
    use super::super::transcript::fixtures::*;
    use super::super::transcript::user_message;
    use super::*;

    #[test]
    fn messages_stringify_in_the_typescript_shape() {
        let messages = vec![
            user_message("Go"),
            call_message("c", "web_fetch", r#"{ "url" : "https://a.com" }"#),
            result_message("c", "web_fetch", json_output(r#"{"z":1, "a":2}"#)),
        ];
        assert_eq!(
            stringify_messages(&messages),
            concat!(
                r#"[{"role":"user","content":"Go"},"#,
                r#"{"role":"assistant","content":[{"type":"tool-call","toolCallId":"c","toolName":"web_fetch","input":{"url":"https://a.com"}}]},"#,
                r#"{"role":"tool","content":[{"type":"tool-result","toolCallId":"c","toolName":"web_fetch","output":{"type":"json","value":{"z":1,"a":2}}}]}]"#,
            )
        );
    }

    #[test]
    fn a_screenshot_is_image_data_as_the_runtime_held_it() {
        let output = ToolOutput::Content {
            value: vec![
                OutputItem::Text { text: "seen".to_owned() },
                OutputItem::File {
                    data: FileData::Data { data: "AAAA".to_owned() },
                    media_type: "image/png".to_owned(),
                },
            ],
        };
        assert_eq!(
            stringify_output(&output),
            r#"{"type":"content","value":[{"type":"text","text":"seen"},{"type":"image-data","data":"AAAA","mediaType":"image/png"}]}"#
        );
    }
}
