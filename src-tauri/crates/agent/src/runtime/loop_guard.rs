//! The loop guard. Runs spent minutes repeating one call: the
//! same page opened again and again, the same fetch of a page that didn't answer. browser-use breaks
//! loops after three steps on one page without progress. Here a note to change approach comes, once
//! per pattern, when:
//! - one address is opened three times in the run (not only the last dozen calls: a run that went
//!   back to work after answering refetched pages it had read long before);
//! - one call is made three times with the same input in the last dozen, or fails twice;
//! - most of the last pages opened are on one site (five hypebeast.com articles in a row, after an
//!   answer that said one date was unconfirmed, October 20).
use std::{
    collections::{HashMap, HashSet},
    sync::LazyLock,
};

use regex::Regex;
use url::Url;

use super::{
    js_json::JsValue,
    js_regex::js_regex,
    text::{js_prefix, js_trim},
    transcript::{failed, input_value, said, tool_parts, ToolPart},
};
use crate::sdk::{Message, RawJson};

const WINDOW: usize = 12;
const REPEATS: usize = 3;
const FAILURES: usize = 2;
/// Of the last SITE_WINDOW pages opened, SITE_REPEATS on one site is a loop on that site.
const SITE_WINDOW: usize = 8;
const SITE_REPEATS: usize = 6;
const MARKER: &str = "Loop guard";

/// Tools that open an address; the address is what repeats.
const OPENING: [&str; 4] = ["browser_navigate", "screen_open", "web_fetch", "browser_tab_open"];
/// Query parameters that change nothing on the page.
static TRACKING: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|igshid|si)$", true));
/// Search engines: many result pages on one is how searching works, not a loop.
static SEARCH_SITE: LazyLock<Regex> = LazyLock::new(|| js_regex(r"(^|\.)(google|bing|duckduckgo|yahoo|ecosia|startpage|kagi)\.[a-z.]+$", true));
static HAS_SCHEME: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^[a-z][\w+.-]*:", true));

struct Call {
    name: String,
    input: JsValue,
    failed: bool,
}

/// Every tool call in the transcript, oldest first, with whether it failed.
fn all_calls(messages: &[Message]) -> Vec<Call> {
    let failures: HashSet<&str> = tool_parts(messages)
        .filter_map(|part| match part {
            ToolPart::Result(result) if failed(&result.output) => Some(result.tool_call_id.as_str()),
            _ => None,
        })
        .collect();
    tool_parts(messages)
        .filter_map(|part| match part {
            ToolPart::Call { id, name, input } if !name.is_empty() => Some(Call {
                name: name.to_owned(),
                input: input_value(input),
                failed: !id.is_empty() && failures.contains(id),
            }),
            _ => None,
        })
        .collect()
}

/// The address a call opens, the same however it was written, or "".
pub(crate) fn address(input: &RawJson) -> String {
    address_of(&input_value(input))
}

fn address_of(input: &JsValue) -> String {
    let Some(url) = input.get("url").and_then(JsValue::as_str) else {
        return String::new();
    };
    normalized_address(url).unwrap_or_else(|| js_trim(url).to_owned())
}

fn normalized_address(url: &str) -> Option<String> {
    let written = if HAS_SCHEME.is_match(url) { url.to_owned() } else { format!("https://{url}") };
    let mut parsed = Url::parse(&written).ok()?;
    parsed.set_fragment(None);
    if parsed.scheme() == "http" {
        // Both schemes are special, so this can't be refused.
        let _ = parsed.set_scheme("https");
    }
    let host = parsed.host_str().unwrap_or("").to_lowercase();
    let bare = host.strip_prefix("www.").unwrap_or(&host).to_owned();
    if parsed.host_str() != Some(bare.as_str()) && !parsed.cannot_be_a_base() {
        // A refused host leaves the address as it was, as JavaScript's setter does.
        let _ = parsed.set_host(Some(&bare));
    }
    // JavaScript rewrites the query only when a parameter is deleted, so an untouched one keeps its
    // own encoding.
    let pairs: Vec<(String, String)> = parsed.query_pairs().into_owned().collect();
    if pairs.iter().any(|(key, _)| TRACKING.is_match(key)) {
        let kept: Vec<_> = pairs.into_iter().filter(|(key, _)| !TRACKING.is_match(key)).collect();
        if kept.is_empty() {
            parsed.set_query(None);
        } else {
            parsed.query_pairs_mut().clear().extend_pairs(kept);
        }
    }
    let href = parsed.as_str();
    let href = href.strip_suffix('/').unwrap_or(href);
    Some(href.replacen("/?", "?", 1))
}

