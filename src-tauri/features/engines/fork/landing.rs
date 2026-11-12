// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/fork/landing.rs.
//! Landing and registration: writing the branch transcript, registering the `sessions` row, rolling back on failure.

use super::*;
/// Registers the branch, folding both failure paths into an `Err` that rolls the file back too.
///
/// `register_fork_landing_with_path`'s `Ok(false)` (file missing, registration refused) is not
/// success: the command would return a `ForkPlan` that looks landed while no `sessions` row
/// exists, so opening the branch tab gives `session not found`, exactly the half state to avoid.
/// So `false` is treated like `Err`: the file just written is deleted here before reporting.
pub(super) fn register_fork_or_rollback(
    db: &crate::engines::support::db::Db,
    engine: &str,
    source_session_id: &str,
    target_session_id: &str,
    written: &Path,
    title: &str,
    degraded: &mut Vec<String>,
) -> Result<(), String> {
    let registered = register_fork_landing_with_path(
        db,
        engine,
        source_session_id,
        target_session_id,
        Some(&written.to_string_lossy()),
        Some(title),
        degraded,
    );
    match registered {
        Ok(true) => Ok(()),
        Ok(false) => {
            // The file vanished between writing and registering (deleted outside, quarantined by antivirus):
            // registration refuses a row pointing at a missing file, nothing is left to roll back, but it is never success.
            cleanup_fork_artifact(engine, written);
            Err(format!(
                "The branch transcript isn't registered (the file is missing): {}",
                written.display()
            ))
        }
        Err(error) => {
            cleanup_fork_artifact(engine, written);
            Err(error)
        }
    }
}


/// Rolls back branch artifacts by the capability table; without an entry it falls back to deleting the file
/// (an unknown engine shouldn't get here, but the rollback path must neither panic nor delete nothing).
pub(super) fn cleanup_fork_artifact(engine: &str, written: &Path) {
    let cleanup = fork_support(engine)
        .map(|support| support.cleanup)
        .unwrap_or(remove_written_file);
    cleanup(written);
}


/// Regression tests for rollback and bad-line semantics.
#[cfg(test)]
mod artifact_tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ccgui-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A dsh branch is a directory plus the transcript in it: rollback must delete the directory too, or
    /// that `session-<uuid>` stays taken (reusing the id would hit "directory already taken").
    #[test]
    fn dsh_rollback_removes_the_branch_directory_too() {
        let dir = temp_dir("dsh-rollback");
        let branch = dir.join("session-3f7a1c2e-9b44-4d18-8a55-6c0d2e7b91af");
        std::fs::create_dir_all(&branch).unwrap();
        let written = branch.join("session.v4.jsonl.zstd");
        std::fs::write(&written, b"x").unwrap();

        cleanup_fork_artifact("dsh", &written);

        assert!(!written.exists(), "the transcript should be deleted");
        assert!(!branch.exists(), "the branch directory should be deleted");
        assert!(dir.exists(), "the parent directory isn't ours and must stay");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A single-file engine (Claude / Codex) deletes only the file, never the parent directory: that is the
    /// engine's session directory, holding other sessions.
    #[test]
    fn rollback_for_file_only_engines_keeps_the_engine_directory() {
        let dir = temp_dir("claude-rollback");
        let written = dir.join("8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jsonl");
        std::fs::write(&written, b"x").unwrap();

        cleanup_fork_artifact("claude", &written);

        assert!(!written.exists());
        assert!(dir.exists(), "the engine's session directory isn't this fork's and must stay");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A non-UTF-8 line must move over as is: `BufRead::lines()` errors on it,
    /// contrary to the contract that a bad line never fails the whole fork.
    #[test]
    fn a_non_utf8_line_is_copied_verbatim_instead_of_failing_the_fork() {
        let dir = temp_dir("bad-utf8");
        let source = dir.join("source.jsonl");
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"{\"type\":\"x\"}\n");
        bytes.extend_from_slice(&[0xFF, 0xFE, b'\n']); // a line of invalid UTF-8
        bytes.extend_from_slice(b"\n"); // an empty line: not written out
        bytes.extend_from_slice(b"{\"type\":\"y\"}\n");
        std::fs::write(&source, &bytes).unwrap();

        let dest = dir.join("branch.jsonl");
        copy_plain_jsonl_prefix(&source, &dest, usize::MAX, |_| false).unwrap();

        let mut expected = Vec::new();
        expected.extend_from_slice(b"{\"type\":\"x\"}\n");
        expected.extend_from_slice(&[0xFF, 0xFE, b'\n']);
        expected.extend_from_slice(b"{\"type\":\"y\"}\n");
        assert_eq!(std::fs::read(&dest).unwrap(), expected);
        let _ = std::fs::remove_dir_all(&dir);
    }
}


