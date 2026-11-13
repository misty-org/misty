//! The working set. A run's context grew to 35,000 input tokens at
//! the median and 100,000 at p90, because every page snapshot, extract and fetch stayed until the
//! transcript neared the model's window. Each turn reread all of it: turns took 9.4 s and the model
//! lost the thread. Like browser-use, the run keeps the current page state and short notes on the
//! past, not every old page.
//!
//! Above [`WORKING_TOKENS`], results older than the newest [`KEEP_RESULTS`] are cut down: page states
//! (snapshots, trees) entirely, since the agent acts only on the current page, and reading results
//! (fetch, extract, search, find) to a short digest, so facts found earlier survive. The cut lands in
//! batches: each cut rewrites earlier messages, so the provider's cached prefix is lost for that
//! turn. Cutting one result a turn made every turn past the budget uncached. A cut waits until it
//! saves [`CUT_BATCH_CHARS`], so most turns still reuse the cache.
use std::{borrow::Cow, sync::LazyLock};

use regex::Regex;

use crate::js_regex::js_regex;
use crate::text::{js_len, js_prefix, js_trim};
use crate::transcript_json::{role, stringify_assistant_part, stringify_raw, stringify_tool_result, stringify_user_part};
use crate::model_calls::{AssistantPart, Message, ToolOutput, ToolResultPart, UserPart};

pub(crate) const WORKING_TOKENS: f64 = 24_000.0;
/// What a cut must save (about 10,000 tokens) to be worth one uncached turn.
pub(crate) const CUT_BATCH_CHARS: usize = 40_000;
/// The newest page states stay whole: the agent acts only on the page in front of it.
const KEEP_PAGES: usize = 2;
/// The newest reading results stay whole; older ones become digests.
const KEEP_READING: usize = 4;
/// Any other result stays whole among the newest few.
pub(crate) const KEEP_RESULTS: usize = 6;
const DIGEST_CHARS: usize = 700;

/// Tools whose results are reading: what they found is kept as a digest.
const READING: [&str; 6] = ["web_fetch", "web_search", "browser_extract", "browser_find", "log_work_read", "browser_run"];
/// Tools whose results are a page's state (its tree): stale after the next action.
const PAGE_STATE: [&str; 7] = ["browser_snapshot", "browser_navigate", "browser_steps", "browser_fill_form", "browser_skill", "browser_visual", "browser_inspect"];

const CUT: &str = "[Older result cut to keep this run fast; what it found should be in your notebook or answer.]";

pub(crate) const DIGEST_MARK: &str = "[Digest of an older result]";

static SPACES: LazyLock<Regex> = LazyLock::new(|| js_regex(r"\s+", false));

fn digest(text: &str) -> String {
    let flat = SPACES.replace_all(text, " ");
    let flat = js_trim(&flat);
    let more = if js_len(flat) > DIGEST_CHARS { " …" } else { "" };
    format!("{DIGEST_MARK} {}{more}", js_prefix(flat, DIGEST_CHARS))
}

fn output_text(output: &ToolOutput) -> Option<Cow<'_, str>> {
    match output {
        ToolOutput::Text { value } => Some(Cow::Borrowed(value)),
        ToolOutput::Json { value } => Some(Cow::Owned(stringify_raw(value))),
        _ => None,
    }
}

/// The output that replaces an old result, or `None` to keep it.
fn cut(part: &ToolResultPart) -> Option<ToolOutput> {
    let text = output_text(&part.output)?;
    if text == CUT || text.starts_with(DIGEST_MARK) {
        return None;
    }
    if READING.contains(&part.tool_name.as_str()) {
        if js_len(&text) <= DIGEST_CHARS + js_len(DIGEST_MARK) + 4 {
            return None;
        }
        return Some(ToolOutput::Text { value: digest(&text) });
    }
    if js_len(&text) <= 400 {
        return None;
    }
    Some(ToolOutput::Text { value: CUT.to_owned() })
}

/// Cuts tool results past the newest few of each kind to a digest or a short note.
pub(crate) fn cut_old_results(messages: &[Message], keep: usize) -> (Cow<'_, [Message]>, usize) {
    let (mut pages, mut readings, mut others) = (0, 0, 0);
    let mut count = 0;
    let mut out = Cow::Borrowed(messages);
    for (message_index, message) in messages.iter().enumerate().rev() {
        let Message::Tool { content, .. } = message else {
            continue;
        };
        for (part_index, part) in content.iter().enumerate().rev() {
            let name = part.tool_name.as_str();
            let (seen, limit) = if PAGE_STATE.contains(&name) {
                pages += 1;
                (pages, KEEP_PAGES)
            } else if READING.contains(&name) {
                readings += 1;
                (readings, KEEP_READING)
            } else {
                others += 1;
                (others, keep)
            };
            if seen <= limit {
                continue;
            }
            let Some(output) = cut(part) else {
                continue;
            };
            count += 1;
            if let Message::Tool { content, .. } = &mut out.to_mut()[message_index] {
                content[part_index].output = output;
            }
        }
    }
    (out, count)
}

/// A transcript's size by kind, and its largest parts, for logs.
#[derive(Debug, PartialEq)]
pub(crate) struct ContextParts {
    pub(crate) total_chars: usize,
    pub(crate) by_kind: Vec<(String, usize)>,
    pub(crate) largest: Vec<(String, usize)>,
}

