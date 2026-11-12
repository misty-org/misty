// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/fork/anchor.rs.
//! Fork anchor: locating which turn the person clicked, and that message's source line.
//!
//! The anchor's identity is a digest of the user message: assistant rows are split by
//! `claude_flush_text`, so the frontend's text and the backend row's text aren't guaranteed equal.

use super::*;
/// The fork point of a mid-conversation fork, located by that turn's user message.
///
/// Why not the clicked message's own text: `fold_rows` splits one assistant record into several
/// rows via `claude_flush_text` (accumulated text is flushed on its own before a thinking or
/// tool_use block), so the frontend's segment and the backend row aren't guaranteed equal. A user
/// turn has no such blocks: one `user` record maps to exactly one row with identical text.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkAnchor {
    /// SHA-256 hex of the turn's user message as stored (the store's `message.text`, not the
    /// display-stripped text).
    pub user_text_sha256: String,
    /// The turn's user message seq; used only to break ties when the text matches several places, never authoritative.
    ///
    /// It is numbered locally by the frontend, a different source from the backend's seq renumbered in
    /// parse order: the frontend inserts plan reviews and question cards into `messages` with a seq of
    /// their own, while the parser emits no message for them. With several identical messages in a row, a
    /// drift of one or two shifts "the middle one" to the next. So `tail_occurrence` below wins; this is only a fallback.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seq_hint: Option<i64>,
    /// How many user messages with exactly the same text follow this one (counted from the end, 0 =
    /// the last one).
    ///
    /// Why it beats `seq_hint`: it depends only on the order the same text appears in, not on any numbering,
    /// so seq drift on either side doesn't affect it. And the frontend's window is always the transcript's
    /// tail (history paging prepends pages; `load-earlier` only prepends), so "how many follow" agrees on
    /// both sides, even with only the latest pages loaded.
    ///
    /// It assumes the view reflects what is on disk: if another client (the CLI in a terminal, another
    /// window) appended a message with the same text before the view refreshed, the backend counts more,
    /// picks a newer one, and the branch carries extra turns. A known limit, not guessed around here.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tail_occurrence: Option<u32>,
}


