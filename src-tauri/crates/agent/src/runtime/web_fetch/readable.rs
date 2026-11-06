//! Readable text from a fetched page, for `web.fetch` (docs/agents/harness.md, Reading without a
//! screen). Navigation, scripts and page chrome are dropped; every other visible text becomes one
//! plain line per block (headings and list items keep their Markdown marks, table rows join their
//! cells with "|"), so prices that sit in plain divs and spans, as on most pricing pages, are kept. A
//! long page returns the parts that best match what the agent asked for, in page order.
use std::{
    collections::{BTreeSet, HashSet},
    fmt,
    sync::LazyLock,
};

use regex::Regex;

use crate::runtime::{
    js_regex::js_regex,
    text::{js_len, js_prefix, js_trim},
};

use super::html_tree::{NodeKind, Page};

/// How much text a page returns unless the caller says otherwise.
pub(crate) const READABLE_LIMIT: usize = 15_000;

fn is_block(name: &str) -> bool {
    matches!(
        name,
        "address" | "article" | "blockquote" | "br" | "button" | "caption" | "dd" | "details" | "div" | "dl" | "dt" | "fieldset" | "figcaption" | "figure" | "form" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "hr" | "label" | "legend" | "li" | "main" | "ol" | "p" | "pre" | "section" | "summary" | "table" | "tbody" | "thead" | "tr" | "ul"
    )
}

static SPACES: LazyLock<Regex> = LazyLock::new(|| js_regex(r"\s+", false));
static TRAILING_PIPES: LazyLock<Regex> = LazyLock::new(|| js_regex(r"(\s*\|)+\s*$", false));
static ONLY_MARKS: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^[\s|\-–—•·]*$", false));
static HAS_PRICE: LazyLock<Regex> = LazyLock::new(|| js_regex(r"[$€£]\s?\d", false));
static NAMES_PERIOD: LazyLock<Regex> = LazyLock::new(|| js_regex(r"\b(annual(ly)?|yearly|per year|billed monthly|month-to-month|monthly)\b", true));
static SCRIPT_SHELL: LazyLock<Regex> = LazyLock::new(|| js_regex(r"enable javascript|javascript is (required|disabled)|requires javascript|please turn on javascript", true));
static WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\p{L}\p{N}]{3,}").expect("a fixed pattern compiles"));

/// Pricing pages draw one billing period (usually yearly) until a toggle is switched, and a fetch
/// can't switch it. When the text has prices and names a billing period, say so.
pub(crate) fn billing_note(text: &str) -> Option<&'static str> {
    if !HAS_PRICE.is_match(text) || !NAMES_PERIOD.is_match(text) {
        return None;
    }
    Some("Prices here show the billing period the page opens on (often yearly) and the page's monthly/yearly toggle cannot be switched by a fetch. State which period each price is for. To read the other period, call screen_open with this page's url, which opens your own tab in the background and keeps this run going, then switch the toggle with browser_steps.")
}

/// A page a fetch can't read: an error, a sign-in wall or a script-only shell with little text. The
/// agent's own browser tab can (docs/agents/evals/odysseys.md).
pub(crate) fn browser_note(status: u16, text: &str) -> Option<&'static str> {
    if status < 400 && js_len(&SPACES.replace_all(text, " ")) >= 600 && !SCRIPT_SHELL.is_match(text) {
        return None;
    }
    Some("This page did not give its content to a fetch (it needs a browser, an account or is blocked). To read or use it, call screen_open with this url: it opens your own browser tab in the background and this run keeps going with browser tools.")
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ReadablePage {
    pub(crate) title: String,
    pub(crate) text: String,
    /// Text was left out: the page was longer than the limit.
    pub(crate) truncated: bool,
}

/// Why a page couldn't be read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReadableError {
    /// Nothing in the page is an element, once scripts and chrome are gone.
    NoDocumentElement,
}

impl fmt::Display for ReadableError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("the page has no document element")
    }
}

impl std::error::Error for ReadableError {}

#[derive(Default)]
struct Lines {
    out: Vec<String>,
    buffer: String,
    prefix: String,
}

impl Lines {
    fn flush(&mut self) {
        let collapsed = SPACES.replace_all(&self.buffer, " ");
        let stripped = TRAILING_PIPES.replace(&collapsed, "");
        let text = js_trim(&stripped);
        let prefix = std::mem::take(&mut self.prefix);
        if !text.is_empty() && !ONLY_MARKS.is_match(text) {
            let line = format!("{prefix}{text}");
            if self.out.last() != Some(&line) {
                self.out.push(line);
            }
        }
        self.buffer.clear();
    }
}

enum Step {
    Enter(usize),
    /// Leaving an element: whether it's a table cell, and whether it's a block.
    Leave { cell: bool, block: bool },
}