fn output_kind(output: &ToolOutput) -> &'static str {
    match output {
        ToolOutput::Text { .. } => "text",
        ToolOutput::Json { .. } => "json",
        ToolOutput::ErrorText { .. } => "error-text",
        ToolOutput::ErrorJson { .. } => "error-json",
        ToolOutput::ExecutionDenied { .. } => "execution-denied",
        ToolOutput::Content { .. } => "content",
    }
}

fn part_sizes(message: &Message) -> Vec<(String, usize)> {
    let role = role(message);
    match message {
        Message::System { content, .. } => {
            let part = UserPart::Text { text: content.clone() };
            vec![(format!("{role}:text"), js_len(&stringify_user_part(&part)))]
        }
        Message::User { content, .. } => content
            .iter()
            .map(|part| {
                let kind = match part {
                    UserPart::Text { .. } => "text",
                    UserPart::File { media_type, .. } if media_type.starts_with("image/") => "image",
                    UserPart::File { .. } => "file",
                };
                (format!("{role}:{kind}"), js_len(&stringify_user_part(part)))
            })
            .collect(),
        Message::Assistant { content, .. } => content
            .iter()
            .map(|part| {
                let label = match part {
                    AssistantPart::Text { .. } => format!("{role}:text"),
                    AssistantPart::Reasoning { .. } => format!("{role}:reasoning"),
                    AssistantPart::ToolCall { tool_name, .. } => format!("{role}:tool-call:{tool_name}"),
                };
                (label, js_len(&stringify_assistant_part(part)))
            })
            .collect(),
        Message::Tool { content, .. } => content
            .iter()
            .map(|part| {
                let label = format!("{role}:tool-result:{}:{}", part.tool_name, output_kind(&part.output));
                (label, js_len(&stringify_tool_result(part)))
            })
            .collect(),
    }
}

pub(crate) fn context_parts(messages: &[Message]) -> ContextParts {
    let mut by_kind: Vec<(String, usize)> = Vec::new();
    let mut parts = Vec::new();
    for message in messages {
        for (label, size) in part_sizes(message) {
            match by_kind.iter_mut().find(|(kind, _)| *kind == label) {
                Some((_, total)) => *total += size,
                None => by_kind.push((label.clone(), size)),
            }
            parts.push((label, size));
        }
    }
    let total_chars = parts.iter().map(|(_, size)| size).sum();
    parts.sort_by(|left, right| right.1.cmp(&left.1));
    parts.truncate(6);
    ContextParts { total_chars, by_kind, largest: parts }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcript::fixtures::{call_message, result_message, text_output};
    use crate::transcript::user_message;

    fn text(message: &Message) -> String {
        match message {
            Message::Tool { content, .. } => match &content[0].output {
                ToolOutput::Text { value } => value.clone(),
                _ => String::new(),
            },
            _ => String::new(),
        }
    }

    #[test]
    fn keeps_the_newest_two_pages_and_four_readings_whole_digests_older_reading_cuts_older_pages() {
        let page = format!(r#"{{"tree":"{}"}}"#, "x".repeat(5_000));
        let found = format!("Aetna, Blue Cross NC and UnitedHealthcare sell plans in Raleigh. {}", "detail ".repeat(400));
        let mut messages = vec![
            call_message("f0", "web_fetch", r#"{"url":"https://example.com/0"}"#),
            result_message("f0", "web_fetch", text_output(found.clone())),
        ];
        for index in 1..=4 {
            messages.push(call_message(&format!("f{index}"), "web_fetch", "{}"));
            messages.push(result_message(&format!("f{index}"), "web_fetch", text_output(found.clone())));
        }
        for index in 0..4 {
            messages.push(call_message(&format!("p{index}"), "browser_snapshot", "{}"));
            messages.push(result_message(&format!("p{index}"), "browser_snapshot", text_output(page.clone())));
        }
        let (out, count) = cut_old_results(&messages, KEEP_RESULTS);
        assert_eq!(count, 3);
        assert!(text(&out[1]).starts_with(DIGEST_MARK));
        assert!(text(&out[1]).contains("Aetna, Blue Cross NC and UnitedHealthcare"));
        assert!(js_len(&text(&out[1])) < 800);
        assert_eq!(text(&out[3]), found);
        assert!(text(&out[11]).starts_with("[Older result cut"));
        assert!(text(&out[13]).starts_with("[Older result cut"));
        assert_eq!(text(&out[15]), page);
        assert_eq!(text(&out[17]), page);
        assert_eq!(cut_old_results(&out, KEEP_RESULTS).1, 0);
    }

    #[test]
    fn a_transcript_with_nothing_to_cut_is_not_copied() {
        let messages = [user_message("Go")];
        assert!(matches!(cut_old_results(&messages, KEEP_RESULTS), (Cow::Borrowed(_), 0)));
    }

    #[test]
    fn context_parts_label_and_rank_the_transcript() {
        let messages = [
            user_message("Go"),
            call_message("a", "web_fetch", "{}"),
            result_message("a", "web_fetch", text_output("x".repeat(500))),
        ];
        let parts = context_parts(&messages);
        assert_eq!(parts.largest[0].0, "tool:tool-result:web_fetch:text");
        assert!(parts.by_kind.iter().any(|(kind, size)| kind == "user:text" && *size == r#"{"type":"text","text":"Go"}"#.len()));
        assert_eq!(parts.total_chars, parts.by_kind.iter().map(|(_, size)| size).sum::<usize>());
    }
}
