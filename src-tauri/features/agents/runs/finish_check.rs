//! A "completed" report must not claim work that no tool did: a draft written only into the answer
//! is not a Gmail draft. When the request asks for something to be made, or the report says it was,
//! and no write succeeded in the run, the first completed agent_finish is refused once with the
//! reason.
use std::{collections::HashMap, sync::LazyLock};

use regex::Regex;

use super::{
    js_json::text_or_empty,
    js_regex::js_regex,
    task_completion::{Outcome, RemainingItem, TaskCompletion},
    transcript::{failed, input_value, tool_parts, user_parts_text, ToolPart},
};
use crate::model_calls::{Message, RawJson};

/// What the person asked to have made or done somewhere other than the answer.
static REQUESTED_ACTION: LazyLock<Regex> = LazyLock::new(|| js_regex(r"\b(draft|create|make|post|send|schedule|book|add|put|file|open an? (issue|pull request|pr)|save|label|invite|reply to)\b", true));
/// The report saying, in the first person, that it made or changed something.
static CLAIMED_ACTION: LazyLock<Regex> = LazyLock::new(|| js_regex(r"\bI(?:'ve| have)?\s+(created|drafted|saved|posted|sent|scheduled|booked|added|filed|opened|made|put|labeled|invited|replied)\b", true));
/// The request naming where the thing belongs, so text in the answer can't stand in for it.
static NAMED_PLACE: LazyLock<Regex> = LazyLock::new(|| js_regex(r"\b(gmail|e-?mail|inbox|slack|channel|github|issue|calendar|linkedin|notion|drive|jira|linear)\b", true));
/// Composio actions that only read.
static READ_ACTION: LazyLock<Regex> = LazyLock::new(|| js_regex(r"_(FETCH|LIST|GET|SEARCH|FIND|READ|QUERY|RETRIEVE|DOWNLOAD|CHECK|LOOKUP|DESCRIBE|COUNT)(_|$)", false));
/// Bookkeeping tools that change nothing the person asked for.
static BOOKKEEPING: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^(log_work_|agent_|memory_)", false));

/// Whether a tool only reads, from the catalog.
pub(crate) type ReadOnly<'a> = &'a (dyn Fn(&str) -> bool + Sync);

/// Whether a call changed something: a non-read Composio action, or a tool the catalog marks as a
/// write.
pub(crate) fn is_write(tool_name: &str, input: &RawJson, read_only: ReadOnly) -> bool {
    if BOOKKEEPING.is_match(tool_name) {
        return false;
    }
    // Opening a tab and running a program in the agent's own tabs are the actions of a request such
    // as "open their channels": a run that did them has done something, not only read (the check
    // refused a correct finish, and the run ended "did not finish").
    if tool_name == "screen_open" || tool_name == "browser_run" {
        return true;
    }
    if tool_name == "integration_execute" {
        let slug = text_or_empty(input_value(input).get("tool_slug")).to_uppercase();
        return !slug.is_empty() && !READ_ACTION.is_match(&slug);
    }
    !read_only(tool_name)
}

/// How many writes succeeded in the transcript so far.
pub(crate) fn successful_writes(messages: &[Message], read_only: ReadOnly) -> usize {
    let mut writes: HashMap<&str, bool> = HashMap::new();
    for part in tool_parts(messages) {
        match part {
            ToolPart::Call { id, name, input } => {
                if !id.is_empty() && !name.is_empty() && is_write(name, input, read_only) {
                    writes.insert(id, false);
                }
            }
            ToolPart::Result(result) => {
                if let Some(succeeded) = writes.get_mut(result.tool_call_id.as_str()) {
                    *succeeded = !failed(&result.output);
                }
            }
        }
    }
    writes.values().filter(|succeeded| **succeeded).count()
}

/// The person's own words in the run.
fn request_text(messages: &[Message]) -> String {
    messages
        .iter()
        .filter(|message| matches!(message, Message::User { .. }))
        .map(user_parts_text)
        .collect::<Vec<_>>()
        .join("\n")
}

/// A second unbacked completed report, after the first was refused. When the request named an app,
/// the text in the answer can't be what was wanted, so the outcome becomes partial; otherwise the
/// agent decided the person only wanted the text, and it stands.
pub(crate) fn after_refusal(report: &TaskCompletion, messages: &[Message], read_only: ReadOnly) -> TaskCompletion {
    if report.outcome != Outcome::Completed || successful_writes(messages, read_only) > 0 || !NAMED_PLACE.is_match(&request_text(messages)) {
        return report.clone();
    }
    let mut next = report.clone();
    next.outcome = Outcome::Partial;
    next.remaining.push(RemainingItem {
        requirement: "Make what was asked for in the app the request named".to_owned(),
        reason: "No tool call in this run created or changed it".to_owned(),
    });
    next
}

