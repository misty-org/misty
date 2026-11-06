//! Proof tabs (docs/agents/harness.md, Completion). Odysseys asks for pages "kept open" as proof in
//! most of its tasks, and those items failed most often: the agent read the page with a fetch, closed
//! the tab, or left it on a generic page or behind a dialog. When the request asks for pages left
//! open, the first finish goes back once, unless the agent has just listed its tabs, to check each
//! one against the request.
use std::{collections::HashMap, sync::LazyLock};

use regex::Regex;
use url::Url;

use crate::sdk::{AssistantPart, Message, ToolOutput};

use super::{
    js_json::{text_or_empty, JsValue},
    js_regex::js_regex,
    text::js_trim,
    transcript::stringify_raw,
};

static KEPT_OPEN: LazyLock<Regex> = LazyLock::new(|| {
    js_regex(
        r"\b(keep|kept|leave|left|stay|remain)\b[^.]{0,80}\b(open|tabs?)\b|\b(in|on) (its|their|a|separate|different) (own )?tabs?\b|\bvisual proof\b|\bopen (in|as) (separate|different|new) tabs?\b",
        true,
    )
});

/// The `{0,80}` above counts UTF-16 units in JavaScript and characters in the `regex` crate, so a
/// character outside the BMP is matched as two.
fn in_utf16_units(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for character in text.chars() {
        if character.len_utf16() == 2 {
            out.push_str("\u{FFFD}\u{FFFD}");
        } else {
            out.push(character);
        }
    }
    out
}

/// Whether the person's request asks for pages left open.
pub(crate) fn asks_for_open_pages(request: &str) -> bool {
    KEPT_OPEN.is_match(&in_utf16_units(request))
}

/// Whether one of the last `within` tool calls was `tool`.
fn called_recently(messages: &[Message], tool: &str, within: usize) -> bool {
    let mut seen = 0;
    for message in messages.iter().rev() {
        if seen >= within {
            break;
        }
        let Message::Assistant { content, .. } = message else {
            continue;
        };
        for part in content.iter().rev() {
            let AssistantPart::ToolCall { tool_name, .. } = part else {
                continue;
            };
            if tool_name == tool {
                return true;
            }
            seen += 1;
            if seen >= within {
                break;
            }
        }
    }
    false
}

/// The reason to send a finish back to check its tabs, or `None`.
pub(crate) fn proof_tabs_refusal(request: &str, messages: &[Message], tab_list: Option<&str>, program: Option<&str>) -> Option<String> {
    let program = program.filter(|program| !program.is_empty());
    let tab_list = tab_list.filter(|list| !list.is_empty());
    if !asks_for_open_pages(request) {
        return None;
    }
    if program.is_none() && tab_list.map_or(true, |list| called_recently(messages, list, 4)) {
        return None;
    }
    // A run with programs checks its own tabs with one (the person's tab list is not its to use),
    // and brings what it reports into view: each kept tab is pictured as it stands at the end.
    let how = match program {
        Some(program) => format!("call {program} with `return listTabs()` (every tab's address and title) and, for each page the request names, `await t.keep(\"the text that shows what you report\")`, which brings that text on screen and keeps the tab awake so it is pictured when you finish (a tab you do not keep() sleeps)"),
        None => format!("call {}", tab_list.unwrap_or_default()),
    };
    Some(format!(
        "The person asked for pages to be left open, and those tabs are part of the answer. Before finishing, {how}, and check each page the request names against your tabs: it is open in its own tab, on the right page (the item, not a search or home page), in the state asked for (the search run, the option or size chosen, scrolled to the evidence) and not covered by a dialog or banner. Open or fix any that are missing, then call agent_finish again."
    ))
}

/// A page title or address that says the page is an error or empty, not the evidence asked for.
static ERROR_PAGE: LazyLock<Regex> = LazyLock::new(|| {
    js_regex(r"\b404\b|page not found|not found|can.?t (find|locate)|no longer (exists|available)|access denied|forbidden|just a moment|^about:blank$", true)
});
static OPEN_TABS: LazyLock<Regex> = LazyLock::new(|| js_regex(r"Your open tabs: ([^.]+)\.", false));

/// `part.output.value` as the TypeScript held it.
fn output_value(output: &ToolOutput) -> Option<JsValue> {
    match output {
        ToolOutput::Text { value } | ToolOutput::ErrorText { value } => Some(JsValue::String(value.clone())),
        ToolOutput::Json { value } | ToolOutput::ErrorJson { value } => JsValue::from_raw(value),
        ToolOutput::Content { .. } => JsValue::parse(&super::transcript::stringify_output(output))?.get("value").cloned(),
        ToolOutput::ExecutionDenied { .. } => None,
    }
}

/// `output.type === "json" ? output.value : typeof output.value === "string" ? JSON.parse(it) : undefined`.
fn program_result(output: &ToolOutput) -> Option<JsValue> {
    match (output, output_value(output)?) {
        (ToolOutput::Json { .. }, value) => Some(value),
        (_, JsValue::String(text)) => JsValue::parse(&text),
        _ => None,
    }
}

