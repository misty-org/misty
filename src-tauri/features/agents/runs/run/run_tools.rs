//! The run's tools, built from Misty's catalog. A screen that joins the run mid-run (screen_open
//! opening the agent's own tab) rebuilds them, so browser tools reach the model in this run instead of
//! a hand-off to a new one.
use std::{collections::HashSet, sync::Arc};

use crate::citation_check::CITATION_INSTRUCTIONS;
use crate::context::prompt_cache::with_runtime_instructions;
use crate::finish_check::{after_refusal, unbacked_completion};
use crate::js_json::JsValue;
use crate::ledger::{ledger_input_schema, parse_ledger_input, record_rows, with_ledger, RowState, LEDGER_INSTRUCTIONS, LEDGER_TOOL};
use crate::model_family::model_family_note;
use crate::model_tools::{catalog_tools, visual_tool_output, CatalogTool, ModelCatalog};
use crate::research_budget::ResearchTools;
use crate::runtime_errors::RuntimeError;
use crate::serial_tool_lifecycle::SerialToolLifecycle;
use crate::task_completion::{parse_task_completion_input, task_completion_input_schema, with_answer_summary, TaskCompletion, SUMMARY_MISSING_NOTE, TASK_COMPLETION_INSTRUCTIONS, TASK_COMPLETION_TOOL};
use crate::text::js_prefix;
use crate::tool_calls::{CallEnvironment, SavedWait};
use crate::tool_monitor::ToolMonitor;
use crate::tool_outcomes::EXECUTION_INSTRUCTIONS;
use crate::tool_transport::{object, string};
use crate::toolsets::{agent_tools, run_toolset_tool, AgentTools, Toolset, TOOL_LOAD_TOOL, TOOL_USE_TOOL};
use crate::web_search::tool::with_device_tools;
use crate::model_calls::{Message, RawJson, ToolDefinition, ToolOutput};

use super::{
    agent_run::{guard, locked, RunShared},
    finish_review::verify_finish,
};

const LEDGER_DESCRIPTION: &str = "Keep the list of this request's parts and where each stands. Send rows to add or update them: pending, done (with evidence: a kept page's address, a note or file you wrote, or a receipt a tool returned), failed, blocked or skipped (with a reason). It records state; it performs no action.";
const FINISH_DESCRIPTION: &str = "Report the final task outcome and user-facing answer. Call alone after completing all possible work, or when a real blocker prevents further progress. Leave summary out when your previous response already gave the answer as text. This records a report; it grants no capabilities and performs no external action.";
const LEDGER_NOTE: &str = "Send these again as done with evidence: the address of a page you kept or read, a note you wrote, or a tool's receipt. For a part that is the answer itself, evidence { kind: \"note\", ref: \"final answer\" }.";

pub(crate) struct RunTools {
    pub(crate) catalog: Arc<ModelCatalog>,
    pub(crate) advertised: HashSet<String>,
    pub(crate) monitor: ToolMonitor,
    pub(crate) research: ResearchTools,
    pub(crate) tool_names: Vec<String>,
    pub(crate) definitions: Vec<ToolDefinition>,
    pub(crate) instructions: String,
    pub(crate) initial: Toolset,
    request: String,
}

impl RunTools {
    /// agent.tool: answer by default; browse, desktop, code and loaded families on request.
    pub(crate) fn toolsets(&self) -> AgentTools<'_> {
        agent_tools(&self.catalog, &self.request)
    }
}

fn definition(name: &str, description: &str, input_schema: RawJson) -> ToolDefinition {
    ToolDefinition { kind: "function".to_owned(), name: name.to_owned(), description: Some(description.to_owned()), input_schema, strict: None }
}

pub(crate) fn assemble_tools(shared: &Arc<RunShared>, order: &SerialToolLifecycle, remote: Vec<CatalogTool>) -> RunTools {
    let context = &shared.context;
    // Misty's catalog plus the tools this device runs itself (web.fetch, and web.search on its own search key).
    let descriptors = with_device_tools(remote, context.device_search);
    let advertised: HashSet<String> = descriptors.iter().map(|descriptor| descriptor.name.clone()).collect();
    let catalog = Arc::new(ModelCatalog::new(descriptors, &[TASK_COMPLETION_TOOL, LEDGER_TOOL, TOOL_USE_TOOL, TOOL_LOAD_TOOL]));
    let monitor = ToolMonitor::new(catalog.clone(), order.clone(), shared.clone(), shared.rejected.clone());
    let toolsets = agent_tools(&catalog, &context.prompt);
    let research = ResearchTools {
        search: catalog.model_name("web.search").map(str::to_owned),
        fetch: catalog.model_name("web.fetch").map(str::to_owned),
        open: catalog.model_name("screen.open").map(str::to_owned),
    };
    let mut definitions = catalog_tools(&catalog);
    definitions.extend(toolsets.tools.iter().cloned());
    definitions.push(definition(LEDGER_TOOL, LEDGER_DESCRIPTION, ledger_input_schema()));
    definitions.push(definition(TASK_COMPLETION_TOOL, FINISH_DESCRIPTION, task_completion_input_schema()));
    let tool_names = definitions.iter().map(|tool| tool.name.clone()).collect();
    let fixed: Vec<&str> = [EXECUTION_INSTRUCTIONS, TASK_COMPLETION_INSTRUCTIONS, LEDGER_INSTRUCTIONS, CITATION_INSTRUCTIONS, toolsets.instructions.as_str(), model_family_note(&context.model_id)]
        .into_iter()
        .filter(|text| !text.is_empty())
        .collect();
    let instructions = with_runtime_instructions(&context.system, &fixed);
    let initial = toolsets.initial;
    RunTools { research, advertised, monitor, tool_names, definitions, instructions, initial, request: context.prompt.clone(), catalog: catalog.clone() }
}