/// A Codex branch's path: `<codex home>/sessions/YYYY/MM/DD/rollout-YYYY-MM-DDTHH-MM-SS-<id>.jsonl`,
/// with date and time in local time, as Codex itself names rollouts (its file names and date
/// directories are local time), so a branch among Codex's own files sorts correctly.
///
/// The codex home is found upward from the source: the parent of the nearest `sessions` / `archived_sessions` directory.
/// It must land back in `sessions/`: if the source was archived (`archived_sessions/rollout-*.jsonl`), a branch
/// landing in the archive would be refused by Codex on resume ("session … is archived", measured on 0.164).
/// Without such an ancestor (a non-standard layout, a test temp directory) it falls back to the source's directory.
///
/// The moment comes from the caller (production passes `chrono::Local::now()`): formatted in `now`'s own
/// time zone, never folded to UTC first.
pub(super) fn codex_branch_path<Tz: chrono::TimeZone>(
    source_path: &Path,
    target_session_id: &str,
    now: chrono::DateTime<Tz>,
) -> Result<PathBuf, String>
where
    Tz::Offset: std::fmt::Display,
{
    let name = format!(
        "rollout-{}-{target_session_id}.jsonl",
        now.format("%Y-%m-%dT%H-%M-%S")
    );
    let home = source_path.ancestors().skip(1).find_map(|dir| {
        match dir.file_name().and_then(|n| n.to_str()) {
            Some("sessions" | "archived_sessions") => dir.parent(),
            _ => None,
        }
    });
    let dir = match home {
        Some(home) => home
            .join("sessions")
            .join(now.format("%Y").to_string())
            .join(now.format("%m").to_string())
            .join(now.format("%d").to_string()),
        None => source_dir(source_path)?.to_path_buf(),
    };
    Ok(dir.join(name))
}


/// Landing a mid fork: copies the first `keep_records` records of the source transcript into the target session file.
///
/// It must finish before the engine spawns: both engines then read the file with an ordinary resume
/// (Claude `--resume <new id>`, Codex `thread/resume <new id>`), and fail without it.
///
/// Why both engines copy it themselves rather than using an engine-side "trim in place" facility:
/// - Claude has no history trimming facility (`--fork-session` forks only from the end).
/// - Codex's `thread/rollback` is an appended record (`event_msg/thread_rolled_back`
///   + `num_turns`), and the rolled-back turns stay in the transcript. The app's timeline would then show
///   content the model can no longer see, so view and model context disagree. Trimming the prefix ourselves
///   keeps them in step, with one mechanism for both engines.
///
/// Naming, encoding and identity rewrite are in the capability table (`ForkSupport::copy_prefix`); this only
/// gets the source session and calls it. The copy can't be inlined as a "move lines" loop: such a loop
/// assumes a plain JSONL transcript, while dsh's transcript is multi-frame zstd
/// (`history::extract::open_line_reader` wraps it in `zstd::stream::read::Decoder` for exactly this),
/// and reading it by line yields binary garbage. An unwritten assumption is worse than an explicit branch:
/// it doesn't fail to compile, it quietly writes a bad file for a new engine.
pub(crate) fn materialize_trimmed_fork(
    db: &crate::engines::support::db::Db,
    engine: &str,
    source_session_id: &str,
    target_session_id: &str,
    keep_records: usize,
) -> Result<PathBuf, String> {
    let support = ensure_fork_supported(engine)?;
    let source = crate::engines::history::reader::session_meta_by_id(db, engine, source_session_id)?
        .ok_or_else(|| format!("fork source vanished: {source_session_id}"))?;
    // The size guard is enforced by `fork_session` before parsing
    // (`ensure_fork_source_within_limit`), so it isn't repeated here: this function is its only
    // caller, and two checks would be two sources of truth.
    (support.copy_prefix)(
        Path::new(&source.file_path),
        target_session_id,
        keep_records,
    )
}


