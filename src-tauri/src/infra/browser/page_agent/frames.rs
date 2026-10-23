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

mod splice;
pub(super) use splice::{append_markdown, merge_skills, splice_trees};
#[cfg(test)]
use splice::shown_url;

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

#[cfg(test)]
mod tests;
