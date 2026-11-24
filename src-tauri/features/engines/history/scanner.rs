// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/history/scanner.rs.
use super::discovery::{
    codex_candidates, discover_agy, discover_claude, identify_head, is_codex_subagent_file,
    path_is_under,
};
use super::{same_or_child, scan_summary_file, stat_signature, ScanSummary};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub(super) static SCAN_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

const TITLE_VERSION: &str = "10";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub scanned: usize,
    pub reparsed: usize,
    pub reused: usize,
}

struct Candidate {
    engine: &'static str,
    path: PathBuf,
    known_id: Option<String>,
    known_workspace: Option<String>,
}

fn scan_with_sink(
    db: &crate::engines::support::db::Db,
    sink: &Arc<crate::engines::support::event_sink::EventSink>,
) -> Result<ScanReport, String> {
    let guard = SCAN_LOCK.lock();
    let changed_sink = Arc::clone(sink);
    let progress_sink = Arc::clone(sink);
    scan_inner(
        db,
        move || changed_sink.emit_sessions_changed(),
        move |p| progress_sink.emit_scan_progress(p),
        &guard,
    )
}

pub(crate) fn scan_now(
    db: &crate::engines::support::db::Db,
    sink: &Arc<crate::engines::support::event_sink::EventSink>,
) -> Result<(), String> {
    scan_with_sink(db, sink).map(|_| ())
}

#[cfg(test)]
pub fn scan_with(
    db: &crate::engines::support::db::Db,
    on_changed: impl Fn(),
) -> Result<ScanReport, String> {
    let guard = SCAN_LOCK.lock();
    scan_with_guard(db, on_changed, &guard)
}

#[cfg(test)]
pub(super) fn scan_with_guard(
    db: &crate::engines::support::db::Db,
    on_changed: impl Fn(),
    guard: &parking_lot::MutexGuard<'_, ()>,
) -> Result<ScanReport, String> {
    scan_inner(db, on_changed, |_| {}, guard)
}

fn gather_candidates(workspaces: &[String]) -> Vec<Candidate> {
    let mut candidates: Vec<Candidate> = Vec::new();
    let mut seen_paths: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    for workspace_path in workspaces {
        let workspace = PathBuf::from(workspace_path);
        for file in discover_claude(&workspace)
            .into_iter()
            .chain(discover_agy(&workspace))
        {
            if seen_paths.insert(file.file_path.clone()) {
                candidates.push(Candidate {
                    engine: file.engine,
                    path: file.file_path,
                    known_id: Some(file.session_id),
                    known_workspace: Some(file.workspace_path),
                });
            }
        }
    }
    for path in codex_candidates() {
        if seen_paths.insert(path.clone()) {
            candidates.push(Candidate {
                engine: "codex",
                path,
                known_id: None,
                known_workspace: None,
            });
        }
    }
    candidates
}

fn stat_all(workspaces: &[String], candidates: &[Candidate]) -> (Vec<Option<(i64, i64)>>, String) {
    let mut signature_hasher = Sha256::new();
    signature_hasher.update(format!("v{}|", crate::engines::support::db::CACHE_VERSION).as_bytes());
    signature_hasher.update(b"codex_home=");
    signature_hasher.update(crate::engines::codex_home().to_string_lossy().as_bytes());
    signature_hasher.update(b"|");
    for w in workspaces {
        signature_hasher.update(w.as_bytes());
        signature_hasher.update(b"|");
    }
    let mut stats: Vec<Option<(i64, i64)>> = Vec::with_capacity(candidates.len());
    for cand in candidates {
        let sig = stat_signature(&cand.path);
        if let Some((size, mtime_ms)) = sig {
            signature_hasher.update(cand.path.to_string_lossy().as_bytes());
            signature_hasher.update(size.to_le_bytes());
            signature_hasher.update(mtime_ms.to_le_bytes());
        }
        stats.push(sig);
    }
    (stats, format!("{:x}", signature_hasher.finalize()))
}

struct Tier1 {
    signature: String,
    retitle_pending: bool,
}

fn tier1_gate(
    db: &crate::engines::support::db::Db,
    signature: String,
) -> Result<Option<Tier1>, String> {
    let conn = db.0.lock();
    let previous: Option<String> = conn
        .query_row(
            "SELECT value FROM cli_meta WHERE key='stat_signature'",
            [],
            |r| r.get(0),
        )
        .ok();
    let row_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM cli_sessions", [], |r| r.get(0))
        .unwrap_or(0);
    let title_version: Option<String> = conn
        .query_row(
            "SELECT value FROM cli_meta WHERE key='title_version'",
            [],
            |r| r.get(0),
        )
        .ok();
    let retitle_pending = title_version.as_deref() != Some(TITLE_VERSION);
    if previous.as_deref() == Some(signature.as_str()) && row_count > 0 && !retitle_pending {
        return Ok(None);
    }
    Ok(Some(Tier1 {
        signature,
        retitle_pending,
    }))
}

struct IndexedFile {
    size: i64,
    mtime_ms: i64,
    workspace_path: String,
}

fn prefetch_stat_keys(
    db: &crate::engines::support::db::Db,
    retitle_pending: bool,
) -> Result<
    (
        std::collections::HashMap<String, IndexedFile>,
        HashSet<String>,
    ),
    String,
