// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/fork_dsh.rs.
//! dsh's row in the fork capability table (`ForkSupport`).
//!
//! Why a file of its own: dsh differs from Claude/Codex not only in how paths are built but in the whole
//! on-disk shape: its transcript is multi-frame zstd (`<dsh home>/sessions/<cwd-slug>/
//! session-<uuid>/session.v<N>.jsonl.zstd`), which plain `BufReader::lines()` reads as
//! binary garbage; and the cut isn't "the nth user record" (one turn can hold several `user/message`s)
//! but the anchor turn's `turn/end`. The capability table's notes at the top of `fork/mod.rs` name this case:
//! put the implementation in a new file and add a table row pointing at it.
//!
//! These are established facts of dsh's disk format; don't derive them again:
//! - Each session directory holds exactly one transcript file, named `session.v<N>.jsonl.zstd`,
//!   with `N` equal to the first-line header's `version`.
//! - The first-line header is the identity: `{"type":"session","version":4,"id":"session-<uuid>",
//!   "cwd":"…",…}`; `id` must equal the containing directory's name exactly (both are
//!   `session-<uuid>`).
//! - Turns are bounded by `turn/start` … `turn/end`; one turn can hold several `user/message`s
//!   (sub-agent reports, `system-reminder`, automatic checkpoints).

use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::fork::{is_uuid, ForkAnchor};
use crate::engines::history::Message;

/// The session id prefix. dsh's directory names and the header's `id` both use it; they are the same string.
const DSH_SESSION_PREFIX: &str = "session-";

/// The transcript file name stem (`session.v<N>.jsonl.zstd`; parsing `<N>` and the suffix belongs to
/// `history::discovery::dsh_log_generation`, whose result is borrowed here, not reimplemented).
const DSH_LOG_STEM: &str = "session";

/// dsh's row in the fork capability table.
///
/// Here rather than in `fork/mod.rs`: all three functions in the row are defined in this module, keeping
/// "capability + implementation" in one place; a new engine needs only a new file + a name in the table.
pub(crate) const DSH_FORK: super::fork::ForkSupport = super::fork::ForkSupport {
    engine: "dsh",
    source_id_ok,
    target_id: new_prefixed_uuid,
    keep_count,
    copy_prefix,
    derive_landing: Some(derive_landing),
    cleanup: remove_written_transcript_and_dir,
};

/// A dsh branch is a directory plus the transcript in it; rollback deletes both.
///
/// Deleting only the file leaves an empty directory: that `session-<uuid>` still holds the id, so reusing
/// the same id hits `copy_prefix`'s "directory already taken" check (it refuses to write into a non-empty one),
/// and `dsh_candidates()` keeps treating the empty directory as a candidate.
///
/// `remove_dir` deletes only empty directories: a non-empty one holds something else, and keeping it is safer.
fn remove_written_transcript_and_dir(written: &Path) {
    let _ = std::fs::remove_file(written);
    if let Some(dir) = written.parent() {
        let _ = std::fs::remove_dir(dir);
    }
}

/// The shape of a dsh session id that can be forked from: `session-<uuid>` (the real value, both the
/// directory name and the header's `id`), and also a bare uuid (older data had such directories, and a
/// caller that drops the prefix shouldn't be told the id is invalid).
///
/// Can't be unified into `is_uuid` (that is Claude's file name constraint): it would shut out every real
/// dsh id; the branch's new id shape is `new_prefixed_uuid`, unrelated to this.
pub(crate) fn source_id_ok(session_id: &str) -> bool {
    match session_id.strip_prefix(DSH_SESSION_PREFIX) {
        Some(rest) => !rest.is_empty() && is_uuid(rest),
        None => is_uuid(session_id),
    }
}

/// The transcript file name: `session.v<N>.jsonl.zstd`. `N` is the generation in the file name, renamed to
/// the source's generation on write, so it is part of the name.
///
/// Generation 0's canonical spelling is the bare `session.jsonl.zstd`, not `session.v0.jsonl.zstd`.
/// `dsh_log_generation` treats the bare name as generation 0 and explicitly refuses a generation starting
/// with `0` (`digits.starts_with('0')` → `None`), since dsh never writes leading zeros. So this follows
/// its rule: written as `session.v0.…`, `dsh_session_log()` would skip it as an unknown file, and the
/// branch wouldn't exist for the scanner: the command reports success and the table has a row, but the file
/// never refreshes, and whatever parses the generation from the name (the host's resume) can't find it either: a branch silently without context.
fn transcript_name(generation: u32) -> String {
    if generation == 0 {
        return format!("{DSH_LOG_STEM}.jsonl.zstd");
    }
    format!("{DSH_LOG_STEM}.v{generation}.jsonl.zstd")
}

/// Source transcript file name → generation. None means the file isn't a dsh session log at all.
fn transcript_generation(source_path: &Path) -> Result<u32, String> {
    let name = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("The source transcript's file name can't be read: {}", source_path.display()))?;
    crate::engines::history::discovery::dsh_log_generation(name)
        .ok_or_else(|| format!("The source transcript isn't a dsh session log (session.v<N>.jsonl.zstd): {name}"))
}

