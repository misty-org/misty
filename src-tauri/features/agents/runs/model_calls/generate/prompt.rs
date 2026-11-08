//! What the `ai` package does to a call on its way to a provider. Ported from
//! `convertToLanguageModelPrompt` and `prepareToolChoice`. A model's `stream` takes options as they
//! are, so everything that talks to a model goes through [`prepare_call`] first.
use std::collections::BTreeSet;

use crate::model_calls::call::{CallOptions, ToolChoice};
use crate::model_calls::error::ModelError;
use crate::model_calls::prompt::{AssistantPart, Message, UserPart};

fn invalid_prompt(message: &str) -> ModelError {
    ModelError::Unsupported(format!("Invalid prompt: {message}"))
}

fn missing_results(ids: BTreeSet<String>) -> ModelError {
    let plural = ids.len() > 1;
    let list = ids.into_iter().collect::<Vec<_>>().join(", ");
    ModelError::NoOutput {
        name: "AI_MissingToolResultsError",
        message: format!(
            "Tool result{} missing for tool call{} {list}.",
            if plural { "s are" } else { " is" },
            if plural { "s" } else { "" },
        ),
    }
}

/// Empty text says nothing and some providers refuse it. Assistant text with provider options stays,
/// because a signature can arrive on an empty part.
fn without_empty_parts(message: Message) -> Message {
    match message {
        Message::User { content, provider_options } => Message::User {
            content: content
                .into_iter()
                .filter(|part| !matches!(part, UserPart::Text { text } if text.is_empty()))
                .collect(),
            provider_options,
        },
        Message::Assistant { content, provider_options } => Message::Assistant {
            content: content
                .into_iter()
                .filter(|part| {
                    !matches!(part, AssistantPart::Text { text, provider_options: None } if text.is_empty())
                })
                .collect(),
            provider_options,
        },
        other => other,
    }
}

/// `convertToLanguageModelPrompt`: tidies the messages, joins neighbouring tool results and checks
/// that every tool call has its result before the conversation moves on.
pub fn to_model_prompt(prompt: Vec<Message>) -> Result<Vec<Message>, ModelError> {
    if !prompt.iter().any(|message| !matches!(message, Message::System { .. })) {
        return Err(invalid_prompt("messages must not be empty"));
    }
    let mut combined: Vec<Message> = Vec::with_capacity(prompt.len());
    for message in prompt {
        let message = without_empty_parts(message);
        if let (Message::Tool { content, provider_options }, Some(Message::Tool { content: earlier, provider_options: earlier_options })) =
            (&message, combined.last_mut())
        {
            earlier.extend(content.iter().cloned());
            *earlier_options = provider_options.clone();
            continue;
        }
        combined.push(message);
    }
    let mut waiting = BTreeSet::new();
    for message in &combined {
        match message {
            Message::Assistant { content, .. } => {
                for part in content {
                    if let AssistantPart::ToolCall { tool_call_id, .. } = part {
                        waiting.insert(tool_call_id.clone());
                    }
                }
            }
            Message::Tool { content, .. } => {
                for part in content {
                    waiting.remove(&part.tool_call_id);
                }
            }
            Message::User { .. } | Message::System { .. } => {
                if !waiting.is_empty() {
                    return Err(missing_results(waiting));
                }
            }
        }
    }
    if !waiting.is_empty() {
        return Err(missing_results(waiting));
    }
    Ok(combined
        .into_iter()
        .filter(|message| !matches!(message, Message::Tool { content, .. } if content.is_empty()))
        .collect())
}

