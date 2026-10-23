//! The page layer inside a tab's cross-origin frames (../browser_frames.rs): snapshots,
//! page text and waits include embedded widgets, such as a class schedule, a booking
//! calendar or a document editor, under the iframe that shows them. Each frame a snapshot
//! reads takes a slot, and its refs come from that slot's range (slot 1 is e1000001 and
//! up), so a step or skill on one of them runs in its frame (`frame_of`).
use super::{RUNTIME, WORLD};
use crate::infra::browser_frames::{self, Frame};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
};
use tauri::Webview;

/// Frames read per call, newest first, and how much each and all may add.
const MAX_FRAMES: usize = 6;
const FRAME_TREE_CHARS: usize = 6_000;
const FRAME_TREES_CHARS: usize = 16_000;
const FRAME_MARKDOWN_CHARS: usize = 40_000;
const FRAME_REFS: u64 = 300;
/// Refs of frame slot n start at n × REF_RANGE + 1; the top document's stay below.
pub(super) const REF_RANGE: u64 = 1_000_000;
const SLOTS: usize = 9;

/// What one frame showed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct FrameRead {
    pub url: String,
    pub text: String,
    /// Skills the frame's page offers, such as a rich-text editor.
    pub skills: Vec<Value>,
}

#[derive(Clone, Debug)]
struct Slot {
    frame: u64,
    document: String,
    used: u64,
}

/// Tab → its frame slots (index 0 is slot 1).
fn slots() -> &'static Mutex<HashMap<String, Vec<Option<Slot>>>> {
    static BY_TAB: OnceLock<Mutex<HashMap<String, Vec<Option<Slot>>>>> = OnceLock::new();
    BY_TAB.get_or_init(Mutex::default)
}

fn tick() -> u64 {
    static TICK: AtomicU64 = AtomicU64::new(1);
    TICK.fetch_add(1, Ordering::Relaxed)
}

/// The frame's slot in its tab: the one it had, a free one, or the least recently used.
fn slot_for(tab: &str, frame: u64) -> u64 {
    let Ok(mut all) = slots().lock() else {
        return 1;
    };
    let list = all
        .entry(tab.to_owned())
        .or_insert_with(|| vec![None; SLOTS]);
    let index = list
        .iter()
        .position(|slot| slot.as_ref().is_some_and(|slot| slot.frame == frame))
        .or_else(|| list.iter().position(Option::is_none))
        .unwrap_or_else(|| {
            (0..SLOTS)
                .min_by_key(|&index| list[index].as_ref().map_or(0, |slot| slot.used))
                .unwrap_or(0)
        });
    let document = list[index]
        .as_ref()
        .filter(|slot| slot.frame == frame)
        .map(|slot| slot.document.clone())
        .unwrap_or_default();
    list[index] = Some(Slot {
        frame,
        document,
        used: tick(),
    });
    index as u64 + 1
}

fn remember_document(tab: &str, slot: u64, document: &str) {
    let Ok(mut all) = slots().lock() else {
        return;
    };
    if let Some(Some(entry)) = all
        .get_mut(tab)
        .and_then(|list| list.get_mut(slot as usize - 1))
    {
        entry.document = document.to_owned();
    }
}

/// The frame a ref belongs to and the document id its steps must name; None for a ref of
/// the top document.
pub(super) fn frame_of(tab: &str, reference: &str) -> Option<(u64, String)> {
    let number: u64 = reference.strip_prefix('e')?.parse().ok()?;
    let slot = number / REF_RANGE;
    if slot == 0 {
        return None;
    }
    let all = slots().lock().ok()?;
    let entry = all.get(tab)?.get(slot as usize - 1)?.as_ref()?;
    Some((entry.frame, entry.document.clone()))
}

async fn call_in_frame(view: &Webview, frame: u64, operation: &str, args: Value) -> Option<Value> {
    let invocation = format!(
        "const args = {}; const page = globalThis.__mistyAgentPageV1;",
        serde_json::to_string(&args).ok()?
    );
    let operation = serde_json::to_string(operation).ok()?;
    // Tracking pixels and hidden frames say nothing a person can see.
    let body = format!(
        "{RUNTIME}\n{invocation}\nif (innerWidth < 80 || innerHeight < 40) return JSON.stringify({{ ok: false, hidden: true }});\nreturn JSON.stringify(await page.call({operation}, args));"
    );
    let raw =
        crate::infra::browser_content_world::evaluate_in_frame(view.clone(), WORLD, body, frame)
            .await
            .ok()?;
    serde_json::from_str::<Value>(&raw)
        .ok()
        .filter(|value| value["ok"] == true)
}

fn recent(mut frames: Vec<Frame>) -> Vec<Frame> {
    if frames.len() > MAX_FRAMES {
        frames.drain(..frames.len() - MAX_FRAMES);
    }
    frames
}

/// The frames' accessibility trees, with refs from each frame's range, in announcement order.
pub(super) async fn trees(view: &Webview) -> Vec<FrameRead> {
    read(view, "snapshot", "tree", FRAME_TREE_CHARS, true).await
}

