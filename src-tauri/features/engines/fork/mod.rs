//! Session fork (Fork Conversation).
//!
//! Design notes: desktop-cc-gui's `docs/design/session-fork-conversation.zh-CN.md`.
//!
//! Two paths:
//!
//! - Tip fork (the fork point is the source's end): copies the whole source transcript (`keep_records`
//!   is `usize::MAX`), through the same "write the prefix + register" mechanism as a mid fork.
//! - Mid fork (an earlier fork point): copies a record prefix of the source transcript into the target
//!   session file, which then continues with an ordinary `--resume <new id>`.
//!
//! Written on click: the `fork_session` command resolves the cut, writes the prefix file and registers the
//! `sessions` row; when it returns the fork exists, without going through the send path.
//!
//! Engine differences live in one place, the `ForkSupport` capability table. The main flow (resolve the cut →
//! write the prefix → register → roll back) has no engine special cases; a new engine adds one table row.
//!
//! A fork point always falls on a whole-turn boundary (question + answer): half a turn with a question and
//! no answer isn't worth keeping, and dropping it on fork is correct.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// The frame-identity caps share constants with the IPC path (`reader::record_accepted_internal_frame`): a
// fork copies the same identities from the same table, and two numbers written separately would drift.
use crate::engines::history::reader::{MAX_RECORDED_FRAMES_PER_SESSION, MAX_RECORDED_FRAMES_TOTAL};

mod anchor;
mod landing;
mod title;

use anchor::*;
use landing::*;
use title::*;

// anchor_turn is used by the sibling fork_dsh, re-exported with crate visibility.
pub(crate) use anchor::anchor_turn;

// These two names are pub (fork_dsh uses them).
pub use anchor::{text_sha256_hex, ForkAnchor};

/// What `fork_session` returns: a branch already on disk (the command wrote the prefix file and registered
/// the `sessions` row; the frontend opens `target_session_id` and reads its history directly).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkPlan {
    /// The source session id.
    pub source_session_id: String,
    /// The source session's engine.
    pub source_engine: String,
    /// The source session's workspace (`sessions.workspace_path`), not the caller's current workspace. The
    /// branch is registered under it, and Claude's `--resume <new id>` only finds a transcript in the cwd's
    /// project directory: the frontend must open the branch in it, or the branch's first message would spawn
    /// in another cwd and might not find its transcript.
    pub workspace_path: String,
    /// The new session id for the branch (UUIDv4). For Claude it must be both the file name stem
    /// and every line's `sessionId` (`--resume` locates by stem and checks it is a valid UUID).
    pub target_session_id: String,
    /// Whether the fork point is the source's end, i.e. the whole transcript moved over
    /// (`keep_records == usize::MAX`); also true when the anchor is exactly the last turn.
    pub at_tip: bool,
    /// How many source records the branch keeps (`usize::MAX` = the whole file).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_records: Option<usize>,
    /// The source session's current name (`custom_title` when non-empty, else the `title` derived from the
    /// transcript), for the frontend to show the branch title at once. The `<current name> (fork #N)` rule builds
    /// on it: the branch title appends to it and strips nothing (see `next_fork_title`).
    pub source_title: String,
    /// Items that were degraded but still count as success (today the last step's session memory: `model` /
    /// `effort` / `provider`). The branch exists, these just weren't inherited, so the first turn uses the
    /// engine's defaults; the frontend tells the person instead of letting them assume it matches the source.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub degraded: Vec<String>,
}

/// Shape check for fork session ids: must be a valid UUID.
///
/// Claude's `--resume` rejects a value that is neither a UUID nor a title
/// (`is not a UUID and does not match any session title`), so a new id can only be a
/// UUIDv4. Source ids must be UUIDs too, so no free text like a title lands in argv.
///
/// It is only the `source_id_ok` of two table rows (both engines' source ids are UUIDs), not a rule for
/// every engine: an engine with differently shaped ids swaps this entry in its row.
pub fn is_uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok()
}

