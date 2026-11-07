//! What a run saves between turns and tool calls: enough to continue from the same place, with the
//! same transcript and counters, as a Workflow replay did.
use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::{
    runtime::{
        js_json::JsValue,
        ledger::{parse_carried_rows, Ledger, LedgerRow, RowField},
        model_budget::{ExecutionBudget, ModelUsage},
        model_tools::CatalogTool,
        tool_calls::SavedWait,
        tool_monitor::MonitorState,
        toolsets::{Family, ToolState, Toolset},
    },
    sdk::{Message, RawJson, ToolResultPart},
};

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct SavedUsage {
    pub(crate) input_tokens: Option<u64>,
    pub(crate) output_tokens: Option<u64>,
    pub(crate) total_tokens: Option<u64>,
    /// Whether two turns' usage were added, which is when the details appear in the report.
    pub(crate) accumulated: bool,
}

impl SavedUsage {
    pub(crate) fn of_turn(input: u64, output: u64) -> ModelUsage {
        ModelUsage { input_tokens: Some(input), output_tokens: Some(output), total_tokens: Some(input + output), ..ModelUsage::default() }
    }

    pub(crate) fn from_usage(usage: &ModelUsage, accumulated: bool) -> Self {
        Self { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, total_tokens: usage.total_tokens, accumulated }
    }

    pub(crate) fn usage(&self) -> ModelUsage {
        ModelUsage { input_tokens: self.input_tokens, output_tokens: self.output_tokens, total_tokens: self.total_tokens, ..ModelUsage::default() }
    }

    /// `totalUsage` as `JSON.stringify` writes it for the server.
    pub(crate) fn to_json(&self) -> JsValue {
        let mut fields = Vec::new();
        let mut number = |name: &str, value: Option<u64>| {
            if let Some(value) = value {
                fields.push((name.to_owned(), JsValue::Number(value as f64)));
            }
        };
        number("inputTokens", self.input_tokens);
        number("outputTokens", self.output_tokens);
        number("totalTokens", self.total_tokens);
        if self.accumulated {
            fields.push(("inputTokenDetails".to_owned(), JsValue::Object(Vec::new())));
            fields.push(("outputTokenDetails".to_owned(), JsValue::Object(Vec::new())));
        }
        JsValue::Object(fields)
    }
}

/// One finished model call, as `result.steps` holds it.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct StepRecord {
    pub(crate) text: String,
    /// The valid tool calls it made, by ID and model name.
    pub(crate) tool_calls: Vec<(String, String)>,
    pub(crate) finish_reason: String,
    pub(crate) input_tokens: u64,
    pub(crate) output_tokens: u64,
}

/// One tool call of the turn just received.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct CallRecord {
    pub(crate) id: String,
    pub(crate) name: String,
    /// The parsed input, as JSON text.
    pub(crate) input: String,
    /// The error text the model gets back when its input didn't fit.
    pub(crate) invalid: Option<String>,
}

/// A call that has finished, with what the model will read and the raw output the loop reads.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct FinishedCall {
    pub(crate) part: ToolResultPart,
    /// The output, as JSON text. `None` for a call that never ran.
    pub(crate) output: Option<String>,
}

/// The assistant turn just received, and how far its tools have got. Calls that haven't finished run
/// again with the same ID when a run resumes: the server journals by ID, so that's the effect identity.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct ReceivedTurn {
    pub(crate) step: StepRecord,
    /// The transcript including the assistant's message, without the system message.
    pub(crate) messages: Vec<Message>,
    pub(crate) calls: Vec<CallRecord>,
    pub(crate) finished: HashMap<String, FinishedCall>,
    pub(crate) waits: HashMap<String, SavedWait>,
}

