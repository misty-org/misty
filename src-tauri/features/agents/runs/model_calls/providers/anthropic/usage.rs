//! Anthropic's token counts. Ported from `convert-anthropic-usage.ts`. Reading a cached token costs
//! about a tenth of a fresh one, and writing one a little more, so these numbers decide what a run
//! costs and have to stay exact.
use serde_json::{json, Map, Value};

use crate::model_calls::stream::{InputTokens, OutputTokens, Usage};

#[derive(Default)]
pub(super) struct TokenCounts {
    input: u64,
    output: u64,
    cache_write: u64,
    cache_read: u64,
    thinking: Option<u64>,
    iterations: Option<Vec<Value>>,
}

fn count(usage: &Value, name: &str) -> Option<u64> {
    usage.get(name).and_then(Value::as_u64)
}

fn number_or_absent(usage: &Value, name: &str) -> bool {
    usage.get(name).map_or(true, |value| value.is_null() || value.is_number())
}

pub(super) fn valid_start(usage: &Value) -> Result<(), &'static str> {
    let fine = usage.is_object()
        && usage.get("input_tokens").is_some_and(Value::is_number)
        && number_or_absent(usage, "cache_creation_input_tokens")
        && number_or_absent(usage, "cache_read_input_tokens");
    if fine {
        Ok(())
    } else {
        Err("message_start needs a usage with input_tokens.")
    }
}

const ITERATION_TYPES: [&str; 4] = ["compaction", "message", "advisor_message", "fallback_message"];

fn valid_iteration(iteration: &Value) -> bool {
    iteration
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|kind| ITERATION_TYPES.contains(&kind))
        && iteration.get("input_tokens").is_some_and(Value::is_number)
        && iteration.get("output_tokens").is_some_and(Value::is_number)
        && number_or_absent(iteration, "cache_creation_input_tokens")
        && number_or_absent(iteration, "cache_read_input_tokens")
}

pub(super) fn valid_delta(usage: &Value) -> Result<(), &'static str> {
    let iterations = match usage.get("iterations") {
        None | Some(Value::Null) => true,
        Some(Value::Array(items)) => items.iter().all(valid_iteration),
        Some(_) => false,
    };
    let details = match usage.get("output_tokens_details") {
        None | Some(Value::Null) => true,
        Some(details) => details.is_object() && number_or_absent(details, "thinking_tokens"),
    };
    let fine = usage.is_object()
        && usage.get("output_tokens").is_some_and(Value::is_number)
        && number_or_absent(usage, "input_tokens")
        && number_or_absent(usage, "cache_creation_input_tokens")
        && number_or_absent(usage, "cache_read_input_tokens")
        && iterations
        && details;
    if fine {
        Ok(())
    } else {
        Err("message_delta needs a usage with output_tokens.")
    }
}

fn keep(object: &Value, names: &[&str]) -> Value {
    let mut kept = Map::new();
    for name in names {
        if let Some(value) = object.get(*name) {
            kept.insert((*name).to_owned(), value.clone());
        }
    }
    Value::Object(kept)
}

/// A delta's usage keeps fields nobody has heard of, but its nested parts keep only the known ones.
pub(super) fn known_fields(usage: &Value) -> Value {
    let mut fields = usage.clone();
    if let Some(object) = fields.as_object_mut() {
        if let Some(details) = object.get_mut("output_tokens_details").filter(|details| details.is_object()) {
            *details = keep(details, &["thinking_tokens"]);
        }
        if let Some(Value::Array(iterations)) = object.get_mut("iterations") {
            for iteration in iterations {
                *iteration = keep(
                    iteration,
                    &[
                        "type",
                        "model",
                        "input_tokens",
                        "output_tokens",
                        "cache_creation_input_tokens",
                        "cache_read_input_tokens",
                    ],
                );
            }
        }
    }
    fields
}

impl TokenCounts {
    pub(super) fn start(&mut self, usage: &Value) {
        self.input = count(usage, "input_tokens").unwrap_or(0);
        self.cache_read = count(usage, "cache_read_input_tokens").unwrap_or(0);
        self.cache_write = count(usage, "cache_creation_input_tokens").unwrap_or(0);
    }