/// The frames' page text as Markdown, for extraction.
pub(super) async fn markdown(view: &Webview) -> Vec<FrameRead> {
    read(view, "markdown", "markdown", FRAME_MARKDOWN_CHARS, false).await
}

async fn read(
    view: &Webview,
    operation: &str,
    field: &str,
    chars: usize,
    refs: bool,
) -> Vec<FrameRead> {
    let frames = recent(browser_frames::list(view).await);
    if frames.is_empty() {
        return Vec::new();
    }
    let tab = view.label().to_owned();
    let reads = frames.iter().map(|frame| {
        let slot = refs.then(|| slot_for(&tab, frame.id));
        let mut args = json!({"candidateId": uuid::Uuid::new_v4().to_string(), "maxChars": chars, "maxRefs": 0});
        if let Some(slot) = slot {
            args["maxRefs"] = json!(FRAME_REFS);
            args["refBase"] = json!(slot * REF_RANGE + 1);
        }
        let tab = tab.clone();
        async move {
            let value = call_in_frame(view, frame.id, operation, args).await?;
            if let (Some(slot), Some(document)) = (slot, value["documentId"].as_str()) {
                remember_document(&tab, slot, document);
            }
            let text = value[field].as_str()?.trim().to_owned();
            (!text.is_empty() && !text.contains("(the page shows no readable content)")).then(
                || FrameRead {
                    url: value["url"].as_str().unwrap_or(&frame.url).to_owned(),
                    text,
                    skills: value["skills"].as_array().cloned().unwrap_or_default(),
                },
            )
        }
    });
    let mut out: Vec<FrameRead> = Vec::new();
    for read in futures_util::future::join_all(reads)
        .await
        .into_iter()
        .flatten()
    {
        // A frame that navigated may have announced twice; its content counts once.
        if !out.iter().any(|seen| seen.text == read.text) {
            out.push(read);
        }
    }
    out
}

/// Whether any frame shows `text` now, for waits on content inside a widget.
pub(super) async fn shows(view: &Webview, condition: &Value) -> bool {
    let frames = recent(browser_frames::list(view).await);
    let checks = frames
        .iter()
        .map(|frame| call_in_frame(view, frame.id, "waitCheck", condition.clone()));
    futures_util::future::join_all(checks)
        .await
        .into_iter()
        .flatten()
        .any(|check| check["met"] == true)
}

/// A frame's address as the tree shows it: without its fragment (some apps pack their whole
/// configuration there) and at most 200 characters.
fn shown_url(url: &str) -> String {
    let mut shown = url::Url::parse(url)
        .map(|mut url| {
            url.set_fragment(None);
            url.to_string()
        })
        .unwrap_or_else(|_| url.to_owned());
    if shown.len() > 200 {
        shown = format!("{}…", clip(&shown, 200));
    }
    shown
}

fn origin(url: &str) -> String {
    url::Url::parse(url)
        .map(|url| url.origin().ascii_serialization())
        .unwrap_or_default()
}