/// The report with the model's own key order, which is what it reads back as the tool's result.
fn report_json(report: &TaskCompletion, sent: &JsValue) -> JsValue {
    let remaining = report
        .remaining
        .iter()
        .map(|item| object([("requirement", string(item.requirement.as_str())), ("reason", string(item.reason.as_str()))]))
        .collect();
    let outcome = serde_json::to_value(report.outcome).ok().and_then(|value| value.as_str().map(str::to_owned)).unwrap_or_default();
    let base = if sent.is_object() { sent.clone() } else { JsValue::Object(Vec::new()) };
    base.with_field("outcome", string(outcome)).with_field("summary", string(report.summary.as_str())).with_field("remaining", JsValue::Array(remaining))
}

fn failure(message: &str) -> JsValue {
    object([("status", string("failure")), ("tool_error", object([("message", string(message))]))])
}

fn run_ledger(shared: &RunShared, sent: &JsValue) -> Result<JsValue, RuntimeError> {
    let Some(rows) = parse_ledger_input(sent) else {
        return Err(RuntimeError::error("invalid_tool_input"));
    };
    // A part is done only with evidence (ledger.rs, record_rows).
    let (rows, missing) = record_rows(&mut locked(&shared.ledger), rows);
    let done = rows.iter().filter(|row| row.state == RowState::Done).count();
    let open = rows.iter().filter(|row| row.state != RowState::Done && row.state != RowState::Skipped).count();
    let mut fields = vec![
        ("status".to_owned(), string("recorded")),
        ("done".to_owned(), JsValue::Number(done as f64)),
        ("open".to_owned(), JsValue::Number(open as f64)),
    ];
    if !missing.is_empty() {
        let names = missing.iter().map(|row| string(js_prefix(&row.requirement, 80))).collect();
        fields.push(("not_done_without_evidence".to_owned(), JsValue::Array(names)));
        fields.push(("note".to_owned(), string(LEDGER_NOTE)));
    }
    Ok(JsValue::Object(fields))
}

async fn run_finish(shared: &RunShared, tools: &RunTools, sent: &JsValue, messages: &[Message]) -> Result<JsValue, RuntimeError> {
    let Some(input) = parse_task_completion_input(sent) else {
        return Err(RuntimeError::error("invalid_tool_input"));
    };
    // A finish after a text answer leaves summary out: that answer is the summary, so the person
    // reads it once (task_completion.rs).
    let Some(report) = with_answer_summary(&input, messages) else {
        return Ok(failure(SUMMARY_MISSING_NOTE));
    };
    // Every check runs together, once (finish_verification.rs); the next finish stands.
    if let Some(note) = verify_finish(shared, tools, &report, messages).await {
        return Ok(failure(&note));
    }
    // A completed report that still claims work no tool did becomes partial when the request named
    // an app (finish_check.rs). The ledger decides what remains.
    let reported = with_ledger(&report, &locked(&shared.ledger));
    let read_only = |name: &str| tools.catalog.read_only(name);
    let ended = if unbacked_completion(&reported, messages, &read_only).is_some() { after_refusal(&reported, messages, &read_only) } else { reported };
    Ok(report_json(&ended, sent))
}

/// One call to execute. `messages` is the transcript through the assistant's message.
pub(crate) struct ExecutedCall<'a> {
    pub(crate) call_id: &'a str,
    pub(crate) tool_name: &'a str,
    pub(crate) input: &'a JsValue,
    pub(crate) messages: &'a [Message],
    pub(crate) resumed: Option<SavedWait>,
}

/// `tool.execute`.
pub(crate) async fn execute_call(shared: &RunShared, tools: &RunTools, order: &SerialToolLifecycle, environment: &dyn CallEnvironment, call: ExecutedCall<'_>) -> Result<JsValue, RuntimeError> {
    let ExecutedCall { call_id, tool_name, input, messages, resumed } = call;
    if let Some(output) = run_toolset_tool(tool_name, input) {
        return Ok(output);
    }
    guard(order, call_id)?;
    if tool_name == LEDGER_TOOL {
        return run_ledger(shared, input);
    }
    if tool_name == TASK_COMPLETION_TOOL {
        return run_finish(shared, tools, input, messages).await;
    }
    let name = tools.catalog.misty_name(tool_name).to_owned();
    shared.execute_capability(environment, call_id, &name, input, resumed).await
}

/// `toModelOutput` for a catalog tool, the plain text or JSON fallback for the runtime's own.
pub(crate) fn model_output(tools: &RunTools, tool_name: &str, output: &JsValue) -> ToolOutput {
    if tools.catalog.tools.iter().any(|tool| tool.model_name == tool_name) {
        return visual_tool_output(tools.catalog.misty_name(tool_name), Some(output));
    }
    match output {
        JsValue::String(text) => ToolOutput::Text { value: text.clone() },
        other => ToolOutput::Json { value: RawJson::from_text(other.stringify()).unwrap_or_else(|_| RawJson::empty_object()) },
    }
}