/// The source transcript's directory: where a Claude branch lands (the same directory keeps the engine's own
/// discovery rules and avoids every workspace path-encoding assumption), and Codex's fallback without a `sessions` ancestor.
pub(super) fn source_dir(source_path: &Path) -> Result<&Path, String> {
    source_path
        .parent()
        .ok_or_else(|| format!("The source transcript has no parent directory: {}", source_path.display()))
}


/// The plain-JSONL prefix copy skeleton shared by Claude and Codex (dsh is multi-frame zstd, written by its
/// own `copy_prefix`, not through this).
///
/// Copy rules:
/// - Lines aren't picked: auxiliary records (`attachment` / `mode` / `system` / `turn_context` …) move too,
///   since records' `parentUuid` points at them; picking only user/assistant would break the chain.
/// - Bad lines move as they are (the CLI tolerates them; one bad line doesn't fail the whole fork).
/// - The target uses `create_new`: it is a new uuid file and can't overwrite anything; on failure it is cleaned up.
///
/// The identity rewrite is injected by the caller as `rewrite_identity` (returning whether the line changed):
/// the rewrite rules differ per engine on purpose: Claude rewrites `sessionId` on every line, Codex only the first
/// `session_meta` (see the two `*_rewrite_identity` notes).
pub(super) fn copy_plain_jsonl_prefix(
    source_path: &Path,
    dest: &Path,
    keep_records: usize,
    rewrite_identity: impl Fn(&mut serde_json::Value) -> bool,
) -> Result<PathBuf, String> {
    if dest.exists() {
        // Never reuse a file with this name: it carries the UUIDv4 this call just generated, and a retry
        // only gets a new id, so a file already here belongs to someone else (left by an earlier failure,
        // placed by hand, written by another program). Using it would register an unrelated transcript
        // as the branch, much worse than an error. `create_new` refuses to overwrite anyway; this
        // just says the conflict plainly first.
        return Err(format!("The branch transcript path is already taken: {}", dest.display()));
    }

    let file = std::fs::File::open(source_path).map_err(|e| format!("Couldn't open the source transcript: {e}"))?;
    let mut reader = std::io::BufReader::new(file);
    use std::io::{BufRead, Write};
    let mut out = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dest)
        .map_err(|e| format!("Couldn't create the branch transcript: {e}"))?;

    let write_result = (|| -> Result<(), String> {
        // Read bytes, not `String` lines: `BufRead::lines()` returns `InvalidData` on non-UTF-8 bytes and
        // the whole fork would fail, while the contract here is "bad lines move as they are".
        // Transcripts should be UTF-8, but one line that isn't would make forking impossible with an error
        // that doesn't match the real cause. Reading bytes, whatever parses as JSON gets its identity
        // rewritten and anything that doesn't (non-UTF-8 included) is written as is, as the notes say.
        let mut buffer: Vec<u8> = Vec::new();
        let mut index = 0usize;
        loop {
            if index >= keep_records {
                break;
            }
            buffer.clear();
            let read = reader
                .read_until(b'\n', &mut buffer)
                .map_err(|e| format!("Couldn't read the source transcript: {e}"))?;
            if read == 0 {
                break;
            }
            // Strip the line ending (`lines()` also strips `\n` and a following `\r`).
            if buffer.last() == Some(&b'\n') {
                buffer.pop();
                if buffer.last() == Some(&b'\r') {
                    buffer.pop();
                }
            }
            index += 1;
            // Empty lines aren't written (as before); the line number still counts toward `keep_records`,
            // since the cut is given as a source line number.
            if buffer.iter().all(|byte| byte.is_ascii_whitespace()) {
                continue;
            }
            let rewritten: Vec<u8> = match std::str::from_utf8(&buffer) {
                // Not UTF-8: moved as is (it can't parse as JSON, so there's no identity to rewrite).
                Err(_) => buffer.clone(),
                Ok(text) => match serde_json::from_str::<serde_json::Value>(text) {
                    Ok(mut value) => {
                        if rewrite_identity(&mut value) {
                            serde_json::to_string(&value)
                                .map_err(|e| format!("Couldn't serialize a record: {e}"))?
                                .into_bytes()
                        } else {
                            buffer.clone()
                        }
                    }
                    // A bad line (the CLI tolerates it) moves as is; one bad line doesn't fail the whole fork.
                    Err(_) => buffer.clone(),
                },
            };
            out.write_all(&rewritten)
                .map_err(|e| format!("Couldn't write the branch transcript: {e}"))?;
            out.write_all(b"\n")
                .map_err(|e| format!("Couldn't write the branch transcript: {e}"))?;
        }
        out.flush().map_err(|e| format!("Couldn't flush the branch transcript: {e}"))
    })();

    if let Err(error) = write_result {
        // A half-written file must never stay in the engine's session directory looking like a real session: delete it, then report.
        drop(out);
        let _ = std::fs::remove_file(dest);
        return Err(error);
    }
    Ok(dest.to_path_buf())
}