/// Source session directory name → branch directory name: `session-<new id>`.
///
/// The two identities must be the same string: the directory name and the header's `id` (`discovery.rs`'s
/// `identify_head` reads the header, `dsh_candidates()` the directory; both must recognize the branch, or
/// one side scans it while the other can't read it).
///
/// Idempotent: the branch id now already is `session-<uuid>` (`DSH_FORK.target_id`), so it mustn't be
/// prefixed blindly again, giving `session-session-<uuid>`. Prefixing stays available for callers with a
/// bare UUID (older data, tests).
fn branch_session_id(target_session_id: &str) -> String {
    if target_session_id.starts_with(DSH_SESSION_PREFIX) {
        target_session_id.to_string()
    } else {
        format!("{DSH_SESSION_PREFIX}{target_session_id}")
    }
}

/// The branch's new id (dsh): a UUIDv4 with the `session-` prefix.
///
/// dsh's canonical shape: the directory name, the header's `id` and the host's own projection cache key all use it.
/// With the prefix on disk but a bare UUID in the DB row and to the host, the host builds a second projection
/// under the bare id (`inheritedEventCount: 0`), and the model can't see the inherited conversation.
fn new_prefixed_uuid() -> String {
    format!("{DSH_SESSION_PREFIX}{}", uuid::Uuid::new_v4())
}

/// The branch's landing path: a sibling of the source session directory (in the same cwd-slug directory)
/// + `session-<new id>/` + the source file's generation name.
///
/// Siblings keep the engine's own discovery rules (`<dsh home>/sessions/<cwd-slug>/session-<id>/`),
/// avoiding every cwd-slug encoding assumption.
fn derive_landing(source_path: &Path, target_session_id: &str) -> Result<PathBuf, String> {
    Ok(branch_dir(source_path, target_session_id)?
        .join(transcript_name(transcript_generation(source_path)?)))
}

/// The branch directory: `<cwd-slug directory>/session-<new id>`.
///
/// It must be the source session directory's parent (the cwd-slug directory), not the source directory itself:
/// dsh sessions are siblings under the slug directory (`sessions/<slug>/session-<a>/`,
/// `sessions/<slug>/session-<b>/`). Writing `<source session dir>/session-<new id>` would put one
/// valid session inside another session's directory: outside dsh's discovery, and making
/// `delete_session_disk`'s structure check see the source directory as having extra content.
/// The naming exists once, shared by writing and deriving.
fn branch_dir(source_path: &Path, target_session_id: &str) -> Result<PathBuf, String> {
    let slug_dir = source_dir(source_path)?
        .parent()
        .ok_or_else(|| format!("The source session directory has no parent: {}", source_path.display()))?;
    Ok(slug_dir.join(branch_session_id(target_session_id)))
}

/// The source session directory (`…/session-<source id>`), where the transcript file is.
fn source_dir(source_path: &Path) -> Result<&Path, String> {
    source_path
        .parent()
        .ok_or_else(|| format!("The source transcript has no parent directory: {}", source_path.display()))
}

/// Event type: dsh puts it at the top level (`turn/start` / `turn/end` / `user/message` …).
fn line_type(value: &serde_json::Value) -> Option<&str> {
    value.get("type").and_then(serde_json::Value::as_str)
}

/// dsh's record-level cut: after the anchor turn's `turn/end`.
///
/// Why not cut at "the next user record" like Claude: one dsh turn can hold several
/// `user/message`s (sub-agent reports, `system-reminder`, automatic checkpoints), and cutting by user record
/// would land mid-turn, leaving a turn with no `turn/end`. The same reason Codex must cut after
/// `task_complete`, only with a different end marker (deliberately not unified).
///
/// The anchor turn is included in the branch (the clicked turn must stay), so the cut is where the turn
/// ends and the next begins = the line after `turn/end`. Records after `turn/end` and before the next
/// `turn/start` go with the anchor turn and aren't lost.
///
/// An anchor turn without `turn/end` (unfinished, or a truncated transcript) → `None`: the caller reports an
/// explicit error, never falling back to "up to the end", which would produce a branch the person didn't click.
///
/// Turns are counted by the order of `turn/start` in the file, not the payload's `turn` field:
/// that field has no verified shape anywhere here (`dsh_session.rs` only handles `turn/end` on the follow
/// stream, with no stored sample), and using it would build the cut on a guess.
///
/// `anchor_turn`'s result can't be used as the turn number directly. It counts visible user messages
/// (how many user messages precede `anchor_hit_index`'s hit), while turns here are bounded by
/// `turn/start`, and one dsh turn can hold several visible user messages (sub-agent reports, automatic checkpoints).
/// The two agree when they are 1:1; once a turn isn't,
/// the index shifts: with the anchor on a turn's second user message, the "turn" computed from the index
/// either doesn't exist (→ a location failure for a message the person can see) or is a later turn (→ the
/// branch silently carries extra content).
///
/// So two steps: `anchor_turn` gives which visible user message the anchor is (the one hit rule),
/// then `user_row_lines` (the same extractor + normalization pipeline as the parser) gives
/// that message's source line, and from that line the cut is the `turn/end` of its turn.
pub(crate) fn keep_count(
    path: &Path,
    anchor: &ForkAnchor,
    parsed: &[Message],
    accepted_frames: &HashSet<String>,
) -> Option<usize> {
    // Which visible user message in the whole file the anchor is (zero-based); `anchor_turn` is the only hit rule.
    let anchor_user_ordinal = super::fork::anchor_turn(parsed, anchor)?;

    // Which line the anchor message is on: the same extractor + normalization pipeline as `parse_session_file`
    // (`user_row_lines`). Don't count raw lines with `dsh_user_message_text` yourself: that is only a
    // quick "has text" check that skips `normalize_extracted_row`, so a `user/message` made entirely of injected
    // blocks or internal frames is overcounted, the index exceeds the anchor, and the cut moves a turn early. Codex
    // once broke exactly this way (see `fork_keep_count_codex` in `fork/anchor.rs`).
    let user_lines = {
        let reader = crate::engines::history::open_line_reader("dsh", path).ok()?;
        crate::engines::history::user_row_lines("dsh", reader, accepted_frames)
    };
    let anchor_line = *user_lines.get(anchor_user_ordinal)?;
    // The `usize::MAX` sentinel is only reached when the anchor index exceeds the visible user count, and
    // `anchor_turn`'s index is always in range.
    if anchor_line == usize::MAX {
        return None;
    }

    // Second pass: from the anchor line onward find `turn/end` and cut on it (inclusive).
    //
    // Don't change this to "count the nth turn's `turn/end`": one dsh turn can hold several visible user
    // messages, and turn number equals user index only when they are 1:1. Searching forward from the anchor's line has no such assumption.
    let reader = crate::engines::history::open_line_reader("dsh", path).ok()?;
    use std::io::BufRead;
    for (index, line) in reader.lines().enumerate() {
        if index < anchor_line {
            continue;
        }
        let Ok(line) = line else { continue };
        let Some(value) = super::fork::parse_json_line(&line) else {
            continue;
        };
        if line_type(&value) == Some("turn/end") {
            let cut = index + 1;
            // Aligned with codex / Claude: when the anchor is the last turn the whole file moves over, returning
            // `usize::MAX` (`at_tip`), not "the whole file moved but at_tip=false".
            let has_later_user = user_lines
                .iter()
                .any(|line| *line != usize::MAX && *line > index);
            return Some(if has_later_user { cut } else { usize::MAX });
        }
    }
    // The anchor turn has no `turn/end` (still running): don't guess, report a location failure.
    None
}