fn clip(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// Puts each frame's tree under the iframe line that shows it, matching by origin and
/// then by order; frames no line claims go at the end. Frames add at most
/// FRAME_TREES_CHARS in all.
pub(super) fn splice_trees(tree: &str, frames: &[FrameRead]) -> String {
    let mut used = vec![false; frames.len()];
    let mut budget = FRAME_TREES_CHARS;
    let mut out: Vec<String> = Vec::new();
    let take = |index: usize, used: &mut Vec<bool>, budget: &mut usize| -> Option<String> {
        used[index] = true;
        if *budget == 0 {
            return None;
        }
        let text = clip(&frames[index].text, (*budget).min(FRAME_TREE_CHARS)).to_owned();
        *budget = budget.saturating_sub(text.len());
        Some(text)
    };
    let indent_lines = |text: &str, indent: &str| -> Vec<String> {
        text.lines()
            .map(|line| format!("{indent}  {line}"))
            .collect()
    };
    for line in tree.lines() {
        let trimmed = line.trim_start();
        let is_frame = trimmed.starts_with("- iframe") && trimmed.contains("[cross-origin");
        if !is_frame {
            out.push(line.to_owned());
            continue;
        }
        let shown = line
            .split("[cross-origin ")
            .nth(1)
            .and_then(|rest| rest.split(']').next())
            .unwrap_or("")
            .to_owned();
        let pick = frames
            .iter()
            .enumerate()
            .position(|(index, frame)| {
                !used[index] && !shown.is_empty() && origin(&frame.url) == shown
            })
            .or_else(|| {
                (shown.is_empty())
                    .then(|| used.iter().position(|taken| !taken))
                    .flatten()
            });
        let indent = &line[..line.len() - trimmed.len()];
        match pick.and_then(|index| take(index, &mut used, &mut budget).map(|text| (index, text))) {
            Some((index, text)) => {
                let head = line.trim_end_matches(':');
                out.push(format!("{head} [url={}]:", shown_url(&frames[index].url)));
                out.extend(indent_lines(&text, indent));
            }
            None => out.push(line.to_owned()),
        }
    }
    for index in 0..frames.len() {
        if used[index] {
            continue;
        }
        if let Some(text) = take(index, &mut used, &mut budget) {
            out.push(format!(
                "- iframe [cross-origin {}] [url={}]:",
                origin(&frames[index].url),
                shown_url(&frames[index].url)
            ));
            out.extend(indent_lines(&text, ""));
        }
    }
    out.join("\n")
}

/// The top document's skills followed by the frames' that it lacks.
pub(super) fn merge_skills(skills: &Value, frames: &[FrameRead]) -> Value {
    let mut merged = skills.as_array().cloned().unwrap_or_default();
    for skill in frames.iter().flat_map(|frame| frame.skills.iter()) {
        if !merged.iter().any(|seen| seen["id"] == skill["id"]) {
            merged.push(skill.clone());
        }
    }
    json!(merged)
}

/// The page's Markdown followed by each frame's, labeled with where it comes from.
pub(super) fn append_markdown(markdown: &str, frames: &[FrameRead]) -> String {
    let mut out = markdown.to_owned();
    for frame in frames {
        out.push_str(&format!(
            "\n\n---\nEmbedded frame from {}:\n\n{}",
            frame.url, frame.text
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(url: &str, text: &str) -> FrameRead {
        FrameRead {
            url: url.into(),
            text: text.into(),
            skills: Vec::new(),
        }
    }

    #[test]
    fn frames_land_under_the_iframe_that_shows_them() {
        let tree =
            "- heading \"Class Schedule\"\n  - iframe [cross-origin]\n- link \"Contact\" [ref=e4]";
        let spliced = splice_trees(
            tree,
            &[read(
                "https://studio.marianaiframes.com/schedule",
                "- button \"Lotus Room\" [ref=e1000001]",
            )],
        );
        assert_eq!(
            spliced,
            "- heading \"Class Schedule\"\n  - iframe [cross-origin] [url=https://studio.marianaiframes.com/schedule]:\n    - button \"Lotus Room\" [ref=e1000001]\n- link \"Contact\" [ref=e4]"
        );
    }

    #[test]
    fn origins_match_before_order_and_strays_go_last() {
        let tree = "- iframe \"Map\" [cross-origin https://maps.example]\n- iframe \"Book\" [cross-origin https://book.example]";
        let frames = [
            read("https://book.example/widget", "- text: Tuesday 7 PM"),
            read("https://maps.example/embed", "- text: 12 Main St"),
            read("https://ads.example/x", "- text: Sale"),
        ];
        let spliced = splice_trees(tree, &frames);
        let lines: Vec<_> = spliced.lines().collect();
        assert_eq!(lines[1], "  - text: 12 Main St");
        assert_eq!(lines[3], "  - text: Tuesday 7 PM");
        assert_eq!(
            lines[4],
            "- iframe [cross-origin https://ads.example] [url=https://ads.example/x]:"
        );
    }

    #[test]
    fn frames_add_a_bounded_amount() {
        let big = "- text: x\n".repeat(5_000);
        let frames = [
            read("https://a.example", &big),
            read("https://b.example", &big),
            read("https://c.example", &big),
        ];
        let spliced = splice_trees("- heading \"Page\"", &frames);
        // The budget counts frame text; indenting it under the iframe adds two characters a line.
        assert!(
            spliced.len() < FRAME_TREES_CHARS * 13 / 10,
            "{}",
            spliced.len()
        );
        assert!(append_markdown("# Page", &frames[..1])
            .contains("Embedded frame from https://a.example"));
        assert_eq!(
            shown_url("https://sandbox.example/pad/inner.html?ver=2#%7B%22cfg%22"),
            "https://sandbox.example/pad/inner.html?ver=2"
        );
    }

    #[test]
    fn refs_route_to_their_frame_slot() {
        let tab = "misty-browser-test-routing";
        let first = slot_for(tab, 41);
        let second = slot_for(tab, 42);
        assert_eq!((first, second), (1, 2));
        assert_eq!(slot_for(tab, 41), 1, "a frame keeps its slot");
        remember_document(tab, 2, "doc-42");
        assert_eq!(frame_of(tab, "e2000007"), Some((42, "doc-42".into())));
        assert_eq!(frame_of(tab, "e17"), None, "top-document refs stay put");
        assert_eq!(
            frame_of(tab, "e5000001"),
            None,
            "an empty slot routes nowhere"
        );
        let skills = merge_skills(
            &json!([{"id": "grid"}]),
            &[FrameRead {
                skills: vec![json!({"id": "editor"}), json!({"id": "grid"})],
                ..read("https://pad.example", "- text: x")
            }],
        );
        assert_eq!(skills, json!([{"id": "grid"}, {"id": "editor"}]));
    }
}
