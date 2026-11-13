//! Reads a generate-content event stream. Ported from `GoogleLanguageModel.doStream`. Misty uses no
//! provider-defined tools, so their parts aren't read, and the partial function arguments that only
//! Vertex AI sends aren't either.
use serde_json::{json, Value};

use super::chunk::{
    converted_usage, google_metadata, mapped_reason, pick, picked_feedback, picked_ratings, picked_usage,
    signature_metadata, valid_chunk, GROUNDING_FIELDS,
};
use crate::model_calls::ids::generate_id;
use crate::model_calls::model::StreamDecoder;
use crate::model_calls::providers::ordered::Ordered;
use crate::model_calls::providers::ordered_ext::OrderedExt;
use crate::model_calls::stream::{FinishReason, StreamPart};

pub(super) struct GoogleDecoder {
    warnings: Vec<Value>,
    finish_reason: FinishReason,
    usage: Option<Value>,
    provider_metadata: Option<Value>,
    grounding: Value,
    url_context: Value,
    has_tool_calls: bool,
    metadata_sent: bool,
    text_block: Option<String>,
    reasoning_block: Option<String>,
    blocks: u64,
}

impl GoogleDecoder {
    pub(super) fn new(warnings: Vec<Value>) -> Self {
        Self {
            warnings,
            finish_reason: FinishReason { unified: "other".into(), raw: None },
            usage: None,
            provider_metadata: None,
            grounding: Value::Null,
            url_context: Value::Null,
            has_tool_calls: false,
            metadata_sent: false,
            text_block: None,
            reasoning_block: None,
            blocks: 0,
        }
    }

    fn next_block(&mut self) -> String {
        let id = self.blocks.to_string();
        self.blocks += 1;
        id
    }

    fn end_text(&mut self, out: &mut Vec<StreamPart>) {
        if let Some(id) = self.text_block.take() {
            out.push(StreamPart::TextEnd { id, provider_metadata: None });
        }
    }

    fn end_reasoning(&mut self, out: &mut Vec<StreamPart>) {
        if let Some(id) = self.reasoning_block.take() {
            out.push(StreamPart::ReasoningEnd { id, provider_metadata: None });
        }
    }

    fn text_part(&mut self, part: &Value, text: &str, out: &mut Vec<StreamPart>) {
        let metadata = signature_metadata(part);
        if text.is_empty() {
            // Gemini can send a signature alone, after the text it belongs to.
            if let (Some(_), Some(id)) = (&metadata, &self.text_block) {
                out.push(StreamPart::TextDelta { id: id.clone(), delta: String::new(), provider_metadata: metadata });
            }
        } else if part.get("thought") == Some(&Value::Bool(true)) {
            self.end_text(out);
            let id = match &self.reasoning_block {
                Some(id) => id.clone(),
                None => {
                    let id = self.next_block();
                    self.reasoning_block = Some(id.clone());
                    out.push(StreamPart::ReasoningStart { id: id.clone(), provider_metadata: metadata.clone() });
                    id
                }
            };
            out.push(StreamPart::ReasoningDelta { id, delta: text.to_owned(), provider_metadata: metadata });
        } else {
            self.end_reasoning(out);
            let id = match &self.text_block {
                Some(id) => id.clone(),
                None => {
                    let id = self.next_block();
                    self.text_block = Some(id.clone());
                    out.push(StreamPart::TextStart { id: id.clone(), provider_metadata: metadata.clone() });
                    id
                }
            };
            out.push(StreamPart::TextDelta { id, delta: text.to_owned(), provider_metadata: metadata });
        }
    }

    fn inline_part(&mut self, part: &Value, data: &Value, out: &mut Vec<StreamPart>) {
        self.end_text(out);
        self.end_reasoning(out);
        let kind = if part.get("thought") == Some(&Value::Bool(true)) { "reasoning-file" } else { "file" };
        let mut file = json!({
            "type": kind,
            "mediaType": data.get("mimeType"),
            "data": { "type": "data", "data": data.get("data") },
        });
        if let Some(metadata) = signature_metadata(part) {
            file["providerMetadata"] = metadata;
        }
        out.push(StreamPart::Other(file));
    }

    /// A call with its arguments whole, which is the only form the Gemini API sends.
    fn function_call(&mut self, call: &Value, ordered: Option<&Ordered>, part: &Value, out: &mut Vec<StreamPart>) {
        let continuing = call.get("willContinue") == Some(&Value::Bool(true));
        let Some(name) = call.get("name").and_then(Value::as_str) else {
            return;
        };
        if continuing || call.get("partialArgs").is_some_and(|value| !value.is_null()) {
            return;
        }
        let metadata = signature_metadata(part);
        let id = call
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .map_or_else(generate_id, str::to_owned);
        let arguments = call.get("args").filter(|args| !args.is_null()).map(|args| match args {
            Value::String(text) => text.clone(),
            other => ordered.map_or_else(|| other.to_string(), Ordered::to_text),
        });
        out.push(StreamPart::ToolInputStart {
            id: id.clone(),
            tool_name: name.to_owned(),
            provider_metadata: metadata.clone(),
        });
        if let Some(arguments) = &arguments {
            out.push(StreamPart::ToolInputDelta {
                id: id.clone(),
                delta: arguments.clone(),
                provider_metadata: metadata.clone(),
            });
        }
        out.push(StreamPart::ToolInputEnd { id: id.clone(), provider_metadata: metadata.clone() });
        out.push(StreamPart::ToolCall {
            tool_call_id: id,
            tool_name: name.to_owned(),
            input: arguments.unwrap_or_else(|| "{}".to_owned()),
            provider_metadata: metadata,
        });
        self.has_tool_calls = true;
    }

