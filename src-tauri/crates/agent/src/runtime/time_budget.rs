//! The person's time (docs/agents/evals/odysseys.md). A run that is right but slow still fails the
//! person waiting on it, and how slow is too slow depends on the task: a quick lookup should take a
//! few minutes, deep research much longer. The agent says how long the task should take with its
//! first checklist (`minutes`); the budget follows that estimate, ten minutes when it gave none. The
//! run is told where it stands at 80%, asked to wrap up at 100%, and past about 130% can only write
//! its answer. A run whose recent steps still find new things is not cut off by the clock (an
//! unfinished task helps nobody): it keeps going until it stops progressing.
use std::{collections::HashSet, sync::LazyLock};

use regex::Regex;

use super::{
    js_regex::js_regex,
    text::js_len,
    transcript::{input_value, said, user_parts_text},
    transcript_json::stringify_output,
};
use crate::sdk::{AssistantPart, Message, ToolOutput};

const DEFAULT_ESTIMATE_MINUTES: f64 = 10.0;
const MIN_ESTIMATE_MINUTES: f64 = 2.0;
const MAX_ESTIMATE_MINUTES: f64 = 120.0;
/// Without a request for long work, an estimate counts for at most this many minutes.
const ORDINARY_MAX_MINUTES: f64 = 30.0;
static LONG_WORK: LazyLock<Regex> = LazyLock::new(|| {
    js_regex(
        r"\b(deep|in-depth|thorough|comprehensive|exhaustive) (research|dive|analysis|review)|\b(write|draft|produce) (me )?(a |an |the )?(full |complete |long |detailed )?(paper|report|essay|thesis|white ?paper)|\bovernight\b|\btake (your|as much) time\b",
        true,
    )
});
static UUIDS: LazyLock<Regex> = LazyLock::new(|| js_regex(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", true));
static REFS: LazyLock<Regex> = LazyLock::new(|| js_regex(r"\bref=e\d+\b|\[ref=e\d+\]", false));

const MARKER: &str = "Time budget";
const CHECKLIST_TOOL: &str = "log_work_checklist";

/// Whether the person's request asks for long work, which may take more than half an hour.
fn asks_for_long_work(messages: &[Message]) -> bool {
    let text = messages
        .iter()
        .find(|message| matches!(message, Message::User { .. }))
        .map(user_parts_text)
        .unwrap_or_default();
    LONG_WORK.is_match(&text)
}

fn told(messages: &[Message], stage: &str) -> bool {
    said(messages, &format!("{MARKER} ({stage})"))
}

/// The agent's latest estimate of the task's minutes, from its checklist calls, if any.
pub(crate) fn estimate_minutes(messages: &[Message]) -> Option<f64> {
    for message in messages.iter().rev() {
        let Message::Assistant { content, .. } = message else {
            continue;
        };
        for part in content.iter().rev() {
            let AssistantPart::ToolCall { tool_name, input, .. } = part else {
                continue;
            };
            if tool_name != CHECKLIST_TOOL {
                continue;
            }
            let minutes = input_value(input).get("minutes").map_or(f64::NAN, |value| value.to_js_number());
            if minutes.is_finite() && minutes > 0.0 {
                return Some(minutes);
            }
        }
    }
    None
}

/// A short, stable fingerprint of a tool result, without the ids and refs that change on every read.
fn fingerprint(output: &ToolOutput) -> String {
    let text = stringify_output(output);
    let text = UUIDS.replace_all(&text, "");
    let text = REFS.replace_all(&text, "");
    let mut hash: u32 = 2_166_136_261;
    for unit in text.encode_utf16() {
        hash = (hash ^ u32::from(unit)).wrapping_mul(16_777_619);
    }
    format!("{}:{hash}", js_len(&text))
}

fn fingerprints(messages: &[Message]) -> Vec<String> {
    messages
        .iter()
        .flat_map(|message| match message {
            Message::Tool { content, .. } => content.iter().map(|part| fingerprint(&part.output)).collect(),
            _ => Vec::new(),
        })
        .collect()
}

/// What every tool result so far said, to tell later results that are new from repeats.
pub(crate) fn result_prints(messages: &[Message]) -> HashSet<String> {
    fingerprints(messages).into_iter().collect()
}

/// Whether the run is still finding things: at least `needed` of its last `window` tool results say
/// something no earlier result did (a new page, new data). Repeats are not progress.
pub(crate) fn still_progressing(messages: &[Message], window: usize, needed: usize) -> bool {
    let results = fingerprints(messages);
    let (earlier, recent) = results.split_at(results.len().saturating_sub(window));
    let earlier: HashSet<&String> = earlier.iter().collect();
    let new: HashSet<&String> = recent.iter().filter(|result| !earlier.contains(result)).collect();
    recent.len() >= needed && new.len() >= needed
}

/// The defaults the TypeScript gave `stillProgressing`.
pub(crate) const PROGRESS_WINDOW: usize = 8;
pub(crate) const PROGRESS_NEEDED: usize = 2;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TimeBudget {
    pub(crate) note: Option<String>,
    pub(crate) answer_only: bool,
}

/// Where the run stands against the person's time before this turn: the note to add, once per stage,
/// and whether only the final answer may be written now. `estimate` is the agent's own, in minutes;
/// `progressing` says the run's recent steps still find new things.
pub(crate) fn time_budget(elapsed_ms: f64, messages: &[Message], estimate: Option<f64>, progressing: bool) -> TimeBudget {
    // Agents overestimate: a request that doesn't ask for long work is held to half an hour.
    let ceiling = if asks_for_long_work(messages) { MAX_ESTIMATE_MINUTES } else { ORDINARY_MAX_MINUTES };
    let estimate = estimate.unwrap_or(DEFAULT_ESTIMATE_MINUTES);
    let budget = ceiling.min(MIN_ESTIMATE_MINUTES.max(estimate)) * 60_000.0;
    let answer_at = (budget * 1.3).max(budget + 90_000.0);
    let minutes = (elapsed_ms / 60_000.0).floor() as i64;
    let expected = (budget / 60_000.0).round() as i64;
    // Past its estimate, a run still finding things keeps going; the clock alone ends nothing.
    if elapsed_ms >= budget && progressing {
        return TimeBudget {
            answer_only: false,
            note: (!told(messages, "progress")).then(|| format!("{MARKER} (progress): {minutes} minutes in, past the {expected} this task was expected to take. Your recent steps are still finding new things, so keep working through what is open, the most important parts first. Once your steps stop turning up anything new, write your answer.")),
        };
    }
    if elapsed_ms >= answer_at {
        return TimeBudget {
            answer_only: true,
            note: (!told(messages, "answer")).then(|| format!("{MARKER} (answer): this run has worked {minutes} minutes against the {expected} it should take, and the person is waiting. Write your final answer now with agent_finish from everything you found: give each finding with its source, and list in remaining what is still undone and why.")),
        };
    }
    if elapsed_ms >= budget && !told(messages, "wrap") {
        return TimeBudget {
            answer_only: false,
            note: Some(format!("{MARKER} (wrap): {minutes} minutes in, the {expected} this task should take. Finish only what is nearly done, open nothing new, and write your answer within the next few turns.")),
        };
    }
    if elapsed_ms >= budget * 0.8 && !told(messages, "pace") {
        return TimeBudget {
            answer_only: false,
            note: Some(format!("{MARKER} (pace): {minutes} of about {expected} minutes used. Finish the parts in hand before starting others, and drop leads that are not paying off.")),
        };
    }
    TimeBudget { answer_only: false, note: None }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::transcript::{
        fixtures::{call_message, result_message, text_output},
        user_message,
    };

    fn minutes(value: f64) -> f64 {
        value * 60_000.0
    }

    fn checklist(estimate: u32) -> Message {
        call_message("c1", CHECKLIST_TOOL, &format!(r#"{{"items":[],"minutes":{estimate}}}"#))
    }

    fn note(budget: &TimeBudget) -> &str {
        budget.note.as_deref().unwrap_or("")
    }

    const QUIET: TimeBudget = TimeBudget { answer_only: false, note: None };

    #[test]
    fn reads_the_agents_estimate_from_its_checklist() {
        assert_eq!(estimate_minutes(&[]), None);
        assert_eq!(estimate_minutes(&[checklist(3), checklist(4)]), Some(4.0));
    }

    #[test]
    fn reads_an_estimate_as_number_does() {
        let written = call_message("c", CHECKLIST_TOOL, r#"{"minutes":"5"}"#);
        assert_eq!(estimate_minutes(&[written]), Some(5.0));
        let none = call_message("c", CHECKLIST_TOOL, r#"{"minutes":"soon"}"#);
        assert_eq!(estimate_minutes(&[none]), None);
    }

    #[test]
    fn paces_a_ten_minute_task_at_eight_wraps_up_at_ten_and_allows_only_the_answer_from_thirteen() {
        let mut messages = Vec::new();
        assert_eq!(time_budget(minutes(7.0), &messages, None, false), QUIET);
        let pace = time_budget(minutes(8.0), &messages, None, false);
        assert!(note(&pace).starts_with("Time budget (pace)"));
        messages.push(user_message(note(&pace)));
        assert_eq!(time_budget(minutes(9.0), &messages, None, false).note, None);
        let wrap = time_budget(minutes(10.0), &messages, None, false);
        assert!(note(&wrap).starts_with("Time budget (wrap)"));
        messages.push(user_message(note(&wrap)));
        let answer = time_budget(minutes(13.0), &messages, None, false);
        assert!(answer.answer_only);
        messages.push(user_message(note(&answer)));
        assert_eq!(time_budget(minutes(14.0), &messages, None, false), TimeBudget { answer_only: true, note: None });
    }

    #[test]
    fn holds_a_three_minute_lookup_to_about_three_minutes() {
        assert!(note(&time_budget(minutes(2.5), &[], Some(3.0), false)).starts_with("Time budget (pace)"));
        assert!(note(&time_budget(minutes(3.0), &[], Some(3.0), false)).starts_with("Time budget (wrap)"));
        assert!(time_budget(minutes(4.5), &[], Some(3.0), false).answer_only);
    }

    #[test]
    fn gives_deep_research_its_own_longer_clock() {
        let asked = [user_message("Do deep research on solid-state batteries and write a full report.")];
        assert_eq!(time_budget(minutes(20.0), &asked, Some(45.0), false), QUIET);
        assert!(note(&time_budget(minutes(45.0), &asked, Some(45.0), false)).starts_with("Time budget (wrap)"));
        assert!(time_budget(minutes(59.0), &asked, Some(45.0), false).answer_only);
    }

    #[test]
    fn holds_an_ordinary_tasks_generous_estimate_to_half_an_hour() {
        let asked = [user_message("Compare three hotels near Disney and keep the pages open.")];
        assert!(note(&time_budget(minutes(30.0), &asked, Some(45.0), false)).starts_with("Time budget (wrap)"));
    }

    #[test]
    fn lets_a_run_past_its_estimate_keep_going_while_it_still_finds_new_things() {
        let going = time_budget(minutes(20.0), &[], Some(10.0), true);
        assert!(!going.answer_only);
        assert!(note(&going).starts_with("Time budget (progress)"));
        let told = [user_message(note(&going))];
        assert_eq!(time_budget(minutes(25.0), &told, Some(10.0), true), QUIET);
        assert!(time_budget(minutes(25.0), &told, Some(10.0), false).answer_only);
    }

    fn result(id: &str, value: &str) -> Message {
        result_message(id, "browser_snapshot", text_output(value))
    }

    #[test]
    fn still_progressing_counts_results_the_run_has_not_seen_before_not_repeats() {
        let names = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
        let pages: Vec<Message> = names.iter().enumerate().map(|(index, page)| result(&format!("c{index}"), &format!("page {page}"))).collect();
        assert!(still_progressing(&pages, PROGRESS_WINDOW, PROGRESS_NEEDED));
        let mut repeats = pages.clone();
        repeats.extend(names[..8].iter().enumerate().map(|(index, page)| result(&format!("r{index}"), &format!("page {page}"))));
        assert!(!still_progressing(&repeats, PROGRESS_WINDOW, PROGRESS_NEEDED));
        assert!(!still_progressing(&[result("x", "same [ref=e1]"), result("y", "same [ref=e9]")], 2, 2));
    }

    #[test]
    fn a_fingerprint_is_the_one_node_computes() {
        assert_eq!(fingerprint(&text_output("page a")), "32:2456729903");
        assert_eq!(fingerprint(&text_output("é😀 98b065b1-5ec0-4054-b100-4b09009a8709 [ref=e12]")), "31:2676989017");
    }
}
