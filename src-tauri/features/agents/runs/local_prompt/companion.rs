//! The cursor's part of a run's system prompt (`ai_cursor_companion.go`).
use crate::web_search::tool::WEB_SEARCH_TOOL;

use super::{request::RunRequest, teach::SKETCH_PROMPT};

// The cursor's voice and pointing rules (agent.entry.cursor).
const TEACH_PROMPT: &str = include_str!("companion_teach_prompt.txt");
// The map of Misty's own interface. src/features/agents/tutor/cursor/mistyGuide.test.ts names its controls.
const MISTY_GUIDE: &str = include_str!("companion_misty_guide.md");
const COMPANION_TURN: &str = include_str!("companion_turn.txt");
const WINDOW_CAPTURE: &str = "window1";

/// The guide goes on a turn about Misty itself: one whose captures show Misty's controls, or whose
/// request names Misty. Other apps' questions don't pay for it.
pub(super) fn misty_guide_section(request: &RunRequest) -> String {
    let about = request.prompt.to_lowercase().contains("misty") || request.display_captures.iter().any(|capture| capture.has_controls);
    if !about {
        return String::new();
    }
    format!("\n\n{}\n", MISTY_GUIDE.trim())
}

/// `tools` is the run's catalog, which decides how a screen question without captures is answered.
pub(super) fn companion_system_prompt(request: &RunRequest, tools: &[String]) -> String {
    let has = |name: &str| tools.iter().any(|tool| tool == name);
    let mut prompt = format!("\n{TEACH_PROMPT}\n{}\n{}", SKETCH_PROMPT.trim(), misty_guide_section(request));
    prompt.push_str(COMPANION_TURN);
    if !has(WEB_SEARCH_TOOL) {
        // Web search runs on the device's own search key; without one, pages are read with web_fetch alone.
        prompt = prompt.replacen("use web_search and web_fetch to answer", "use web_fetch to answer", 1);
    }
    if !request.display_captures.is_empty() {
        for capture in &request.display_captures {
            if capture.screen == WINDOW_CAPTURE {
                prompt.push_str("window1 is the window the person is working in, captured again at full resolution from the primary screen. Read small text from it, and point with :window1 when the element is clearer there.\n");
            }
        }
    } else if has("screen.look") {
        prompt.push_str("No display captures accompany this turn yet. For a question about what is on the user's screen, such as where something is or how to do something there, call screen_look first; Misty captures the screens and continues with them attached, so you can answer and point. Do not guess from old history or treat DOM as desktop pixels.\n");
    } else {
        prompt.push_str("No fresh desktop display captures accompany this turn. For a question about the current screen, explain that desktop context is unavailable and ask the user to use the main desktop companion or attach an image. Do not guess from old history or treat DOM as desktop pixels. Use [POINT:none].\n");
    }
    prompt.push_str("When the user asks for work, carry it through multiple steps, keep the user informed, verify results, and report completion or the precise blocker. Do not start unrelated work.\n");
    prompt
}

/// The cursor's voice, pointing and walkthrough rules for an outside engine's turn (Claude Code,
/// Codex and the like), with the screenshots it was handed as images, in order. Its reply's
/// [POINT] and [GUIDE] tags are read by the companion exactly as Misty's own runtime's are, so the
/// engine answers and points across every display. `captures` is each screenshot's name
/// (screen1, screen2, window1) with its width and height in pixels.
pub fn companion_engine_note(captures: &[(String, u32, u32)]) -> String {
    let mut note = format!("{}\n", TEACH_PROMPT.trim());
    if captures.is_empty() {
        note.push_str("No screenshots came with this turn. For a question about the user's screen, say you can't see it right now and use [POINT:none].\n");
        return note;
    }
    note.push_str("The images attached to this message are this turn's screenshots of the user's screens, in this order:\n");
    for (index, (screen, width, height)) in captures.iter().enumerate() {
        let what = if screen == WINDOW_CAPTURE {
            "the window the person is working in, at full resolution"
        } else if index == 0 {
            "the primary display"
        } else {
            "another display"
        };
        note.push_str(&format!("{}. {screen}: {width}x{height} pixels, {what}\n", index + 1));
    }
    note.push_str("Point in those pixels with the screenshot's name. Answer from the screenshots; don't edit files or run commands to answer a question about the screen.\n");
    note
}

#[cfg(test)]
mod engine_note_tests {
    use super::companion_engine_note;

    #[test]
    fn names_each_screenshot_in_order_with_its_size() {
        let note = companion_engine_note(&[
            ("screen1".into(), 1512, 982),
            ("screen2".into(), 1920, 1080),
            ("window1".into(), 1200, 800),
        ]);
        assert!(note.contains("[POINT:x,y:label:screenN]"));
        assert!(note.contains("1. screen1: 1512x982 pixels, the primary display"));
        assert!(note.contains("2. screen2: 1920x1080 pixels, another display"));
        assert!(note.contains("3. window1: 1200x800 pixels, the window the person is working in"));
    }

    #[test]
    fn without_screenshots_it_says_so_and_does_not_point() {
        assert!(companion_engine_note(&[]).contains("[POINT:none]"));
    }
}
