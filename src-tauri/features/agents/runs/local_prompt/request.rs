//! The run's request: the JSON the app sends to start a run (`src/features/agents/runs/invocations/serverInvocation.ts`),
//! cleaned the way `validateAIInvocationInput` cleans it. The server refused a malformed request at
//! admission; here the person's own app sent it, so a bad part is dropped instead of failing the run.
use serde::de::DeserializeOwned;
use serde_json::Value;

use super::teach::{Lesson, LessonSummary};

pub(super) use super::request_parts::MAX_NOTES_CHARS;
pub(crate) use super::request_parts::{
    AgentIdentity, ContextReference, CurrentTab, DeviceContext, DisplayCapture, HistoryNotes, HistoryTurn, PlanPayload, PlanState, PlanStep, ResolvedContext, Selection,
};
use super::request_parts::{cleaned_notes, cleaned_turn, has_usable_control, RawCapture, RawHistory};

const MAX_HISTORY_TURNS: usize = 200;

/// Everything the prompt and the catalog read about a run.
///
/// The app's request carries most of it. The chat's own state came from the server's database and now
/// lives on the computer: `collaboration` in the JSON is what `collaborationOf` gives the chat
/// (`src/features/agents/tools/run-state/conversationState.ts`), and its `plan` and `mode` are
/// read here; a `goal` an older build saved is ignored. `agent`, `resolved_context`, `prior_write_receipts` and `conversation_title` are keys of
/// the same names.
#[derive(Clone, Debug, Default)]
pub(crate) struct RunRequest {
    pub(crate) mode: String,
    pub(crate) surface_id: String,
    pub(crate) trigger: String,
    pub(crate) prompt: String,
    pub(crate) context: Vec<ContextReference>,
    pub(crate) selection: Option<Selection>,
    pub(crate) requested_artifact_kind: String,
    pub(crate) conversation_id: String,
    pub(crate) idempotency_key: String,
    pub(crate) timezone: String,
    pub(crate) collaboration_mode: String,
    pub(crate) execution_mode: String,
    pub(crate) window_label: String,
    pub(crate) task_id: String,
    pub(crate) delegated_from: String,
    pub(crate) eval_turn_limit: i64,
    pub(crate) current_tab: Option<CurrentTab>,
    pub(crate) display_captures: Vec<DisplayCapture>,
    pub(crate) device_contexts: Vec<DeviceContext>,
    pub(crate) lesson: Option<Lesson>,
    pub(crate) lesson_index: Vec<LessonSummary>,
    pub(crate) history_turns: Vec<HistoryTurn>,
    pub(crate) history_notes: Option<HistoryNotes>,
    pub(crate) agent: AgentIdentity,
    pub(crate) plan: Option<PlanState>,
    pub(crate) resolved_context: Vec<ResolvedContext>,
    pub(crate) prior_write_receipts: String,
    /// `None` is a chat whose title is still its placeholder.
    pub(crate) conversation_title: Option<String>,
}

fn parsed<T: DeserializeOwned>(body: &Value, key: &str) -> Option<T> {
    body.get(key).filter(|value| !value.is_null()).and_then(|value| serde_json::from_value(value.clone()).ok())
}

fn cleaned_tab(mut tab: CurrentTab) -> Option<CurrentTab> {
    tab.title = tab.title.trim().to_owned();
    tab.url = tab.url.trim().to_owned();
    (tab.url.len() <= 2048 && (tab.url.starts_with("https://") || tab.url.starts_with("http://"))).then_some(tab)
}