fn site(url: &str) -> String {
    Url::parse(url).ok().and_then(|parsed| parsed.host_str().map(str::to_owned)).unwrap_or_default()
}

struct Loop {
    key: String,
    text: String,
}

/// Counts in the order each key first came.
#[derive(Default)]
struct Tally<T> {
    entries: Vec<(String, T)>,
    index: HashMap<String, usize>,
}

impl<T: Default> Tally<T> {
    fn entry(&mut self, key: &str) -> &mut T {
        let at = *self.index.entry(key.to_owned()).or_insert_with(|| {
            self.entries.push((key.to_owned(), T::default()));
            self.entries.len() - 1
        });
        &mut self.entries[at].1
    }
}

#[derive(Default)]
struct CallTally {
    count: usize,
    failures: usize,
    name: String,
}

fn loops(calls: &[Call]) -> Vec<Loop> {
    let mut found = Vec::new();
    let opened: Vec<String> = calls
        .iter()
        .filter(|call| OPENING.contains(&call.name.as_str()))
        .map(|call| address_of(&call.input))
        .filter(|url| !url.is_empty())
        .collect();
    // One address, three times in the run.
    let mut per_address = Tally::<usize>::default();
    for url in &opened {
        *per_address.entry(url) += 1;
    }
    for (url, count) in &per_address.entries {
        if *count >= REPEATS {
            found.push(Loop {
                key: format!("open:{url}"),
                text: format!("you have opened {url} {count} times in this run. Its content won't change by opening it again"),
            });
        }
    }
    // One call, the same input, three times or failing twice, in the last dozen.
    let recent = &calls[calls.len().saturating_sub(WINDOW)..];
    let mut per_call = Tally::<CallTally>::default();
    for call in recent {
        if OPENING.contains(&call.name.as_str()) && !address_of(&call.input).is_empty() {
            continue;
        }
        let key = format!("{}:{}", call.name, call.input.stringify());
        let entry = per_call.entry(&key);
        entry.count += 1;
        entry.name.clone_from(&call.name);
        if call.failed {
            entry.failures += 1;
        }
    }
    for (key, CallTally { count, failures, name }) in &per_call.entries {
        if *failures >= FAILURES {
            found.push(Loop {
                key: format!("failed:{key}"),
                text: format!("{name} with the same input has failed {failures} times in your last {WINDOW} steps. It will fail the same way again"),
            });
        } else if *count >= REPEATS {
            found.push(Loop {
                key: key.clone(),
                text: format!("you have called {name} with the same input {count} times in your last {WINDOW} steps without moving on. Repeating it won't change the result"),
            });
        }
    }
    // Most of the last pages opened on one site.
    let latest = &opened[opened.len().saturating_sub(SITE_WINDOW)..];
    if latest.len() >= SITE_REPEATS {
        let mut per_site = Tally::<usize>::default();
        for url in latest {
            *per_site.entry(&site(url)) += 1;
        }
        for (host, count) in &per_site.entries {
            if !host.is_empty() && !SEARCH_SITE.is_match(host) && *count >= SITE_REPEATS {
                found.push(Loop {
                    key: format!("site:{host}"),
                    text: format!("{count} of the last {} pages you opened are on {host}. If they aren't adding what is still missing, more pages there won't either", latest.len()),
                });
            }
        }
    }
    found
}

/// The note for a loop the run is in, once per pattern, or `None`.
pub(crate) fn loop_note(messages: &[Message]) -> Option<String> {
    for Loop { key, text } in loops(&all_calls(messages)) {
        let tag = format!("{MARKER} [{}]", js_prefix(&key, 160));
        if said(messages, &tag) {
            continue;
        }
        return Some(format!(
            "{tag}: {text}. Change approach: use the page itself (click through, search on the site, apply its filters), try another source, or record what you have, say plainly what is unconfirmed, and move to the next part or finish."
        ));
    }
    None
}

#[cfg(test)]
mod tests;
