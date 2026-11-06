//! Research budget (docs/agents/harness.md, Completion). Prompts say "be economical"; this layer
//! makes it true. It reads the run's own transcript before every model call, so a replayed run
//! agrees, and moves through three stages: open, wrap-up (the model is told what it has spent and
//! must name the fact still missing) and closed (search and fetch leave the tool list, so the next
//! turn can only answer). A repeat of an earlier query or page costs double, so a run that circles
//! closes sooner than one that keeps finding new ground.
use std::{collections::HashSet, sync::LazyLock};

use regex::Regex;
use url::Url;

use super::{
    js_json::{text_or_empty, JsValue},
    js_regex::js_regex,
    requirements_review::LEDGER_HEADING,
    text::js_trim,
    transcript::{input_value, tool_parts, user_parts_text, user_string, ToolPart},
};
use crate::sdk::Message;

pub(crate) const RESEARCH_WRAP_UP: usize = 6;
pub(crate) const RESEARCH_CLOSE: usize = 12;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum ResearchStage {
    Open,
    WrapUp,
    Closed,
}

impl ResearchStage {
    fn label(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::WrapUp => "wrap-up",
            Self::Closed => "closed",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ResearchUse {
    pub(crate) searches: usize,
    pub(crate) fetches: usize,
    pub(crate) repeats: usize,
    /// Calls, with each repeat counted twice.
    pub(crate) cost: usize,
    pub(crate) stage: ResearchStage,
}

/// Model-visible names of the research tools this run has (either may be absent).
#[derive(Clone, Debug, Default)]
pub(crate) struct ResearchTools {
    pub(crate) search: Option<String>,
    pub(crate) fetch: Option<String>,
    /// screen_open, when the run can open its own browser tab: the route for a page a fetch can't read.
    pub(crate) open: Option<String>,
}

const STOP_WORDS: [&str; 15] = ["the", "and", "for", "with", "what", "how", "are", "was", "who", "that", "this", "from", "about", "does", "did"];

static NOT_WORD: LazyLock<Regex> = LazyLock::new(|| js_regex(r"[^a-z0-9]+", false));
static NUMBERED_LINE: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^\s*\d+[.)]\s", false));

fn query_words(query: &str) -> HashSet<String> {
    NOT_WORD
        .split(&query.to_lowercase())
        .filter(|word| word.len() > 2 && !STOP_WORDS.contains(word))
        .map(str::to_owned)
        .collect()
}

/// The same question in other words: nearly every word of the shorter query is in the other.
pub(crate) fn same_query(a: &HashSet<String>, b: &HashSet<String>) -> bool {
    let smaller = a.len().min(b.len());
    if smaller < 2 {
        return false;
    }
    let shared = a.iter().filter(|word| b.contains(*word)).count();
    shared as f64 / smaller as f64 >= 0.8
}

pub(crate) fn page_key(url: &str) -> String {
    match Url::parse(url) {
        Ok(parsed) => {
            let host = parsed.host_str().unwrap_or("").to_lowercase();
            let path = parsed.path().trim_end_matches('/');
            // An empty query is no search, as in JavaScript.
            let query = parsed.query().filter(|query| !query.is_empty()).map(|query| format!("?{query}")).unwrap_or_default();
            format!("{host}{path}{query}")
        }
        Err(_) => js_trim(url).to_lowercase(),
    }
}

fn stage_for(cost: usize, scale: usize) -> ResearchStage {
    if cost >= RESEARCH_CLOSE * scale {
        ResearchStage::Closed
    } else if cost >= RESEARCH_WRAP_UP * scale {
        ResearchStage::WrapUp
    } else {
        ResearchStage::Open
    }
}

/// A long request earns a longer budget: one base allowance for every step of the run's own
/// checklist (log_work_checklist) or every requirement listed from the request, whichever is more,
/// never less than one nor more than twenty. A quick question has no checklist and keeps the base
/// budget; a six-part task gets about 36 lookups before the wrap-up note
/// (docs/agents/evals/odysseys.md).
pub(crate) fn budget_scale(messages: &[Message]) -> usize {
    let mut steps = HashSet::new();
    // The requirements Misty listed from a long request (`requirements_review.rs`) count too: a run
    // with 26 pages to verify outgrew an eight-step checklist's budget at a third of its turns.
    let mut requirements = 0;
    for message in messages {
        if let Some(text) = user_string(message).filter(|text| text.starts_with(LEDGER_HEADING)) {
            requirements = requirements.max(text.split('\n').filter(|line| NUMBERED_LINE.is_match(line)).count());
        }
    }
    for part in tool_parts(messages) {
        let ToolPart::Call { name: "log_work_checklist", input, .. } = part else {
            continue;
        };
        let input = input_value(input);
        let items = input.get("items").and_then(JsValue::as_array).unwrap_or(&[]);
        for item in items {
            if let Some(id) = item.get("id").and_then(JsValue::as_str) {
                steps.insert(id.to_owned());
            }
        }
    }
    steps.len().max(requirements).clamp(1, 20)
}

/// What the run has spent on research so far, read from its tool calls. `min_scale` is the largest
/// budget the run has had: a summarized transcript loses the checklist and requirements that set
/// it, and on October 20 a 200-turn run lost search and fetch at turn 29 that way.
pub(crate) fn research_use(messages: &[Message], tools: &ResearchTools, min_scale: usize) -> ResearchUse {
    let (mut searches, mut fetches, mut repeats) = (0, 0, 0);
    let mut queries: Vec<HashSet<String>> = Vec::new();
    let mut pages = HashSet::new();
    for part in tool_parts(messages) {
        let ToolPart::Call { name, input, .. } = part else {
            continue;
        };
        if tools.search.as_deref() == Some(name) {
            searches += 1;
            let words = query_words(&text_or_empty(input_value(input).get("query")));
            if queries.iter().any(|earlier| same_query(earlier, &words)) {
                repeats += 1;
            }
            queries.push(words);
        } else if tools.fetch.as_deref() == Some(name) {
            fetches += 1;
            let key = page_key(&text_or_empty(input_value(input).get("url")));
            if !pages.insert(key) {
                repeats += 1;
            }
        }
    }
    let cost = searches + fetches + repeats;
    ResearchUse { searches, fetches, repeats, cost, stage: stage_for(cost, min_scale.max(budget_scale(messages))) }
}

/// The tools to hide: both research tools once the budget is closed.
pub(crate) fn closed_research_tools(usage: &ResearchUse, tools: &ResearchTools) -> HashSet<String> {
    if usage.stage != ResearchStage::Closed {
        return HashSet::new();
    }
    [&tools.search, &tools.fetch].into_iter().flatten().filter(|name| !name.is_empty()).cloned().collect()
}

const NOTE_MARKER: &str = "Research budget";

/// The note for a stage, or `None` when it is open or the transcript already carries it.
pub(crate) fn research_note(usage: &ResearchUse, messages: &[Message], tools: &ResearchTools) -> Option<String> {
    if usage.stage == ResearchStage::Open {
        return None;
    }
    let marker = format!("{NOTE_MARKER} ({})", usage.stage.label());
    let told = messages
        .iter()
        .filter(|message| matches!(message, Message::User { .. }))
        .any(|message| user_parts_text(message).starts_with(&marker));
    if told {
        return None;
    }
    let mut spent = format!(
        "{} search{} and {} page read{}",
        usage.searches,
        if usage.searches == 1 { "" } else { "es" },
        usage.fetches,
        if usage.fetches == 1 { "" } else { "s" }
    );
    if usage.repeats > 0 {
        spent.push_str(&format!(", {} of them repeats", usage.repeats));
    }
    // A run with its own tabs does its remaining work on pages, not in searches. "Answer now" made
    // such runs give up: a 20-school task ended "not finished" after 24 lookups (October 19).
    if let Some(open) = tools.open.as_deref().filter(|open| !open.is_empty()) {
        if usage.stage == ResearchStage::WrapUp {
            return Some(format!("{marker}: this run has used {spent}. Stop searching with new wording. Do the rest of the request on pages: open the sites you already know in your own tabs with {open}, use their own search boxes, menus and links (browser_steps), and read them with browser_snapshot or browser_extract, which are not counted here. Finish every part the request names before agent_finish."));
        }
        return Some(format!("{marker}: this run has used {spent}, so web search and fetch are closed. Keep working in your own tabs: {open} opens a site's address, and its own search, menus and links reach the rest. Finish every part the request names, then call agent_finish and say plainly what you could not confirm."));
    }
    if usage.stage == ResearchStage::WrapUp {
        return Some(format!("{marker}: this run has used {spent}. Answer now from what you have unless one specific fact is still missing. If it is, name it and make the single call that finds it; do not search again with new wording."));
    }
    Some(format!("{marker}: this run has used {spent}, so search and page reading are closed. Answer from what you found, say plainly what you could not confirm, and call agent_finish."))
}

#[cfg(test)]
mod tests;