/// The same single-line parse as parse_session_file: a bad line is skipped and doesn't fail the whole file.
pub(crate) fn parse_json_line(line: &str) -> Option<serde_json::Value> {
    let trimmed = line.trim();
    if trimmed.is_empty() || !trimmed.contains('"') {
        return None;
    }
    serde_json::from_str::<serde_json::Value>(trimmed).ok()
}

/// One engine's fork capabilities: every engine difference in the `fork_session` flow lives here.
///
/// Why a table and not methods on the `Engine` trait: `Engine`'s methods are queried on the send/launch
/// path (`drives_own_transport` on every `send_reserved`), while fork capabilities are looked up once in the
/// `fork_session` command. On the trait, the other ten engines that can never fork would all have to
/// implement it or take an empty default, an abstraction for a guessed future need.
///
/// How the next engine comes in:
/// - If its cut rule and on-disk shape can reuse what exists (another plain JSONL), add a row whose
///   capabilities point at the existing functions;
/// - if it needs new cut semantics or a new on-disk shape (like dsh: a multi-frame zstd transcript
///   whose cut goes through its own extractor), put it in a new file and add a row pointing at it;
/// - none of this changes: `fork_session`'s orchestration (size guard → resolve → title → write → register
///   → roll back), command registration, title numbering, the transaction that copies internal frames.
///
/// Conversely, these are deliberately not unified; don't merge them in a later refactor (implementations
/// with a real semantic difference aren't forced together):
/// - `keep_count`: Claude cuts at the next visible user record (its record chain is linear with no turn
///   markers); Codex must cut after the anchor turn's end marker (`task_complete` or `turn_aborted`). The asymmetry on a missed anchor
///   is deliberate too: Claude's last turn returns the whole file, Codex's unfinished turn returns `None` (an
///   explicit error), never "take the tail on failure".
/// - Identity rewrite: Claude rewrites `sessionId` on every line; Codex rewrites only the first `session_meta` (new `id` /
///   `session_id`, adds `forked_from_id`, the same shape as Codex's own fork) and deliberately leaves `cwd`.
///   A "configurable field list" would turn "every field left alone is one less way to break" into guesswork.
/// - Where it lands and its name: Claude writes `<new id>.jsonl` beside the source; Codex writes into the same Codex
///   home's `sessions/<local date>/rollout-<local time>-<new id>.jsonl` (`discovery.rs`'s
///   `codex_candidates()` only takes the `rollout-` prefix; Codex refuses to resume sessions in the archive).
///   Not a path template.
pub(crate) struct ForkSupport {
    /// The engine id: the same value as `sessions.engine` and `Engine::id()`; the table is keyed by it.
    pub engine: &'static str,
    /// The shape of a session id this engine can fork from.
    ///
    /// Can't be unified into a UUID check: `--resume` takes only UUIDs and refuses free text like titles in
    /// argv, which is Claude's own file name constraint; dsh's real ids are `session-<uuid>`, and a UUID check
    /// would shut them all out. The branch's new id shape is `target_id`, unrelated to this.
    pub source_id_ok: fn(&str) -> bool,
    /// The shape of the branch's new id.
    ///
    /// Claude / Codex use a bare UUIDv4 (Claude's `--resume` locates by file name stem and checks it is a valid
    /// UUID; an extra prefix is refused); dsh's canonical id carries a `session-` prefix: the directory name,
    /// the header's `id` and the host's own projection cache key all use that shape.
    ///
    /// The shape must match everywhere. The host builds its projection cache by the id it is given: with
    /// `session-<uuid>` on disk and a bare UUID over IPC, the projection misses the transcript and the model
    /// can't read the inherited conversation (the interface shows history, the agent says it has no context).
    pub target_id: fn() -> String,
    /// Record-level cut: the branch keeps the first N records of the source transcript.
    ///
    /// What's needed here is how this engine locates the cut, not a second rule for which raw record is a
    /// user message: which turn is the anchor is decided by `anchor_turn` alone (see its notes for why).
    /// The last argument is the accepted internal frame identities, which `user_row_lines` needs to match the extractor.
    pub keep_count: fn(
        &Path,
        &ForkAnchor,
        &[crate::engines::history::Message],
        &std::collections::HashSet<String>,
    ) -> Option<usize>,
    /// Writes the branch transcript (name + encoding + identity rewrite + cleanup on failure) and returns the path written.
    ///
    /// The arguments are `(source transcript path, branch's new id, records kept)`. Naming and encoding stay inside
    /// because copying a prefix depends on them: plain JSONL can be moved line by line, dsh's multi-frame zstd
    /// can't. Don't split it into "naming" + "generic copy".
    pub copy_prefix: fn(&Path, &str, usize) -> Result<PathBuf, String>,
    /// How the landing path is derived when none is named (used by `register_fork_landing_with_path`).
    ///
    /// `None` = this engine can't derive it: better to leave `file_path` empty for the scanner to fill than guess
    /// a path that may be wrong; Codex's rollout name carries the write time's timestamp, which can't be
    /// recreated afterwards.
    pub derive_landing: Option<fn(&Path, &str) -> Result<PathBuf, String>>,
    /// Removes the branch artifacts just written, on rollback (the argument is the path `copy_prefix` returned).
    ///
    /// Why it differs per engine: a dsh branch is a directory plus the transcript inside it
    /// (`session-<uuid>/session.v<N>.jsonl.zstd`). Removing only the file leaves an empty directory, so the
    /// id stays taken, and reusing it hits `copy_prefix`'s "directory already taken" check.
    /// The other two engines' branches are a single file.
    pub cleanup: fn(&Path),
}

