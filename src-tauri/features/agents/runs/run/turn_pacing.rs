//! The run's clock and research spend, kept across turns and summaries.
use crate::context::context_compaction::message_bytes;
use crate::control_plane_steps::take_steering;
use crate::js_json::JsValue;
use crate::loop_guard::loop_note;
use crate::person_takeover::{after_takeover, TAKEOVER_LIMIT, TAKEOVER_POLL_SECONDS};
use crate::research_budget::{budget_scale, closed_research_tools, research_note, research_use};
use crate::runtime_errors::RuntimeError;
use crate::task_completion::TASK_COMPLETION_TOOL;
use crate::text::js_len;
use crate::time_budget::{estimate_minutes, still_progressing, time_budget, PROGRESS_NEEDED, PROGRESS_WINDOW};
use crate::tool_transport::{object, string};
use crate::turn_deadline::deadline_note;
use crate::model_calls::{Message, UserPart};

use super::{model_stream::sleep_until_ms, space_task_agent::RunLoop, state::Stage};

/// The transcript as the note checks read it. The adapter hands back every message it has seen in
/// converted form (a list of parts), and those checks only count a plain string, so a note from an
/// earlier turn doesn't count as said. A converted message shows here with a second, empty part.
fn as_note_checks_read(messages: &[Message], plain_tail: usize) -> Vec<Message> {
    let plain_from = messages.len().saturating_sub(plain_tail);
    messages
        .iter()
        .enumerate()
        .map(|(index, message)| match message {
            Message::User { content, provider_options } if index < plain_from && matches!(content.as_slice(), [UserPart::Text { .. }]) => {
                let mut parts = content.clone();
                parts.push(UserPart::Text { text: String::new() });
                Message::User { content: parts, provider_options: provider_options.clone() }
            }
            other => other.clone(),
        })
        .collect()
}

/// Taken over (`person_takeover.rs`): wait without model turns until the person resumes. A restart
/// carries on from the saved poll.
pub(super) async fn wait_out_takeover(run: &mut RunLoop, resumed: Option<(u32, Vec<String>, i64, i64)>) -> Result<(), RuntimeError> {
    let clock = run.shared.deps.clock.clone();
    let poll_ms = TAKEOVER_POLL_SECONDS as i64 * 1000;
    let (mut poll, mut sent, pause_started, mut poll_at) = resumed.unwrap_or_else(|| (1, Vec::new(), clock(), clock() + poll_ms));
    let mut paused = true;
    while paused && poll <= TAKEOVER_LIMIT {
        run.save(Stage::Takeover { next_poll: poll, sent: sent.clone(), pause_started_ms: pause_started, poll_at_ms: poll_at }).await?;
        sleep_until_ms(run, poll_at).await;
        let boundary = format!("{}:paused:{poll}", run.state.model_turn);
        let next = take_steering(run.shared.deps.control.as_ref(), &run.shared.identity, &boundary, false).await?;
        sent.extend(next.messages);
        paused = next.paused;
        poll += 1;
        poll_at = clock() + poll_ms;
    }
    // The person's turn in the window doesn't spend the agent's time.
    run.state.pacing.paused_ms += clock() - pause_started;
    let added = sent.len() + 1;
    let next = after_takeover(&run.state.messages, &sent);
    run.replace_messages(next);
    run.state.plain_tail += added;
    Ok(())
}

impl RunLoop {
    /// The notes a turn carries and the tools it may still use, from what the run has spent.
    pub(super) fn pace_turn(&mut self, mut visible: Vec<String>) -> Vec<String> {
        let (model_turn, limit) = (self.state.model_turn, self.state.limit);
        let view = as_note_checks_read(&self.state.messages, self.state.plain_tail);
        // Research budget (research_budget.rs): a run that keeps searching is told what it has spent,
        // then loses search and fetch so its next turn can only answer.
        self.state.pacing.research_scale = self.state.pacing.research_scale.max(budget_scale(&view));
        let research = research_use(&self.state.messages, &self.tools.research, self.state.pacing.research_scale);
        let closed = closed_research_tools(&research, &self.tools.research);
        if !closed.is_empty() {
            visible.retain(|name| !closed.contains(name));
        }
        if let Some(note) = research_note(&research, &self.state.messages, &self.tools.research) {
            self.push_note(note);
        }
        // The loop guard (loop_guard.rs): the same call or address three times brings a note.
        if let Some(note) = loop_note(&view_with_tail(&view, &self.state.messages)) {
            self.push_note(note);
        }
        // The deliverable deadline (turn_deadline.rs): near the turn limit the run writes its answer
        // from what it found instead of ending with nothing.
        if let Some(note) = deadline_note(model_turn, limit, &view) {
            self.push_note(note);
        }
        // The person's time (time_budget.rs), against the agent's own estimate: paced at 80%, wrapping
        // up at 100%, only the answer past about 130%, unless the run is still finding new things.
        self.state.pacing.estimate = estimate_minutes(&self.state.messages).or(self.state.pacing.estimate);
        let elapsed = (self.shared.deps.clock)() - self.state.pacing.started_at_ms - self.state.pacing.paused_ms;
        let progressing = still_progressing(&self.state.messages, PROGRESS_WINDOW, PROGRESS_NEEDED);
        let time = time_budget(elapsed as f64, &view, self.state.pacing.estimate, progressing);
        if let Some(note) = time.note {
            self.push_note(note);
        }
        if model_turn >= limit - 1 || time.answer_only {
            visible.retain(|name| name == TASK_COMPLETION_TOOL);
        }
        visible
    }