/// Where the loop was.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) enum Stage {
    /// At the top of a turn.
    #[default]
    BeforeTurn,
    /// Near the top of a turn, with its steering already in the transcript: the server hands it over once.
    SteeringTaken,
    /// Waiting for the person to hand the window back (`turn_pacing::wait_out_takeover`).
    Takeover { next_poll: u32, sent: Vec<String>, pause_started_ms: i64, poll_at_ms: i64 },
    /// Waiting out a provider outage before trying the same turn again (`model_stream`).
    Outage { outage: usize, wait_started_ms: i64, wake_at_ms: i64, budget: SavedBudget },
    /// A model turn's tools are running or done.
    Tools(Box<ReceivedTurn>),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct SavedBudget {
    pub(crate) version: u32,
    pub(crate) remaining_ms: Option<f64>,
    pub(crate) active: bool,
    pub(crate) deadline: Option<String>,
}

impl SavedBudget {
    pub(crate) fn of(budget: &ExecutionBudget) -> Self {
        Self { version: budget.version, remaining_ms: budget.remaining_ms, active: budget.active, deadline: budget.deadline.clone() }
    }

    pub(crate) fn budget(&self) -> ExecutionBudget {
        ExecutionBudget { version: self.version, remaining_ms: self.remaining_ms, active: self.active, deadline: self.deadline.clone() }
    }
}

/// `CatalogTool`, for the file.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct SavedTool {
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) input_schema: RawJson,
    pub(crate) concurrent: bool,
    pub(crate) read_only: bool,
    pub(crate) local: bool,
}

impl From<&CatalogTool> for SavedTool {
    fn from(tool: &CatalogTool) -> Self {
        Self { name: tool.name.clone(), description: tool.description.clone(), input_schema: tool.input_schema.clone(), concurrent: tool.concurrent, read_only: tool.read_only, local: tool.local }
    }
}

