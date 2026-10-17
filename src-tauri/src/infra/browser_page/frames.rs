//! The page layer inside a tab's cross-origin frames (../browser_frames.rs): snapshots,
//! page text and waits include embedded widgets, such as a class schedule or a booking
//! calendar, under the iframe that shows them. Frame content is read-only here: refs act
//! on the top document, and browser_act reaches into frames with real input.
use super::{RUNTIME, WORLD};
use crate::infra::browser_frames::{self, Frame};
use serde_json::{json, Value};
use tauri::Webview;

/// Frames read per call, newest first, and how much each and all may add.
const MAX_FRAMES: usize = 6;
const FRAME_TREE_CHARS: usize = 6_000;
const FRAME_TREES_CHARS: usize = 16_000;
const FRAME_MARKDOWN_CHARS: usize = 40_000;
/// Frame content has no refs yet; real input through browser_act reaches it.
const READ_ONLY: &str = "[no refs inside: click it with browser_act]";

/// What one frame showed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct FrameRead {
    pub url: String,
    pub text: String,
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

/// The frames' accessibility trees, without refs, in announcement order.
pub(super) async fn trees(view: &Webview) -> Vec<FrameRead> {
    read(view, "snapshot", "tree", FRAME_TREE_CHARS).await
}

/// The frames' page text as Markdown, for extraction.
pub(super) async fn markdown(view: &Webview) -> Vec<FrameRead> {
    read(view, "markdown", "markdown", FRAME_MARKDOWN_CHARS).await
}

async fn read(view: &Webview, operation: &str, field: &str, chars: usize) -> Vec<FrameRead> {
    let frames = recent(browser_frames::list(view).await);
    if frames.is_empty() {
        return Vec::new();
    }
    let reads = frames.iter().map(|frame| {
        let args = json!({"candidateId": uuid::Uuid::new_v4().to_string(), "maxChars": chars, "maxRefs": 0});
        async move {
            let value = call_in_frame(view, frame.id, operation, args).await?;
            let text = value[field].as_str()?.trim().to_owned();
            (!text.is_empty() && !text.contains("(the page shows no readable content)")).then(|| FrameRead {
                url: value["url"].as_str().unwrap_or(&frame.url).to_owned(),
                text,
            })
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
    let mut take = |index: usize, used: &mut Vec<bool>, budget: &mut usize| -> Option<String> {
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
                out.push(format!("{head} [url={}] {READ_ONLY}:", frames[index].url));
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
                "- iframe [cross-origin {}] [url={}] {READ_ONLY}:",
                origin(&frames[index].url),
                frames[index].url
            ));
            out.extend(indent_lines(&text, ""));
        }
    }
    out.join("\n")
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
                "- text: 6:00 AM Hot Flow",
            )],
        );
        assert_eq!(
            spliced,
            "- heading \"Class Schedule\"\n  - iframe [cross-origin] [url=https://studio.marianaiframes.com/schedule] [no refs inside: click it with browser_act]:\n    - text: 6:00 AM Hot Flow\n- link \"Contact\" [ref=e4]"
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
        assert_eq!(lines[4], "- iframe [cross-origin https://ads.example] [url=https://ads.example/x] [no refs inside: click it with browser_act]:");
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
    }
}