> {
    let conn = db.0.lock();
    let mut stmt = conn
        .prepare("SELECT file_path, file_size, file_mtime_ms, workspace_path FROM cli_sessions")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                IndexedFile {
                    size: r.get(1)?,
                    mtime_ms: r.get(2)?,
                    workspace_path: r.get(3)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut stats = std::collections::HashMap::new();
    for row in rows {
        match row {
            Ok((path, indexed)) => {
                stats.insert(path, indexed);
            }
            Err(e) => eprintln!("[scanner] skipping undecodable session stat row: {e}"),
        }
    }
    let stale = if retitle_pending {
        stats.keys().cloned().collect()
    } else {
        HashSet::new()
    };
    Ok((stats, stale))
}

struct PreparedUpsert {
    engine: &'static str,
    session_id: String,
    workspace_path: String,
    path_str: String,
    size: i64,
    mtime_ms: i64,
    summary: ScanSummary,
}

fn prepare_candidate(
    cand: &Candidate,
    sig: (i64, i64),
    stat_keys: &std::collections::HashMap<String, IndexedFile>,
    stale_paths: &HashSet<String>,
    workspaces: &[String],
) -> Option<PreparedUpsert> {
    let (size, mtime_ms) = sig;
    let path_str = cand.path.to_string_lossy().to_string();
    if let Some(indexed) = stat_keys.get(&path_str) {
        if (indexed.size, indexed.mtime_ms) == sig
            && cand
                .known_workspace
                .as_ref()
                .is_none_or(|workspace| workspace == &indexed.workspace_path)
            && !stale_paths.contains(&path_str)
        {
            return None;
        }
    }
    let (session_id, workspace_path) = match (&cand.known_id, &cand.known_workspace) {
        (Some(id), Some(ws)) => (id.clone(), ws.clone()),
        _ => {
            let (id, cwd) = identify_head(cand.engine, &cand.path)?;
            if !workspaces
                .iter()
                .any(|w| same_or_child(Path::new(&cwd), Path::new(w)))
            {
                return None;
            }
            (id, cwd)
        }
    };
    let summary = scan_summary_file(cand.engine, &cand.path).ok()?;
    Some(PreparedUpsert {
        engine: cand.engine,
        session_id,
        workspace_path,
        path_str,
        size,
        mtime_ms,
        summary,
    })
}

fn prune_hidden_subagent_sessions(db: &crate::engines::support::db::Db) -> Result<bool, String> {
    prune_engine_subagent_sessions(db, "codex", is_codex_subagent_file)
}

fn prune_engine_subagent_sessions(
    db: &crate::engines::support::db::Db,
    engine: &str,
    is_subagent: fn(&Path) -> bool,
) -> Result<bool, String> {
    let paths: Vec<(String, String)> = {
        let conn = db.0.lock();
        let mut stmt = conn
            .prepare("SELECT session_id, file_path FROM cli_sessions WHERE engine=?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([engine], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            match row {
                Ok(pair) => out.push(pair),
                Err(e) => eprintln!("[scanner] skipping undecodable {engine} session row: {e}"),
            }
        }
        out
    };
    let dead: Vec<String> = paths
        .into_iter()
        .filter(|(_, path)| is_subagent(Path::new(path)))
        .map(|(id, _)| id)
        .collect();
    if dead.is_empty() {
        return Ok(false);
    }
    let conn = db.0.lock();
    for id in &dead {
        conn.execute(
            "DELETE FROM cli_sessions WHERE engine=?1 AND session_id=?2",
            rusqlite::params![engine, id],
        )
        .map_err(|e| e.to_string())?;
        crate::engines::plan_review::delete_reviews_for_session(&conn, engine, id)?;
    }
    Ok(true)
}

fn prune_codex_sessions_outside_home(db: &crate::engines::support::db::Db) -> Result<bool, String> {
    #[cfg(not(test))]
    {
        let custom = crate::engines::support::settings::read_settings()
            .ok()
            .and_then(|s| s.codex_home)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        if custom.is_none() {
            return Ok(false);
        }
    }
    let home = crate::engines::codex_home();
    let legacy_root = crate::engines::support::paths::legacy_home().join("codex-provider-homes");
    let paths: Vec<(String, String)> = {
        let conn = db.0.lock();
        let mut stmt = conn
            .prepare("SELECT session_id, file_path FROM cli_sessions WHERE engine='codex'")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            match row {
                Ok(pair) => out.push(pair),
                Err(e) => eprintln!("[scanner] skipping undecodable codex session row: {e}"),
            }
        }
        out
    };
    let dead: Vec<String> = paths
        .into_iter()
        .filter(|(_, path)| !path_is_under(path, &home) && !path_is_under(path, &legacy_root))
        .map(|(id, _)| id)
        .collect();
    if dead.is_empty() {
        return Ok(false);
    }
    let mut conn = db.0.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for id in &dead {
        tx.execute(
            "DELETE FROM cli_sessions WHERE engine='codex' AND session_id=?1",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
        crate::engines::plan_review::delete_reviews_for_session(&tx, "codex", id)?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

#[allow(
    clippy::disallowed_methods,
    reason = "checks whether an engine's session file is gone, in place, wherever the engine keeps it"
)]
fn definitely_missing(path: &Path, attached: &mut HashMap<PathBuf, bool>) -> bool {
    let Some(dir) = path.parent() else {
        return false;
    };
    storage_attached(dir, attached)
        && std::fs::symlink_metadata(path)
            .err()
            .is_some_and(|e| e.kind() == std::io::ErrorKind::NotFound)
}

