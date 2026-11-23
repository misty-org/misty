use std::{
    collections::{BTreeSet, HashSet},
    fmt,
    sync::LazyLock,
};

use regex::Regex;

use crate::{
    html_tree::{NodeKind, Page},
    js_regex::js_regex,
    text::{js_len, js_prefix, js_trim},
};

pub const READABLE_LIMIT: usize = 15_000;

fn is_block(name: &str) -> bool {
    matches!(
        name,
        "address"
            | "article"
            | "blockquote"
            | "br"
            | "button"
            | "caption"
            | "dd"
            | "details"
            | "div"
            | "dl"
            | "dt"
            | "fieldset"
            | "figcaption"
            | "figure"
            | "form"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "hr"
            | "label"
            | "legend"
            | "li"
            | "main"
            | "ol"
            | "p"
            | "pre"
            | "section"
            | "summary"
            | "table"
            | "tbody"
            | "thead"
            | "tr"
            | "ul"
    )
}

static SPACES: LazyLock<Regex> = LazyLock::new(|| js_regex(r"\s+", false));
static TRAILING_PIPES: LazyLock<Regex> = LazyLock::new(|| js_regex(r"(\s*\|)+\s*$", false));
static ONLY_MARKS: LazyLock<Regex> = LazyLock::new(|| js_regex(r"^[\s|\-–—•·]*$", false));
static HAS_PRICE: LazyLock<Regex> = LazyLock::new(|| js_regex(r"[$€£]\s?\d", false));
static NAMES_PERIOD: LazyLock<Regex> = LazyLock::new(|| {
    js_regex(
        r"\b(annual(ly)?|yearly|per year|billed monthly|month-to-month|monthly)\b",
        true,
    )
});
static SCRIPT_SHELL: LazyLock<Regex> = LazyLock::new(|| {
    js_regex(
        r"enable javascript|javascript is (required|disabled)|requires javascript|please turn on javascript",
        true,
    )
});
static WORD: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[\p{L}\p{N}]{3,}").expect("a fixed pattern compiles"));

pub fn billing_note(text: &str) -> Option<&'static str> {
    if !HAS_PRICE.is_match(text) || !NAMES_PERIOD.is_match(text) {
        return None;
    }
    Some("Prices here show the billing period the page opens on (often yearly) and the page's monthly/yearly toggle cannot be switched by a fetch. State which period each price is for. To read the other period, call screen_open with this page's url, which opens your own tab in the background and keeps this run going, then switch the toggle with browser_steps.")
}

pub fn browser_note(status: u16, text: &str) -> Option<&'static str> {
    if status < 400 && js_len(&SPACES.replace_all(text, " ")) >= 600 && !SCRIPT_SHELL.is_match(text)
    {
        return None;
    }
    Some("This page did not give its content to a fetch (it needs a browser, an account or is blocked). To read or use it, call screen_open with this url: it opens your own browser tab in the background and this run keeps going with browser tools.")
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReadablePage {
    pub title: String,
    pub text: String,
    pub truncated: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReadableError {
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
    Leave { cell: bool, block: bool },
}

fn lines(page: &Page, root: Option<usize>) -> Vec<String> {
    let mut state = Lines::default();
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
                    steps.push(Step::Leave {
                        cell: name == "td" || name == "th",
                        block,
                    });
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
    WORD.find_iter(&lower)
        .map(|found| found.as_str().to_owned())
        .collect()
}

fn relevant(all: &[String], question: &str, limit: usize) -> Vec<String> {
    let wanted = words(question);
    let mut scored: Vec<(usize, f64)> = all
        .iter()
        .enumerate()
        .map(|(index, line)| {
            let score = words(line)
                .iter()
                .filter(|word| wanted.contains(*word))
                .count() as f64;
            (
                index,
                if line.starts_with('#') {
                    score + 0.5
                } else {
                    score
                },
            )
        })
        .collect();
    scored.sort_by(|left, right| right.1.total_cmp(&left.1).then(left.0.cmp(&right.0)));
    let mut keep = BTreeSet::new();
    let mut size = 0;
    for (index, score) in scored {
        if score <= 0.0 || size >= limit {
            break;
        }
        for neighbour in [index.checked_sub(1), Some(index), Some(index + 1)]
            .into_iter()
            .flatten()
        {
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

fn size(page: &Page, id: Option<usize>) -> usize {
    id.map_or(0, |id| {
        js_len(&SPACES.replace_all(&page.text_content(id), " "))
    })
}

pub fn readable_page(
    html: &str,
    content_type: &str,
    question: &str,
    limit: usize,
) -> Result<ReadablePage, ReadableError> {
    if !(content_type.contains("html") || content_type.contains("xml") || content_type.is_empty()) {
        let text = js_trim(html);
        return Ok(ReadablePage {
            title: String::new(),
            text: js_prefix(text, limit).to_owned(),
            truncated: js_len(text) > limit,
        });
    }
    let mut page = Page::parse(html);
    page.remove_dropped();
    let document = page
        .document_element()
        .ok_or(ReadableError::NoDocumentElement)?;
    let body = page.body(document);
    let main = page
        .main_area()
        .filter(|main| size(&page, Some(*main)) as f64 >= size(&page, body) as f64 * 0.6);
    let all = lines(&page, main.or(body));
    let title = js_trim(&page.title(document)).to_owned();
    let full = all.join("\n");
    if js_len(&full) <= limit {
        return Ok(ReadablePage {
            title,
            text: full,
            truncated: false,
        });
    }
    let picked = if js_trim(question).is_empty() {
        Vec::new()
    } else {
        relevant(&all, question, limit)
    };
    let text = if picked.is_empty() {
        full
    } else {
        picked.join("\n")
    };
    Ok(ReadablePage {
        title,
        text: js_prefix(&text, limit).to_owned(),
        truncated: true,
    })
}

#[cfg(test)]
#[path = "readable_tests.rs"]
mod tests;
