//! A Claude turn's usage: the context window its `result` reports and the occupancy left after
//! a compaction.

use serde_json::Value;

/// Fold the CLI's reported context window into a turn's usage.
///
/// Claude's `result` line carries the window per model under `modelUsage`
/// (`{ "<model>": { contextWindow, maxOutputTokens, … } }`); it never sends
/// `model_context_window`, which is the key the rest of the app reads. Without
/// this, every Claude turn fell through to the UI's assumed 200k — wrong for
/// the 1M `[1m]` variants, and unverifiable for the rest.
///
/// A turn can name several models (a subagent on a cheap model, background
/// work). The one that actually ran the turn is the one with the most tokens,
/// so its window wins; entries without a usable window are ignored.
pub(super) fn attach_reported_context_window(mut usage: Value, source: &Value) -> Value {
    if usage.get("model_context_window").is_some() {
        return usage;
    }
    let Some(models) = source.get("modelUsage").and_then(Value::as_object) else {
        return usage;
    };
    let busiest = models
        .values()
        .filter_map(|model| {
            let window = model.get("contextWindow").and_then(Value::as_i64)?;
            if window <= 0 {
                return None;
            }
            let tokens: i64 = [
                "inputTokens",
                "outputTokens",
                "cacheReadInputTokens",
                "cacheCreationInputTokens",
            ]
            .iter()
            .filter_map(|key| model.get(*key).and_then(Value::as_i64))
            .sum();
            Some((tokens, window))
        })
        .max_by_key(|(tokens, _)| *tokens);
    let Some((_, window)) = busiest else {
        return usage;
    };
    if let Some(object) = usage.as_object_mut() {
        object.insert("model_context_window".to_string(), Value::from(window));
    }
    usage
}

/// Usage snapshot for a compacted turn. Occupancy is the post-compaction
/// remainder (`post_tokens`), not the turn's billing input, but the turn's
/// output still enters the context afterwards and the reported context
/// window is carried over so the breakdown keeps its segments and scale
/// (total = post_tokens + output_tokens).
pub(super) fn compact_usage(post_tokens: i64, raw: Option<&Value>) -> Value {
    let output = raw
        .and_then(|u| u.get("output_tokens"))
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let mut usage = serde_json::json!({
        "input_tokens": post_tokens,
        "output_tokens": output,
        "total_tokens": post_tokens + output,
    });
    if let (Some(raw), Some(obj)) = (raw, usage.as_object_mut()) {
        if let Some(window) = raw.get("model_context_window") {
            obj.insert("model_context_window".to_string(), window.clone());
        }
    }
    usage
}

#[cfg(test)]
mod tests {
    use crate::engines::claude::ClaudeEngine;
    use crate::engines::{Engine, EngineEvent};

    fn compact_result_line() -> String {
        serde_json::json!({
            "type": "result",
            "subtype": "success",
            "is_error": false,
            "session_id": "s-1",
            "usage": {
                "input_tokens": 30190,
                "output_tokens": 1200,
                "total_tokens": 31390,
                "model_context_window": 200000
            }
        })
        .to_string()
    }

    #[test]
    fn compact_boundary_emits_usage_and_overrides_turn_result_once() {
        let engine = ClaudeEngine::new();
        let boundary = serde_json::json!({
            "type": "system",
            "subtype": "compact_boundary",
            "compactMetadata": { "preTokens": 30190, "postTokens": 8038, "durationMs": 4207 }
        })
        .to_string();
        let mut out = Vec::new();
        engine.parse_line(&boundary, &mut out);
        assert_eq!(out.len(), 1);
        match &out[0] {
            EngineEvent::Usage(usage) => {
                assert_eq!(usage["input_tokens"], 8038);
                assert_eq!(usage["total_tokens"], 8038);
            }
            _ => panic!("expected usage event"),
        }

        // The following result's billing usage is replaced by the
        // post-compaction occupancy, keeping output and the context window.
        let mut out = Vec::new();
        engine.parse_line(&compact_result_line(), &mut out);
        match &out[0] {
            EngineEvent::Done { usage, .. } => {
                let usage = usage.as_ref().expect("usage");
                assert_eq!(usage["input_tokens"], 8038);
                assert_eq!(usage["output_tokens"], 1200);
                assert_eq!(usage["total_tokens"], 8038 + 1200);
                assert_eq!(usage["model_context_window"], 200000);
            }
            _ => panic!("expected done event"),
        }

        // Single-shot: the next turn without a boundary keeps billing usage.
        let mut out = Vec::new();
        engine.parse_line(&compact_result_line(), &mut out);
        match &out[0] {
            EngineEvent::Done { usage, .. } => {
                assert_eq!(usage.as_ref().expect("usage")["input_tokens"], 30190);
            }
            _ => panic!("expected done event"),
        }
    }