/// Rollback: remove the written branch file. A Claude / Codex branch is that one file.
fn remove_written_file(written: &Path) {
    let _ = std::fs::remove_file(written);
}

/// The capability table: the only fork allowlist (not found = this engine can't fork sessions yet).
///
/// The frontend's `FORK_ENGINES` mirrors this table; when adding an engine change
/// both (the frontend has no other way to know which engines the backend accepts).
const FORK_SUPPORT: &[ForkSupport] = &[CLAUDE_FORK, CODEX_FORK, super::fork_dsh::DSH_FORK];

/// Looks up the capability table by engine id. Two rows, searched linearly; no map for this.
pub(crate) fn fork_support(engine: &str) -> Option<&'static ForkSupport> {
    FORK_SUPPORT.iter().find(|support| support.engine == engine)
}

/// Engines without capabilities are refused; resolving and writing share one sentence, so the same
/// refusal isn't worded two ways.
fn ensure_fork_supported(engine: &str) -> Result<&'static ForkSupport, String> {
    fork_support(engine).ok_or_else(|| format!("This engine can't fork sessions yet: {engine}"))
}

/// Claude: a plain JSONL transcript; `--resume <new id>` finds it by file name stem.
const CLAUDE_FORK: ForkSupport = ForkSupport {
    engine: "claude",
    source_id_ok: is_uuid,
    target_id: new_bare_uuid,
    keep_count: fork_keep_count,
    copy_prefix: claude_copy_prefix,
    derive_landing: Some(claude_derive_landing),
    cleanup: remove_written_file,
};

/// The branch's new id (Claude / Codex): a bare UUIDv4.
///
/// Claude's `--resume` checks the file name stem as the id and refuses an extra prefix; Codex's file name
/// plays no part in locating it, so a bare UUID works there too.
fn new_bare_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Codex: a plain JSONL rollout; `thread/resume <new id>` locates it by the thread id inside
/// (the file name plays no part; see `codex_rewrite_identity`).
const CODEX_FORK: ForkSupport = ForkSupport {
    engine: "codex",
    source_id_ok: is_uuid,
    target_id: new_bare_uuid,
    keep_count: fork_keep_count_codex,
    copy_prefix: codex_copy_prefix,
    derive_landing: None,
    cleanup: remove_written_file,
};