/// dsh's prefix copy: reads the decoded NDJSON by line, rewrites only the first-line header's `id`, and
/// writes zstd back to `<source dir>/session-<new id>/session.v<N>.jsonl.zstd`.
///
/// Three whys:
/// - Reading must go through `history::open_line_reader`: it is the one place that knows dsh is
///   zstd and must read across frames to EOF. Another wrapper would be a second source of truth.
/// - Only the header's `id` changes, not `cwd`: the same reason as Codex: a branch is by definition in the
///   same workspace, so the transcript's cwd is already right; rewriting it adds a second possibly inconsistent
///   source (the DB's `workspace_path` vs the transcript's `cwd`), which would quietly run the
///   branch elsewhere whenever the two are spelled differently. Every field left alone is one less way to break.
/// - The directory name and the header's `id` must match exactly: so `id` is written as
///   `session-<new id>` (whatever the branch directory is called), not a bare uuid. On success
///   it returns the transcript file path in that directory (the caller registers it as `file_path`
///   and deletes that file on rollback).
///
/// Landing rules: the target directory must not exist or be empty (non-empty means someone else's, an explicit
/// error rather than overwriting); the file uses `create_new`; any failure deletes the half-written directory
/// whole before reporting, since `dsh_candidates()` would scan it as a real session (it only checks "the directory has a log").
pub(crate) fn copy_prefix(
    source_path: &Path,
    target_session_id: &str,
    keep_records: usize,
) -> Result<PathBuf, String> {
    let generation = transcript_generation(source_path)?;
    let dir = branch_dir(source_path, target_session_id)?;
    let dest = dir.join(transcript_name(generation));

    // The target directory name carries the UUIDv4 this call just generated: if it exists it is someone else's
    // (left by an earlier failure, placed by hand). An empty directory can be reused (the earlier failure was
    // cleaned up); anything non-empty is refused, since `remove_dir_all` on someone else's directory is far worse than an error.
    if let Ok(entries) = std::fs::read_dir(&dir) {
        if entries.into_iter().next().is_some() {
            return Err(format!("The branch session directory is already taken: {}", dir.display()));
        }
    }

    let reader = crate::engines::history::open_line_reader("dsh", source_path)?;
    use std::io::BufRead;

    let mut lines = reader.lines();
    // The first line must be the header: it holds the identity and is the only line to change. If it can't be
    // read or parsed, fail explicitly; never write a branch without a header.
    let header_line = match lines.next() {
        Some(Ok(line)) => line,
        Some(Err(error)) => return Err(format!("Couldn't read the source transcript: {error}")),
        None => return Err("The source transcript is empty (no header)".into()),
    };
    let mut header = super::fork::parse_json_line(&header_line)
        .ok_or_else(|| "The source transcript's first line isn't valid JSON (the dsh header)".to_string())?;
    let header_version = header
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .and_then(|v| u32::try_from(v).ok());
    if header_version != Some(generation) {
        // A name that disagrees with the header is refused: both are sources of truth, and guessing one wrong would
        // write a branch the host can't read (or the app can't scan).
        return Err(format!(
            "The dsh transcript's generation doesn't match the header's version (file name v{generation} / header {header_version:?}): {}",
            source_path.display()
        ));
    }
    let new_session_id = branch_session_id(target_session_id);
    if !rewrite_identity(&mut header, &new_session_id) {
        return Err("The source transcript's first line isn't a dsh session header (type=session)".into());
    }
    let header =
        serde_json::to_string(&header).map_err(|e| format!("Couldn't serialize the dsh header: {e}"))?;

    // The directory and file are created below; any failure after this cleans up the whole directory.
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create the branch session directory: {e}"))?;
    let written = (|| -> Result<(), String> {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&dest)
            .map_err(|e| format!("Couldn't create the branch transcript: {e}"))?;
        // Compression level 0 (zstd's "default"): this only forwards a transcript that was already compressed,
        // not worth trading size for anything.
        // The first frame must be exactly one header line. The host checks this, and otherwise
        // `session/create` refuses:
        //   "corrupt Zstandard session log: first frame is not exactly one header line"
        // Writing the whole log as one frame likewise leaves the host unable to read the branch
        // (`inheritedEventCount` comes out 0 and the model can't see the inherited conversation).
        // So the header gets a frame of its own, closed at once; the other lines start in the second frame.
        let mut file = file;
        {
            let mut header_frame = zstd::stream::write::Encoder::new(&mut file, 0)
                .map_err(|e| format!("Couldn't start the zstd encoder: {e}"))?;
            header_frame
                .write_all(header.as_bytes())
                .and_then(|_| header_frame.write_all(b"\n"))
                .map_err(|e| format!("Couldn't write the branch transcript: {e}"))?;
            header_frame
                .finish()
                .map_err(|e| format!("Couldn't flush the branch transcript: {e}"))?;
        }
        // Moved line by line, nothing picked: auxiliary records (`turn/start`, `step/*`, `tool/*`) move too,
        // or a turn in the branch would have no boundary markers, and both the cut and the host's reading would go wrong.
        //
        // `keep_records` counts how many lines of the source to keep (the header is line 1), the same measure as
        // `keep_count`'s raw `turn/end` line number + 1, and as the plain copy path
        // (`copy_plain_jsonl_prefix`'s `index >= keep_records`).
        //
        // This once counted written non-empty lines (`written`) while `keep_count` gives raw
        // line numbers (empty lines included): one empty line in the source made them differ by 1 and the copy went
        // past the cut by a few lines. Now it cuts by source line number; empty lines are still skipped (they mean
        // nothing in a zstd stream) but no longer affect where the cut lands.
        //
        // The second frame is created on demand: keeping only the header (`keep_records == 1`) mustn't write an empty frame.
        let mut rest: Option<zstd::stream::write::Encoder<&mut std::fs::File>> = None;
        for (offset, line) in lines.enumerate() {
            // `lines` has already consumed the header (source line 0), so `offset + 1` is the source line number.
            if offset + 1 >= keep_records {
                break;
            }
            let line = line.map_err(|e| format!("Couldn't read the source transcript: {e}"))?;
            if line.trim().is_empty() {
                continue;
            }
            if rest.is_none() {
                rest = Some(
                    zstd::stream::write::Encoder::new(&mut file, 0)
                        .map_err(|e| format!("Couldn't start the zstd encoder: {e}"))?,
                );
            }
            let frame = rest.as_mut().expect("just created");
            frame
                .write_all(line.as_bytes())
                .and_then(|_| frame.write_all(b"\n"))
                .map_err(|e| format!("Couldn't write the branch transcript: {e}"))?;
        }
        if let Some(frame) = rest {
            frame
                .finish()
                .map_err(|e| format!("Couldn't flush the branch transcript: {e}"))?;
        }
        Ok(())
    })();

    if let Err(error) = written {
        // A half-written directory would be scanned as a real session, so the whole directory is deleted before reporting, leaving no half state.
        cleanup_half_written(&dir, &dest);
        return Err(error);
    }
    Ok(dest)
}