    #[test]
    fn result_without_compact_boundary_keeps_billing_usage() {
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&compact_result_line(), &mut out);
        match &out[0] {
            EngineEvent::Done { usage, .. } => {
                let usage = usage.as_ref().expect("usage");
                assert_eq!(usage["input_tokens"], 30190);
                assert_eq!(usage["total_tokens"], 31390);
            }
            _ => panic!("expected done event"),
        }
    }

    #[test]
    fn compact_boundary_without_metadata_stays_silent() {
        let line = serde_json::json!({
            "type": "system",
            "subtype": "compact_boundary"
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        assert!(out.is_empty());
    }

    /// The UI's context gauge divided by a hardcoded 200k because nothing
    /// read the window the CLI reports per model. The result line carries it
    /// under `modelUsage`; the model that did the work is the busiest one, so
    /// a cheap subagent's window must not win a mixed turn.
    #[test]
    fn result_reports_the_window_of_the_model_that_did_the_work() {
        let line = serde_json::json!({
            "type": "result",
            "subtype": "success",
            "is_error": false,
            "session_id": "s-1",
            "usage": { "input_tokens": 900000, "output_tokens": 2000, "total_tokens": 902000 },
            "modelUsage": {
                "claude-haiku-4-5": {
                    "inputTokens": 300, "outputTokens": 40, "contextWindow": 200000
                },
                "claude-opus-5[1m]": {
                    "inputTokens": 880000, "outputTokens": 1250, "contextWindow": 1000000
                }
            }
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        match &out[0] {
            EngineEvent::Done { usage, .. } => {
                let usage = usage.as_ref().expect("usage");
                assert_eq!(usage["model_context_window"], 1_000_000);
                // The billing figures stay the CLI's own.
                assert_eq!(usage["input_tokens"], 900000);
            }
            _ => panic!("expected done event"),
        }
    }

    /// Nothing usable reported ⇒ no key at all, so the UI keeps its own
    /// explicit fallback instead of this layer inventing a number.
    #[test]
    fn result_without_a_reported_window_adds_nothing() {
        for models in [
            None,
            Some(serde_json::json!({})),
            Some(serde_json::json!({
                "m": { "inputTokens": 10, "contextWindow": 0 }
            })),
        ] {
            let mut value = serde_json::json!({
                "type": "result",
                "subtype": "success",
                "is_error": false,
                "session_id": "s-1",
                "usage": { "input_tokens": 10, "output_tokens": 1, "total_tokens": 11 }
            });
            if let Some(models) = models {
                value["modelUsage"] = models;
            }
            let mut out = Vec::new();
            ClaudeEngine::new().parse_line(&value.to_string(), &mut out);
            match &out[0] {
                EngineEvent::Done { usage, .. } => {
                    assert!(usage
                        .as_ref()
                        .expect("usage")
                        .get("model_context_window")
                        .is_none());
                }
                _ => panic!("expected done event"),
            }
        }
    }

    /// An explicitly reported window is the more specific statement and must
    /// survive the per-model map.
    #[test]
    fn explicit_context_window_beats_the_model_map() {
        let line = serde_json::json!({
            "type": "result",
            "subtype": "success",
            "is_error": false,
            "session_id": "s-1",
            "usage": {
                "input_tokens": 10, "output_tokens": 1, "total_tokens": 11,
                "model_context_window": 500000
            },
            "modelUsage": { "m": { "inputTokens": 10, "contextWindow": 200000 } }
        })
        .to_string();
        let mut out = Vec::new();
        ClaudeEngine::new().parse_line(&line, &mut out);
        match &out[0] {
            EngineEvent::Done { usage, .. } => {
                assert_eq!(
                    usage.as_ref().expect("usage")["model_context_window"],
                    500000
                );
            }
            _ => panic!("expected done event"),
        }
    }

    /// A compacted turn's usage is rebuilt from the boundary, so the window
    /// has to be re-attached there too — that path dropped it before.
    #[test]
    fn compacted_turn_keeps_the_reported_window() {
        let engine = ClaudeEngine::new();
        let boundary = serde_json::json!({
            "type": "system",
            "subtype": "compact_boundary",
            "compactMetadata": { "preTokens": 900000, "postTokens": 40000, "durationMs": 1000 }
        })
        .to_string();
        let mut out = Vec::new();
        engine.parse_line(&boundary, &mut out);

        let result = serde_json::json!({
            "type": "result",
            "subtype": "success",
            "is_error": false,
            "session_id": "s-1",
            "usage": { "input_tokens": 900000, "output_tokens": 50, "total_tokens": 900050 },
            "modelUsage": { "claude-opus-5[1m]": { "inputTokens": 900000, "contextWindow": 1000000 } }
        })
        .to_string();
        let mut out = Vec::new();
        engine.parse_line(&result, &mut out);
        match &out[0] {
            EngineEvent::Done { usage, .. } => {
                let usage = usage.as_ref().expect("usage");
                assert_eq!(usage["input_tokens"], 40000);
                assert_eq!(usage["model_context_window"], 1_000_000);
            }
            _ => panic!("expected done event"),
        }
    }
}