impl From<SavedTool> for CatalogTool {
    fn from(tool: SavedTool) -> Self {
        Self { name: tool.name, description: tool.description, input_schema: tool.input_schema, concurrent: tool.concurrent, read_only: tool.read_only, local: tool.local }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct SavedPacing {
    pub(crate) started_at_ms: i64,
    pub(crate) paused_ms: i64,
    pub(crate) estimate: Option<f64>,
    pub(crate) research_scale: usize,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct SavedToolState {
    pub(crate) toolset: String,
    pub(crate) loaded: Vec<String>,
    pub(crate) seen: bool,
}

impl SavedToolState {
    pub(crate) fn of(state: &ToolState) -> Self {
        Self { toolset: state.toolset.as_str().to_owned(), loaded: state.loaded.iter().map(|family| family.as_str().to_owned()).collect(), seen: state.seen }
    }

    pub(crate) fn state(&self) -> ToolState {
        let toolset = [Toolset::Answer, Toolset::Browse, Toolset::Desktop].into_iter().find(|set| set.as_str() == self.toolset).unwrap_or(Toolset::Answer);
        let loaded = [Family::Integration, Family::Agent, Family::Misty].into_iter().filter(|family| self.loaded.iter().any(|name| name == family.as_str())).collect();
        ToolState { toolset, loaded, seen: self.seen }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct LoopState {
    pub(crate) catalog: Vec<SavedTool>,
    pub(crate) messages: Vec<Message>,
    /// How many messages at the end were added since the last model call. The adapter hands back
    /// every earlier one in converted form, so note checks don't see them as plain text.
    pub(crate) plain_tail: usize,
    /// What the stop path reads, when it isn't `messages` itself: the array the TypeScript kept hold of
    /// after the transcript was rewritten, or nothing yet.
    pub(crate) transcript: Option<Vec<Message>>,
    pub(crate) model_turn: i64,
    pub(crate) limit: i64,
    pub(crate) visible_tools: Vec<String>,
    pub(crate) progress_nudges: u32,
    pub(crate) finish_asked: bool,
    pub(crate) compactions: u64,
    pub(crate) summary_turn: i64,
    pub(crate) last_input_tokens: u64,
    pub(crate) last_sent_bytes: usize,
    pub(crate) toolset: SavedToolState,
    pub(crate) last_tool_key: String,
    pub(crate) pacing: SavedPacing,
    pub(crate) steps: Vec<StepRecord>,
    pub(crate) usage: Option<SavedUsage>,
    pub(crate) last_finish_reason: String,
    pub(crate) last_tool_results: Vec<SavedResult>,
    pub(crate) stream_aborted: bool,
    pub(crate) verified: bool,
    pub(crate) persisted: usize,
    pub(crate) persisted_at: Option<HashSet<String>>,
    pub(crate) reported_only: u32,
    pub(crate) ledger: Vec<SavedRow>,
    pub(crate) documents_latest: HashMap<String, String>,
    pub(crate) documents_issued: HashSet<String>,
    pub(crate) rejected: HashSet<String>,
    pub(crate) monitor: MonitorState,
    pub(crate) stopped_reason: String,
    pub(crate) paused_reason: String,
    pub(crate) declined: HashMap<String, String>,
    pub(crate) stage: Stage,
}

/// `toolResults` of the latest turn.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(crate) struct SavedResult {
    pub(crate) tool_call_id: String,
    pub(crate) tool_name: String,
    pub(crate) output: String,
}

/// One ledger row: its JSON, in its own field order, and whether it came from an earlier attempt.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct SavedRow {
    pub(crate) row: String,
    pub(crate) carried: bool,
}

pub(crate) fn saved_ledger(ledger: &Ledger) -> Vec<SavedRow> {
    ledger.snapshot().iter().map(|row| SavedRow { row: row.to_js().stringify(), carried: row.carried }).collect()
}

fn field_of(name: &str) -> Option<RowField> {
    Some(match name {
        "id" => RowField::Id,
        "requirement" => RowField::Requirement,
        "state" => RowField::State,
        "evidence" => RowField::Evidence,
        "reason" => RowField::Reason,
        "needs" => RowField::Needs,
        "hint" => RowField::Hint,
        _ => return None,
    })
}

/// The rows back, in the order they were saved. `None` is a row that no longer reads.
pub(crate) fn restored_ledger(saved: &[SavedRow]) -> Option<Ledger> {
    let mut rows: Vec<LedgerRow> = Vec::with_capacity(saved.len());
    for saved in saved {
        let value = JsValue::parse(&saved.row)?;
        let order: Vec<RowField> = match &value {
            JsValue::Object(fields) => fields.iter().filter_map(|(name, _)| field_of(name)).collect(),
            _ => return None,
        };
        let mut row = parse_carried_rows(&JsValue::Array(vec![value]))?.pop()?;
        row.carried = saved.carried;
        row.order = order;
        rows.push(row);
    }
    Some(Ledger::restored(rows))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::ledger::record_rows;

    #[test]
    fn usage_reads_as_the_sdk_writes_it() {
        let one = SavedUsage::from_usage(&SavedUsage::of_turn(100, 12), false);
        assert_eq!(one.to_json().stringify(), r#"{"inputTokens":100,"outputTokens":12,"totalTokens":112}"#);
        let added = SavedUsage::from_usage(&SavedUsage::of_turn(200, 24), true);
        assert_eq!(added.to_json().stringify(), r#"{"inputTokens":200,"outputTokens":24,"totalTokens":224,"inputTokenDetails":{},"outputTokenDetails":{}}"#);
    }

    #[test]
    fn a_ledger_comes_back_as_it_was() {
        let mut ledger = Ledger::new(Vec::new());
        let sent = crate::runtime::ledger::parse_ledger_input(&JsValue::parse(r#"{"rows":[{"requirement":"Find it","state":"blocked","reason":"no page"}]}"#).unwrap()).unwrap();
        record_rows(&mut ledger, sent);
        let saved = saved_ledger(&ledger);
        let back = restored_ledger(&saved).unwrap();
        assert_eq!(back.snapshot(), ledger.snapshot());
    }
}