#[allow(
    clippy::disallowed_methods,
    reason = "probes the folders above an engine's session file to tell a missing file from an unmounted drive"
)]
fn storage_attached(dir: &Path, verdicts: &mut HashMap<PathBuf, bool>) -> bool {
    if let Some(root) = dir.ancestors().last().filter(|root| *root != dir) {
        if !storage_attached(root, verdicts) {
            return false;
        }
    }
    let mut visited: Vec<&Path> = Vec::new();
    let mut verdict = false;
    for ancestor in dir.ancestors() {
        if let Some(&known) = verdicts.get(ancestor) {
            verdict = known;
            break;
        }
        visited.push(ancestor);
        let probe = if ancestor.as_os_str().is_empty() {
            Path::new(".")
        } else {
            ancestor
        };
        match std::fs::symlink_metadata(probe) {
            Ok(meta) => {
                let dangling = meta.file_type().is_symlink() && std::fs::metadata(probe).is_err();
                verdict = !dangling && !is_mount_container(ancestor);
                break;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => break,
        }
    }
    for path in visited {
        verdicts.insert(path.to_path_buf(), verdict);
    }
    verdict
}

fn is_mount_container(dir: &Path) -> bool {
    ["/Volumes", "/mnt", "/media", "/run/media"]
        .iter()
        .map(Path::new)
        .any(|container| dir == container || dir.parent() == Some(container))
}

fn is_remote_path(path: &str) -> bool {
    if path.starts_with("\\\\?\\UNC\\") {
        return true;
    }
    if path.starts_with("\\\\?\\") {
        return false;
    }
    path.starts_with("\\\\")
}

fn prune_missing_file_sessions(
    db: &crate::engines::support::db::Db,
    candidates: &[Candidate],
) -> Result<bool, String> {
    let live: HashSet<PathBuf> = candidates.iter().map(|c| c.path.clone()).collect();
    let rows: Vec<(String, String, String)> = {
        let conn = db.0.lock();
        let mut stmt = conn
            .prepare(
                "SELECT engine, session_id, file_path
                 FROM cli_sessions WHERE file_path <> ''",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            match row {
                Ok(row) => out.push(row),
                Err(e) => eprintln!("[scanner] skipping undecodable session row in file GC: {e}"),
            }
        }
        out
    };
    let mut attached: HashMap<PathBuf, bool> = HashMap::new();
    let mut dead: Vec<(String, String)> = Vec::new();
    for (engine, session_id, file_path) in rows {
        let path = PathBuf::from(&file_path);
        if live.contains(&path) || is_remote_path(&file_path) {
            continue;
        }
        if definitely_missing(&path, &mut attached) {
            dead.push((engine, session_id));
        }
    }
    if dead.is_empty() {
        return Ok(false);
    }
    let conn = db.0.lock();
    for (engine, id) in &dead {
        conn.execute(
            "DELETE FROM cli_sessions WHERE engine=?1 AND session_id=?2",
            rusqlite::params![engine, id],
        )
        .map_err(|e| e.to_string())?;
        crate::engines::plan_review::delete_reviews_for_session(&conn, engine, id)?;
    }
    Ok(true)
}

fn prune_stale_sessions(db: &crate::engines::support::db::Db) -> Result<bool, String> {
    let outside = prune_codex_sessions_outside_home(db)?;
    let subagent = prune_hidden_subagent_sessions(db)?;
    Ok(outside || subagent)
}