impl RunRequest {
    pub(crate) fn from_json(body: &Value) -> Self {
        let text = |key: &str| body.get(key).and_then(Value::as_str).unwrap_or("").trim().to_owned();
        let mode = text("mode");
        let saved = body.get("collaboration").unwrap_or(&Value::Null);
        // A turn that doesn't choose a mode takes the chat's saved one (`admitCollaboration`).
        let collaboration_mode = match text("collaboration_mode") {
            mode if mode.is_empty() && !text("conversation_id").is_empty() => saved.get("mode").and_then(Value::as_str).unwrap_or("").trim().to_owned(),
            mode => mode,
        };
        let companion = mode == "companion";
        let teach = collaboration_mode == "teach";
        let timezone = text("timezone");
        let raw_turns: Vec<RawHistory> = parsed(body, "history_turns").unwrap_or_default();
        let skip = raw_turns.len().saturating_sub(MAX_HISTORY_TURNS);
        let captures: Vec<RawCapture> = if companion { parsed(body, "display_captures").unwrap_or_default() } else { Vec::new() };
        let mut context: Vec<ContextReference> = parsed(body, "context").unwrap_or_default();
        for reference in &mut context {
            reference.kind = reference.kind.trim().to_owned();
            reference.id = reference.id.trim().to_owned();
            reference.space_id = reference.space_id.trim().to_owned();
            reference.opaque_scope_id = reference.opaque_scope_id.trim().to_owned();
        }
        Self {
            surface_id: text("surface_id"),
            trigger: text("trigger"),
            prompt: text("prompt"),
            context,
            selection: parsed(body, "selection"),
            requested_artifact_kind: text("requested_artifact_kind"),
            conversation_id: text("conversation_id"),
            idempotency_key: body.get("idempotency_key").and_then(Value::as_str).unwrap_or("").to_owned(),
            timezone: if timezone.is_empty() { "UTC".to_owned() } else { timezone },
            execution_mode: text("execution_mode"),
            window_label: text("window_label"),
            task_id: text("task_id"),
            delegated_from: text("delegated_from"),
            eval_turn_limit: body.get("eval_turn_limit").and_then(Value::as_i64).unwrap_or(0),
            current_tab: parsed(body, "current_tab").and_then(cleaned_tab),
            display_captures: captures.iter().map(|capture| DisplayCapture { screen: capture.screen.clone(), has_controls: has_usable_control(capture) }).collect(),
            device_contexts: parsed(body, "device_contexts").unwrap_or_default(),
            lesson: if teach { parsed(body, "lesson").and_then(Lesson::cleaned) } else { None },
            lesson_index: if teach { LessonSummary::cleaned_list(parsed(body, "lesson_index").unwrap_or_default()) } else { Vec::new() },
            history_turns: raw_turns.into_iter().skip(skip).map(cleaned_turn).collect(),
            history_notes: parsed(body, "history_notes").and_then(cleaned_notes),
            agent: parsed(body, "agent").unwrap_or_default(),
            plan: parsed(saved, "plan"),
            resolved_context: parsed(body, "resolved_context").unwrap_or_default(),
            prior_write_receipts: body.get("prior_write_receipts").and_then(Value::as_str).unwrap_or("").to_owned(),
            conversation_title: parsed(body, "conversation_title"),
            mode,
            collaboration_mode,
        }
    }

    pub(super) fn companion(&self) -> bool {
        self.mode == "companion"
    }

    pub(super) fn teach(&self) -> bool {
        self.collaboration_mode == "teach"
    }

    fn has_conversation(&self) -> bool {
        !self.conversation_id.is_empty()
    }

    /// Plan mode needs a conversation to hold its plan; without one the run acts.
    pub(super) fn planning(&self) -> bool {
        self.collaboration_mode == "plan" && self.has_conversation()
    }

    /// A spoken turn can't show a card.
    pub(super) fn can_ask(&self) -> bool {
        let voice = self.companion() && self.idempotency_key.starts_with("voice-");
        self.has_conversation() && !voice
    }

    pub(super) fn approved_plan(&self) -> Option<&PlanState> {
        self.plan.as_ref().filter(|plan| !self.planning() && self.has_conversation() && plan.state == "approved")
    }

    pub(super) fn desktop_control(&self) -> bool {
        self.device_contexts.iter().any(|device| device.meta("desktop_control") == Some(&Value::Bool(true)))
    }

    /// The workspace grant a browser session opens under: the sending computer's own.
    fn session_target(&self) -> Option<&DeviceContext> {
        self.device_contexts.iter().find(|device| device.kind == "workspace" && device.meta("source").and_then(Value::as_str) == Some("desktop") && device.allows("browser.session"))
    }

    /// The sending computer can open the agent's own browser session, so screen_open keeps the run going.
    pub(super) fn can_open_own_tab(&self) -> bool {
        self.session_target().is_some()
    }

    pub(super) fn can_run_programs(&self) -> bool {
        self.session_target().is_some_and(|target| target.allows("browser.run"))
    }

    pub(super) fn has_browser_context(&self) -> bool {
        self.device_contexts.iter().any(|device| device.meta("app_id").and_then(Value::as_str) == Some("browser"))
    }
}