/// dsh: a multi-frame zstd transcript at `<source dir>/session-<new id>/session.v<N>.jsonl.zstd`
/// (the directory name and the header's `id` must match exactly). The cut, encoding and identity rewrite are
/// in `fork_dsh.rs`: dsh differs in the whole on-disk shape, not just the path, so by the table's rule it
/// gets its own file. Source ids are `session-<uuid>` (bare uuids too), and the branch's new id also carries
/// the `session-` prefix (the same shape as its directory name, header and host cache key; see `target_id`).
///
/// No `const DSH_FORK` alias here: the table names `super::fork_dsh::DSH_FORK` directly, and an alias
/// would only add an unread constant (and a `dead_code` warning).

/// Resolves one fork request: finds the source session, checks shapes, computes the record-level cut, assigns a new id.
///
/// Only resolves and assigns; writing the prefix file and registering the `sessions` row is `fork_session`'s next step.
///
/// The largest source transcript a fork may move (the same measure as `reader.rs`'s `MAX_REMOTE_SESSION_BYTES`).
/// Over it, an explicit error; no large synchronous copy.
const MAX_FORK_SOURCE_BYTES: u64 = 64 * 1024 * 1024;

/// Refuses over the limit, and runs before anything is read (see where `fork_session` calls it).
///
/// A plain transcript (Claude / Codex) is checked by `metadata().len()`, barely touching the content: the
/// cheapest entry check. Without metadata it neither passes nor wrongly refuses; it reports the error.
///
/// A compressed transcript (dsh's zstd) must be measured decoded: `metadata()` gives the compressed
/// size (about 2.7× smaller in practice), so comparing it to 64 MiB would loosen the real limit to ~170 MiB,
/// and this path decodes the source several times (parse, count anchors, find `turn/end`, copy the prefix).
/// This decodes as a stream and stops at the limit: one bounded read, not a whole decode.
fn ensure_fork_source_within_limit(
    db: &crate::engines::support::db::Db,
    engine: &str,
    session_id: &str,
) -> Result<(), String> {
    let source = crate::engines::history::reader::session_meta_by_id(db, engine, session_id)?
        .ok_or_else(|| format!("session not found: {engine}/{session_id}"))?;
    let path = std::path::Path::new(&source.file_path);
    let compressed_bytes = std::fs::metadata(path)
        .map_err(|e| format!("Couldn't read the source session's size ({}): {e}", source.file_path))?
        .len();
    let bytes = if source.file_path.ends_with(".zstd") {
        decompressed_len_bounded(path).unwrap_or(compressed_bytes)
    } else {
        compressed_bytes
    };
    if bytes > MAX_FORK_SOURCE_BYTES {
        return Err(format!(
            "The source transcript is {} MiB, over the {} MiB limit, so it can't be forked",
            bytes / (1024 * 1024),
            MAX_FORK_SOURCE_BYTES / (1024 * 1024),
        ));
    }
    Ok(())
}

/// Counts decoded bytes, stopping at the limit (only for compressed transcripts; see the caller).
///
/// `None` means it can't be decoded (a damaged file / an unknown encoder): the caller falls back to the
/// compressed size and lets the real parse report the specific error, rather than refusing outright here.
fn decompressed_len_bounded(path: &std::path::Path) -> Option<u64> {
    let mut reader = crate::engines::history::open_line_reader("dsh", path).ok()?;
    let mut buf = vec![0u8; 64 * 1024];
    let mut total: u64 = 0;
    loop {
        match std::io::Read::read(&mut reader, &mut buf) {
            Ok(0) => return Some(total),
            Ok(n) => {
                total += n as u64;
                if total > MAX_FORK_SOURCE_BYTES {
                    return Some(total);
                }
            }
            Err(_) => return None,
        }
    }
}