    /// Tool definitions come first in the request, so a change costs this turn its cached prefix.
    pub(super) fn log_tool_change(&self) -> String {
        let tool_key = self.state.visible_tools.join(",");
        if self.state.model_turn > 0 && tool_key != self.state.last_tool_key {
            let before: Vec<&str> = self.state.last_tool_key.split(',').collect();
            let names = |names: Vec<&str>| JsValue::Array(names.into_iter().map(string).collect());
            let added = self.state.visible_tools.iter().map(String::as_str).filter(|name| !before.contains(name)).collect();
            let removed = before.iter().copied().filter(|name| !self.state.visible_tools.iter().any(|known| known == name)).collect();
            self.shared.deps.logger.line(
                "tools_changed",
                &object([
                    ("run", string(self.shared.identity.misty_run_id.as_str())),
                    ("turn", JsValue::Number(self.state.model_turn as f64)),
                    ("added", names(added)),
                    ("removed", names(removed)),
                ]),
            );
        }
        tool_key
    }

    /// What the first turn carries: the fixed cost of every turn.
    pub(super) fn log_context_breakdown(&self) {
        let catalog = &self.tools.catalog;
        // The tools this turn sends, not the whole catalog: the rest wait behind agent_tool_use and loads.
        let mut sizes: Vec<(String, usize)> = catalog
            .tools
            .iter()
            .filter(|tool| self.state.visible_tools.contains(&tool.model_name))
            .map(|tool| {
                let schema = JsValue::from_raw(&tool.descriptor.input_schema).unwrap_or(JsValue::Null);
                let mut fields = vec![
                    ("name".to_owned(), string(tool.descriptor.name.as_str())),
                    ("description".to_owned(), string(tool.descriptor.description.as_str())),
                    ("inputSchema".to_owned(), schema),
                    ("readOnly".to_owned(), JsValue::Bool(tool.descriptor.read_only)),
                    ("concurrent".to_owned(), JsValue::Bool(tool.descriptor.concurrent)),
                ];
                if tool.descriptor.local {
                    fields.push(("local".to_owned(), JsValue::Bool(true)));
                }
                fields.push(("modelName".to_owned(), string(tool.model_name.as_str())));
                (tool.model_name.clone(), js_len(&JsValue::Object(fields).stringify()))
            })
            .collect();
        let tool_chars: usize = sizes.iter().map(|(_, size)| size).sum();
        sizes.sort_by(|left, right| right.1.cmp(&left.1));
        let number = |value: usize| JsValue::Number(value as f64);
        self.shared.deps.logger.line(
            "context_breakdown",
            &object([
                ("run", string(self.shared.identity.misty_run_id.as_str())),
                ("systemChars", number(js_len(&self.tools.instructions))),
                ("toolChars", number(tool_chars)),
                ("tools", number(self.state.visible_tools.len())),
                ("catalogTools", number(catalog.tools.len())),
                ("toolSizes", JsValue::Array(sizes.into_iter().map(|(name, size)| JsValue::Array(vec![string(name), number(size)])).collect())),
                ("messageChars", number(message_bytes(&self.state.messages))),
            ]),
        );
    }
}

/// The loop guard also reads what's been pushed this turn, which the view predates.
fn view_with_tail(view: &[Message], messages: &[Message]) -> Vec<Message> {
    let mut all = view.to_vec();
    all.extend_from_slice(messages.get(view.len()..).unwrap_or_default());
    all
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcript::{said, user_message};
    use crate::turn_deadline::deadline_note;

    #[test]
    fn a_note_from_an_earlier_turn_no_longer_counts_as_said() {
        let messages = vec![user_message("Ask"), user_message("Turn budget: older"), user_message("Turn budget: newer")];
        assert!(said(&as_note_checks_read(&messages, 1), "Turn budget: newer"));
        assert!(!said(&as_note_checks_read(&messages, 1), "Turn budget: older"));
        assert!(!said(&as_note_checks_read(&messages, 0), "Turn budget: newer"));
    }

    #[test]
    fn the_deadline_note_repeats_each_turn_as_it_does_on_the_adapters_transcript() {
        let first = deadline_note(18, 20, &[]).unwrap();
        let messages = vec![user_message(first)];
        assert!(deadline_note(19, 20, &as_note_checks_read(&messages, 0)).unwrap().contains("1 model turn left"));
        assert_eq!(deadline_note(19, 20, &as_note_checks_read(&messages, 1)), None);
    }
}