/// `typeof output.value === "string" ? output.value : JSON.stringify(output.value ?? "")`.
fn output_text(output: &ToolOutput) -> String {
    match output {
        ToolOutput::Json { value } | ToolOutput::ErrorJson { value } if !value.get().starts_with('"') => stringify_raw(value),
        _ => match output_value(output) {
            Some(JsValue::String(text)) => text,
            Some(JsValue::Null) | None => "\"\"".to_owned(),
            Some(other) => other.stringify(),
        },
    }
}

fn tool_results(messages: &[Message]) -> impl Iterator<Item = (&str, &ToolOutput)> {
    messages
        .iter()
        .filter_map(|message| match message {
            Message::Tool { content, .. } => Some(content),
            _ => None,
        })
        .flatten()
        .map(|part| (part.tool_name.as_str(), &part.output))
}

/// Kept tabs (browser_run's keep()) that end on an error or empty page, from the run's latest
/// program results (docs/agents/harness.md, Completion): the proof the person asked to see
/// must show the page, not "We Can't Find That Page".
pub(crate) fn broken_proof_tabs(messages: &[Message]) -> Vec<String> {
    let mut kept: Vec<String> = Vec::new();
    let mut latest: HashMap<String, (String, String)> = HashMap::new();
    for (tool_name, output) in tool_results(messages) {
        if tool_name != "browser_run" {
            continue;
        }
        let Some(value) = program_result(output) else {
            continue;
        };
        for id in value.get("kept").and_then(JsValue::as_array).unwrap_or_default() {
            if let Some(id) = id.as_str().filter(|id| !kept.iter().any(|known| known == id)) {
                kept.push(id.to_owned());
            }
        }
        for tab in value.get("tabs").and_then(JsValue::as_array).unwrap_or_default() {
            if let Some(id) = tab.get("id").and_then(JsValue::as_str) {
                latest.insert(id.to_owned(), (text_or_empty(tab.get("url")), text_or_empty(tab.get("title"))));
            }
        }
    }
    kept.iter()
        .filter_map(|id| {
            let (url, title) = latest.get(id)?;
            (ERROR_PAGE.is_match(title) || ERROR_PAGE.is_match(url)).then(|| format!("{} (\"{title}\")", if url.is_empty() { id } else { url }))
        })
        .collect()
}

/// Search engines a request starts on ("start on Google") without asking to keep them.
const SEARCH_ENGINES: [&str; 5] = ["google", "bing", "duckduckgo", "yahoo", "brave"];

/// A site's name as a request says it: amazon.com and smile.amazon.com are "amazon".
fn brand(url: &str) -> String {
    let Ok(parsed) = Url::parse(url) else {
        return String::new();
    };
    let host = parsed.host_str().unwrap_or("");
    let parts: Vec<&str> = host.strip_prefix("www.").unwrap_or(host).split('.').collect();
    if parts.len() >= 2 {
        parts[parts.len() - 2].to_owned()
    } else {
        String::new()
    }
}

fn named_in(site: &str, request: &str) -> bool {
    // The TypeScript built this pattern from the name unescaped. Host names are letters, digits and
    // hyphens, where escaping changes nothing, and the odd character allowed in a host can't break it here.
    Regex::new(&format!(r"(?-u:\b){}(?-u:\b)", regex::escape(site))).is_ok_and(|pattern| pattern.is_match(request))
}

/// Sites the request names and the run visited, with no tab of the agent's open there at the end:
/// a run read Amazon's search page, took a price from a shopping snippet and closed the tab, though
/// the person asked for the product page left open. Only when the request asks for open pages.
pub(crate) fn missing_site_tabs(request: &str, messages: &[Message]) -> Vec<String> {
    if !asks_for_open_pages(request) {
        return Vec::new();
    }
    let mut visited: Vec<String> = Vec::new();
    let mut open: Vec<String> = Vec::new();
    let mut urls: HashMap<String, String> = HashMap::new();
    for (tool_name, output) in tool_results(messages) {
        if tool_name == "browser_run" {
            let value = match output {
                ToolOutput::Json { .. } => output_value(output),
                _ => JsValue::parse(&output_text(output)),
            };
            let Some(tabs) = value.as_ref().and_then(|value| value.get("tabs")).and_then(JsValue::as_array) else {
                continue;
            };
            open.clear();
            for tab in tabs {
                let (Some(id), Some(url)) = (tab.get("id").and_then(JsValue::as_str), tab.get("url").and_then(JsValue::as_str)) else {
                    continue;
                };
                urls.insert(id.to_owned(), url.to_owned());
                open.push(id.to_owned());
                let site = brand(url);
                if !visited.contains(&site) {
                    visited.push(site);
                }
            }
        } else {
            // screen_open and screen_close end with the tabs still open: "Your open tabs: a, b."
            let text = output_text(output);
            if let Some(listed) = OPEN_TABS.captures(&text).and_then(|found| found.get(1)) {
                open = listed.as_str().split(',').map(js_trim).filter(|id| !id.is_empty()).map(str::to_owned).collect();
            }
        }
    }
    let open_brands: Vec<String> = open.iter().map(|id| brand(urls.get(id).map_or("", String::as_str))).collect();
    let named = request.to_lowercase();
    visited
        .into_iter()
        .filter(|site| site.len() > 2 && !SEARCH_ENGINES.contains(&site.as_str()) && !open_brands.contains(site) && named_in(site, &named))
        .collect()
}

#[cfg(test)]
#[path = "proof_tabs_tests.rs"]
mod tests;
