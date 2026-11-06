//! Telling a run's answer from its narration, and what the model is told about finishing.
use std::sync::LazyLock;

use regex::Regex;

use super::TASK_COMPLETION_TOOL;
use crate::runtime::{
    js_regex::js_regex,
    text::{js_is_space, js_len, js_prefix, js_trim},
};
use crate::sdk::{AssistantPart, Message};

/// The text answer agent_finish confirms: the latest model response written as plain text, looking
/// past earlier agent_finish calls (a refused report sent again). A response that called other tools
/// is narration, not an answer, so there is none.
pub(crate) fn last_text_answer(messages: &[Message]) -> String {
    for message in messages.iter().rev() {
        let Message::Assistant { content, .. } = message else {
            continue;
        };
        let narrates = content.iter().any(|part| matches!(part, AssistantPart::ToolCall { tool_name, .. } if tool_name != TASK_COMPLETION_TOOL));
        if narrates {
            return String::new();
        }
        let text: String = content
            .iter()
            .filter_map(|part| match part {
                AssistantPart::Text { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        let text = js_trim(&text);
        if !text.is_empty() {
            return if is_progress_note(text) { String::new() } else { text.to_owned() };
        }
    }
    String::new()
}

pub(crate) const SUMMARY_MISSING_NOTE: &str = "agent_finish had no summary and there is no answer written just before it. Call agent_finish again with your full answer to the person in summary.";

/// Sent once when a run that used its tools answers without agent_finish.
pub(crate) const FINISH_MISSING_NOTE: &str = "You answered in text but did not report the task's outcome. Call agent_finish now, on its own, with only outcome and remaining, set honestly: leave summary out, since your answer above is already the summary and the person has read it. Don't repeat the answer or call other tools first unless the answer is missing something.";

/// An announced next move: "Let me click…", "I'll open…", "Now I need to…".
static ANNOUNCED_MOVE: LazyLock<Regex> = LazyLock::new(|| js_regex(r"\b(let me|let's|i'll|i will|i'm going to|i am going to|i need to|i should|i'm trying|i'll try|now i|next,? i)\b", true));
static PROGRESS_LABEL: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^(\*\*)?(Last|Have|Next)\b", true));
static NEXT: LazyLock<Regex> = LazyLock::new(|| js_regex(r"\bNext\b", true));
static STRUCTURED: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^#|\n\s*[-*|#]", false));

/// `text.split(/(?<=[.!:])\s+/).filter(Boolean).at(-1)`, written by hand because the `regex` crate
/// has no lookbehind.
fn last_sentence(text: &str) -> &str {
    let mut last = "";
    let mut start = 0;
    let mut previous = None;
    let mut characters = text.char_indices().peekable();
    while let Some((at, character)) = characters.next() {
        if js_is_space(character) && matches!(previous, Some('.' | '!' | ':')) {
            if at > start {
                last = &text[start..at];
            }
            let mut end = at + character.len_utf8();
            while let Some(&(next_at, next)) = characters.peek() {
                if !js_is_space(next) {
                    break;
                }
                end = next_at + next.len_utf8();
                characters.next();
            }
            start = end;
            previous = None;
            continue;
        }
        previous = Some(character);
    }
    if start < text.len() {
        last = &text[start..];
    }
    last
}

/// Whether plain text is the turn's progress line rather than an answer: "Last: … Next: …", or a
/// short note that announces the next move and makes no call ("The popup is still showing. Let me
/// try the link directly."). A run ended on such a line with five sites left (Odysseys, Oct 20).
pub(crate) fn is_progress_note(text: &str) -> bool {
    let head = js_prefix(js_trim(text), 600);
    let length = js_len(head);
    if length < 400 && PROGRESS_LABEL.is_match(head) && NEXT.is_match(head) {
        return true;
    }
    if length >= 500 || head.contains('?') || STRUCTURED.is_match(head) {
        return false;
    }
    ANNOUNCED_MOVE.is_match(last_sentence(head))
}

/// One finished model step, for [`closing_text`].
#[derive(Clone, Debug, Default)]
pub(crate) struct ClosingStep {
    pub(crate) text: Option<String>,
    pub(crate) has_tool_call: bool,
}

/// What a run that never called agent_finish answered: its fullest plain-text answer since its last
/// tool call, not just its last words. Asked once to confirm, a model replied "My full answer is
/// already provided above" with a short recap, and the recap replaced a complete shortlist as the
/// run's answer (Odysseys, October 20).
pub(crate) fn closing_text(steps: &[ClosingStep]) -> String {
    let after_last_call = steps.iter().rposition(|step| step.has_tool_call).map_or(0, |index| index + 1);
    let trimmed = |step: &'_ ClosingStep| step.text.as_deref().map(js_trim).unwrap_or("").to_owned();
    let mut fullest = String::new();
    for step in &steps[after_last_call..] {
        let text = trimmed(step);
        if !text.is_empty() && !is_progress_note(&text) && js_len(&text) > js_len(&fullest) {
            fullest = text;
        }
    }
    if !fullest.is_empty() {
        return fullest;
    }
    steps.iter().rev().map(trimmed).find(|text| !text.is_empty()).unwrap_or_default()
}

pub(crate) const PROGRESS_NOTE_NUDGE: &str = "That was your progress line, not an answer. Make the tool calls for the next step now, or, if the work is done, call agent_finish with the full answer.";

pub(crate) const TASK_COMPLETION_INSTRUCTIONS: &str = "A reply that needs no action, such as a greeting or a question you can answer from what you already know, ends with your plain text answer and no tool calls. Finish every task with one standalone agent_finish call, with no other tool calls in that response. Its summary is your final answer to the user: give every table, list and detail the request asks for in full there, never pointing to an earlier message or saying it is above. If you just wrote that answer as text in your previous response, leave summary out instead of repeating it; that text becomes the summary. Choose completed only when every requested deliverable is actually complete and verified; set remaining to an empty list. Choose blocked when required access, information, permission, or capability is missing; choose partial when only part of the requested work was achieved. For blocked or partial outcomes, list each unfinished requirement and its reason. Explaining why you cannot do the work does not complete the user's requested deliverable. Do not issue a completed report just because the model response is ending. This report cannot replace tool receipts.";
