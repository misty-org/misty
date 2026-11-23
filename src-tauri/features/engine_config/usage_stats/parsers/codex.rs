// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

use super::{clean, count_of, model_or_unknown, ParseCtx, UsageEvent};
use crate::engine_config::usage_stats::time::parse_iso_ms;
use crate::engine_config::usage_stats::types::Tokens;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Recent cumulative totals remembered per file. Mirrors TokenTracker (MIT):
/// a rollout can interleave token_count streams (parent agent + embedded
/// reviewer) and repeat an older stream's total; a small window of recent
/// totals makes those repeats idempotent.
const RECENT_TOTALS: usize = 32;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
struct State {
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    root_id: Option<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    pending_record: bool,
    #[serde(default)]
    recent_totals: Vec<String>,
    #[serde(default)]
    last_total: Option<[i64; 4]>,
}

pub(crate) struct CodexParser {
    state: State,
    file_session: Option<String>,
}

#[derive(Deserialize)]
struct Line {
    #[serde(default, rename = "type")]
    kind: Option<String>,
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(default)]
    payload: Option<Value>,
}

const MARKERS: [&[u8]; 6] = [
    b"\"token_count\"",
    b"\"token_usage_record\"",
    b"\"turn_context\"",
    b"\"session_meta\"",
    b"\"model_rerouted\"",
    b"\"model/rerouted\"",
];

impl CodexParser {
    pub fn new(file_name: &str, state: Option<&str>) -> Self {
        let state = state
            .and_then(|text| serde_json::from_str(text).ok())
            .unwrap_or_default();
        Self {
            state,
            file_session: session_from_file_name(file_name),
        }
    }

    pub fn state_json(&self) -> Option<String> {
        serde_json::to_string(&self.state).ok()
    }

    pub fn wants(&self, line: &[u8]) -> bool {
        MARKERS.iter().any(|marker| super::contains(line, marker))
    }

    pub fn feed(&mut self, line: &[u8], ctx: &mut ParseCtx, out: &mut Vec<UsageEvent>) {
        let Ok(parsed) = serde_json::from_slice::<Line>(line) else {
            return;
        };
        let Some(payload) = parsed.payload.as_ref().filter(|p| p.is_object()) else {
            return;
        };
        let ts = parsed.timestamp.as_deref().and_then(parse_iso_ms);
        match parsed.kind.as_deref() {
            Some("session_meta") => self.on_session_meta(payload, ctx),
            Some("turn_context") => self.on_turn_context(payload),
            Some("token_usage_record") => self.on_record(payload, ts, out),
            Some("event_msg") => self.on_event(payload, ts, out),
            _ => {}
        }
    }

    fn on_session_meta(&mut self, payload: &Value, ctx: &mut ParseCtx) {
        if self.state.session_id.is_some() {
            return;
        }
        let Some(id) = clean(payload.get("id").and_then(Value::as_str)) else {
            return;
        };
        let forked_from = clean(payload.get("forked_from_id").and_then(Value::as_str));
        let root = match forked_from {
            Some(parent) => ctx.codex_root(&parent),
            None => ctx.codex_root(&id),
        };
        ctx.set_codex_root(&id, &root);
        self.state.session_id = Some(id);
        self.state.root_id = Some(root);
        if let Some(cwd) = clean(payload.get("cwd").and_then(Value::as_str)) {
            self.state.cwd = Some(cwd);
        }
        if self.state.model.is_none() {
            self.state.model = clean(payload.get("model").and_then(Value::as_str));
        }
    }

    fn on_turn_context(&mut self, payload: &Value) {
        if let Some(model) = clean(payload.get("model").and_then(Value::as_str)) {
            self.state.model = Some(model);
        }
        if let Some(cwd) = clean(payload.get("cwd").and_then(Value::as_str)) {
            self.state.cwd = Some(cwd);
        }
    }

    fn on_record(&mut self, payload: &Value, ts: Option<i64>, out: &mut Vec<UsageEvent>) {
        let Some(response_id) = clean(payload.get("response_id").and_then(Value::as_str)) else {
            return;
        };
        let Some(usage) = payload.get("usage").filter(|u| u.is_object()) else {
            return;
        };
        self.state.pending_record = true;
        let tokens = normalize(usage);
        if let (Some(ts_ms), false) = (ts, tokens.is_zero()) {
            out.push(self.event(format!("codex:resp:{response_id}"), ts_ms, tokens));
        }
    }