/// `at` = `None` is a tip fork (the fork point is the whole-turn boundary at the source's end).
///
/// Written on click: when the command returns the fork exists (file written + registered), and the branch
/// tab reads the inherited context at once. No message has to be sent first: we write the prefix file
/// ourselves, costing no tokens and no extra turn. It can't become lazy (created on the first message): the
/// branch window would be empty after the click.
#[tauri::command]
pub async fn fork_session(
    state: tauri::State<'_, crate::engines::support::EngineState>,
    engine: String,
    session_id: String,
    at: Option<ForkAnchor>,
) -> Result<ForkPlan, String> {
    // The whole chain is blocking IO: reading up to 64 MiB of transcript, a full parse, writing the branch file,
    // an SQLite transaction. Run directly in an async command it would hold a runtime worker thread (the
    // crate's `load_session_page` wraps itself in `spawn_blocking` for the same reason). A fork is rare,
    // but one can take hundreds of milliseconds to seconds.
    let db = std::sync::Arc::clone(&state.db);
    let plan = tauri::async_runtime::spawn_blocking(move || {
        fork_session_blocking(&db, &engine, &session_id, at.as_ref())
    })
    .await
    .map_err(|e| format!("The session fork task ended unexpectedly: {e}"))??;
    // The broadcast stays on the async side: it is only an event notice and needs no blocking thread.
    state.sink.emit_sessions_changed();
    Ok(plan)
}

/// Forks in one process run one at a time.
///
/// Fork numbering is three steps (read the existing titles → write the file → register) with no atomicity:
/// two concurrent forks would read the same title snapshot and get the same `#N`. Every window drives the
/// same process, and the frontend only blocks repeat clicks within one window. Forks are rare and
/// bounded (64 MiB size guard), so serializing costs nothing. Two app processes sharing one data directory
/// could still collide; that needs a cross-process lock and isn't handled here.
static FORK_SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// `fork_session`'s blocking body (takes the db rather than Tauri state, so tests can drive it directly).
pub(crate) fn fork_session_blocking(
    db: &crate::engines::support::db::Db,
    engine: &str,
    session_id: &str,
    at: Option<&ForkAnchor>,
) -> Result<ForkPlan, String> {
    // A fork that panics only poisons the lock; it guards an empty tuple with no state to corrupt, so use it as usual.
    let _serial = FORK_SERIAL
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    // The allowlist is checked first: for an engine the table doesn't know, don't even answer whether the session exists
    // (the person would get `session not found` for a session right there in the sidebar), let alone check its size.
    ensure_fork_supported(engine)?;
    // The size guard must come before any parse: `resolve_fork_plan` parses the whole source transcript
    // to locate the fork point, and checking in `materialize_trimmed_fork` would be too late, with a
    // several-hundred-MB file already read and parsed. Here first, an oversize source is refused without reading a byte.
    ensure_fork_source_within_limit(db, engine, session_id)?;
    let mut plan = resolve_fork_plan(db, engine, session_id, at)?;
    // The title comes first (it doesn't need the branch file): if it can't be computed, don't write a file, so no orphan is left.
    // The backend builds `<source's current name> (fork #N)`: the number depends on existing sibling names,
    // which only the backend knows, and the suffix is language-neutral, needing no translation.
    let branch_title = next_fork_title(db, engine, &plan.source_title)?;
    let keep = plan.keep_records.unwrap_or(usize::MAX);
    let written = materialize_trimmed_fork(
        db,
        engine,
        &plan.source_session_id,
        &plan.target_session_id,
        keep,
    )?;
    // Panic guard: the file is written now. If anything after it (parsing the new branch file, stat, the
    // transaction) panics, `register_fork_or_rollback`'s rollback never runs, leaving
    // an orphan with a file and no row: a retry makes a new uuid, and a later scan adds a row for it
    // with no fork title. Normal returns and `Err` are still rolled back by the register function;
    // this guard only cleans up while unwinding, so the two never delete twice.
    let _written_guard = WrittenGuard::new(engine, &written);
    // Register in the app's own table: the sidebar must see the branch, and `load_session_page` needs
    // a `sessions` row, or opening the branch tab reports "session not found".
    //
    // A failed registration must delete the file just written (no half-finished results are left).
    // Otherwise the worst in-between state remains: a usable branch file on disk with no row in the table,
    // a later scan adds an untitled row for it, and the branch looks usable but has no
    // fork title; neither the person nor a developer could tell it once failed.
    //
    // Name the real path: `written` is right here, so registration needn't guess.
    // With `None`, an engine that can't derive the landing path (`ForkSupport::derive_landing` is `None`,
    // like Codex) would leave an empty `file_path` in the row; the branch tab's `open("")` would then fail, and
    // under a custom `codex_home` the scanner would judge it "outside the home" and delete the whole row.
    register_fork_or_rollback(
        db,
        engine,
        &plan.source_session_id,
        &plan.target_session_id,
        &written,
        &branch_title,
        &mut plan.degraded,
    )?;
    Ok(plan)
}