/// How a Claude landing path is derived when none is named (`ForkSupport::derive_landing`).
///
/// Location and name: the source file's directory + `<new id>.jsonl`. `--resume` locates the transcript by
/// file name stem, so the name can only be the new id, nothing else; every line's `sessionId` must
/// match it (see `claude_rewrite_identity`).
pub(super) fn claude_derive_landing(source_path: &Path, target_session_id: &str) -> Result<PathBuf, String> {
    Ok(source_dir(source_path)?.join(format!("{target_session_id}.jsonl")))
}


/// Claude's identity rewrite: the top-level `sessionId` on every line (the file name stem and in-line id must
/// match; the CLI locates by stem). Records without the key (auxiliary records, bad lines) move as they are.
pub(super) fn claude_rewrite_identity(value: &mut serde_json::Value, target_session_id: &str) -> bool {
    let Some(object) = value.as_object_mut() else {
        return false;
    };
    if !object.contains_key("sessionId") {
        return false;
    }
    object.insert(
        "sessionId".to_string(),
        serde_json::Value::String(target_session_id.to_string()),
    );
    true
}


/// Claude's prefix copy: plain JSONL moved by line, identity rewritten on every line (see `claude_rewrite_identity`).
pub(super) fn claude_copy_prefix(
    source_path: &Path,
    target_session_id: &str,
    keep_records: usize,
) -> Result<PathBuf, String> {
    let dest = claude_derive_landing(source_path, target_session_id)?;
    copy_plain_jsonl_prefix(source_path, &dest, keep_records, |value| {
        claude_rewrite_identity(value, target_session_id)
    })
}


/// Codex's prefix copy: plain JSONL moved by line, identity rewritten only on the first `session_meta`
/// (see `codex_rewrite_identity`). Location and naming are in `codex_branch_path`.
///
/// `discovery.rs`'s `codex_candidates()` takes only `rollout-*.jsonl` (by
/// `starts_with("rollout-")`); a `<new id>.jsonl` would be ignored by our own scanner forever,
/// so registration would get no path and the branch tab no history.
///
/// This is also why Codex's `derive_landing` is `None`: the timestamp in the name is taken at the moment
/// of writing, and the same name can't be derived afterwards.
///
/// Only the first one: older Codex native forks replay the parent's `session_meta` into the child
/// too; that line describes the parent and stays as is (usage statistics and other readers read only the first).
pub(super) fn codex_copy_prefix(
    source_path: &Path,
    target_session_id: &str,
    keep_records: usize,
) -> Result<PathBuf, String> {
    let dest = codex_branch_path(source_path, target_session_id, chrono::Local::now())?;
    // Date directories are created as needed; rollback deletes only the file and deliberately leaves a possibly
    // empty date directory: Codex creates the same directories, and deleting one could race Codex writing a new rollout in it.
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Couldn't create the branch session directory: {e}"))?;
    }
    let rewritten = std::cell::Cell::new(false);
    copy_plain_jsonl_prefix(source_path, &dest, keep_records, |value| {
        if rewritten.get() || !codex_rewrite_identity(value, target_session_id) {
            return false;
        }
        rewritten.set(true);
        true
    })
}


