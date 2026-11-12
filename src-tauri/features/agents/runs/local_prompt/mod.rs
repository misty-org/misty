//! A run's prompt and tools, built on the computer (docs/agents/runtime.md). Ported from the Go server's
//! prompt and toolbox, and tuned against benchmarks. `catalog.json` and `fixtures/` were exported from
//! that code when it was removed and are now the source of truth: the tests compare against them byte
//! for byte, and a change to the prompt or the tools changes them by hand.
#![allow(dead_code)]

mod artifact_specs;
mod capabilities;
mod catalog;
mod catalog_schemas;
mod collaboration;
mod companion;
pub use companion::companion_engine_note;
mod go_text;
mod history;
mod request;
mod request_parts;
mod system;
mod teach;
mod user_prompt;

#[cfg(test)]
mod tests;

#[allow(unused_imports)]
pub(crate) use catalog::{catalog_output_schemas, run_catalog, CatalogInputs};
#[allow(unused_imports)]
pub(crate) use history::kept_notes;
#[allow(unused_imports)]
pub(crate) use request::{AgentIdentity, GoalState, PlanState, ResolvedContext, RunRequest};

use go_text::single_spaced;
use history::summary_request;
use system::invocation_system;
use teach::{teach_lesson_context, teach_system_prompt, teach_tool_budget};
use user_prompt::user_prompt;

/// `DefaultContextWindow`, what the server used for any model an operator hadn't listed.
const DEFAULT_CONTEXT_WINDOW: i64 = 128_000;
const ORDINARY_TURN_LIMIT: i64 = 20;
const AGENT_TURN_LIMIT: i64 = 120;
const MAX_EVAL_TURN_LIMIT: i64 = 200;
const NEW_CONVERSATION_TITLE: &str = "New conversation";

/// What a run's context step used to return.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct BuiltPrompt {
    pub(crate) system: String,
    pub(crate) prompt: String,
    /// The opening message the chat gets named from, or empty when it needs no name.
    pub(crate) title_prompt: String,
    /// `(previous notes, turns that aged out)`, for the notes written as the run ends.
    pub(crate) summary_request: Option<(String, String)>,
    pub(crate) model_turn_limit: Option<i64>,
    pub(crate) context_window_tokens: Option<i64>,
    pub(crate) teach: bool,
    pub(crate) teach_tool_budget: f64,
}

/// `cleanMistyTitle`: what a new chat is called until its title is written.
fn opening_title(prompt: &str) -> String {
    let title = single_spaced(prompt);
    if title.is_empty() {
        return NEW_CONVERSATION_TITLE.to_owned();
    }
    const MAX_TITLE: usize = 64;
    if title.chars().count() > MAX_TITLE {
        return format!("{}…", title.chars().take(MAX_TITLE).collect::<String>());
    }
    title
}

/// `deviceTitlePrompt`: a title goes on only while the chat has its placeholder, so a person's own
/// rename always wins.
fn title_prompt(request: &RunRequest) -> String {
    if request.conversation_id.is_empty() || request.prompt.is_empty() || (request.trigger != "message" && request.trigger != "selection") {
        return String::new();
    }
    let keeps_placeholder = request.conversation_title.as_ref().map_or(true, |title| title == NEW_CONVERSATION_TITLE || *title == opening_title(&request.prompt));
    if keeps_placeholder {
        request.prompt.clone()
    } else {
        String::new()
    }
}

/// `invocationModelTurnLimitTx` and `evalTurnLimit`. Screen work needs several turns per step. An
/// eval's own limit is honored only in development builds.
fn turn_limit(request: &RunRequest) -> i64 {
    if matches!(request.execution_mode.as_str(), "agent" | "auto" | "team") && !request.task_id.is_empty() && !request.window_label.is_empty() {
        return AGENT_TURN_LIMIT;
    }
    if cfg!(debug_assertions) && request.eval_turn_limit > ORDINARY_TURN_LIMIT {
        return request.eval_turn_limit.min(MAX_EVAL_TURN_LIMIT);
    }
    ORDINARY_TURN_LIMIT
}

/// `tools` is the run's catalog (`run_catalog`). `now_rfc3339` is the time in the request's timezone,
/// written as Go's `time.RFC3339` does: `Z` for UTC, no fractional seconds.
pub(crate) fn build_prompt(request: &RunRequest, tools: &[String], now_rfc3339: &str) -> BuiltPrompt {
    let teach = request.teach();
    let mut prompt = user_prompt(request, DEFAULT_CONTEXT_WINDOW);
    let system = if teach {
        // A lesson turn runs the tutor's fast lane, with its own prompt.
        prompt = format!("{}{prompt}", teach_lesson_context(request));
        teach_system_prompt(request, now_rfc3339)
    } else {
        format!("{}{}", invocation_system(request, tools, now_rfc3339), collaboration::collaboration_instructions(request))
    };
    BuiltPrompt {
        system,
        prompt,
        title_prompt: title_prompt(request),
        summary_request: summary_request(request, DEFAULT_CONTEXT_WINDOW),
        model_turn_limit: Some(turn_limit(request)),
        context_window_tokens: Some(DEFAULT_CONTEXT_WINDOW),
        teach,
        teach_tool_budget: teach_tool_budget(request),
    }
}