/// `fork_session`'s body, taking the db rather than Tauri state: for the same reason as `send_message_inner`,
/// so integration tests can drive it directly.
pub(crate) fn resolve_fork_plan(
    db: &crate::engines::support::db::Db,
    engine: &str,
    session_id: &str,
    at: Option<&ForkAnchor>,
) -> Result<ForkPlan, String> {
    // The allowlist is the capability table: a prefix transcript + ordinary resume only works for the table's
    // engines (Claude `--resume <new id>`, Codex `thread/resume <new id>`).
    // Native fork facilities (`--fork-session` / `thread/fork`) take no part in landing it.
    let support = ensure_fork_supported(engine)?;
    // The source id's shape is the engine's own (`ForkSupport::source_id_ok`): Claude's
    // `--resume` takes only UUIDs, dsh's canonical ids are `session-<uuid>`; one rule for both would shut out half.
    if !(support.source_id_ok)(session_id) {
        return Err(format!("The session id isn't a valid UUID: {session_id}"));
    }
    if let Some(anchor) = at {
        // The anchor must be a 64-digit hex SHA-256; a wrong shape means the caller built it wrong, so
        // refuse now rather than finding out while landing. Case doesn't matter here (both hex spellings
        // are valid); comparison folds to lowercase, since `text_sha256_hex` produces only lowercase and
        // without folding the error would point the wrong way ("couldn't locate the turn").
        if anchor.user_text_sha256.len() != 64
            || !anchor
                .user_text_sha256
                .bytes()
                .all(|b| b.is_ascii_hexdigit())
        {
            return Err("The fork point's anchor isn't a valid SHA-256".into());
        }
    }
    // The source session must really be registered: its file_path decides where the fork lands (Claude
    // writes beside the source file, dsh in a sibling directory, Codex back into the same Codex home's `sessions/`),
    // all derived from the source file, avoiding any path-encoding assumption.
    let source = crate::engines::history::reader::session_meta_by_id(db, engine, session_id)?
        .ok_or_else(|| format!("session not found: {engine}/{session_id}"))?;
    // No remote guard here, on purpose: `session_meta_by_id` always fills `remote` with
    // `None` (the `sessions` table has no such column), and remote sessions never get a `sessions` row,
    // so they are already session-not-found at the query above and a guard would never fire.
    // The frontend greys out the remote entry point on its own; the backend doesn't gate on this field.
    // The cut is computed here (re-parsing the file on disk + locating the turn's user record).
    // Failing to locate it must be an explicit error, never a fallback to "fork from the end", which would
    // produce a branch that isn't what the person clicked, worse than an error.
    //
    // Meaning: the branch includes the fork point's turn (clicking "Help me with a math problem" gives that
    // turn and everything before it). So the cut is where that turn ends and the next begins.
    let keep_records = match at {
        // No anchor = fork from the end: the whole transcript moves over.
        None => usize::MAX,
        Some(anchor) => {
            let path = std::path::Path::new(&source.file_path);
            let (accepted, _) = db.accepted_internal_frames(engine, session_id)?;
            let parsed = crate::engines::history::parse_session_file(engine, path, &accepted)?;
            // How the cut is computed differs per engine, each in the capability table (Claude cuts at the session
            // chain's user records, Codex after the turn's end marker; see each function's notes).
            // The accepted internal frames are the same as this parse's (`accepted`), so Claude's cut
            // line numbers align with `parsed` one to one.
            match (support.keep_count)(path, anchor, &parsed.messages, &accepted) {
                Some(count) => count,
                // Either cause is possible: the anchor turn's text isn't in the transcript, or the turn has no
                // end marker (the Codex/dsh cut needs a whole turn). The latter is more common and usually means
                // the process was killed mid-turn (window closed / crash / kill), not that the file changed. Say
                // which, or the person is pointed at the wrong conclusion of "damaged data".
                None => {
                    return Err(
                        "Couldn't find this turn's fork point in the transcript: the turn may not have finished (an interrupted process leaves no end marker), or the source file was changed outside"
                            .into(),
                    );
                }
            }
        }
    };
    Ok(ForkPlan {
        source_session_id: session_id.to_string(),
        source_engine: engine.to_string(),
        // The branch always lands in the source session's own workspace: Claude finds transcripts by the source
        // file's directory, and the frontend must open the tab in the same workspace, or the two facts diverge.
        workspace_path: source.workspace_path.clone(),
        // The branch id's shape differs per engine (Claude/Codex bare UUIDv4; dsh with a `session-` prefix,
        // matching its directory name, header and host cache key). A mismatched shape makes the
        // host build a second projection under the other spelling, and the model can't read the inherited conversation.
        target_session_id: (support.target_id)(),
        // Whether it is at the end depends on the actual cut: `at` = `None` and "the anchor is exactly the last
        // turn" both give `usize::MAX` (the whole file moved), with the same meaning: the branch kept everything.
        at_tip: keep_records == usize::MAX,
        // Keeping the whole file sends no count: `usize::MAX` through JSON reads in JS as
        // 18446744073709552000 (precision lost), neither `Number.MAX_SAFE_INTEGER`
        // nor usable in arithmetic; one field meaning both "how many" and "all" is a trap.
        // `at_tip` already says it, so the sentinel never leaves.
        keep_records: (keep_records != usize::MAX).then_some(keep_records),
        source_title: source
            .custom_title
            .filter(|t| !t.trim().is_empty())
            .unwrap_or(source.title),
        // Filled by `fork_session` while registering (degradation only happens at the chain's last step).
        degraded: Vec::new(),
    })
}

/// The panic fallback for "the branch file is already written" (see the notes in `fork_session`).
///
/// Cleans up only while unwinding: normal returns and `Err` are rolled back by `register_fork_or_rollback`
/// itself, and deleting here too would make two rollback paths race for one file.
struct WrittenGuard<'a> {
    engine: &'a str,
    written: &'a std::path::Path,
}

impl<'a> WrittenGuard<'a> {
    fn new(engine: &'a str, written: &'a std::path::Path) -> Self {
        Self { engine, written }
    }
}

impl Drop for WrittenGuard<'_> {
    fn drop(&mut self) {
        if std::thread::panicking() {
            eprintln!(
                "[fork] panic after the branch was written, rolling back what was written: {}",
                self.written.display()
            );
            cleanup_fork_artifact(self.engine, self.written);
        }
    }
}

#[cfg(test)]
mod tests;