/// Codex's identity rewrite: the thread identity is in `session_meta.payload`, rewritten in the shape of
/// Codex's own fork (as `codex exec fork` writes it, measured on 0.164):
/// - `id` → the new id: Codex finds the thread by it (and by the id in the file name);
/// - `session_id` (from 0.16x) → the new id: Codex shows it as the session number and uses it as the prompt
///   cache key; left as the source's, Codex would treat the branch as the same session;
/// - `forked_from_id` → the source id, kept if already set: it marks lineage, and usage statistics use it
///   to attribute the copied old records to the same lineage without double counting.
///   When the source is itself a native fork, its `forked_from_id` and `history_base` point at the ancestor
///   together, and overwriting it would make them contradict.
///
/// Every other field on this line (`history_base` included) stays as is. Measured on 0.164, resuming a branch
/// of this shape gives the model exactly the source's context before that turn, with no duplicates.
///
/// `cwd` is left alone: the branch always shares the source's workspace, so the rollout already has the right
/// path; rewriting it would add a possibly inconsistent source (the DB's workspace_path vs the rollout's cwd), which
/// would quietly run the branch elsewhere whenever the two are spelled differently. Every field left alone is one less way to break.
pub(super) fn codex_rewrite_identity(value: &mut serde_json::Value, target_session_id: &str) -> bool {
    let Some(object) = value.as_object_mut() else {
        return false;
    };
    if object.get("type").and_then(serde_json::Value::as_str) != Some("session_meta") {
        return false;
    }
    let Some(payload) = object
        .get_mut("payload")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return false;
    };
    let target = serde_json::Value::String(target_session_id.to_string());
    let source_id = payload
        .insert("id".to_string(), target.clone())
        .and_then(|old| old.as_str().map(str::to_string))
        .filter(|old| !old.trim().is_empty() && old != target_session_id);
    if payload.contains_key("session_id") {
        payload.insert("session_id".to_string(), target);
    }
    // An existing non-empty lineage is kept; only a missing, `null` or empty one gets the source id.
    let has_lineage = payload
        .get("forked_from_id")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|parent| !parent.trim().is_empty());
    if let (false, Some(source_id)) = (has_lineage, source_id) {
        payload.insert(
            "forked_from_id".to_string(),
            serde_json::Value::String(source_id),
        );
    }
    true
}