    fn on_event(&mut self, payload: &Value, ts: Option<i64>, out: &mut Vec<UsageEvent>) {
        let kind = payload.get("type").and_then(Value::as_str);
        if matches!(kind, Some("model_rerouted") | Some("model/rerouted")) {
            let to = payload.get("to_model").or_else(|| payload.get("toModel"));
            if let Some(model) = clean(to.and_then(Value::as_str)) {
                self.state.model = Some(model);
            }
            return;
        }
        let info = if kind == Some("token_count") {
            payload.get("info")
        } else {
            payload
                .get("msg")
                .filter(|msg| msg.get("type").and_then(Value::as_str) == Some("token_count"))
                .and_then(|msg| msg.get("info"))
        };
        if let Some(info) = info.filter(|i| i.is_object()) {
            self.on_token_count(info, ts, out);
        }
    }

    fn on_token_count(&mut self, info: &Value, ts: Option<i64>, out: &mut Vec<UsageEvent>) {
        let total = info.get("total_token_usage").filter(|t| t.is_object());
        let last = info.get("last_token_usage").filter(|t| t.is_object());
        let signature = total.map(signature);
        let covered_by_record = std::mem::take(&mut self.state.pending_record);
        if let Some(sig) = &signature {
            if self.state.recent_totals.contains(sig) {
                return;
            }
            self.state.recent_totals.push(sig.clone());
            if self.state.recent_totals.len() > RECENT_TOTALS {
                self.state.recent_totals.remove(0);
            }
        }
        let previous_total = self.state.last_total;
        if let Some(total) = total {
            self.state.last_total = Some(raw_fields(total));
        }
        if covered_by_record {
            return;
        }
        let tokens = match (last, total, previous_total) {
            (Some(last), _, _) => normalize(last),
            (None, Some(total), Some(prev)) => delta_tokens(raw_fields(total), prev),
            (None, Some(total), None) => normalize(total),
            (None, None, _) => return,
        };
        let Some(ts_ms) = ts.filter(|_| !tokens.is_zero()) else {
            return;
        };
        let key = match &signature {
            Some(sig) => format!("codex:tc:{}:{sig}", self.root().unwrap_or_default()),
            None => format!("codex:ts:{}:{ts_ms}", self.root().unwrap_or_default()),
        };
        out.push(self.event(key, ts_ms, tokens));
    }

    fn root(&self) -> Option<String> {
        self.state
            .root_id
            .clone()
            .or_else(|| self.state.session_id.clone())
            .or_else(|| self.file_session.clone())
    }

    fn event(&self, key: String, ts_ms: i64, tokens: Tokens) -> UsageEvent {
        UsageEvent {
            key,
            ts_ms,
            engine: "codex",
            model: model_or_unknown(self.state.model.clone()),
            project: self.state.cwd.clone(),
            session_id: self
                .state
                .session_id
                .clone()
                .or_else(|| self.file_session.clone()),
            tokens,
        }
    }
}

fn raw_fields(usage: &Value) -> [i64; 4] {
    let field = |name: &str| usage.get(name).map(count_of).unwrap_or(0);
    [
        field("input_tokens"),
        field("cached_input_tokens"),
        field("output_tokens"),
        field("reasoning_output_tokens"),
    ]
}

fn tokens_from_raw([input, cached, output, reasoning]: [i64; 4]) -> Tokens {
    Tokens {
        input: input.saturating_sub(cached).max(0),
        output,
        cache_read: cached,
        cache_write: 0,
        reasoning: reasoning.min(output),
    }
}

pub(crate) fn normalize(usage: &Value) -> Tokens {
    tokens_from_raw(raw_fields(usage))
}

fn delta_tokens(total: [i64; 4], previous: [i64; 4]) -> Tokens {
    let mut delta = [0i64; 4];
    for (i, slot) in delta.iter_mut().enumerate() {
        *slot = (total[i] - previous[i]).max(0);
    }
    tokens_from_raw(delta)
}

fn signature(total: &Value) -> String {
    let field = |name: &str| total.get(name).map(count_of).unwrap_or(0);
    format!(
        "{}:{}:{}:{}:{}:{}",
        field("input_tokens"),
        field("cached_input_tokens"),
        field("cache_write_input_tokens"),
        field("output_tokens"),
        field("reasoning_output_tokens"),
        field("total_tokens"),
    )
}

fn session_from_file_name(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".jsonl")?;
    let tail = stem.get(stem.len().checked_sub(36)?..)?;
    let looks_like_uuid = tail.bytes().enumerate().all(|(i, b)| {
        matches!(i, 8 | 13 | 18 | 23) == (b == b'-') && (b == b'-' || b.is_ascii_hexdigit())
    });
    looks_like_uuid.then(|| tail.to_string())
}