/// Lowercase SHA-256 hex of the text. Must match the frontend's `src/lib/sha256.ts` byte for byte:
/// the frontend hashes the stored text of that user message, and the backend uses the same digest to
/// find it in the transcript. Each side has its own implementation (the frontend can't rely on
/// `crypto.subtle`, since LAN HTTP isn't a secure context), so a test pins the value for CJK text.
pub fn text_sha256_hex(text: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(text.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}


/// The index of the anchor's hit in `parsed`: role user with the same text digest; with several hits the
/// nearest to `seq_hint`, and without a hint the last one (the latest turn).
///
/// Shared by both engines: their cut algorithms differ on purpose (Claude cuts at the next user row, Codex
/// at a turn boundary), but "which message is the anchor" must have one criterion; the turn number comes
/// from here through `anchor_turn`, and both cut functions only consume that number.
///
/// Distance uses `abs_diff`, not `(a - b).abs()`: `seq_hint` comes from the frontend and is unconstrained,
/// so an extreme like `i64::MIN` overflows `i64 - i64`, panicking in dev/test and wrapping to the wrong
/// duplicate turn in release.
///
/// Digests are compared lowercased: the shape check allows uppercase hex while `text_sha256_hex` only
/// produces lowercase, and without folding the caller's spelling would surface as "couldn't find the turn
/// in the transcript", blaming the transcript.
pub(super) fn anchor_hit_index(parsed: &[crate::engines::history::Message], anchor: &ForkAnchor) -> Option<usize> {
    let wanted = anchor.user_text_sha256.to_ascii_lowercase();
    let matches: Vec<usize> = parsed
        .iter()
        .enumerate()
        .filter(|(_, m)| m.role == "user" && text_sha256_hex(&m.text) == wanted)
        .map(|(i, _)| i)
        .collect();
    let hit = match matches.as_slice() {
        [] => None,
        [only] => Some(*only),
        many => {
            // First choice: the same-text index counted from the end (0 = last). It depends only on the order the
            // same text appears in, not on either side's seq, so frontend seq drift can't move it: with several
            // "continue" messages in a row, clicking the middle one no longer picks the last. The frontend window
            // is always the transcript's tail, so the index agrees on both sides (see the field's notes for limits).
            let by_tail = anchor
                .tail_occurrence
                .map(|tail| tail as usize)
                .filter(|tail| *tail < many.len())
                .map(|tail| many[many.len() - 1 - tail]);
            // Fallback: an older frontend without tail_occurrence picks the nearest seq (the earlier one on a tie).
            by_tail.or_else(|| match anchor.seq_hint {
                // `min_by_key` keeps the first minimum: on a tie the earlier one (parse order) stays, matching
                // nearest-wins and making the cut stable for the same input.
                Some(hint) => Some(
                    many.iter()
                        .copied()
                        .min_by_key(|i| parsed[*i].seq.abs_diff(hint))
                        .unwrap_or(many[many.len() - 1]),
                ),
                None => Some(many[many.len() - 1]),
            })
        }
    };
    log_anchor_drift(parsed, anchor, hit, &matches);
    hit
}

/// An observability probe for tie-breaking: one line per fork, to measure the drift between the
/// frontend's seq and the backend's parsed seq.
///
/// Why it exists: `seq_hint` is accumulated locally by the frontend (`session-utils.ts`'s
/// `seq: lastSeq + 1 + i`), while here the backend renumbers in parse order. They line up only when
/// history loads (it brings back the backend's seq via `reader.rs`), then drift apart: the frontend inserts
/// plan reviews and question cards into `messages` with a seq of their own, and the parser emits nothing for them.
///
/// How to read the line (important: `drift` is relative to the chosen message, not the true drift):
///
/// Say two messages with the same text have backend seqs `P1 < P2`, gap `G = P2-P1`, true drift `d = hint - P_intended`
/// (`P_intended` is the one the person clicked). The rule is "smallest distance, earlier on a tie", so:
///
/// | The person clicked | Picks the other one when | The log shows |
/// |---|---|---|
/// | `P1` (earlier) | `d > G/2` (the frontend ran high past the midpoint) | `drift = d - G` (negative, `\\|drift\\| < G/2`) |
/// | `P2` (later) | `d < -G/2` (the frontend ran low past the midpoint) | `drift = d + G` (positive, `< G/2`) |
///
/// That is: it can cut wrong in both directions, and when it does, `|drift|` is always under `G/2`, so
/// "small drift" does not mean safe; it is exactly what a wrong cut looks like. The reliable reading is
/// where `hint` falls in `seqs=[...]`:
///   - `hint` right next to one candidate (`|drift| ≪ G`): almost certainly right;
///   - `|drift|` near `G/2` (especially `hint` midway between two candidates): possibly a coin flip;
///     review that sample by hand (read `hint` with `seqs`, against which turn the person clicked).
///   - with `hits=1` there is no ambiguity, and `drift` is a clean sample of the true drift (the data most
///     worth collecting): exactly how many seqs the frontend counted beyond the backend.
///
/// Logs only numbers and candidate seqs, never any user text.
fn log_anchor_drift(
    parsed: &[crate::engines::history::Message],
    anchor: &ForkAnchor,
    hit: Option<usize>,
    matches: &[usize],
) {
    // Candidate seqs come from a window around the hit: a short repeated prompt can hit six or more times in a
    // long session, and printing only the earliest could leave `parsed_seq` outside `seqs`, losing the gap.
    let seqs = {
        const WINDOW: usize = 6;
        let window: &[usize] = if matches.len() <= WINDOW {
            matches
        } else {
            let pos = hit
                .and_then(|h| matches.iter().position(|i| *i == h))
                .unwrap_or(matches.len() - 1);
            let start = pos.saturating_sub(WINDOW / 2).min(matches.len() - WINDOW);
            &matches[start..start + WINDOW]
        };
        window
            .iter()
            .map(|i| parsed[*i].seq.to_string())
            .collect::<Vec<_>>()
            .join(",")
    };
    let hits = matches.len();
    match (hit, anchor.seq_hint) {
        (Some(index), Some(hint)) => {
            let parsed_seq = parsed[index].seq;
            if hits > 1 {
                eprintln!(
                    "[fork][anchor] hits={hits} picked_by={} tail={:?} hint={hint} parsed_seq={parsed_seq} drift={} seqs=[{seqs}]",
                    if anchor.tail_occurrence.is_some() { "tail" } else { "seq" },
                    anchor.tail_occurrence,
                    hint.saturating_sub(parsed_seq)
                );
            } else {
                eprintln!(
                    "[fork][anchor] hits={hits} hint={hint} parsed_seq={parsed_seq} drift={}",
                    hint.saturating_sub(parsed_seq)
                );
            }
        }
        (Some(index), None) => eprintln!(
            "[fork][anchor] hits={hits} hint=- parsed_seq={} drift=-",
            parsed[index].seq
        ),
        (None, hint) => {
            eprintln!("[fork][anchor] hits={hits} hint={hint:?} hit=none")
        }
    }
}


/// The anchor turn's zero-based index: how many user messages come before the hit.
///
/// Every engine's cut function starts here (the hit rule is in `anchor_hit_index`); they differ only in
/// how they find the cut from this index: Claude takes the source line of user record `n+1`, Codex
/// looks forward from the anchor for the first turn-end marker (`task_complete` / `turn_aborted`), and
/// dsh for the first `turn/end`. This "which turn is the anchor" reasoning is written once: copied twice,
/// any change would split the engines' idea of "the same turn".
/// Visibility: `pub(crate)` so the sibling `fork_dsh` can reuse it (re-exported through `mod.rs`); keep it
/// inside the engine layer, and never start a second "which turn is the anchor" rule elsewhere.
pub(crate) fn anchor_turn(parsed: &[crate::engines::history::Message], anchor: &ForkAnchor) -> Option<usize> {
    let hit = anchor_hit_index(parsed, anchor)?;
    Some(parsed.iter().take(hit).filter(|m| m.role == "user").count())
}


/// The record-level cut of a mid-conversation fork: keep the first N records of the source file.
///
/// Meaning: the cut is the first line of the first user record after the anchor turn,
/// where that turn ends and the next begins. The branch includes the turn the person clicked
/// (clicking "Help me with a math problem" gives a branch with that turn and everything before it) and
/// nothing after it. Cutting at the next user row always lands on a whole-turn boundary: the first user
/// record after the anchor turn starts the next turn.
///
/// `None` means the anchor didn't match (the file changed outside, or the text doesn't match): the caller
/// must report an error, never fall back to "take the last one".
///
/// The cut may only come from the extractor's pipeline (`history::user_row_lines`: line numbers and
/// user messages from the same pass). A separate "nth user record" rule inevitably drifts from the
/// extractor: local command stdout, skill command envelopes and image-only turns are all counted
/// differently, shifting the cut by N turns, at worst into CLI chrome with no conversation in the
/// branch at all. Don't bring a second rule back.
pub(super) fn fork_keep_count(
    path: &Path,
    anchor: &ForkAnchor,
    parsed: &[crate::engines::history::Message],
    accepted_frames: &std::collections::HashSet<String>,
) -> Option<usize> {
    // Which user message the anchor turn is (rule in `anchor_turn`).
    let user_ordinal = anchor_turn(parsed, anchor)?;

    let file = std::fs::File::open(path).ok()?;
    let lines =
        crate::engines::history::user_row_lines("claude", std::io::BufReader::new(file), accepted_frames);
    // Cut at the line of the user record after the anchor turn: the branch includes the clicked turn
    // (the "math problem" turn and everything before it) instead of excluding it.
    // `user_row_lines` ends with a sentinel, so when the anchor is the last turn this gets the whole file.
    lines.get(user_ordinal + 1).copied()
}


/// Codex's record-level cut. Unlike Claude, Codex must cut at a whole-turn boundary: its turns are
/// wrapped by `event_msg`'s `task_started` … `task_complete`, and non-conversation records
/// (`turn_context` / `token_count`) are scattered inside them. Cutting at "the nth user record's line"
/// would land mid-turn and leave a turn with no end marker.
///
/// Two steps, each with exactly one criterion:
/// 1. Which line the anchor's user message is on, from `user_row_lines("codex", …)`, the same
///    extractor + `normalize_extracted_row` pipeline as `parse_session_file`.
///    Don't count raw lines with `codex_line_is_visible_user` instead: it only checks "has text or an
///    image", without normalization, so injected rows the extractor drops (`# AGENTS.md instructions` / `<environment_context>` /
///    `<skill>`) are still counted, `users_seen` exceeds the anchor index,
///    and the cut moves a turn early, silently dropping the clicked turn (regression test
///    `hidden_context_rows_must_not_shift_the_cut`).
/// 2. From the anchor line onward, find this turn's end marker: `task_complete`, or the
///    `turn_aborted` an interrupt writes. Looking only for `task_complete` runs an interrupted turn on to the next
///    turn's marker, and the branch carries an extra turn (regression test
///    `an_aborted_anchor_turn_must_not_pull_in_the_next_turn`).
pub(super) fn fork_keep_count_codex(
    path: &Path,
    anchor: &ForkAnchor,
    parsed: &[crate::engines::history::Message],
    accepted_frames: &std::collections::HashSet<String>,
) -> Option<usize> {
    // The anchor is the nth visible user message (zero-based); `anchor_turn` is the only hit rule, and its
    // idea of visible is the parser's, the same source as step 1's line numbers.
    let anchor_user_ordinal = anchor_turn(parsed, anchor)?;

    let file = std::fs::File::open(path).ok()?;
    let user_lines =
        crate::engines::history::user_row_lines("codex", std::io::BufReader::new(file), accepted_frames);
    // The anchor message's source line. The `usize::MAX` sentinel is only reached when the anchor index
    // exceeds the visible user count, and `anchor_turn`'s index is always in range, so it never comes up here.
    let anchor_line = *user_lines.get(anchor_user_ordinal)?;
    if anchor_line == usize::MAX {
        return None;
    }

    // The second pass looks only for turn-end markers, scanning from the anchor line (earlier markers belong to earlier turns).
    let file = std::fs::File::open(path).ok()?;
    use std::io::BufRead;
    for (index, line) in std::io::BufReader::new(file).lines().enumerate() {
        if index < anchor_line {
            continue;
        }
        let Ok(line) = line else { continue };
        let Some(value) = parse_json_line(&line) else {
            continue;
        };
        if codex_line_ends_turn(&value) {
            let cut = index + 1;
            // When the anchor is the last turn the whole file moves over, so align with Claude as
            // `usize::MAX` (`at_tip`). Otherwise "fork from the last turn" would return different plans on
            // different engines: an identical file, yet `at_tip` false and an extra `keepRecords`, and any
            // later consumer would draw contradictory conclusions.
            let has_later_user = user_lines
                .iter()
                .any(|line| *line != usize::MAX && *line > index);
            return Some(if has_later_user { cut } else { usize::MAX });
        }
    }
    // The anchor turn has no end marker yet (still running), or the transcript was truncated: don't guess, report
    // that it couldn't be located. The interface offers forking only on settled rows, so normally this isn't reached.
    None
}


/// Whether a Codex line marks the end of a turn.
///
/// Both sources are needed:
/// - `event_msg/task_complete`: finished normally.
/// - `event_msg/turn_aborted`: interrupted by the person (Esc). An interrupted turn is still a whole turn:
///   it is on disk, visible, and the person may want to fork from it. With only `task_complete`,
///   an anchor on an interrupted turn runs on to the next turn's marker and the branch carries an extra turn.
pub(super) fn codex_line_ends_turn(value: &serde_json::Value) -> bool {
    if value.get("type").and_then(serde_json::Value::as_str) != Some("event_msg") {
        return false;
    }
    matches!(
        value
            .get("payload")
            .and_then(|p| p.get("type"))
            .and_then(serde_json::Value::as_str),
        Some("task_complete") | Some("turn_aborted")
    )
}


/// Regression tests for the Codex cut.
///
/// Both match real defects (reproduced with temporary tests during review):
/// - Injected rows (`# AGENTS.md instructions` / `<environment_context>` / `<skill>`) are dropped by the
///   extractor's normalization, yet they really are `role=user` `response_item`s. Counting "is the raw line
///   user" counted them as turns, `users_seen` exceeded the anchor index, the cut moved a turn early, and
///   the clicked turn itself vanished.
/// - `turn_aborted` (the person pressed Esc) also ends a turn. With only `task_complete`, an anchor
///   on an interrupted turn ran on to the next turn's end marker, and the branch carried a whole extra turn.
///
/// Assertions are about which messages the branch has when parsed again, not intermediate values: what the person sees counts.
#[cfg(test)]
mod codex_cut_tests {
    use super::*;
    use std::collections::HashSet;

    const META: &str = r#"{"type":"session_meta","payload":{"id":"src"}}"#;
    const AGENTS: &str = r##"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions for /tmp/ws\n\n<INSTRUCTIONS>rules</INSTRUCTIONS>"}]}}"##;
    const ENV: &str = r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>\n  <cwd>/tmp/ws</cwd>\n</environment_context>"}]}}"#;
    const START: &str = r#"{"type":"event_msg","payload":{"type":"task_started"}}"#;
    const DONE: &str = r#"{"type":"event_msg","payload":{"type":"task_complete"}}"#;
    const ABORT: &str = r#"{"type":"event_msg","payload":{"type":"turn_aborted"}}"#;

    fn msg(role: &str, kind: &str, text: &str) -> String {
        format!(
            r#"{{"type":"response_item","payload":{{"type":"message","role":"{role}","content":[{{"type":"{kind}","text":"{text}"}}]}}}}"#
        )
    }

    /// Cuts the prefix at `fork_keep_count_codex`'s cut, then reads it back with the ordinary parser.
    fn branch_messages(lines: &[&str], anchor_text: &str) -> Vec<String> {
        let dir = std::env::temp_dir().join(format!("ccgui-codex-cut-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("rollout-src.jsonl");
        std::fs::write(&source, lines.join("\n") + "\n").unwrap();
        let parsed =
            crate::engines::history::parse_session_file("codex", &source, &HashSet::new()).unwrap().messages;
        let anchor = ForkAnchor {
            user_text_sha256: text_sha256_hex(anchor_text),
            seq_hint: None,
            tail_occurrence: None,
        };
        let keep = fork_keep_count_codex(&source, &anchor, &parsed, &HashSet::new())
            .expect("the anchor turn should be located");
        let branch = dir.join("rollout-branch.jsonl");
        let body: String = lines.iter().take(keep).map(|line| format!("{line}\n")).collect();
        std::fs::write(&branch, body).unwrap();
        let out = crate::engines::history::parse_session_file("codex", &branch, &HashSet::new())
            .unwrap()
            .messages
            .iter()
            .map(|m| format!("{}:{}", m.role, m.text))
            .collect();
        let _ = std::fs::remove_dir_all(&dir);
        out
    }

    /// Injected rows must not change which visible user message the anchor counts as.
    #[test]
    fn hidden_context_rows_do_not_shift_the_cut() {
        let (q1, a1) = (msg("user", "input_text", "Q1"), msg("assistant", "output_text", "A1"));
        let (q2, a2) = (msg("user", "input_text", "Q2"), msg("assistant", "output_text", "A2"));
        let (q3, a3) = (msg("user", "input_text", "Q3"), msg("assistant", "output_text", "A3"));
        let lines = [
            META, AGENTS, ENV, START, &q1, &a1, DONE, START, &q2, &a2, DONE, START, &q3, &a3, DONE,
        ];
        // The defect: the branch had only ["user:Q1","assistant:A1"], and the clicked Q2 turn was lost entirely.
        assert_eq!(
            branch_messages(&lines, "Q2"),
            ["user:Q1", "assistant:A1", "user:Q2", "assistant:A2"]
        );
    }

    /// An interrupted turn is a whole turn: the cut must stop at its `turn_aborted`, not go past it.
    #[test]
    fn an_aborted_anchor_turn_does_not_pull_in_the_next_turn() {
        let q1 = msg("user", "input_text", "Q1");
        let (q2, a2) = (msg("user", "input_text", "Q2"), msg("assistant", "output_text", "A2"));
        let lines = [META, START, &q1, ABORT, START, &q2, &a2, DONE];
        let branch = branch_messages(&lines, "Q1");
        assert_eq!(branch, ["user:Q1"]);
    }

    /// The anchor is the last turn and it was interrupted: a valid cut (= the whole file),
    /// not a location failure because no `task_complete` was found.
    #[test]
    fn an_aborted_last_turn_is_a_valid_cut() {
        let q1 = msg("user", "input_text", "Q1");
        let lines = [META, START, &q1, ABORT];
        assert_eq!(branch_messages(&lines, "Q1"), ["user:Q1"]);
    }
}