/// Copies the source session's internal frame identities to the branch whole, in one statement.
///
/// Why not `db.record_accepted_internal_frame_hash`: that is a one-at-a-time
/// helper with no cap at all (the cap exists only in the IPC command
/// `reader::record_accepted_internal_frame`); calling it per frame would make one fork issue 2N
/// statements (each also deleting `fts_state`), and its `Ok(false)` means "this identity is already
/// there", nothing to do with a cap. This copy is one `INSERT ... SELECT`: one read and write, one to one
/// with the source set, checked against the same constants as the IPC path.
///
/// If it doesn't fit, it fails rather than copying fewer: copying fewer would make the branch show internal
/// frames that should be hidden while the command reports success, with no visible difference from the
/// source. The same reason `record_accepted_internal_frame` fails at its cap.
pub(super) fn copy_accepted_frames(
    conn: &rusqlite::Connection,
    engine: &str,
    source_session_id: &str,
    target_session_id: &str,
    workspace_path: &str,
    source_count: usize,
) -> Result<(), String> {
    if source_count == 0 {
        return Ok(());
    }
    // The same measure as the IPC path: first what this branch row has left, then the whole table.
    let (target_count, total): (i64, i64) = conn
        .query_row(
            "SELECT
                (SELECT COUNT(*) FROM cli_accepted_internal_frames
                  WHERE engine=?1 AND session_id=?2),
                (SELECT COUNT(*) FROM cli_accepted_internal_frames)",
            rusqlite::params![engine, target_session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("Couldn't count the recorded internal frame identities: {e}"))?;
    let headroom = (MAX_RECORDED_FRAMES_PER_SESSION - target_count)
        .min(MAX_RECORDED_FRAMES_TOTAL - total)
        .max(0);
    if source_count as i64 > headroom {
        return Err(format!(
            "Recorded internal frame identities are at their limit ({MAX_RECORDED_FRAMES_PER_SESSION} per session / {MAX_RECORDED_FRAMES_TOTAL} in all), so the source session's {source_count} identities can't be copied to the branch; the fork was cancelled"
        ));
    }
    conn.execute(
        "INSERT OR IGNORE INTO cli_accepted_internal_frames(engine, session_id, frame_hash, workspace_path)
         SELECT ?1, ?2, frame_hash, ?3 FROM cli_accepted_internal_frames
          WHERE engine=?1 AND session_id=?4
          ORDER BY rowid
          LIMIT ?5",
        rusqlite::params![
            engine,
            target_session_id,
            workspace_path,
            source_session_id,
            source_count as i64
        ],
    )
    .map_err(|e| format!("Couldn't copy the recorded internal frame identities: {e}"))?;
    // For the same reason as the IPC path: the FTS stamp only tracks file stat + INDEX_VERSION, and internal frames
    // moved into the branch transcript may already be indexed; without deleting the stamp they stay searchable
    // forever. One delete for the whole batch is enough.
    conn.execute(
        "DELETE FROM cli_fts_state WHERE engine=?1 AND session_id=?2",
        rusqlite::params![engine, target_session_id],
    )
    .map_err(|e| format!("Couldn't reset the branch session's index stamp: {e}"))?;
    Ok(())
}


/// Registers the new session in the app's own table after the fork lands.
///
/// `materialize_trimmed_fork` writes the prefix file first, and this row must follow, or:
///   - the branch doesn't appear in the sidebar (`emit_sessions_changed` only rereads the table, no rescan);
///   - opening the fork tab makes `load_session_page` report `session not found`.
///
/// Session memory (model / effort / provider) is copied from the source session; the title comes from the
/// caller (`fork_session` built `<source's current name> (fork #N)` with `next_fork_title`), falling back
/// to the source's current name only when none is given.
/// `explicit_path` can name where the transcript really landed (otherwise derived by the table:
/// `ForkSupport::derive_landing`; for an engine that can't, `file_path` stays empty for the scanner).
/// If the file doesn't exist yet it returns `Ok(false)` and never registers a row for a missing file; the
/// caller must treat `false` as failure (`register_fork_or_rollback` rolls the file back too).
pub(crate) fn register_fork_landing_with_path(
    db: &crate::engines::support::db::Db,
    engine: &str,
    source_session_id: &str,
    target_session_id: &str,
    explicit_path: Option<&str>,
    title: Option<&str>,
    degraded: &mut Vec<String>,
) -> Result<bool, String> {
    let source = crate::engines::history::reader::session_meta_by_id(db, engine, source_session_id)?
        .ok_or_else(|| format!("fork source vanished: {source_session_id}"))?;
    let target = landing_target(engine, &source, target_session_id, explicit_path)?;
    if target.as_ref().is_some_and(|target| !target.is_file()) {
        // A missing file refuses registration (`Ok(false)`); never write a row for a missing file.
        // The caller must treat it as failure (see `register_fork_or_rollback`): there is no
        // "try again on the next send"; a command reporting success with no row is a half state.
        return Ok(false);
    }
    // Frame identities: copy the source's set. Without it, internal frames hidden in the branch
    // would show again: the new id's set is empty, as if no frame had ever been
    // accepted. The branch summary is computed with this set too (it decides which frames are hidden), so get it first.
    let (frames, _) = db.accepted_internal_frames(engine, source_session_id)?;
    let row = branch_row(engine, target.as_deref(), &frames, &source, title)?;
    insert_branch_rows(
        db,
        engine,
        source_session_id,
        target_session_id,
        &source.workspace_path,
        frames.len(),
        &row,
    )?;
    inherit_session_memory(db, engine, target_session_id, &source, degraded);
    Ok(true)
}


/// The branch transcript's path; `None` = this engine can't derive it and the caller didn't name it.
///
/// Following the identity rules: an engine that can derive the path (Claude locates by file name
/// stem, so the place is the source file's directory, reused directly, avoiding every workspace
/// path-encoding assumption) goes through `ForkSupport::derive_landing`; an engine that can't (Codex's
/// rollout name is chosen by `materialize_trimmed_fork` as `rollout-<ts>-<id>.jsonl` and named
/// by the caller) leaves `file_path` empty for the scanner rather than guessing
/// a path that may be wrong.
fn landing_target(
    engine: &str,
    source: &crate::engines::history::SessionMeta,
    target_session_id: &str,
    explicit_path: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    match explicit_path {
        // The caller named the landing path: use it.
        Some(path) if !path.trim().is_empty() => Ok(Some(PathBuf::from(path))),
        _ => match fork_support(engine).and_then(|support| support.derive_landing) {
            Some(derive_landing) => {
                derive_landing(Path::new(&source.file_path), target_session_id).map(Some)
            }
            // No path given and none derivable: don't guess a file name; register a row so the branch shows in the
            // sidebar, and leave `file_path` empty for the scanner.
            None => Ok(None),
        },
    }
}


/// The values of the branch's row in the `sessions` table.
struct BranchRow {
    file_path: String,
    file_size: i64,
    file_mtime_ms: i64,
    /// The transcript-derived title (`title` column), not the branch title; see `branch_row`.
    title: String,
    preview: String,
    created_at: Option<i64>,
    updated_at: Option<i64>,
    message_count: i64,
    /// The branch title (`custom_title` column), the only source of the fork number.
    custom_title: String,
}


/// The branch row's values read from the real file (title/preview/times/count all parsed, nothing guessed).
/// With an unknown path (the caller named none and the table can't derive one, see `landing_target`) the
/// statistics stay empty for the scanner to fill.
fn branch_row(
    engine: &str,
    target: Option<&Path>,
    frames: &std::collections::HashSet<String>,
    source: &crate::engines::history::SessionMeta,
    title: Option<&str>,
) -> Result<BranchRow, String> {
    let (summary, file_size, file_mtime_ms) = match target {
        Some(path) => {
            let summary = crate::engines::history::scan_summary_file(engine, path, frames)?;
            let (size, mtime_ms) = crate::engines::history::stat_signature(path)
                .ok_or_else(|| format!("Couldn't read the branch transcript: {}", path.display()))?;
            (summary, size, mtime_ms)
        }
        None => (
            crate::engines::history::ScanSummary {
                title: String::new(),
                preview: String::new(),
                first_ts: None,
                last_ts: None,
                message_count: 0,
            },
            0,
            0,
        ),
    };
    // The `title` column must hold the scanner-derived title (`summary.title`), never the branch
    // title. Sharing one value between the two columns breaks two things at once:
    //
    //   1. `title` should be "the transcript's first user message"; writing `… (fork #N)` makes the row's
    //      `title` false for a while: rows not rescanned show the branch title in the sidebar, rescanned
    //      rows the derived title, so one batch of branches shows inconsistently.
    //   2. `title` is an unrenamed session's effective name (`taken_titles` folds both columns into one),
    //      so the branch would count as its own source's sibling: after `A`'s #1 branch writes its title into
    //      `title`, the next branch's "sibling max" gives #3 (#1 is itself). When a rescan
    //      overwrites `title` with the derived title the number goes back to #2: the same action gets
    //      different numbers depending on whether a rescan happened in between.
    //
    // So the fork number comes only from `custom_title`; `title` is a faithful projection of the transcript.
    Ok(BranchRow {
        file_path: target
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
        file_size,
        file_mtime_ms,
        title: summary.title.trim().to_string(),
        preview: summary.preview,
        created_at: summary.first_ts.or(Some(file_mtime_ms)),
        updated_at: summary.last_ts.or(Some(file_mtime_ms)),
        message_count: summary.message_count,
        custom_title: branch_custom_title(title, source),
    })
}


/// `custom_title` (the sidebar label) uses the branch title the caller gave: `fork_session` already built
/// `<source's current name> (fork #N)` with `next_fork_title` (the suffix is language-neutral, with no
/// frontend wording). Without one it falls back to the source's current name, with no suffix: better one
/// marker less than hard-coding a suffix in one language here.
fn branch_custom_title(title: Option<&str>, source: &crate::engines::history::SessionMeta) -> String {
    title
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            source
                .custom_title
                .clone()
                .filter(|t| !t.trim().is_empty())
                .unwrap_or_else(|| source.title.clone())
        })
        .trim()
        .to_string()
}