fn upsert_rows(
    db: &crate::engines::support::db::Db,
    rows: &[PreparedUpsert],
    tier1: &Tier1,
    advance_markers: bool,
) -> Result<(), String> {
    let mut conn = db.0.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for row in rows {
        let created_at = row.summary.first_ts.or(Some(row.mtime_ms));
        let updated_at = row.summary.last_ts.or(Some(row.mtime_ms));
        tx.execute(
            "INSERT INTO cli_sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title, preview, created_at, updated_at, message_count)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
             ON CONFLICT(engine, session_id) DO UPDATE SET
                workspace_path=excluded.workspace_path,
                file_path=excluded.file_path,
                file_size=excluded.file_size,
                file_mtime_ms=excluded.file_mtime_ms,
                title=excluded.title,
                preview=excluded.preview,
                created_at=COALESCE(cli_sessions.created_at, excluded.created_at),
                updated_at=excluded.updated_at,
                message_count=excluded.message_count",
            rusqlite::params![
                row.engine,
                row.session_id,
                row.workspace_path,
                row.path_str,
                row.size,
                row.mtime_ms,
                row.summary.title,
                row.summary.preview,
                created_at,
                updated_at,
                row.summary.message_count,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    if advance_markers {
        tx.execute(
            "INSERT INTO cli_meta(key, value) VALUES('stat_signature', ?1)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            rusqlite::params![tier1.signature],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO cli_meta(key, value) VALUES('title_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [TITLE_VERSION],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

fn scan_inner(
    db: &crate::engines::support::db::Db,
    on_changed: impl Fn(),
    on_progress: impl Fn(crate::engines::support::event_sink::ScanProgress),
    _guard: &parking_lot::MutexGuard<'_, ()>,
) -> Result<ScanReport, String> {
    let workspaces = db.workspace_paths()?;
    let candidates = gather_candidates(&workspaces);
    let (stats, signature) = stat_all(&workspaces, &candidates);
    let Some(tier1) = tier1_gate(db, signature)? else {
        let missing = prune_missing_file_sessions(db, &candidates)?;
        let pruned = prune_stale_sessions(db)?;
        if super::codex_titles::sync(db)? || pruned || missing {
            on_changed();
        }
        return Ok(ScanReport {
            scanned: candidates.len(),
            reparsed: 0,
            reused: candidates.len(),
        });
    };
    let (stat_keys, stale_paths) = prefetch_stat_keys(db, tier1.retitle_pending)?;

    let total = candidates.len();
    let step = (total / 50).max(1);
    if total > 0 {
        on_progress(crate::engines::support::event_sink::ScanProgress {
            done: 0,
            total,
            finished: false,
        });
    }
    let mut rows = Vec::new();
    let mut reused = 0usize;
    let mut retitle_complete = true;
    for (index, (cand, sig)) in candidates.iter().zip(stats.iter()).enumerate() {
        let processed = index + 1;
        if processed % step == 0 {
            on_progress(crate::engines::support::event_sink::ScanProgress {
                done: processed,
                total,
                finished: false,
            });
        }
        let path_str = cand.path.to_string_lossy().to_string();
        let stale = stale_paths.contains(&path_str);
        let Some(sig) = sig else {
            if stale {
                retitle_complete = false;
            }
            continue;
        };
        match prepare_candidate(cand, *sig, &stat_keys, &stale_paths, &workspaces) {
            Some(row) => rows.push(row),
            None => {
                if stale {
                    retitle_complete = false;
                }
                if stat_keys
                    .get(&path_str)
                    .is_some_and(|indexed| (indexed.size, indexed.mtime_ms) == *sig)
                {
                    reused += 1;
                }
            }
        }
    }

    let reparsed = rows.len();
    upsert_rows(
        db,
        &rows,
        &tier1,
        !tier1.retitle_pending || retitle_complete,
    )?;
    prune_missing_file_sessions(db, &candidates)?;
    prune_stale_sessions(db)?;
    super::codex_titles::sync(db)?;
    on_changed();
    if total > 0 {
        on_progress(crate::engines::support::event_sink::ScanProgress {
            done: total,
            total,
            finished: true,
        });
    }
    Ok(ScanReport {
        scanned: total,
        reparsed,
        reused,
    })
}

pub fn spawn_scan(
    db: Arc<crate::engines::support::db::Db>,
    sink: Arc<crate::engines::support::event_sink::EventSink>,
) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static SCAN_RUNNING: AtomicBool = AtomicBool::new(false);
    if SCAN_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    tauri::async_runtime::spawn_blocking(move || {
        struct ResetOnDrop;
        impl Drop for ResetOnDrop {
            fn drop(&mut self) {
                SCAN_RUNNING.store(false, Ordering::SeqCst);
            }
        }
        let _guard = ResetOnDrop;
        super::past_folders::register(&db);
        if let Err(error) = scan_with_sink(&db, &sink) {
            eprintln!("[scanner] scan failed: {error}");
        }
        super::search::spawn_index(db);
    });
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    pub(crate) use crate::engines::support::paths::HOME_ENV_LOCK as HOME_LOCK;

    const ENGINE_HOME_KEYS: [&str; 2] = ["CLAUDE_CONFIG_DIR", "CODEX_HOME"];

    pub struct HomeGuard {
        _lock: parking_lot::MutexGuard<'static, ()>,
        prev: HomeEnvPair,
        engine_homes: Vec<(&'static str, Option<std::ffi::OsString>)>,
    }
    impl HomeGuard {
        pub fn set(home: &Path) -> Self {
            let lock = HOME_LOCK.lock();
            let prev = std::env::var_os("HOME");
            std::env::set_var("HOME", home);
            let prev_profile = std::env::var_os("USERPROFILE");
            std::env::set_var("USERPROFILE", home);
            let engine_homes = ENGINE_HOME_KEYS
                .into_iter()
                .map(|key| {
                    let previous = std::env::var_os(key);
                    std::env::remove_var(key);
                    (key, previous)
                })
                .collect();
            Self {
                _lock: lock,
                prev: HomeEnvPair(prev, prev_profile),
                engine_homes,
            }
        }
    }

    struct HomeEnvPair(Option<std::ffi::OsString>, Option<std::ffi::OsString>);

    impl Drop for HomeGuard {
        fn drop(&mut self) {
            let HomeEnvPair(home, profile) = &self.prev;
            match home {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
            match profile {
                Some(value) => std::env::set_var("USERPROFILE", value),
                None => std::env::remove_var("USERPROFILE"),
            }
            for (key, value) in &self.engine_homes {
                match value {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
        }
    }

    pub fn scratch_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ccgui-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn prune_codex_outside_home_keeps_provider_home_sessions() -> Result<(), String> {
        let home = scratch_dir("prune-codex-legacy");
        let _guard = HomeGuard::set(&home);
        let legacy_dir = home
            .join(".ccgui")
            .join("codex-provider-homes")
            .join("p1")
            .join("sessions");
        let other_dir = home.join("elsewhere");
        std::fs::create_dir_all(&legacy_dir).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&other_dir).map_err(|e| e.to_string())?;
        let legacy_file = legacy_dir.join("rollout-old.jsonl");
        let other_file = other_dir.join("rollout-stray.jsonl");
        std::fs::write(&legacy_file, "").map_err(|e| e.to_string())?;
        std::fs::write(&other_file, "").map_err(|e| e.to_string())?;

        let db = crate::engines::support::db::Db::open_at(&home.join("app.db"))
            .map_err(|e| e.to_string())?;
        {
            let conn = db.0.lock();
            for (id, path) in [("keep", &legacy_file), ("drop", &other_file)] {
                conn.execute(
                    "INSERT INTO cli_sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title) VALUES('codex', ?1, '/ws', ?2, 0, 0, 't')",
                    rusqlite::params![id, path.to_string_lossy().to_string()],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        let removed = prune_codex_sessions_outside_home(&db)?;
        assert!(removed);
        let remaining: Vec<String> = {
            let conn = db.0.lock();
            let mut stmt = conn
                .prepare("SELECT session_id FROM cli_sessions ORDER BY session_id")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .collect::<rusqlite::Result<Vec<String>>>()
                .map_err(|e| e.to_string())?;
            rows
        };
        assert_eq!(remaining, ["keep"]);

        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
    }

    #[test]
    fn retitle_migration_retries_after_partial_parse_failure() -> Result<(), String> {
        let home = scratch_dir("scan-retitle-retry");
        let workspace = home.join("ws");
        let sessions_dir = home.join(".codex/sessions/2026/09/05");
        std::fs::create_dir_all(&sessions_dir).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;

        let session_contents = |id: &str, title: &str| {
            let session_line = serde_json::json!({"type": "session_meta",
                "timestamp": "2026-09-05T07:13:57.946Z",
                "payload": {"id": id, "cwd": workspace.to_string_lossy()}})
            .to_string();
            let message_line = serde_json::json!({"type": "response_item",
                "timestamp": "2026-09-05T07:14:06.682Z",
                "payload": {"type": "message", "role": "user",
                    "content": [{"type": "input_text", "text": title}]}})
            .to_string();
            format!("{session_line}\n{message_line}\n")
        };
        let valid_path = sessions_dir.join("rollout-2026-09-05T07-13-57-valid.jsonl");
        let retry_path = sessions_dir.join("rollout-2026-09-05T07-13-57-retry.jsonl");
        std::fs::write(&valid_path, session_contents("valid", "valid title"))
            .map_err(|e| e.to_string())?;
        std::fs::write(&retry_path, session_contents("retry", "repaired title"))
            .map_err(|e| e.to_string())?;

        let _guard = HomeGuard::set(&home);
        let db = crate::engines::support::db::Db::open_at(&home.join("app.db"))
            .map_err(|e| e.to_string())?;
        {
            let conn = db.0.lock();
            conn.execute(
                "INSERT INTO cli_workspaces(id, path, name) VALUES('w1', ?1, 'ws')",
                [workspace.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
        }
        assert_eq!(scan_with(&db, || {})?.reparsed, 2);
        let original_signature: String = {
            let conn = db.0.lock();
            conn.query_row(
                "SELECT value FROM cli_meta WHERE key='stat_signature'",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?
        };

        {
            let conn = db.0.lock();
            conn.execute(
                "UPDATE cli_sessions SET title='<recommended_plugins>stale' WHERE session_id IN ('valid', 'retry')",
                [],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE cli_meta SET value='7' WHERE key='title_version'",
                [],
            )
            .map_err(|e| e.to_string())?;
        }
        std::fs::write(&retry_path, "not a session\n").map_err(|e| e.to_string())?;
        let workspace_paths = vec![workspace.to_string_lossy().to_string()];
        let (_, malformed_signature) =
            stat_all(&workspace_paths, &gather_candidates(&workspace_paths));
        assert_ne!(malformed_signature, original_signature);

        let partial = scan_with(&db, || {})?;
        assert_eq!(partial.reparsed, 1);
        {
            let conn = db.0.lock();
            let (version, signature, valid_title, retry_title): (String, String, String, String) =
                conn.query_row(
                    "SELECT
                        (SELECT value FROM cli_meta WHERE key='title_version'),
                        (SELECT value FROM cli_meta WHERE key='stat_signature'),
                        (SELECT title FROM cli_sessions WHERE session_id='valid'),
                        (SELECT title FROM cli_sessions WHERE session_id='retry')",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .map_err(|e| e.to_string())?;
            assert_eq!(version, "7");
            assert_eq!(signature, original_signature);
            assert_eq!(valid_title, "valid title");
            assert_eq!(retry_title, "<recommended_plugins>stale");
        }

        std::fs::write(&retry_path, session_contents("retry", "repaired title"))
            .map_err(|e| e.to_string())?;
        scan_with(&db, || {})?;
        {
            let conn = db.0.lock();
            let (version, signature, retry_title): (String, String, String) = conn
                .query_row(
                    "SELECT
                        (SELECT value FROM cli_meta WHERE key='title_version'),
                        (SELECT value FROM cli_meta WHERE key='stat_signature'),
                        (SELECT title FROM cli_sessions WHERE session_id='retry')",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .map_err(|e| e.to_string())?;
            let (_, repaired_signature) =
                stat_all(&workspace_paths, &gather_candidates(&workspace_paths));
            assert_eq!(version, TITLE_VERSION);
            assert_eq!(signature, repaired_signature);
            assert_eq!(retry_title, "repaired title");
        }

        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
    }

    #[test]
    fn scan_identifies_codex_rollout_with_huge_session_meta() -> Result<(), String> {
        let home = scratch_dir("scan-codex-home");
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
        let rollout_dir = home
            .join(".codex")
            .join("sessions")
            .join("2026")
            .join("09")
            .join("06");
        std::fs::create_dir_all(&rollout_dir).map_err(|e| e.to_string())?;
        let big_instructions = "x".repeat(40 * 1024);
        let cwd_json = workspace.display().to_string().replace('\\', "\\\\");
        std::fs::write(
            rollout_dir.join("rollout-2026-09-06T21-52-11-sid-codex.jsonl"),
            format!(
                "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"sid-codex\",\"cwd\":\"{cwd_json}\",\"base_instructions\":{{\"text\":\"{big_instructions}\"}}}}}}\n{{\"type\":\"response_item\",\"payload\":{{\"type\":\"message\",\"role\":\"user\",\"content\":[{{\"type\":\"input_text\",\"text\":\"你好啊\"}}]}}}}\n",
            ),
        )
        .map_err(|e| e.to_string())?;

        let _guard = HomeGuard::set(&home);
        let db = crate::engines::support::db::Db::open_at(&home.join("app.db"))
            .map_err(|e| e.to_string())?;
        {
            let conn = db.0.lock();
            conn.execute(
                "INSERT INTO cli_workspaces(id, path, name) VALUES('w1', ?1, 'ws')",
                [workspace.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
        }
        let report = scan_with(&db, || {})?;
        assert_eq!(report.reparsed, 1);
        let title: String = {
            let conn = db.0.lock();
            conn.query_row(
                "SELECT title FROM cli_sessions WHERE engine='codex' AND session_id='sid-codex'",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?
        };
        assert_eq!(title, "你好啊");
        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
    }

    #[test]
    fn scan_skips_and_prunes_codex_subagent_rollouts() -> Result<(), String> {
        let home = scratch_dir("scan-codex-subagent");
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
        let rollout_dir = home
            .join(".codex")
            .join("sessions")
            .join("2026")
            .join("09")
            .join("10");
        std::fs::create_dir_all(&rollout_dir).map_err(|e| e.to_string())?;
        let cwd = workspace.display().to_string();
        let user = serde_json::json!({
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "改一下"}]
            }
        });
        std::fs::write(
            rollout_dir.join("rollout-2026-09-10T00-00-00-parent.jsonl"),
            format!(
                "{}\n{}\n",
                serde_json::json!({"type":"session_meta","payload":{"id":"parent","cwd":cwd,"source":"vscode"}}),
                user
            ),
        )
        .map_err(|e| e.to_string())?;
        let child_path = rollout_dir.join("rollout-2026-09-10T00-00-01-child.jsonl");
        std::fs::write(
            &child_path,
            format!(
                "{}\n{}\n",
                serde_json::json!({
                    "type": "session_meta",
                    "payload": {
                        "id": "child",
                        "cwd": cwd,
                        "source": {"subagent": {"thread_spawn": {"parent_thread_id": "parent", "depth": 1}}}
                    }
                }),
                user
            ),
        )
        .map_err(|e| e.to_string())?;

        let _guard = HomeGuard::set(&home);
        let db = crate::engines::support::db::Db::open_at(&home.join("app.db"))
            .map_err(|e| e.to_string())?;
        {
            let conn = db.0.lock();
            conn.execute(
                "INSERT INTO cli_workspaces(id, path, name) VALUES('w1', ?1, 'ws')",
                [workspace.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO cli_sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title) VALUES('codex', 'child', ?1, ?2, 1, 1, '改一下')",
                rusqlite::params![workspace.to_string_lossy().to_string(), child_path.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
        }
        let report = scan_with(&db, || {})?;
        assert_eq!(report.reparsed, 1);
        let ids: Vec<String> = {
            let conn = db.0.lock();
            let mut stmt = conn
                .prepare(
                    "SELECT session_id FROM cli_sessions WHERE engine='codex' ORDER BY session_id",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        assert_eq!(ids, vec!["parent".to_string()]);
        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
    }

    #[test]
    fn default_codex_home_keeps_indexed_sessions() -> Result<(), String> {
        let home = scratch_dir("scan-codex-default-keep");
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
        let rollout = home
            .join(".codex")
            .join("sessions")
            .join("rollout-keep.jsonl");
        std::fs::create_dir_all(rollout.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::write(&rollout, "{}\n").map_err(|e| e.to_string())?;
        let _guard = HomeGuard::set(&home);
        let db = crate::engines::support::db::Db::open_at(&home.join("app.db"))
            .map_err(|e| e.to_string())?;
        {
            let conn = db.0.lock();
            conn.execute(
                "INSERT INTO cli_workspaces(id, path, name) VALUES('w1', ?1, 'ws')",
                [workspace.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO cli_sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title) VALUES('codex', 'keep', ?1, ?2, 1, 1, '默认目录')",
                rusqlite::params![
                    workspace.to_string_lossy().to_string(),
                    rollout.to_string_lossy().to_string()
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        scan_with(&db, || {})?;
        let count: i64 = {
            let conn = db.0.lock();
            conn.query_row(
                "SELECT COUNT(*) FROM cli_sessions WHERE engine='codex' AND session_id='keep'",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?
        };
        assert_eq!(count, 1);
        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
    }

    #[test]
    fn scan_prunes_codex_rows_from_another_home() -> Result<(), String> {
        let home = scratch_dir("scan-codex-wrong-home");
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
        let _guard = HomeGuard::set(&home);
        let db = crate::engines::support::db::Db::open_at(&home.join("app.db"))
            .map_err(|e| e.to_string())?;
        {
            let conn = db.0.lock();
            conn.execute(
                "INSERT INTO cli_workspaces(id, path, name) VALUES('w1', ?1, 'ws')",
                [workspace.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO cli_sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title) VALUES('codex', 'old', ?1, '/Users/demo/.codex/sessions/old.jsonl', 1, 1, '旧目录')",
                [workspace.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
        }
        scan_with(&db, || {})?;
        let count: i64 = {
            let conn = db.0.lock();
            conn.query_row(
                "SELECT COUNT(*) FROM cli_sessions WHERE engine='codex'",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?
        };
        assert_eq!(count, 0);
        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
    }

    fn session_count(db: &crate::engines::support::db::Db, engine: &str, session_id: &str) -> i64 {
        db.0.lock()
            .query_row(
                "SELECT COUNT(*) FROM cli_sessions WHERE engine=?1 AND session_id=?2",
                rusqlite::params![engine, session_id],
                |r| r.get(0),
            )
            .unwrap_or(-1)
    }

    #[test]
    fn scan_prunes_transcripts_deleted_outside_the_app() -> Result<(), String> {
        let home = scratch_dir(&format!("gc-external-{}", uuid::Uuid::new_v4()));
        let _guard = HomeGuard::set(&home);
        struct HomeEnv(Option<std::ffi::OsString>);
        impl Drop for HomeEnv {
            fn drop(&mut self) {
                match &self.0 {
                    Some(value) => std::env::set_var("CODEX_HOME", value),
                    None => std::env::remove_var("CODEX_HOME"),
                }
            }
        }
        let _env = HomeEnv(std::env::var_os("CODEX_HOME"));
        std::env::set_var("CODEX_HOME", home.join(".codex"));
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
        let db = crate::engines::support::db::Db::open_at(&home.join("app.db"))
            .map_err(|e| e.to_string())?;
        db.0.lock()
            .execute(
                "INSERT INTO cli_workspaces(id, path, name) VALUES('w1', ?1, 'ws')",
                [workspace.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
        let rollout = |id: &str| -> Result<PathBuf, String> {
            let path = home
                .join(".codex")
                .join("sessions")
                .join("2026")
                .join("10")
                .join("26")
                .join(format!("rollout-2026-10-26T00-00-00-{id}.jsonl"));
            std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
            let text = serde_json::json!({"type": "session_meta", "payload": {
                "id": id, "cwd": workspace.to_string_lossy()
            }})
            .to_string()
                + "\n";
            std::fs::write(&path, text).map_err(|e| e.to_string())?;
            Ok(path)
        };
        rollout("keep")?;
        let gone = rollout("gone")?;
        scan_with(&db, || {})?;
        assert_eq!(session_count(&db, "codex", "keep"), 1);
        assert_eq!(session_count(&db, "codex", "gone"), 1);
        std::fs::remove_file(&gone).map_err(|e| e.to_string())?;
        scan_with(&db, || {})?;
        assert_eq!(session_count(&db, "codex", "gone"), 0);
        assert_eq!(session_count(&db, "codex", "keep"), 1);
        scan_with(&db, || {})?;
        assert_eq!(session_count(&db, "codex", "keep"), 1);
        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
    }

    #[test]
    fn file_gc_skips_remote_paths() -> Result<(), String> {
        let home = scratch_dir(&format!("gc-shapes-{}", uuid::Uuid::new_v4()));
        let _guard = HomeGuard::set(&home);
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
        let db = crate::engines::support::db::Db::open_at(&home.join("app.db"))
            .map_err(|e| e.to_string())?;
        let live_file = home.join("live.jsonl");
        std::fs::write(&live_file, "{}\n").map_err(|e| e.to_string())?;
        let ghost_file = home.join("ghost.jsonl");
        {
            let conn = db.0.lock();
            for (engine, id, path) in [
                ("claude", "live", live_file.to_string_lossy().into_owned()),
                ("claude", "ghost", ghost_file.to_string_lossy().into_owned()),
                (
                    "claude",
                    "unc",
                    "\\\\server\\share\\ghost.jsonl".to_string(),
                ),
                (
                    "claude",
                    "extended",
                    "\\\\?\\UNC\\server\\share\\x.jsonl".to_string(),
                ),
                (
                    "claude",
                    "extended-local",
                    format!("\\\\?\\{}", ghost_file.to_string_lossy()),
                ),
            ] {
                conn.execute(
                    "INSERT INTO cli_sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title) VALUES(?1, ?2, ?3, ?4, 1, 1, 't')",
                    rusqlite::params![engine, id, workspace.to_string_lossy(), path],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        let candidates = vec![Candidate {
            engine: "claude",
            path: live_file.clone(),
            known_id: Some("live".into()),
            known_workspace: Some(workspace.to_string_lossy().into_owned()),
        }];
        assert!(prune_missing_file_sessions(&db, &candidates)?);
        assert_eq!(session_count(&db, "claude", "ghost"), 0);
        assert_eq!(session_count(&db, "claude", "live"), 1);
        assert_eq!(session_count(&db, "claude", "unc"), 1);
        assert_eq!(session_count(&db, "claude", "extended"), 1);
        assert_eq!(session_count(&db, "claude", "extended-local"), 0);
        assert!(!prune_missing_file_sessions(&db, &candidates)?);
        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
    }

    struct CodexHomeEnv(Option<std::ffi::OsString>);
    impl Drop for CodexHomeEnv {
        fn drop(&mut self) {
            match &self.0 {
                Some(value) => std::env::set_var("CODEX_HOME", value),
                None => std::env::remove_var("CODEX_HOME"),
            }
        }
    }

    fn codex_gc_fixture(
        home: &Path,
        codex_home: &Path,
    ) -> Result<
        (
            HomeGuard,
            CodexHomeEnv,
            PathBuf,
            crate::engines::support::db::Db,
        ),
        String,
    > {
        let guard = HomeGuard::set(home);
        let env = CodexHomeEnv(std::env::var_os("CODEX_HOME"));
        std::env::set_var("CODEX_HOME", codex_home);
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
        let db = crate::engines::support::db::Db::open_at(&home.join("app.db"))
            .map_err(|e| e.to_string())?;
        db.0.lock()
            .execute(
                "INSERT INTO cli_workspaces(id, path, name) VALUES('w1', ?1, 'ws')",
                [workspace.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
        Ok((guard, env, workspace, db))
    }

    fn write_codex_rollout(
        codex_home: &Path,
        workspace: &Path,
        id: &str,
    ) -> Result<PathBuf, String> {
        let path = codex_home
            .join("sessions")
            .join("2026")
            .join("10")
            .join("26")
            .join(format!("rollout-2026-10-26T00-00-00-{id}.jsonl"));
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        let text = serde_json::json!({"type": "session_meta", "payload": {
            "id": id, "cwd": workspace.to_string_lossy()
        }})
        .to_string()
            + "\n";
        std::fs::write(&path, text).map_err(|e| e.to_string())?;
        Ok(path)
    }

    #[test]
    fn file_gc_runs_even_when_disk_is_unchanged() -> Result<(), String> {
        let home = scratch_dir(&format!("gc-unchanged-{}", uuid::Uuid::new_v4()));
        let codex_home = home.join(".codex");
        let (_guard, _env, workspace, db) = codex_gc_fixture(&home, &codex_home)?;
        let keep = write_codex_rollout(&codex_home, &workspace, "keep")?;
        scan_with(&db, || {})?;
        let ghost = keep.with_file_name("rollout-2026-10-26T00-00-00-old.jsonl");
        db.0.lock()
            .execute(
                "INSERT INTO cli_sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title) VALUES('codex', 'old', ?1, ?2, 1, 1, 'ghost')",
                rusqlite::params![workspace.to_string_lossy(), ghost.to_string_lossy()],
            )
            .map_err(|e| e.to_string())?;
        let changed = std::cell::Cell::new(false);
        let report = scan_with(&db, || changed.set(true))?;
        assert_eq!(
            report.reparsed, 0,
            "the disk did not change: tier-1 short-circuit"
        );
        assert_eq!(session_count(&db, "codex", "old"), 0);
        assert_eq!(session_count(&db, "codex", "keep"), 1);
        assert!(changed.get(), "the sidebar must refresh after the GC");
        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn file_gc_keeps_rows_on_detached_storage() -> Result<(), String> {
        let home = scratch_dir(&format!("gc-detached-{}", uuid::Uuid::new_v4()));
        let disk = home.join("disk");
        std::fs::create_dir_all(disk.join("codex")).map_err(|e| e.to_string())?;
        let codex_home = home.join(".codex");
        std::os::unix::fs::symlink(disk.join("codex"), &codex_home).map_err(|e| e.to_string())?;
        let (_guard, _env, workspace, db) = codex_gc_fixture(&home, &codex_home)?;
        let rollout = write_codex_rollout(&codex_home, &workspace, "pinned")?;
        scan_with(&db, || {})?;
        db.0.lock()
            .execute(
                "UPDATE cli_sessions SET pinned=1, custom_title='my name' WHERE engine='codex' AND session_id='pinned'",
                [],
            )
            .map_err(|e| e.to_string())?;
        let user_fields =
            |db: &crate::engines::support::db::Db| -> Result<(i64, Option<String>), String> {
                db.0.lock()
                .query_row(
                    "SELECT pinned, custom_title FROM cli_sessions WHERE engine='codex' AND session_id='pinned'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(|e| e.to_string())
            };
        let parked = home.join("disk-parked");
        std::fs::rename(&disk, &parked).map_err(|e| e.to_string())?;
        scan_with(&db, || {})?;
        assert_eq!(
            session_count(&db, "codex", "pinned"),
            1,
            "detached is not deleted"
        );
        std::fs::rename(&parked, &disk).map_err(|e| e.to_string())?;
        scan_with(&db, || {})?;
        assert_eq!(user_fields(&db)?, (1, Some("my name".to_string())));
        std::fs::remove_file(&rollout).map_err(|e| e.to_string())?;
        scan_with(&db, || {})?;
        assert_eq!(session_count(&db, "codex", "pinned"), 0);
        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
    }

    #[test]
    fn storage_probe_separates_deleted_from_detached() {
        for dir in [
            "/Volumes",
            "/Volumes/Backup",
            "/mnt",
            "/mnt/nas",
            "/media/alice",
            "/run/media",
            "/run/media/alice",
        ] {
            assert!(is_mount_container(Path::new(dir)), "{dir}");
        }
        for dir in [
            "/",
            "/Users/alice",
            "/Volumes/Backup/.codex",
            "/mnt/nas/codex",
            "/home/alice/.claude",
        ] {
            assert!(!is_mount_container(Path::new(dir)), "{dir}");
        }
        let home = scratch_dir(&format!("gc-probe-{}", uuid::Uuid::new_v4()));
        let mut verdicts = HashMap::new();
        assert!(storage_attached(
            &home.join("gone").join("deeper"),
            &mut verdicts
        ));
        assert!(storage_attached(&home, &mut verdicts));
        #[cfg(unix)]
        {
            let link = home.join("linked-home");
            std::os::unix::fs::symlink(home.join("detached-disk"), &link).unwrap();
            assert!(!storage_attached(&link.join("sessions"), &mut verdicts));
        }
        #[cfg(target_os = "macos")]
        {
            let volume = format!("/Volumes/ccgui-missing-{}", uuid::Uuid::new_v4());
            let sessions = Path::new(&volume).join(".codex").join("sessions");
            assert!(!storage_attached(&sessions, &mut verdicts));
        }
        #[cfg(windows)]
        {
            if let Some(letter) =
                ('D'..='Z').find(|c| std::fs::metadata(format!("{c}:\\")).is_err())
            {
                let sessions = PathBuf::from(format!("{letter}:\\ccgui\\sessions"));
                assert!(!storage_attached(&sessions, &mut verdicts));
            }
        }
        std::fs::remove_dir_all(&home).ok();
    }
}
