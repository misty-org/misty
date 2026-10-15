//! Codex's notifications as runner events: text and reasoning deltas, the turn
//! plan, token usage, rate limits and the end of the turn.
use serde_json::Value;

use super::CodexProtocol;
use crate::agents::runners::events::{todo_status, RateLimit, RunnerEvent, TodoItem, Usage};

impl CodexProtocol {
    pub(super) fn notification(&mut self, method: &str, params: &Value) -> Vec<RunnerEvent> {
        let text = |key: &str| params[key].as_str().unwrap_or("").to_owned();
        match method {
            "item/agentMessage/delta" => vec![RunnerEvent::Delta {
                text: text("delta"),
            }],
            "item/reasoning/textDelta" | "item/reasoning/summaryTextDelta" => {
                vec![RunnerEvent::Thinking {
                    text: text("delta"),
                }]
            }
            "item/started" if params["item"]["type"] == "fileChange" => {
                let item = &params["item"];
                let paths = item["changes"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|c| c["path"].as_str().map(String::from))
                    .collect();
                self.changes
                    .insert(item["id"].as_str().unwrap_or("").into(), paths);
                Vec::new()
            }
            "turn/plan/updated" => {
                let items = params["plan"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .enumerate()
                    .map(|(index, step)| TodoItem {
                        id: format!("p{}", index + 1),
                        title: step["step"]
                            .as_str()
                            .unwrap_or("")
                            .chars()
                            .take(160)
                            .collect(),
                        status: todo_status(step["status"].as_str().unwrap_or("")).into(),
                    });
                vec![RunnerEvent::Todos {
                    items: items.collect(),
                }]
            }
            "thread/tokenUsage/updated" => {
                let last = &params["tokenUsage"]["last"];
                let count = |key: &str| last[key].as_u64().unwrap_or(0);
                vec![RunnerEvent::Usage(Usage {
                    input: count("inputTokens").saturating_sub(count("cachedInputTokens")),
                    output: count("outputTokens"),
                    cache_write: count("cacheWriteInputTokens"),
                    cache_read: count("cachedInputTokens"),
                    model: self.model.clone(),
                })]
            }
            "account/rateLimits/updated" => {
                let primary = &params["rateLimits"]["primary"];
                primary["usedPercent"]
                    .as_f64()
                    .map_or_else(Vec::new, |used| {
                        let window = primary["windowDurationMins"]
                            .as_u64()
                            .map(|m| format!("{m}m"))
                            .unwrap_or_default();
                        vec![RunnerEvent::RateLimit(RateLimit {
                            used_percent: used,
                            window,
                            resets_at: primary["resetsAt"].as_i64(),
                        })]
                    })
            }
            "model/rerouted" => {
                self.model = text("toModel");
                Vec::new()
            }
            "turn/completed" => {
                let turn = &params["turn"];
                let mut events = Vec::new();
                if turn["status"] == "failed" {
                    let message = turn["error"]["message"]
                        .as_str()
                        .unwrap_or("Codex stopped with an error.");
                    events.push(RunnerEvent::Error {
                        message: message.into(),
                    });
                }
                events.push(RunnerEvent::Done {
                    stop_reason: turn["status"].as_str().unwrap_or("completed").into(),
                });
                events
            }
            _ => Vec::new(),
        }
    }
}
