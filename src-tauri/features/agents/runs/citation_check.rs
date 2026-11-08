//! Citation grounding. A search result is a lead, not a source:
//! its snippet can be stale or cut off. A final answer may cite a page only if the run read it, with
//! web_fetch or in a browser. The first agent_finish that cites an unread page is refused once with
//! the list (a plain-text final answer is checked the same way), so the model reads those pages,
//! drops the citation, or says the fact came from a search snippet. The second attempt stands, so
//! this can never loop.
use std::{
    collections::{HashMap, HashSet},
    sync::LazyLock,
};

use regex::Regex;

use super::{
    js_json::JsValue,
    js_regex::js_regex,
    research_budget::{page_key, ResearchTools},
    transcript::{failed, input_value, tool_parts, user_parts_text, ToolPart},
    transcript_json::stringify_output,
};
use crate::model_calls::Message;

pub(crate) const CITATION_INSTRUCTIONS: &str = "Cite only pages you read. A search result is a lead, not a source: read the page with web_fetch before citing it, or say the fact comes from a search snippet.";

static URL_PATTERN: LazyLock<Regex> = LazyLock::new(|| js_regex(r#"https?:\/\/[^\s)\]>"'`]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s)\]>"'`]+"#, true));
static HAS_HTTP: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^https?:", true));

/// The pages an answer names, as page keys with the text it wrote them as, in order, without
/// sentence punctuation.
pub(crate) fn cited_pages(text: &str) -> Vec<(String, String)> {
    let mut cited: Vec<(String, String)> = Vec::new();
    let mut seen = HashSet::new();
    for found in URL_PATTERN.find_iter(text) {
        let url = found.as_str().trim_end_matches(['.', ',', ';', ':', '!', '?', '*', '_']);
        let key = if HAS_HTTP.is_match(url) { page_key(url) } else { page_key(&format!("https://{url}")) };
        if seen.insert(key.clone()) {
            cited.push((key, url.to_owned()));
        }
    }
    cited
}

/// Pages the run read: fetched successfully, opened in a browser, or handed over by the person.
pub(crate) fn read_pages(messages: &[Message], tools: &ResearchTools) -> HashSet<String> {
    let mut read = HashSet::new();
    let mut fetches: HashMap<&str, String> = HashMap::new();
    for message in messages {
        if matches!(message, Message::User { .. }) {
            read.extend(cited_pages(&user_parts_text(message)).into_iter().map(|(key, _)| key));
            continue;
        }
        for part in tool_parts(std::slice::from_ref(message)) {
            match part {
                ToolPart::Call { id, name, input } => {
                    let input = input_value(input);
                    let Some(url) = input.get("url").and_then(JsValue::as_str) else {
                        continue;
                    };
                    if tools.search.as_deref() == Some(name) {
                        continue;
                    }
                    let key = page_key(url);
                    if tools.fetch.as_deref() == Some(name) && !id.is_empty() {
                        fetches.insert(id, key);
                    } else {
                        read.insert(key);
                    }
                }
                ToolPart::Result(result) => {
                    if !failed(&result.output) {
                        if let Some(key) = fetches.get(result.tool_call_id.as_str()) {
                            read.insert(key.clone());
                        }
                    }
                }
            }
        }
    }
    read
}

/// Pages that only appeared in search results, never opened.
fn searched_pages(messages: &[Message], tools: &ResearchTools) -> HashSet<String> {
    let mut seen = HashSet::new();
    let Some(search) = tools.search.as_deref().filter(|search| !search.is_empty()) else {
        return seen;
    };
    for part in tool_parts(messages) {
        if let ToolPart::Result(result) = part {
            if result.tool_name == search {
                seen.extend(cited_pages(&stringify_output(&result.output)).into_iter().map(|(key, _)| key));
            }
        }
    }
    seen
}

/// Cited pages the run saw only as search results and never read, as the answer wrote them. A link
/// an app tool returned (an issue it opened) or one the person gave is not in question.
pub(crate) fn unread_citations(answer: &str, messages: &[Message], tools: &ResearchTools) -> Vec<String> {
    let read = read_pages(messages, tools);
    let searched = searched_pages(messages, tools);
    cited_pages(answer)
        .into_iter()
        .filter(|(key, _)| searched.contains(key) && !read.contains(key))
        .map(|(_, url)| url)
        .collect()
}

/// What follows the fix in a refusal when the caller names nothing else.
pub(crate) const CALL_FINISH_AGAIN: &str = "call agent_finish again";

/// The reason to refuse a report once, in words the model can act on.
pub(crate) fn citation_refusal(unread: &[String], can_fetch: bool, then: &str) -> String {
    let list = unread.iter().take(5).map(String::as_str).collect::<Vec<_>>().join(", ");
    let fix = if can_fetch {
        "Read each with web_fetch (pass the question you need answered) and cite it from what it says; or remove the citation; or say the fact comes from a search snippet."
    } else {
        "Page reading is closed for this run, so remove those citations, or say the fact comes from a search snippet; do not present it as read."
    };
    format!("Your answer cites pages this run never read: {list}. A search result is only a lead. {fix} Then {then}.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcript::fixtures::{error_output, json_output, turn};
    use crate::transcript::user_message;

    fn tools() -> ResearchTools {
        ResearchTools { search: Some("web_search".to_owned()), fetch: Some("web_fetch".to_owned()), open: None }
    }

    fn found(id: &str, urls: &[&str]) -> Vec<Message> {
        let results = urls.iter().map(|url| format!(r#"{{"url":"{url}","snippet":"..."}}"#)).collect::<Vec<_>>().join(",");
        turn(id, "web_search", r#"{"query":"x"}"#, json_output(&format!(r#"{{"results":[{results}]}}"#)))
    }

    #[test]
    fn finds_cited_pages_with_or_without_a_scheme_ignoring_sentence_punctuation() {
        let pages: Vec<String> = cited_pages("See https://a.com/x. Also kprofiles.com/a2o/members/, and (b.org/p).").into_iter().map(|(_, url)| url).collect();
        assert_eq!(pages, ["https://a.com/x", "kprofiles.com/a2o/members/", "b.org/p"]);
    }

    #[test]
    fn flags_a_page_seen_only_in_search_results_and_accepts_it_once_fetched() {
        let search = found("s", &["https://kprofiles.com/a2o/"]);
        assert_eq!(unread_citations("Source: kprofiles.com/a2o/", &search, &tools()), ["kprofiles.com/a2o/"]);
        let mut read = search;
        read.extend(turn("f", "web_fetch", r#"{"url":"https://kprofiles.com/a2o"}"#, json_output(r#"{"text":"members"}"#)));
        assert!(unread_citations("Source: kprofiles.com/a2o/", &read, &tools()).is_empty());
    }

    #[test]
    fn does_not_count_a_failed_fetch_as_reading() {
        let mut messages = found("s", &["https://a.com/p"]);
        messages.extend(turn("f", "web_fetch", r#"{"url":"https://a.com/p"}"#, error_output("blocked")));
        assert!(!read_pages(&messages, &tools()).contains("a.com/p"));
        assert_eq!(unread_citations("https://a.com/p", &messages, &tools()), ["https://a.com/p"]);
    }

    #[test]
    fn leaves_links_from_app_tools_and_from_the_person_alone() {
        let mut messages = vec![user_message("Summarize https://rfc.org/1")];
        messages.extend(turn("g", "integration_execute", r#"{"tool_slug":"GITHUB_CREATE_ISSUE"}"#, json_output(r#"{"html_url":"https://github.com/o/r/issues/1"}"#)));
        assert!(unread_citations("Opened https://github.com/o/r/issues/1 from https://rfc.org/1", &messages, &tools()).is_empty());
    }

    #[test]
    fn counts_a_page_opened_in_a_browser_as_read() {
        let mut messages = found("s", &["https://a.com/p"]);
        messages.extend(turn("b", "browser_navigate", r#"{"url":"https://a.com/p"}"#, json_output("{}")));
        assert!(unread_citations("https://a.com/p", &messages, &tools()).is_empty());
    }

    #[test]
    fn words_the_refusal_for_open_and_closed_research() {
        let unread = ["a.com/p".to_owned()];
        assert!(citation_refusal(&unread, true, CALL_FINISH_AGAIN).contains("Read each with web_fetch"));
        assert!(citation_refusal(&unread, false, CALL_FINISH_AGAIN).contains("closed for this run"));
        assert!(citation_refusal(&unread, true, CALL_FINISH_AGAIN).ends_with("call agent_finish again."));
        assert!(citation_refusal(&unread, true, "give your answer again").ends_with("give your answer again."));
    }
}