/// Readies a call for a model: the prompt tidied, and a tool choice of `auto` unless one was named.
pub fn prepare_call(mut options: CallOptions) -> Result<CallOptions, ModelError> {
    options.prompt = to_model_prompt(options.prompt)?;
    options.tool_choice = options.tool_choice.or(Some(ToolChoice::Auto));
    Ok(options)
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;

    fn prompt(value: Value) -> Vec<Message> {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn neighbouring_tool_results_join_and_empty_text_goes() {
        let tidy = to_model_prompt(prompt(json!([
            { "role": "system", "content": "Be brief." },
            { "role": "user", "content": [{ "type": "text", "text": "" }, { "type": "text", "text": "Go." }] },
            { "role": "assistant", "content": [
                { "type": "text", "text": "" },
                { "type": "text", "text": "", "providerOptions": { "google": { "thoughtSignature": "s" } } },
                { "type": "tool-call", "toolCallId": "a", "toolName": "t", "input": {} },
                { "type": "tool-call", "toolCallId": "b", "toolName": "t", "input": {} },
            ] },
            { "role": "tool", "content": [{ "type": "tool-result", "toolCallId": "a", "toolName": "t", "output": { "type": "text", "value": "1" } }] },
            { "role": "tool", "content": [{ "type": "tool-result", "toolCallId": "b", "toolName": "t", "output": { "type": "text", "value": "2" } }] },
            { "role": "user", "content": [{ "type": "text", "text": "Next." }] },
        ])))
        .unwrap();
        assert_eq!(
            serde_json::to_value(&tidy).unwrap(),
            json!([
                { "role": "system", "content": "Be brief." },
                { "role": "user", "content": [{ "type": "text", "text": "Go." }] },
                { "role": "assistant", "content": [
                    { "type": "text", "text": "", "providerOptions": { "google": { "thoughtSignature": "s" } } },
                    { "type": "tool-call", "toolCallId": "a", "toolName": "t", "input": {} },
                    { "type": "tool-call", "toolCallId": "b", "toolName": "t", "input": {} },
                ] },
                { "role": "tool", "content": [
                    { "type": "tool-result", "toolCallId": "a", "toolName": "t", "output": { "type": "text", "value": "1" } },
                    { "type": "tool-result", "toolCallId": "b", "toolName": "t", "output": { "type": "text", "value": "2" } },
                ] },
                { "role": "user", "content": [{ "type": "text", "text": "Next." }] },
            ])
        );
    }

    #[test]
    fn a_call_without_its_result_is_refused() {
        let one = to_model_prompt(prompt(json!([
            { "role": "user", "content": [{ "type": "text", "text": "Go." }] },
            { "role": "assistant", "content": [{ "type": "tool-call", "toolCallId": "a", "toolName": "t", "input": {} }] },
            { "role": "user", "content": [{ "type": "text", "text": "Next." }] },
        ])));
        assert_eq!(one.unwrap_err().to_string(), "Tool result is missing for tool call a.");
        let two = to_model_prompt(prompt(json!([
            { "role": "user", "content": [{ "type": "text", "text": "Go." }] },
            { "role": "assistant", "content": [
                { "type": "tool-call", "toolCallId": "a", "toolName": "t", "input": {} },
                { "type": "tool-call", "toolCallId": "b", "toolName": "t", "input": {} },
            ] },
        ])));
        assert_eq!(two.unwrap_err().to_string(), "Tool results are missing for tool calls a, b.");
    }

    #[test]
    fn a_prompt_needs_more_than_system_text() {
        let error = to_model_prompt(prompt(json!([{ "role": "system", "content": "Be brief." }]))).unwrap_err();
        assert_eq!(error.to_string(), "Invalid prompt: messages must not be empty");
    }

    #[test]
    fn the_tool_choice_defaults_to_auto() {
        let options = |choice: Option<ToolChoice>| CallOptions {
            prompt: prompt(json!([{ "role": "user", "content": [{ "type": "text", "text": "Go." }] }])),
            tool_choice: choice,
            ..CallOptions::default()
        };
        assert!(matches!(prepare_call(options(None)).unwrap().tool_choice, Some(ToolChoice::Auto)));
        assert!(matches!(prepare_call(options(Some(ToolChoice::None))).unwrap().tool_choice, Some(ToolChoice::None)));
    }
}