/// Internal frame identities + the `sessions` row + `custom_title` are written in one transaction (the shape
/// follows scanner.rs: `db.0.lock()` → `conn.transaction()`): all three succeed or
/// none do. An INSERT that succeeds with an UPDATE that fails would leave an untitled orphan row;
/// frame identities written without the `sessions` row would leave a record set with no session that
/// neither the scan nor `remove_workspace` recognizes again, and the caller can only delete the file.
fn insert_branch_rows(
    db: &crate::engines::support::db::Db,
    engine: &str,
    source_session_id: &str,
    target_session_id: &str,
    workspace_path: &str,
    source_frame_count: usize,
    row: &BranchRow,
) -> Result<(), String> {
    let mut conn = db.0.lock();
    let tx = conn
        .transaction()
        .map_err(|e| format!("Couldn't start the registration transaction: {e}"))?;
    copy_accepted_frames(
        &tx,
        engine,
        source_session_id,
        target_session_id,
        workspace_path,
        source_frame_count,
    )?;
    // The sessions row carries the signature of the copied record set, so it is derived again for the
    // target session in the same transaction: leaving the column out gives '' (NOT NULL DEFAULT ''), which
    // disagrees with what accepted_internal_frames derives, and the scanner uses it to decide which frames
    // the row hides; a wrong signature shows them again or hides too few.
    let (_, signature) =
        crate::engines::support::db::accepted_internal_frames_from(&tx, engine, target_session_id)?;
    tx.execute(
        "INSERT INTO cli_sessions(engine, session_id, workspace_path, file_path, file_size,
                              file_mtime_ms, title, preview, created_at, updated_at,
                              message_count, accepted_frames_signature)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
         ON CONFLICT(engine, session_id) DO UPDATE SET
            workspace_path=excluded.workspace_path,
            file_path=excluded.file_path,
            file_size=excluded.file_size,
            file_mtime_ms=excluded.file_mtime_ms,
            title=excluded.title,
            preview=excluded.preview,
            updated_at=excluded.updated_at,
            message_count=excluded.message_count,
            accepted_frames_signature=excluded.accepted_frames_signature",
        rusqlite::params![
            engine,
            target_session_id,
            workspace_path,
            row.file_path,
            row.file_size,
            row.file_mtime_ms,
            row.title,
            row.preview,
            row.created_at,
            row.updated_at,
            row.message_count,
            signature,
        ],
    )
    .map_err(|e| format!("Couldn't register the branch session: {e}"))?;
    // upsert_rows doesn't touch custom_title; a fork sets it explicitly, or the sidebar falls back to the
    // title derived from the transcript and the branch doesn't look like one. This column is the fork number's only source.
    tx.execute(
        "UPDATE cli_sessions SET custom_title=?3 WHERE engine=?1 AND session_id=?2",
        rusqlite::params![engine, target_session_id, row.custom_title],
    )
    .map_err(|e| format!("Couldn't set the fork's title: {e}"))?;
    tx.commit()
        .map_err(|e| format!("Couldn't register the branch session: {e}"))
}