/// Cleanup on failure: delete the transcript file that may have been written, then the directory.
///
/// `remove_file` before `remove_dir_all` rather than only the latter: if the directory held anything else,
/// `remove_dir_all` would delete it all the same, but the two steps at least make "we delete only what we
/// wrote" visible in the code. A non-empty directory is still handled by `remove_dir_all`: the moment
/// "directory made, file not written" must be cleaned up.
fn cleanup_half_written(dir: &Path, dest: &Path) {
    if dest.is_file() {
        let _ = std::fs::remove_file(dest);
    }
    let _ = std::fs::remove_dir_all(dir);
}

/// dsh's identity rewrite: only the first-line header's `id` (the directory name must match it).
///
/// `cwd` is left alone (see `copy_prefix` for why). Returns whether the line changed: when the first line isn't
/// a `session` header the caller must report an error rather than quietly write a branch without an identity.
fn rewrite_identity(value: &mut serde_json::Value, new_session_id: &str) -> bool {
    let Some(object) = value.as_object_mut() else {
        return false;
    };
    if object.get("type").and_then(serde_json::Value::as_str) != Some("session") {
        return false;
    }
    object.insert(
        "id".to_string(),
        serde_json::Value::String(new_session_id.to_string()),
    );
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;

    /// The file name a branch writes must be recognized by our own discovery.
    ///
    /// The generation has two separate conventions: `transcript_name` decides what name is written, `dsh_log_generation`
    /// decides what name counts as a dsh session log. If they disagree, the branch really exists on disk, has a
    /// row and the command reports success, but the scanner never sees it (`dsh_session_log()` skips it as
    /// unknown), and whatever parses the generation from the name (the host's resume) can't find it either: a
    /// branch silently without context. Generation 0's bare `session.jsonl.zstd` is the canonical spelling; writing
    /// `session.v0.…` is judged invalid (a leading zero).
    ///
    /// So this asserts a round trip, not a literal comparison of two format strings; the latter only proves the
    /// copy-paste is right, not that both sides use the same rule.
    #[test]
    fn written_transcript_names_are_recognised_by_discovery() {
        for generation in 0u32..=12 {
            let name = transcript_name(generation);
            assert_eq!(
                crate::engines::history::discovery::dsh_log_generation(&name),
                Some(generation),
                "a file name we write must parse back to the same generation: {name}"
            );
        }
    }

    /// The host checks that the first frame is exactly one header line, and otherwise `session/create`
    /// refuses:
    ///   `corrupt Zstandard session log: first frame is not exactly one header line`
    ///
    /// This test reads the file back frame by frame, not letting the decoder join all frames: how many frames
    /// there are is exactly what is checked, and reading them joined would hide the problem entirely (with the
    /// whole log in one frame, every "reads back" assertion would still pass).
    #[test]
    fn first_zstd_frame_is_exactly_the_header_line() {
        use std::io::Read as _;

        let (root, source, _id) = fixture(4, 4, true);
        let target = new_prefixed_uuid();
        let dest = copy_prefix(&source, &target, usize::MAX).unwrap();

        let bytes = std::fs::read(&dest).unwrap();
        // zstd frame magic 0x28 B5 2F FD: find every frame start and cut out the first frame.
        let magic = [0x28u8, 0xb5, 0x2f, 0xfd];
        let mut starts = Vec::new();
        let mut i = 0usize;
        while i + 4 <= bytes.len() {
            if bytes[i..i + 4] == magic {
                starts.push(i);
                i += 4;
            } else {
                i += 1;
            }
        }
        assert!(
            starts.len() >= 2,
            "at least two frames (one for the header + one for the rest), got {} frames",
            starts.len()
        );

        let mut text = String::new();
        zstd::stream::read::Decoder::new(&bytes[starts[0]..starts[1]])
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
        assert_eq!(
            lines.len(),
            1,
            "the first frame must hold only the header line, got {} lines: {text:?}",
            lines.len()
        );
        assert!(
            lines[0].contains("\"type\":\"session\""),
            "the first frame must be dsh's session header: {}",
            lines[0]
        );
        assert!(
            lines[0].contains(&target),
            "the header's id must be the branch's new id ({target}), got: {}",
            lines[0]
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// The branch id's shape differs per engine, and must match each engine's own convention.
    ///
    /// Once the shapes diverge, the feature breaks in a way that looks normal but has no context: on disk (directory name /
    /// header) it is `session-<uuid>`, while with a bare UUID in the DB row and to the host, the host
    /// builds a second projection under the other spelling (`inheritedEventCount: 0`, `rows` only the new turn),
    /// and the model can't read the inherited conversation. So all three shapes are pinned together.
    #[test]
    fn branch_id_shape_matches_each_engines_own_convention() {
        for engine in ["claude", "codex"] {
            let support = super::super::fork::fork_support(engine).expect("the engine must be in the capability table");
            let id = (support.target_id)();
            assert!(
                super::super::fork::is_uuid(&id),
                "{engine}'s branch id must be a bare UUID (Claude's --resume checks the file name stem): {id}"
            );
        }

        let dsh = (DSH_FORK.target_id)();
        let bare = dsh.strip_prefix(DSH_SESSION_PREFIX).unwrap_or_else(|| {
            panic!("dsh's branch id must carry the `{DSH_SESSION_PREFIX}` prefix (the shape of its directory name/header/host cache key): {dsh}")
        });
        assert!(
            super::super::fork::is_uuid(bare),
            "after the prefix it must be a valid UUID: {dsh}"
        );

        // Idempotent: the directory name and header use `branch_session_id(...)`, and the branch id now
        // already carries the prefix; prefixing again would give `session-session-<uuid>`, breaking both.
        assert_eq!(
            branch_session_id(&dsh),
            dsh,
            "an id that already has the prefix mustn't get it twice"
        );
        assert_eq!(
            branch_session_id(bare),
            dsh,
            "a bare UUID should still be prefixed into the canonical shape (older data/tests)"
        );
    }

    /// A three-message transcript: turn 0 holds a `system-reminder`, turn 1 holds a
    /// second `user/message` (a sub-agent report), then turn 2. Fixed line numbers:
    /// 0 header / 1 turn1 start / 2 user / 3 assistant / 4 reminder /
    /// 5 turn1 end / 6 turn2 start / 7 user / 8 sub-agent report / 9 assistant /
    /// 10 turn2 end (no line 10 when `with_last_end = false`).
    fn transcript(session_id: &str, cwd: &str, header_version: u32, last_end: bool) -> Vec<String> {
        let mut lines = vec![
            serde_json::json!({
                "type": "session",
                "version": header_version,
                "id": session_id,
                "createdAt": 1_791_000_000_000i64,
                "cwd": cwd,
                "isSeeded": false,
                "delegationDepth": 0,
                "agentPreset": "standard",
            })
            .to_string(),
            turn("turn/start", 1),
            user("First question"),
            assistant("First answer"),
            serde_json::json!({
                "type": "user/message",
                "data": { "content": [{ "type": "text",
                    "text": "<system-reminder>Injected runtime context</system-reminder>" }] }
            })
            .to_string(),
            turn("turn/end", 1),
            turn("turn/start", 2),
            user("Second question"),
            user("Sub-agent report (the second user record in one turn)"),
            assistant("Second answer"),
        ];
        if last_end {
            lines.push(turn("turn/end", 2));
        }
        lines
    }

    fn turn(kind: &str, turn: u32) -> String {
        // `data.turn` is only a record field: the cut doesn't read it (see `keep_count`'s notes).
        serde_json::json!({ "type": kind, "data": { "turn": turn } }).to_string()
    }

    fn user(text: &str) -> String {
        serde_json::json!({
            "type": "user/message",
            "data": { "content": [{ "type": "text", "text": text }] }
        })
        .to_string()
    }

    fn assistant(text: &str) -> String {
        serde_json::json!({
            "type": "assistant/message",
            "data": { "message": { "content": [{ "type": "text", "text": text }] } }
        })
        .to_string()
    }

    /// A single-frame zstd (the same shape as `scanner.rs`'s test fixture). dsh transcripts are multi-frame; that
    /// case is pinned separately by `multi_frame_transcripts_are_read_across_frames`.
    fn write_zstd_lines(path: &Path, lines: &[String]) {
        let file = std::fs::File::create(path).unwrap();
        let mut encoder = zstd::stream::write::Encoder::new(file, 0).unwrap();
        for line in lines {
            encoder.write_all(line.as_bytes()).unwrap();
            encoder.write_all(b"\n").unwrap();
        }
        encoder.finish().unwrap();
    }

    /// Each line its own zstd frame, the bytes concatenated: exactly the shape of a dsh transcript.
    fn write_multi_frame_lines(path: &Path, lines: &[String]) {
        let mut bytes = Vec::new();
        for line in lines {
            let mut encoder = zstd::stream::write::Encoder::new(Vec::new(), 0).unwrap();
            encoder.write_all(line.as_bytes()).unwrap();
            encoder.write_all(b"\n").unwrap();
            bytes.extend_from_slice(&encoder.finish().unwrap());
        }
        std::fs::write(path, bytes).unwrap();
    }

    /// A source session under a temporary root: `<root>/session-<uuid>/session.v<N>.jsonl.zstd`.
    /// Returns `(root, source transcript path, source session id)`.
    fn fixture(file_generation: u32, header_version: u32, last_end: bool) -> (PathBuf, PathBuf, String) {
        let root = std::env::temp_dir().join(format!("ccgui-fork-dsh-{}", uuid::Uuid::new_v4()));
        let session_id = branch_session_id(&uuid::Uuid::new_v4().to_string());
        let dir = root.join(&session_id);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(transcript_name(file_generation));
        let body = transcript(&session_id, "/ws", header_version, last_end);
        write_zstd_lines(&path, &body);
        (root, path, session_id)
    }

    fn parsed_messages(path: &Path) -> Vec<Message> {
        crate::engines::history::parse_session_file("dsh", path, &HashSet::new())
            .unwrap()
            .messages
    }

    /// Every decoded line (a file the fork writes must read back through the same path).
    fn lines_of(path: &Path) -> Vec<String> {
        crate::engines::history::open_line_reader("dsh", path)
            .unwrap()
            .lines()
            .map(|line| line.unwrap())
            .collect()
    }

    fn messages_of(path: &Path) -> Vec<String> {
        parsed_messages(path)
            .iter()
            .map(|m| format!("{}:{}", m.role, m.text))
            .collect()
    }

    fn anchor(text: &str) -> ForkAnchor {
        ForkAnchor {
            user_text_sha256: super::super::fork::text_sha256_hex(text),
            seq_hint: None,
            tail_occurrence: None,
        }
    }

    /// With the anchor on the second user message of one turn, the cut must still be in that turn.
    ///
    /// It guards a shift that really happened: `anchor_turn` counts visible user messages, while turns are
    /// bounded by `turn/start`. Turn 2 in the fixture has two visible user messages (`Second question` + the sub-agent
    /// report, which is how sub-agent reports are stored). Computing "message index + 1 = turn", an anchor on the
    /// second one would give a turn 3 that doesn't exist: the person clicked a message they can see and got
    /// "couldn't find the turn in the transcript"; worse, with later turns the cut would silently land on a later turn.
    ///
    /// So two steps: `anchor_turn` finds which visible user message it is, then
    /// `history::user_row_lines("dsh", …)` (the same extractor + normalization pipeline as the parser)
    /// gives that message's source line, from which `turn/end` is searched.
    #[test]
    fn anchoring_the_second_user_message_of_a_turn_still_cuts_that_turn() {
        let (root, source, _id) = fixture(4, 4, true);
        let parsed = parsed_messages(&source);
        let hit = anchor("Sub-agent report (the second user record in one turn)");

        let keep = keep_count(&source, &hit, &parsed, &HashSet::new())
            .expect("the anchor is turn 2's second user message and must be located");
        // 0 header / 1 turn1 start / 2 user / 3 assistant / 4 reminder / 5 turn1 end /
        // 6 turn2 start / 7 user / 8 sub-agent report / 9 assistant / 10 turn2 end
        assert_eq!(
            keep,
            usize::MAX,
            "the anchor is the last turn ⇒ the whole file moves (the sentinel, as for Claude/Codex); the file has 11 lines, the same as cutting after line 10's turn/end"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// dsh landing: branch directory + transcript; the header's `id` rewritten, `cwd` as is, and the messages
    /// read back match the source.
    #[test]
    fn dsh_copy_prefix_rewrites_identity_and_keeps_messages() {
        let cwd = "D:\\private\\project\\desktop-cc-gui";
        let root = std::env::temp_dir().join(format!("ccgui-fork-dsh-{}", uuid::Uuid::new_v4()));
        let session_id = branch_session_id(&uuid::Uuid::new_v4().to_string());
        let dir = root.join(&session_id);
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join(transcript_name(4));
        write_zstd_lines(&source, &transcript(&session_id, cwd, 4, true));

        let target = uuid::Uuid::new_v4().to_string();
        let landing = copy_prefix(&source, &target, usize::MAX).unwrap();

        // Landing path: the same directory + `session-<new id>` + the source file's generation name.
        assert_eq!(
            landing,
            root.join(branch_session_id(&target))
                .join("session.v4.jsonl.zstd"),
            "the landing path must be named by the new id and keep the source's generation name"
        );
        assert_eq!(
            landing,
            derive_landing(&source, &target).unwrap(),
            "derive_landing must derive the same path (registration uses it)"
        );
        assert!(landing.is_file());
        assert_eq!(
            std::fs::read_dir(landing.parent().unwrap()).unwrap().count(),
            1,
            "exactly one transcript in the branch directory (one more file means it was written wrong)"
        );

        // header: id = `session-<new id>` (equal to the directory name), cwd untouched.
        let branch_lines = lines_of(&landing);
        let header: serde_json::Value = serde_json::from_str(&branch_lines[0]).unwrap();
        assert_eq!(header["type"], "session");
        assert_eq!(header["id"], branch_session_id(&target));
        assert_eq!(
            header["id"].as_str().unwrap(),
            landing
                .parent()
                .unwrap()
                .file_name()
                .unwrap()
                .to_str()
                .unwrap(),
            "the directory name and the header's id must match exactly (discovery and reading both rely on it)"
        );
        assert_eq!(header["cwd"], cwd, "cwd isn't rewritten (the same reason as for Codex)");
        assert_eq!(header["version"], 4, "the generation is part of the transcript format, untouched");
        assert_eq!(header["agentPreset"], "standard", "no other field changes at all");

        // Messages: identical to the source one by one (the whole file moves).
        assert_eq!(messages_of(&landing), messages_of(&source));
        assert_eq!(
            messages_of(&landing),
            [
                "user:First question",
                "assistant:First answer",
                "user:Second question",
                "user:Sub-agent report (the second user record in one turn)",
                "assistant:Second answer",
            ],
            "fixture premise: system-reminder makes no message, and both user records of one turn stay"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// What is written really is zstd (plain `BufReader::lines()` reads it as binary garbage),
    /// and a multi-frame source is read across frames to the end, the shape of a dsh transcript (the first frame
    /// often holds only the header line).
    #[test]
    fn multi_frame_transcripts_are_read_across_frames() {
        let root = std::env::temp_dir().join(format!("ccgui-fork-dsh-{}", uuid::Uuid::new_v4()));
        let session_id = branch_session_id(&uuid::Uuid::new_v4().to_string());
        let dir = root.join(&session_id);
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join(transcript_name(4));
        let body = transcript(&session_id, "/ws", 4, true);
        write_multi_frame_lines(&source, &body);

        assert_eq!(
            lines_of(&source),
            body,
            "every line must read back (an implementation reading only the first frame would have only the header)"
        );

        let target = uuid::Uuid::new_v4().to_string();
        let landing = copy_prefix(&source, &target, usize::MAX).unwrap();
        let branch = lines_of(&landing);
        assert_eq!(branch.len(), body.len(), "no line may be lost");
        assert_eq!(branch[1..], body[1..], "identical apart from the header's id");
        assert_eq!(
            parsed_messages(&landing).len(),
            parsed_messages(&source).len(),
            "parsed again after a cross-frame copy, the message count must match"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// `keep_count` cuts after the anchor turn's `turn/end`; however many `user/message`s a turn holds
    /// doesn't change the cut.
    #[test]
    fn dsh_cut_lands_after_the_anchor_turns_end() {
        let (root, source, _id) = fixture(4, 4, true);
        let messages = parsed_messages(&source);
        let frames = HashSet::new();

        assert_eq!(
            keep_count(&source, &anchor("First question"), &messages, &frames),
            Some(6),
            "anchor turn = turn 1: cut after its turn/end (line 6 = turn 2's turn/start)"
        );
        assert_eq!(
            keep_count(&source, &anchor("Second question"), &messages, &frames),
            Some(usize::MAX),
            "anchor turn = turn 2: two user records in the turn don't change the cut"
        );
        assert_eq!(
            keep_count(&source, &anchor("This sentence isn't in the transcript"), &messages, &frames),
            None,
            "anchor not found → None (the caller reports an error, never falling back to the end)"
        );

        // Really copy with the result: the branch holds exactly turn 1, not one record more or less.
        let target = uuid::Uuid::new_v4().to_string();
        let landing = copy_prefix(&source, &target, 6).unwrap();
        assert_eq!(
            parsed_messages(&landing)
                .iter()
                .map(|m| m.text.clone())
                .collect::<Vec<_>>(),
            ["First question", "First answer"],
            "cut after turn/end: the anchor turn stays, nothing from turn 2's turn/start on gets in"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// An anchor turn without `turn/end` (unfinished): `None`, never a cut mid-turn and never up to the end.
    #[test]
    fn dsh_cut_refuses_a_turn_without_end() {
        let (root, source, _id) = fixture(4, 4, false);
        let messages = parsed_messages(&source);
        let frames = HashSet::new();

        assert_eq!(
            keep_count(&source, &anchor("Second question"), &messages, &frames),
            None,
            "an unfinished turn can't have a guessed cut"
        );
        // Turn 1 in the same file is complete and must still cut, so "no turn/end anywhere in the
        // file" and "only the last turn unfinished" aren't confused.
        assert_eq!(
            keep_count(&source, &anchor("First question"), &messages, &frames),
            Some(6)
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// Cleanup on failure: `cleanup_half_written` must delete the half-written directory whole (it would be
    /// scanned by `dsh_candidates()` as a real session), and be idempotent when the directory doesn't exist.
    ///
    /// Why test the function directly instead of causing a write failure: write failures can't be produced in a unit test.
    /// The only reliable failure is "the target transcript exists", but then the target directory is non-empty and is
    /// stopped first by the "already taken" check above (that path must never delete the directory, which may be
    /// someone else's; see `dsh_copy_prefix_never_adopts_an_occupied_directory`). What remains are real I/O
    /// errors (permissions, a full disk), which a unit test can't reproduce reliably. Pinning the cleanup function
    /// is worth more than an "end to end" test whose assertion is never reached.
    #[test]
    fn cleanup_half_written_removes_the_partial_directory() {
        let root = std::env::temp_dir().join(format!("ccgui-fork-dsh-cleanup-{}", uuid::Uuid::new_v4()));
        let dir = root.join(branch_session_id(&uuid::Uuid::new_v4().to_string()));
        let dest = dir.join(transcript_name(4));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&dest, b"half").unwrap();

        cleanup_half_written(&dir, &dest);
        assert!(
            !dir.exists(),
            "cleanup must delete the half-written directory whole (the scanner treats a directory as a real session)"
        );

        // Idempotent: on the failure path the directory may never have been made.
        cleanup_half_written(&dir, &dest);
        assert!(!dir.exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    /// A non-empty target directory → an explicit error, never overwriting nor deleting someone else's things.
    #[test]
    fn dsh_copy_prefix_never_adopts_an_occupied_directory() {
        let (root, source, _id) = fixture(4, 4, true);
        let target = uuid::Uuid::new_v4().to_string();
        let dir = root.join(branch_session_id(&target));
        std::fs::create_dir_all(&dir).unwrap();
        let foreign = dir.join("someone-elses-file.txt");
        std::fs::write(&foreign, "keep me").unwrap();

        let error = copy_prefix(&source, &target, usize::MAX).expect_err("a non-empty directory must be an error");
        assert!(error.contains("already taken"), "{error}");
        assert_eq!(std::fs::read_to_string(&foreign).unwrap(), "keep me");

        let _ = std::fs::remove_dir_all(&root);
    }

    /// An empty directory can be reused (the earlier failure was cleaned up, leaving only the shell): success, with
    /// exactly one transcript in it.
    #[test]
    fn dsh_copy_prefix_reuses_an_empty_directory() {
        let (root, source, _id) = fixture(4, 4, true);
        let target = uuid::Uuid::new_v4().to_string();
        let dir = root.join(branch_session_id(&target));
        std::fs::create_dir_all(&dir).unwrap();

        let landing = copy_prefix(&source, &target, usize::MAX).unwrap();
        assert_eq!(landing.parent().unwrap(), dir);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);

        let _ = std::fs::remove_dir_all(&root);
    }

    /// A generation mismatch is refused: the file name and the header's `version` are both sources of truth, and
    /// guessing one wrong writes a branch the host can't read or the app can't scan.
    #[test]
    fn dsh_copy_prefix_refuses_a_generation_mismatch() {
        // File name v3, header says 4.
        let (root, source, _id) = fixture(3, 4, true);
        let target = uuid::Uuid::new_v4().to_string();

        let error = copy_prefix(&source, &target, usize::MAX).expect_err("a generation mismatch must be an error");
        assert!(error.contains("generation"), "{error}");
        assert!(!root.join(branch_session_id(&target)).exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn dsh_source_ids_accept_the_prefixed_and_bare_forms() {
        let uuid_text = "3f7a1c2e-9b44-4d18-8a55-6c0d2e7b91af";
        assert!(source_id_ok(uuid_text), "a bare uuid is accepted too");
        assert!(source_id_ok(&format!("session-{uuid_text}")));
        // The real ids are `session-<uuid>`: a UUID check would shut them all out.
        assert!(!source_id_ok("session-"));
        assert!(!source_id_ok("session-not-a-uuid"));
        assert!(!source_id_ok(""));
        // Free text like titles must never reach argv or a path.
        assert!(!source_id_ok("my forked chat"));
        assert!(!source_id_ok("branch-3f7a1c2e-9b44-4d18-8a55-6c0d2e7b91af"));
    }

    /// This table row must really point at dsh's implementation (the table is the only allowlist).
    #[test]
    fn dsh_is_registered_in_the_fork_support_table() {
        let support = super::super::fork::fork_support("dsh").expect("dsh must be in the capability table");
        assert_eq!(support.engine, "dsh");
        assert!(
            support.derive_landing.is_some(),
            "dsh's landing path is derivable; registration shouldn't leave file_path empty"
        );
        assert!((support.source_id_ok)("session-3f7a1c2e-9b44-4d18-8a55-6c0d2e7b91af"));
        assert!(!(support.source_id_ok)("not-a-session"));
    }
}