    fn fail(&self, error: Value, out: &mut Vec<StreamPart>) {
        out.push(StreamPart::Error { error });
    }
}

impl StreamDecoder for GoogleDecoder {
    fn start(&mut self, out: &mut Vec<StreamPart>) {
        out.push(StreamPart::StreamStart { warnings: std::mem::take(&mut self.warnings) });
    }

    fn event(&mut self, data: &str, out: &mut Vec<StreamPart>) {
        // Parsed with its key order kept, because call arguments go back to the model as they came.
        let Ok(tree) = Ordered::from_text(data) else {
            self.fail(json!({ "name": "AI_JSONParseError", "text": data }), out);
            return;
        };
        let chunk = tree.to_value();
        if !valid_chunk(&chunk) {
            self.fail(json!({ "name": "AI_TypeValidationError", "value": chunk }), out);
            return;
        }
        if !self.metadata_sent {
            if let Some(id) = chunk.get("responseId").and_then(Value::as_str) {
                self.metadata_sent = true;
                out.push(StreamPart::ResponseMetadata { id: Some(id.to_owned()), model_id: None, timestamp: None });
            }
        }
        let usage_here = chunk.get("usageMetadata").filter(|usage| !usage.is_null()).map(picked_usage);
        if let Some(usage) = &usage_here {
            self.usage = Some(usage.clone());
        }
        let Some(candidate) = chunk.get("candidates").and_then(|list| list.get(0)) else {
            return;
        };
        if let Some(grounding) = candidate.get("groundingMetadata").filter(|value| !value.is_null()) {
            self.grounding = pick(grounding, &GROUNDING_FIELDS);
        }
        if let Some(context) = candidate.get("urlContextMetadata").filter(|value| !value.is_null()) {
            self.url_context = pick(context, &["urlMetadata"]);
        }
        let parts = candidate
            .get("content")
            .and_then(|content| content.get("parts"))
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        for part in parts {
            // Which schema a part fits decides which of its fields count, in this order.
            let has_object = |key: &str| part.get(key).is_some_and(Value::is_object);
            if has_object("functionCall") || has_object("toolCall") || has_object("toolResponse") {
                continue;
            }
            if let Some(inline) = part.get("inlineData").filter(|inline| {
                inline.get("mimeType").is_some_and(Value::is_string) && inline.get("data").is_some_and(Value::is_string)
            }) {
                self.inline_part(part, inline, out);
                continue;
            }
            let runs_code = part.pointer("/executableCode/code").and_then(Value::as_str).is_some_and(|code| !code.is_empty());
            if runs_code || part.get("codeExecutionResult").is_some_and(Value::is_object) {
                continue;
            }
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                self.text_part(part, text, out);
            }
        }
        // Calls come after the text of the same chunk, as the SDK reads them in a second pass.
        let ordered_parts = tree
            .get("candidates")
            .and_then(OrderedExt::as_array)
            .and_then(|list| list.first())
            .and_then(|candidate| candidate.get("content"))
            .and_then(|content| content.get("parts"))
            .and_then(OrderedExt::as_array)
            .unwrap_or(&[]);
        for (index, part) in parts.iter().enumerate() {
            if let Some(call) = part.get("functionCall").filter(|call| call.is_object()) {
                let args = ordered_parts
                    .get(index)
                    .and_then(|part| part.get("functionCall"))
                    .and_then(|call| call.get("args"));
                self.function_call(call, args, part, out);
            }
        }
        if let Some(reason) = candidate.get("finishReason").and_then(Value::as_str) {
            self.finish_reason = FinishReason {
                unified: mapped_reason(reason, self.has_tool_calls).into(),
                raw: Some(reason.to_owned()),
            };
            let or_null = |value: Option<&Value>| value.cloned().unwrap_or(Value::Null);
            self.provider_metadata = Some(google_metadata(json!({
                "promptFeedback": chunk.get("promptFeedback").map(picked_feedback).unwrap_or(Value::Null),
                "groundingMetadata": self.grounding,
                "urlContextMetadata": self.url_context,
                "safetyRatings": candidate.get("safetyRatings").map(picked_ratings).unwrap_or(Value::Null),
                "usageMetadata": usage_here.clone().unwrap_or(Value::Null),
                "finishMessage": or_null(candidate.get("finishMessage")),
                "serviceTier": or_null(self.usage.as_ref().and_then(|usage| usage.get("serviceTier"))),
            })));
        }
    }

    fn finish(&mut self, out: &mut Vec<StreamPart>) {
        self.end_text(out);
        self.end_reasoning(out);
        out.push(StreamPart::Finish {
            finish_reason: self.finish_reason.clone(),
            usage: converted_usage(self.usage.as_ref()),
            provider_metadata: self.provider_metadata.take(),
        });
    }
}
