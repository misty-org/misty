use super::{ClaudeEngine, EngineEvent};
use serde_json::Value;

impl ClaudeEngine {
    pub(super) fn note_streamed_text(&self, events: &[EngineEvent]) {
        if events
            .iter()
            .any(|event| matches!(event, EngineEvent::Delta(_)))
        {
            if let Ok(mut lock) = self.streamed_text.lock() {
                *lock = true;
            }
        }
    }

    pub(super) fn keep_local_text(&self, value: &Value) {
        if let Ok(mut lock) = self.local_text.lock() {
            for text in snapshot_texts(value) {
                if !lock.is_empty() {
                    lock.push_str("\n\n");
                }
                lock.push_str(&text);
            }
        }
    }

    pub(super) fn take_local_output(&self) -> (bool, String) {
        let streamed = self
            .streamed_text
            .lock()
            .map(|mut lock| std::mem::take(&mut *lock))
            .unwrap_or(false);
        let local_text = self
            .local_text
            .lock()
            .map(|mut lock| std::mem::take(&mut *lock))
            .unwrap_or_default();
        (streamed, local_text)
    }
}

pub(super) fn local_command_reply(
    streamed: bool,
    local_text: String,
    value: &Value,
) -> Option<String> {
    if streamed || value.get("num_turns").and_then(Value::as_u64) != Some(0) {
        return None;
    }
    let text = if local_text.trim().is_empty() {
        value
            .get("result")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    } else {
        local_text
    };
    (!text.trim().is_empty()).then_some(text)
}

fn snapshot_texts(value: &Value) -> Vec<String> {
    value
        .pointer("/message/content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .filter(|text| !text.trim().is_empty())
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engines::Engine;

    #[test]
    fn local_command_output_is_shown_once_as_the_reply() {
        let engine = ClaudeEngine::new();
        let mut out = Vec::new();
        engine.parse_line(
            &serde_json::json!({
                "type": "assistant",
                "session_id": "s-1",
                "message": { "model": "<synthetic>", "content": [
                    { "type": "text", "text": "## Context Usage" }
                ]}
            })
            .to_string(),
            &mut out,
        );
        engine.parse_line(
            &serde_json::json!({
                "type": "result", "subtype": "success", "is_error": false,
                "num_turns": 0, "result": "## Context Usage", "session_id": "s-1"
            })
            .to_string(),
            &mut out,
        );
        let texts: Vec<&String> = out
            .iter()
            .filter_map(|event| match event {
                EngineEvent::Delta(text) => Some(text),
                _ => None,
            })
            .collect();
        assert_eq!(texts, vec!["## Context Usage"]);
        assert!(matches!(out.last(), Some(EngineEvent::Done { .. })));

        let mut out = Vec::new();
        engine.parse_line(
            &serde_json::json!({
                "type": "assistant",
                "message": { "model": "<synthetic>", "content": [
                    { "type": "text", "text": "API Error: 500" }
                ]}
            })
            .to_string(),
            &mut out,
        );
        engine.parse_line(
            &serde_json::json!({
                "type": "result", "subtype": "error_during_execution", "is_error": true,
                "num_turns": 0, "result": "API Error: 500"
            })
            .to_string(),
            &mut out,
        );
        assert!(!out
            .iter()
            .any(|event| matches!(event, EngineEvent::Delta(_))));
    }

    #[test]
    fn real_local_command_wire_gives_its_output_as_one_delta() {
        let engine = ClaudeEngine::new();
        let mut out = Vec::new();
        let lines: Vec<&str> = include_str!("testdata/claude_local_command_context.jsonl")
            .lines()
            .collect();
        assert_eq!(lines.len(), 3);
        for line in &lines {
            engine.parse_line(line, &mut out);
        }
        let result: Value = serde_json::from_str(lines[2]).unwrap();
        assert_eq!(result["num_turns"], 0);
        let expected = result["result"].as_str().unwrap();
        let texts: Vec<&String> = out
            .iter()
            .filter_map(|event| match event {
                EngineEvent::Delta(text) => Some(text),
                _ => None,
            })
            .collect();
        assert_eq!(texts, vec![expected], "got {out:?}");
        assert!(texts[0].starts_with("## Context Usage"));
        assert!(!texts[0].contains("local-command-stdout"));
        assert!(!out
            .iter()
            .any(|event| matches!(event, EngineEvent::Error(_))));
        assert!(!out
            .iter()
            .any(|event| matches!(event, EngineEvent::Served { model: Some(_), .. })));
        assert!(matches!(
            out.last(),
            Some(EngineEvent::Done { session_id: Some(id), .. })
                if id == "08ff1128-a774-475c-95d6-191401e84f8a"
        ));
    }
}