    pub(super) fn update(&mut self, usage: &Value) {
        if let Some(input) = count(usage, "input_tokens") {
            self.input = input;
        }
        self.output = count(usage, "output_tokens").unwrap_or(0);
        if let Some(details) = usage.get("output_tokens_details").filter(|details| !details.is_null()) {
            self.thinking = count(details, "thinking_tokens");
        }
        if let Some(read) = count(usage, "cache_read_input_tokens") {
            self.cache_read = read;
        }
        if let Some(write) = count(usage, "cache_creation_input_tokens") {
            self.cache_write = write;
        }
        if let Some(iterations) = usage.get("iterations").and_then(Value::as_array) {
            self.iterations = Some(iterations.clone());
        }
    }

    /// Iterations are the real totals when compaction or the advisor ran, except advisor ones,
    /// which bill at another rate. After a server-side fallback the top-level totals already
    /// describe the answer that was served, and the blocked attempt must not count.
    fn totals(&self) -> (u64, u64) {
        let Some(iterations) = self.iterations.as_ref().filter(|iterations| !iterations.is_empty()) else {
            return (self.input, self.output);
        };
        let kind = |iteration: &Value| iteration.get("type").and_then(Value::as_str).map(str::to_owned);
        if iterations.iter().any(|iteration| kind(iteration).as_deref() == Some("fallback_message")) {
            return (self.input, self.output);
        }
        let executors: Vec<&Value> = iterations
            .iter()
            .filter(|iteration| matches!(kind(iteration).as_deref(), Some("compaction" | "message")))
            .collect();
        if executors.is_empty() {
            return (self.input, self.output);
        }
        let sum = |name: &str| executors.iter().map(|iteration| count(iteration, name).unwrap_or(0)).sum();
        (sum("input_tokens"), sum("output_tokens"))
    }

    pub(super) fn to_usage(&self, raw: Option<Value>) -> Usage {
        let (input, output) = self.totals();
        Usage {
            input_tokens: InputTokens {
                total: Some(input + self.cache_write + self.cache_read),
                no_cache: Some(input),
                cache_read: Some(self.cache_read),
                cache_write: Some(self.cache_write),
            },
            output_tokens: OutputTokens {
                total: Some(output),
                text: self.thinking.map(|thinking| output.saturating_sub(thinking)),
                reasoning: self.thinking,
            },
            raw: Some(raw.unwrap_or_else(|| self.zeros())),
        }
    }

    fn zeros(&self) -> Value {
        json!({
            "input_tokens": self.input,
            "output_tokens": self.output,
            "cache_creation_input_tokens": self.cache_write,
            "cache_read_input_tokens": self.cache_read,
            "iterations": self.iterations,
        })
    }

    pub(super) fn iterations_metadata(&self) -> Value {
        let Some(iterations) = &self.iterations else {
            return Value::Null;
        };
        Value::Array(
            iterations
                .iter()
                .map(|iteration| {
                    let mut mapped = Map::new();
                    mapped.insert("type".into(), iteration.get("type").cloned().unwrap_or(Value::Null));
                    if let Some(model) = iteration.get("model").filter(|model| !model.is_null()) {
                        mapped.insert("model".into(), model.clone());
                    }
                    mapped.insert("inputTokens".into(), iteration.get("input_tokens").cloned().unwrap_or(Value::Null));
                    mapped.insert("outputTokens".into(), iteration.get("output_tokens").cloned().unwrap_or(Value::Null));
                    for (from, to) in [
                        ("cache_creation_input_tokens", "cacheCreationInputTokens"),
                        ("cache_read_input_tokens", "cacheReadInputTokens"),
                    ] {
                        if let Some(tokens) = count(iteration, from).filter(|tokens| *tokens > 0) {
                            mapped.insert(to.into(), json!(tokens));
                        }
                    }
                    Value::Object(mapped)
                })
                .collect(),
        )
    }
}
