//! Placing what frames show into the top document's tree, skills and Markdown.
use super::*;

/// A frame's address as the tree shows it: without its fragment (some apps pack their whole
/// configuration there) and at most 200 characters.
pub(super) fn shown_url(url: &str) -> String {
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
pub(in crate::infra::browser::page_agent) fn splice_trees(
    tree: &str,
    frames: &[FrameRead],
) -> String {
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
pub(in crate::infra::browser::page_agent) fn merge_skills(
    skills: &Value,
    frames: &[FrameRead],
) -> Value {
    let mut merged = skills.as_array().cloned().unwrap_or_default();
    for skill in frames.iter().flat_map(|frame| frame.skills.iter()) {
        if !merged.iter().any(|seen| seen["id"] == skill["id"]) {
            merged.push(skill.clone());
        }
    }
    json!(merged)
}

/// The page's Markdown followed by each frame's, labeled with where it comes from.
pub(in crate::infra::browser::page_agent) fn append_markdown(
    markdown: &str,
    frames: &[FrameRead],
) -> String {
    let mut out = markdown.to_owned();
    for frame in frames {
        out.push_str(&format!(
            "\n\n---\nEmbedded frame from {}:\n\n{}",
            frame.url, frame.text
        ));
    }
    out
}