/// The reason to refuse a completed report, or `None` when it may stand.
pub(crate) fn unbacked_completion(report: &TaskCompletion, messages: &[Message], read_only: ReadOnly) -> Option<String> {
    if report.outcome != Outcome::Completed {
        return None;
    }
    let request = request_text(messages);
    if !REQUESTED_ACTION.is_match(&request) && !CLAIMED_ACTION.is_match(&report.summary) {
        return None;
    }
    if successful_writes(messages, read_only) > 0 {
        return None;
    }
    Some(
        concat!(
            "No tool call in this run created or changed anything, but the request asks for that or your summary says it happened. ",
            "Writing a draft, post, event or task into your answer does not make it. An email, event, post or task belongs in the person's connected app when one exists: ",
            "load connected apps with agent_tool_load (integration) and check integration_connected before deciding none is available. Call the tool that makes it, then finish; ",
            "or finish with outcome partial and say what is missing. If the person only wanted the text in your answer (they named no app), call agent_finish again with the same report."
        )
        .to_owned(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcript::fixtures::{error_output, json_output, raw, turn};
    use crate::transcript::user_message;
    use crate::model_calls::ToolOutput;

    fn read_only(name: &str) -> bool {
        name.ends_with("_query") || name.ends_with("_search")
    }

    fn call(id: &str, name: &str, input: &str) -> Vec<Message> {
        call_with(id, name, input, json_output(r#"{"successful":true}"#))
    }

    fn call_with(id: &str, name: &str, input: &str, output: ToolOutput) -> Vec<Message> {
        turn(id, name, input, output)
    }

    fn with_ask(ask: &str, rest: Vec<Message>) -> Vec<Message> {
        let mut messages = vec![user_message(ask)];
        messages.extend(rest);
        messages
    }

    fn report(outcome: Outcome, summary: &str) -> TaskCompletion {
        TaskCompletion { outcome, summary: summary.to_owned(), remaining: Vec::new() }
    }

    fn done(summary: &str) -> TaskCompletion {
        report(Outcome::Completed, summary)
    }

    #[test]
    fn tells_reads_from_writes_including_composio_actions() {
        assert!(!is_write("integration_execute", &raw(r#"{"tool_slug":"GMAIL_FETCH_EMAILS"}"#), &read_only));
        assert!(is_write("integration_execute", &raw(r#"{"tool_slug":"GMAIL_CREATE_EMAIL_DRAFT"}"#), &read_only));
        assert!(is_write("task_create", &raw("{}"), &read_only));
        assert!(!is_write("task_query", &raw("{}"), &read_only));
        assert!(!is_write("log_work_write", &raw("{}"), &read_only));
    }

    #[test]
    fn refuses_a_completed_draft_request_with_only_reads() {
        let messages = with_ask("Draft one for each candidate.", call("a", "integration_execute", r#"{"tool_slug":"GMAIL_FETCH_EMAILS"}"#));
        assert!(unbacked_completion(&done("Drafts (not sent): ..."), &messages, &read_only).unwrap().contains("does not make it"));
    }

    #[test]
    fn accepts_it_once_a_write_succeeded_and_ignores_failed_writes() {
        let failed_write = call_with("b", "integration_execute", r#"{"tool_slug":"GMAIL_CREATE_EMAIL_DRAFT"}"#, error_output("denied"));
        assert_eq!(successful_writes(&failed_write, &read_only), 0);
        let messages = with_ask("Draft a follow-up.", call("c", "integration_execute", r#"{"tool_slug":"GMAIL_CREATE_EMAIL_DRAFT"}"#));
        assert_eq!(unbacked_completion(&done("I drafted it."), &messages, &read_only), None);
    }

    #[test]
    fn leaves_questions_partial_reports_and_unclaimed_answers_alone() {
        let messages = with_ask("What in my inbox needs a reply?", call("d", "integration_execute", r#"{"tool_slug":"GMAIL_FETCH_EMAILS"}"#));
        assert_eq!(unbacked_completion(&done("Two emails need a reply."), &messages, &read_only), None);
        let partial = report(Outcome::Partial, "I could not save the drafts.");
        assert_eq!(unbacked_completion(&partial, &[user_message("Draft them.")], &read_only), None);
        assert!(unbacked_completion(&done("I've created the event."), &[user_message("Is tomorrow free?")], &read_only).unwrap().contains("does not make it"));
    }

    #[test]
    fn turns_a_second_unbacked_report_into_partial_when_the_request_named_an_app() {
        let answer = done("Draft below.");
        let named = after_refusal(&answer, &[user_message("Draft a short intro email to their CFO.")], &read_only);
        assert_eq!(named.outcome, Outcome::Partial);
        assert_eq!(named.remaining.len(), 1);
        assert_eq!(after_refusal(&answer, &[user_message("Draft a thank-you note I can paste.")], &read_only).outcome, Outcome::Completed);
    }

    #[test]
    fn counts_opening_a_tab_and_running_a_program_as_actions_so_open_their_channels_is_backed() {
        let always = |_: &str| true;
        assert!(is_write("screen_open", &raw(r#"{"url":"https://www.youtube.com/@Fireship"}"#), &always));
        assert!(is_write("browser_run", &raw(r#"{"code":"return 1;"}"#), &always));
        let messages = with_ask("Can you open their youtube channels in the browser so i can take a look?", call("a", "screen_open", r#"{"url":"https://www.youtube.com/@Fireship"}"#));
        assert_eq!(unbacked_completion(&done("All 13 tabs opened."), &messages, &always), None);
    }
}