/// The three session memory rows: reuse the existing helpers, no hand-written SQL.
///
/// A failed write doesn't roll the branch back: the file and the `sessions` row exist by now, and deleting
/// the whole branch over three rows of "remember the last model" would be backwards. But it can't be silent:
/// silently, the branch would run on the engine's default model while the person assumes the source's. So each item is logged and the degradation reported honestly, no `let _ =`.
fn inherit_session_memory(
    db: &crate::engines::support::db::Db,
    engine: &str,
    target_session_id: &str,
    source: &crate::engines::history::SessionMeta,
    degraded: &mut Vec<String>,
) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let present = |value: &Option<String>| value.clone().filter(|v| !v.trim().is_empty());
    if let Some(model) = present(&source.model) {
        if let Err(e) = db.remember_session_model(engine, target_session_id, &model, now) {
            degraded.push("model".into());
            eprintln!("[fork] branch {target_session_id} couldn't inherit the model ({e})");
        }
    }
    if let Some(effort) = present(&source.effort) {
        if let Err(e) = db.remember_session_effort(engine, target_session_id, &effort, now) {
            degraded.push("effort".into());
            eprintln!("[fork] branch {target_session_id} couldn't inherit the effort level ({e})");
        }
    }
    if let Some(provider) = present(&source.provider) {
        if let Err(e) = db.remember_session_provider(engine, target_session_id, &provider, now) {
            degraded.push("provider".into());
            eprintln!("[fork] branch {target_session_id} couldn't inherit the provider ({e})");
        }
    }
}