fn lines(page: &Page, root: Option<usize>) -> Vec<String> {
    let mut state = Lines::default();
    // A list of steps rather than recursion: a hostile page can nest deeper than the stack goes.
    let mut steps: Vec<Step> = root.into_iter().map(Step::Enter).collect();
    while let Some(step) = steps.pop() {
        match step {
            Step::Leave { cell, block } => {
                if cell {
                    state.buffer.push_str(" | ");
                }
                if block {
                    state.flush();
                }
            }
            Step::Enter(id) => match &page.nodes[id].kind {
                NodeKind::Text(text) => state.buffer.push_str(text),
                NodeKind::Document => {}
                NodeKind::Element(element) => {
                    // Text a script hides from view but keeps for screen readers (prices drawn by a counter)
                    // lives in a sibling that stays; the drawn copy is the one marked aria-hidden.
                    if element.aria_hidden {
                        continue;
                    }
                    let name = element.name.as_str();
                    let block = is_block(name);
                    if block {
                        state.flush();
                        if let Some(level) = heading_level(name) {
                            state.prefix = format!("{} ", "#".repeat(level));
                        } else if name == "li" {
                            state.prefix = "- ".to_owned();
                        }
                    }
                    steps.push(Step::Leave { cell: name == "td" || name == "th", block });
                    steps.extend(page.children(id).rev().map(Step::Enter));
                }
            },
        }
    }
    state.out
}

fn heading_level(name: &str) -> Option<usize> {
    match name.as_bytes() {
        [b'h', digit @ b'1'..=b'6'] => Some(usize::from(digit - b'0')),
        _ => None,
    }
}

fn words(text: &str) -> HashSet<String> {
    let lower = text.to_lowercase();
    WORD.find_iter(&lower).map(|found| found.as_str().to_owned()).collect()
}

/// The lines that best answer `question`, kept in page order, within `limit` characters.
fn relevant(all: &[String], question: &str, limit: usize) -> Vec<String> {
    let wanted = words(question);
    let mut scored: Vec<(usize, f64)> = all
        .iter()
        .enumerate()
        .map(|(index, line)| {
            let score = words(line).iter().filter(|word| wanted.contains(*word)).count() as f64;
            // Headings carry the context of the lines under them.
            (index, if line.starts_with('#') { score + 0.5 } else { score })
        })
        .collect();
    scored.sort_by(|left, right| right.1.total_cmp(&left.1).then(left.0.cmp(&right.0)));
    let mut keep = BTreeSet::new();
    let mut size = 0;
    for (index, score) in scored {
        if score <= 0.0 || size >= limit {
            break;
        }
        for neighbour in [index.checked_sub(1), Some(index), Some(index + 1)].into_iter().flatten() {
            let Some(line) = all.get(neighbour) else {
                continue;
            };
            if keep.insert(neighbour) {
                size += js_len(line) + 1;
            }
        }
    }
    keep.into_iter().map(|index| all[index].clone()).collect()
}

/// The collapsed length of a node's text, as the size of an area on the page.
fn size(page: &Page, id: Option<usize>) -> usize {
    id.map_or(0, |id| js_len(&SPACES.replace_all(&page.text_content(id), " ")))
}

pub(crate) fn readable_page(html: &str, content_type: &str, question: &str, limit: usize) -> Result<ReadablePage, ReadableError> {
    if !(content_type.contains("html") || content_type.contains("xml") || content_type.is_empty()) {
        let text = js_trim(html);
        return Ok(ReadablePage { title: String::new(), text: js_prefix(text, limit).to_owned(), truncated: js_len(text) > limit });
    }
    let mut page = Page::parse(html);
    page.remove_dropped();
    let document = page.document_element().ok_or(ReadableError::NoDocumentElement)?;
    let body = page.body(document);
    // The page's main area, unless it holds only a small part of the text (pricing cards often
    // sit beside it, in plain sections).
    let main = page.main_area().filter(|main| size(&page, Some(*main)) as f64 >= size(&page, body) as f64 * 0.6);
    let all = lines(&page, main.or(body));
    let title = js_trim(&page.title(document)).to_owned();
    let full = all.join("\n");
    if js_len(&full) <= limit {
        return Ok(ReadablePage { title, text: full, truncated: false });
    }
    let picked = if js_trim(question).is_empty() { Vec::new() } else { relevant(&all, question, limit) };
    let text = if picked.is_empty() { full } else { picked.join("\n") };
    Ok(ReadablePage { title, text: js_prefix(&text, limit).to_owned(), truncated: true })
}

/// The plain entry point for a page with no question. Its address plays no part, as it never did in
/// the TypeScript; it's here for the confined worker this moves to, which reads one page by address.
pub(crate) fn readable_text(html: &str, _url: &str) -> Result<ReadablePage, ReadableError> {
    readable_page(html, "text/html", "", READABLE_LIMIT)
}

#[cfg(test)]
#[path = "readable_tests.rs"]
mod tests;
