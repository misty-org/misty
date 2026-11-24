// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/history/discovery.rs.
//! Session-file discovery: enumerate per-engine session files on disk and
//! identify head-keyed engine files. The scan pipeline that consumes these
//! candidates lives in `scanner.rs`.
use super::{same_or_child, SessionFile};
use std::path::{Path, PathBuf};

pub(super) fn peek_head_json_lines(path: &Path, max_lines: usize) -> Vec<serde_json::Value> {
    try_peek_head_json_lines(path, max_lines).unwrap_or_default()
}

#[allow(
    clippy::disallowed_types,
    reason = "reads the engine's own session file in place, wherever the engine keeps it"
)]
fn try_peek_head_json_lines(
    path: &Path,
    max_lines: usize,
) -> std::io::Result<Vec<serde_json::Value>> {
    use std::io::Read;
    const CHUNK_BYTES: usize = 16 * 1024;
    const MAX_HEAD_BYTES: usize = 1024 * 1024;
    let mut reader = std::fs::File::open(path)?;
    let mut buf = Vec::new();
    let mut newline_count = 0usize;
    let mut eof = false;
    while newline_count < max_lines && buf.len() < MAX_HEAD_BYTES {
        let mut chunk = [0u8; CHUNK_BYTES];
        match reader.read(&mut chunk) {
            Ok(0) => {
                eof = true;
                break;
            }
            Ok(n) => {
                newline_count += chunk[..n].iter().filter(|&&b| b == b'\n').count();
                buf.extend_from_slice(&chunk[..n]);
            }
            Err(error) => return Err(error),
        }
    }
    let head = String::from_utf8_lossy(&buf);
    let mut lines: Vec<&str> = head.split('\n').collect();
    if !eof {
        lines.pop();
    }
    Ok(lines
        .into_iter()
        .take(max_lines)
        .filter_map(|line| serde_json::from_str(line.trim()).ok())
        .collect())
}

#[allow(
    clippy::disallowed_methods,
    reason = "reads the engine's own history in place, wherever the engine keeps it"
)]
pub(super) fn discover_claude(workspace: &Path) -> Vec<SessionFile> {
    let base = crate::engines::engine_home(Some("CLAUDE_CONFIG_DIR"), ".claude").join("projects");
    let mut out = Vec::new();
    let mut seen_sessions = std::collections::HashSet::new();
    for dir in claude_project_dirs(&base, workspace) {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if stem == "history" || !seen_sessions.insert(stem.to_string()) {
                continue;
            }
            out.push(SessionFile {
                engine: "claude",
                session_id: stem.to_string(),
                workspace_path: workspace.to_string_lossy().to_string(),
                file_path: path,
            });
        }
    }
    out
}

fn strip_verbatim_prefix(path: &str) -> &str {
    path.strip_prefix(r"\\?\").unwrap_or(path)
}

#[allow(
    clippy::disallowed_methods,
    reason = "compares the person's project folder against an engine's records; the folder may not be linked"
)]
fn claude_project_dirs(base: &Path, workspace: &Path) -> Vec<PathBuf> {
    fn push(
        out: &mut Vec<PathBuf>,
        seen: &mut std::collections::HashSet<String>,
        base: &Path,
        spelling: &str,
    ) {
        if !spelling.is_empty() && seen.insert(spelling.to_string()) {
            out.push(base.join(super::claude_encode_project_path(spelling)));
        }
    }
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let raw = workspace.to_string_lossy().to_string();
    let trimmed = raw.trim_end_matches(['/', '\\']).to_string();
    push(&mut out, &mut seen, base, &raw);
    push(&mut out, &mut seen, base, &trimmed);
    for spelling in [&raw, &trimmed] {
        if let Ok(canonical) = std::fs::canonicalize(spelling) {
            let canonical = strip_verbatim_prefix(&canonical.to_string_lossy()).to_string();
            push(&mut out, &mut seen, base, &canonical);
        }
    }
    out
}

#[allow(
    clippy::disallowed_methods,
    reason = "lists the legacy ~/.ccgui provider homes, which sit outside the folders the gate grants"
)]
fn legacy_provider_homes(dir_name: &str) -> Vec<PathBuf> {
    let root = crate::engines::support::paths::legacy_home().join(dir_name);
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect()
}

pub(super) fn discover_kimi(workspace: &Path) -> Vec<SessionFile> {
    let homes = dir_session_anchor_roots("kimi");
    let mut out = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();
    for base in homes {
        for file in discover_kimi_in(&base, workspace) {
            if seen_paths.insert(file.file_path.clone()) {
                out.push(file);
            }
        }
    }
    out
}

#[allow(
    clippy::disallowed_methods,
    reason = "reads the engine's own history in place, wherever the engine keeps it"
)]
fn discover_kimi_in(base: &Path, workspace: &Path) -> Vec<SessionFile> {
    let Ok(raw) = std::fs::read_to_string(base.join("session_index.jsonl")) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for line in raw.lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let work_dir = value
            .get("workDir")
            .or_else(|| value.get("work_dir"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if work_dir.is_empty() || !same_or_child(Path::new(work_dir), workspace) {
            continue;
        }
        let session_id = value
            .get("sessionId")
            .or_else(|| value.get("session_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let session_dir = value
            .get("sessionDir")
            .or_else(|| value.get("session_dir"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if session_id.is_empty() || session_dir.is_empty() {
            continue;
        }
        let wire = PathBuf::from(&session_dir)
            .join("agents")
            .join(crate::known_names::KIMI_PRIMARY_AGENT)
            .join("wire.jsonl");
        if wire.is_file() {
            out.push(SessionFile {
                engine: "kimi",
                session_id,
                workspace_path: workspace.to_string_lossy().to_string(),
                file_path: wire,
            });
        }
    }
    out
}

fn qoder_encode_project_slug(path: &str) -> String {
    let mut value = path.trim().replace('\\', "/");
    while value.ends_with('/') && value.len() > 1 {
        value.pop();
    }
    if value.is_empty() {
        return String::new();
    }
    value.replace(['/', ':'], "-")
}

fn qoder_cli_project_slug(path: &str) -> String {
    const PREFIX_LEN: usize = 200;
    let mut slug = String::new();
    let mut hash = 5381_i32;
    for unit in path.encode_utf16() {
        let ascii = u8::try_from(unit).ok().filter(u8::is_ascii_alphanumeric);
        slug.push(ascii.map_or('-', char::from));
        hash = hash.wrapping_mul(33) ^ i32::from(unit);
    }
    if slug.len() > PREFIX_LEN {
        slug.truncate(PREFIX_LEN);
        let mut hash = hash.unsigned_abs();
        let mut suffix = Vec::new();
        loop {
            suffix.push(char::from_digit(hash % 36, 36).expect("base36 digit"));
            hash /= 36;
            if hash == 0 {
                break;
            }
        }
        slug.push('-');
        slug.extend(suffix.into_iter().rev());
    }
    slug
}

struct CachedQoderCwd {
    signature: (u64, std::time::SystemTime),
    cwd: Option<String>,
}

static QODER_CWD_CACHE: std::sync::LazyLock<
    parking_lot::Mutex<std::collections::HashMap<PathBuf, CachedQoderCwd>>,
> = std::sync::LazyLock::new(|| parking_lot::Mutex::new(std::collections::HashMap::new()));

fn read_qoder_transcript_cwd(path: &Path, bucket: &str) -> Option<String> {
    const HEAD_LINES: usize = 64;
    try_peek_head_json_lines(path, HEAD_LINES)
        .ok()?
        .into_iter()
        .find_map(|line| {
            let cwd = line.get("cwd")?.as_str()?;
            (!cwd.is_empty()
                && (qoder_cli_project_slug(cwd) == bucket
                    || qoder_encode_project_slug(cwd) == bucket))
                .then(|| cwd.to_owned())
        })
}

fn qoder_transcript_cwd(path: &Path, bucket: &str, metadata: &std::fs::Metadata) -> Option<String> {
    const CACHE_CAPACITY: usize = 4096;
    let signature = metadata
        .modified()
        .ok()
        .map(|mtime| (metadata.len(), mtime));
    if let Some(signature) = signature {
        if let Some(cached) = QODER_CWD_CACHE.lock().get(path) {
            if cached.signature == signature {
                return cached.cwd.clone();
            }
        }
    }
    let cwd = read_qoder_transcript_cwd(path, bucket);
    if let Some(signature) = signature {
        let mut cache = QODER_CWD_CACHE.lock();
        if cache.len() >= CACHE_CAPACITY && !cache.contains_key(path) {
            cache.clear();
        }
        cache.insert(
            path.to_path_buf(),
            CachedQoderCwd {
                signature,
                cwd: cwd.clone(),
            },
        );
    }
    cwd
}

#[derive(Debug)]
struct QoderProjectDir {
    path: PathBuf,
    cli_encoded: bool,
}

#[allow(
    clippy::disallowed_methods,
    reason = "compares the person's project folder against an engine's records; the folder may not be linked"
)]
fn qoder_project_dirs(base: &Path, workspace: &Path) -> Vec<QoderProjectDir> {
    fn push(
        out: &mut Vec<QoderProjectDir>,
        seen: &mut std::collections::HashSet<String>,
        base: &Path,
        spelling: &str,
    ) {
        for (slug, cli_encoded) in [
            (qoder_cli_project_slug(spelling), true),
            (qoder_encode_project_slug(spelling), false),
        ] {
            if !slug.is_empty() && seen.insert(slug.clone()) {
                out.push(QoderProjectDir {
                    path: base.join(slug),
                    cli_encoded,
                });
            }
        }
    }
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let raw = workspace.to_string_lossy().to_string();
    let trimmed = raw.trim_end_matches(['/', '\\']).to_string();
    push(&mut out, &mut seen, base, &raw);
    push(&mut out, &mut seen, base, &trimmed);
    for spelling in [&raw, &trimmed] {
        if let Ok(canonical) = std::fs::canonicalize(spelling) {
            let canonical = strip_verbatim_prefix(&canonical.to_string_lossy()).to_string();
            push(&mut out, &mut seen, base, &canonical);
        }
    }
    out
}

#[allow(
    clippy::disallowed_methods,
    reason = "compares the person's project folder against an engine's records; the folder may not be linked"
)]
fn qoder_cwd_matches_workspace(
    cwd: &str,
    workspace: &Path,
    canonical_workspace: Option<&Path>,
) -> bool {
    let cwd = Path::new(cwd);
    cwd == workspace
        || canonical_workspace.is_some_and(|canonical| {
            std::fs::canonicalize(cwd).is_ok_and(|resolved| resolved == canonical)
        })
}

#[allow(
    clippy::disallowed_methods,
    reason = "reads Qoder's own history in place and compares the person's project folder against it; the folder may not be linked"
)]
pub(super) fn discover_qoder(
    workspace: &Path,
    distribution: crate::engines::qoder::QoderDistribution,
) -> Vec<SessionFile> {
    let base =
        crate::engines::engine_home(None, distribution.default_config_dir_name()).join("projects");
    let mut out = Vec::new();
    let mut seen_sessions = std::collections::HashSet::new();
    let canonical_workspace = std::fs::canonicalize(workspace).ok();
    for dir in qoder_project_dirs(&base, workspace) {
        let Some(bucket) = dir.path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let Ok(entries) = std::fs::read_dir(&dir.path) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let Ok(metadata) = std::fs::metadata(&path) else {
                continue;
            };
            if !metadata.is_file() {
                continue;
            }
            match qoder_transcript_cwd(&path, bucket, &metadata) {
                Some(cwd)
                    if !qoder_cwd_matches_workspace(
                        &cwd,
                        workspace,
                        canonical_workspace.as_deref(),
                    ) =>
                {
                    continue;
                }
                None if dir.cli_encoded => continue,
                _ => {}
            }
            if !seen_sessions.insert(stem.to_string()) {
                continue;
            }
            out.push(SessionFile {
                engine: distribution.engine_id(),
                session_id: stem.to_string(),
                workspace_path: workspace.to_string_lossy().to_string(),
                file_path: path,
            });
        }
    }
    out
}

#[allow(
    clippy::disallowed_methods,
    reason = "reads a Qoder transcript in place and compares the person's project folder against it; the folder may not be linked"
)]
pub(super) fn qoder_transcript_conflicts_with_workspace(path: &Path, workspace: &Path) -> bool {
    let Some(bucket) = path
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
    else {
        return false;
    };
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    let canonical_workspace = std::fs::canonicalize(workspace).ok();
    read_qoder_transcript_cwd(path, bucket).is_some_and(|cwd| {
        if Path::new(&cwd) == workspace {
            return false;
        }
        let Some(canonical) = canonical_workspace.as_deref() else {
            return false;
        };
        !qoder_cwd_matches_workspace(&cwd, workspace, Some(canonical))
    })
}

fn grok_url_decode(encoded: &str) -> String {
    let bytes = encoded.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = &encoded[i + 1..i + 3];
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

pub(super) fn discover_grok(workspace: &Path) -> Vec<SessionFile> {
    let roots = dir_session_anchor_roots("grok");
    let mut out = Vec::new();
    for root in roots {
        out.extend(discover_grok_in(&root, workspace));
    }
    out
}

pub(crate) fn dir_session_anchor_roots(engine: &str) -> Vec<PathBuf> {
    match engine {
        "kimi" => {
            let mut homes = vec![crate::engines::engine_home(None, ".kimi-code")];
            homes.push(crate::engines::engine_home(Some("KIMI_HOME"), ".kimi"));
            homes.extend(legacy_provider_homes("kimi-provider-homes"));
            homes
        }
        "grok" => {
            let mut roots = vec![crate::engines::engine_home(None, ".grok").join("sessions")];
            roots.extend(
                legacy_provider_homes("grok-provider-homes")
                    .into_iter()
                    .map(|home| home.join("sessions")),
            );
            roots
        }
        "minimax" => {
            vec![
                crate::engines::engine_home(Some("MINIMAX_DATA_DIR"), ".minimax")
                    .join("v2")
                    .join("sessions"),
            ]
        }
        _ => Vec::new(),
    }
}

#[allow(
    clippy::disallowed_methods,
    reason = "reads the engine's own history in place, wherever the engine keeps it"
)]
fn discover_grok_in(sessions_root: &Path, workspace: &Path) -> Vec<SessionFile> {
    let Ok(cwd_dirs) = std::fs::read_dir(sessions_root) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for cwd_entry in cwd_dirs.flatten() {
        let cwd_dir = cwd_entry.path();
        if !cwd_dir.is_dir() {
            continue;
        }
        let decoded = grok_url_decode(&cwd_entry.file_name().to_string_lossy());
        if !same_or_child(Path::new(&decoded), workspace) {
            continue;
        }
        let Ok(session_dirs) = std::fs::read_dir(&cwd_dir) else {
            continue;
        };
        for session_entry in session_dirs.flatten() {
            let session_dir = session_entry.path();
            if !session_dir.is_dir() {
                continue;
            }
            let chat = session_dir.join("chat_history.jsonl");
            if !chat.is_file() {
                continue;
            }
            let session_id = session_entry.file_name().to_string_lossy().to_string();
            if session_id.is_empty() {
                continue;
            }
            out.push(SessionFile {
                engine: "grok",
                session_id,
                workspace_path: workspace.to_string_lossy().to_string(),
                file_path: chat,
            });
        }
    }
    out
}

#[allow(
    clippy::disallowed_methods,
    reason = "reads the engine's own history in place, wherever the engine keeps it"
)]
pub(super) fn discover_minimax(workspace: &Path) -> Vec<SessionFile> {
    let data_dir = crate::engines::engine_home(Some("MINIMAX_DATA_DIR"), ".minimax");
    let sessions_root = data_dir.join("v2").join("sessions");
    let db_path = data_dir
        .join("v2")
        .join("sqlite")
        .join("runtime-state.sqlite");
    let mut out = Vec::new();
    let Ok(conn) =
        rusqlite::Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return out;
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT session_id, COALESCE(workspace_dir, ''), COALESCE(project_workspace_dir, ''), \
         COALESCE(history_relative_dir, '') FROM local_runtime_sessions \
         WHERE session_kind = 'conversation' AND visibility = 'visible' AND archived = 0",
    ) else {
        return out;
    };
    let Ok(rows) = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    }) else {
        return out;
    };
    for (session_id, workspace_dir, project_dir, relative) in rows.flatten() {
        let session_id = session_id.trim();
        let relative = relative.trim().trim_matches('/');
        if session_id.is_empty() || relative.is_empty() {
            continue;
        }
        let matches = |session_workspace: &str| {
            !session_workspace.is_empty() && same_or_child(Path::new(session_workspace), workspace)
        };
        if !matches(workspace_dir.trim()) && !matches(project_dir.trim()) {
            continue;
        }
        let messages = sessions_root.join(relative).join("messages.jsonl");
        if !messages.is_file() {
            continue;
        }
        out.push(SessionFile {
            engine: "minimax",
            session_id: session_id.to_string(),
            workspace_path: workspace.to_string_lossy().to_string(),
            file_path: messages,
        });
    }
    out
}

#[allow(
    clippy::disallowed_methods,
    reason = "reads the engine's own history in place, wherever the engine keeps it"
)]
pub(super) fn discover_agy(workspace: &Path) -> Vec<SessionFile> {
    let home = crate::engines::agy::agy_home();
    let conv_dir = home.join("conversations");
    let mut by_id: std::collections::HashMap<String, PathBuf> = std::collections::HashMap::new();

    if let Ok(conn) = rusqlite::Connection::open_with_flags(
        home.join("conversation_summaries.db"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) {
        if let Ok(mut stmt) =
            conn.prepare("SELECT conversation_id, workspace_uris FROM conversation_summaries")
        {
            if let Ok(rows) = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }) {
                for row in rows.flatten() {
                    let (id, uris) = row;
                    if id.trim().is_empty() {
                        continue;
                    }
                    if agy_uris_match_workspace(&uris, workspace) {
                        let path = conv_dir.join(format!("{id}.db"));
                        by_id.entry(id).or_insert(path);
                    }
                }
            }
        }
    }

    if let Ok(text) = std::fs::read_to_string(home.join("cache").join("last_conversations.json")) {
        if let Ok(map) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&text) {
            for (cwd, id) in map {
                let Some(id) = id.as_str().map(str::trim).filter(|s| !s.is_empty()) else {
                    continue;
                };
                if same_or_child(Path::new(&cwd), workspace) {
                    by_id
                        .entry(id.to_string())
                        .or_insert_with(|| conv_dir.join(format!("{id}.db")));
                }
            }
        }
    }

    by_id
        .into_iter()
        .filter(|(_, path)| path.is_file())
        .map(|(session_id, file_path)| SessionFile {
            engine: "agy",
            session_id,
            workspace_path: workspace.to_string_lossy().to_string(),
            file_path,
        })
        .collect()
}

fn agy_uris_match_workspace(uris_json: &str, workspace: &Path) -> bool {
    let Ok(uris) = serde_json::from_str::<Vec<String>>(uris_json) else {
        return false;
    };
    uris.iter()
        .any(|uri| file_uri_path(uri).is_some_and(|path| same_or_child(&path, workspace)))
}

fn file_uri_path(uri: &str) -> Option<PathBuf> {
    let rest = uri.strip_prefix("file://")?;
    Some(PathBuf::from(percent_decode_path(rest)))
}

fn percent_decode_path(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (from_hex(bytes[i + 1]), from_hex(bytes[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn from_hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn is_codex_subagent_source(source: &serde_json::Value) -> bool {
    source
        .get("subagent")
        .map(|v| v.is_object() || v.as_bool() == Some(true))
        .unwrap_or(false)
}

fn is_codex_subagent_head(head: &serde_json::Value) -> bool {
    head.get("type").and_then(|v| v.as_str()) == Some("session_meta")
        && head
            .get("payload")
            .and_then(|p| p.get("source"))
            .is_some_and(is_codex_subagent_source)
}

pub(super) fn is_codex_subagent_file(path: &Path) -> bool {
    peek_head_json_lines(path, 8)
        .iter()
        .any(is_codex_subagent_head)
}

pub(super) fn identify_head(engine: &str, path: &Path) -> Option<(String, String)> {
    if engine != "codex" {
        return None;
    }
    for head in peek_head_json_lines(path, 8) {
        if head.get("type").and_then(|v| v.as_str()) != Some("session_meta") {
            continue;
        }
        let source = head.get("payload")?;
        if source.get("source").is_some_and(is_codex_subagent_source) {
            return None;
        }
        let id = source.get("id").and_then(|v| v.as_str())?.trim();
        let cwd = source.get("cwd").and_then(|v| v.as_str())?.trim();
        if id.is_empty() || cwd.is_empty() {
            return None;
        }
        return Some((id.to_string(), cwd.to_string()));
    }
    None
}

#[allow(
    clippy::disallowed_methods,
    reason = "reads Codex's own history in place, in its home and the legacy ~/.ccgui provider homes"
)]
pub(super) fn codex_candidates() -> Vec<PathBuf> {
    let mut homes = vec![crate::engines::codex_home()];
    homes.extend(legacy_provider_homes("codex-provider-homes"));
    let mut out = Vec::new();
    for home in homes {
        for root in [home.join("sessions"), home.join("archived_sessions")] {
            let mut stack = vec![root];
            while let Some(dir) = stack.pop() {
                let Ok(entries) = std::fs::read_dir(&dir) else {
                    continue;
                };
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        stack.push(path);
                    } else if path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.starts_with("rollout-") && n.ends_with(".jsonl"))
                        .unwrap_or(false)
                    {
                        out.push(path);
                    }
                }
            }
        }
    }
    out
}

#[allow(
    clippy::disallowed_methods,
    reason = "resolves a session's folder and an engine's home to compare them; neither need be granted"
)]
pub(super) fn path_is_under(path: &str, home: &Path) -> bool {
    let path = Path::new(path);
    if path.starts_with(home) {
        return true;
    }
    match (std::fs::canonicalize(path), std::fs::canonicalize(home)) {
        (Ok(path), Ok(home)) => path.starts_with(home),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::super::scanner::tests::{scratch_dir, HomeGuard, HOME_LOCK};
    use super::*;

    struct ClaudeConfigDirGuard {
        _lock: parking_lot::MutexGuard<'static, ()>,
        prev: Option<std::ffi::OsString>,
    }
    impl ClaudeConfigDirGuard {
        fn set(dir: &Path) -> Self {
            let lock = HOME_LOCK.lock();
            let prev = std::env::var_os("CLAUDE_CONFIG_DIR");
            std::env::set_var("CLAUDE_CONFIG_DIR", dir);
            Self { _lock: lock, prev }
        }
    }
    impl Drop for ClaudeConfigDirGuard {
        fn drop(&mut self) {
            match &self.prev {
                Some(value) => std::env::set_var("CLAUDE_CONFIG_DIR", value),
                None => std::env::remove_var("CLAUDE_CONFIG_DIR"),
            }
        }
    }

    #[test]
    fn identify_head_skips_codex_subagent_rollout() {
        let dir = scratch_dir("identify-subagent");
        let path = dir.join("s.jsonl");
        std::fs::write(
            &path,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"child\",\"cwd\":\"/ws\",",
                "\"source\":{\"subagent\":{\"thread_spawn\":{\"parent_thread_id\":\"parent\",",
                "\"depth\":1,\"agent_path\":\"/root/review\",\"agent_nickname\":\"Hypatia\"}}}}}\n",
            ),
        )
        .unwrap();
        assert_eq!(identify_head("codex", &path), None);
        assert!(is_codex_subagent_file(&path));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn strip_verbatim_prefix_removes_windows_prefix_only() {
        assert_eq!(
            strip_verbatim_prefix(r"\\?\C:\Users\zlt\proj"),
            r"C:\Users\zlt\proj"
        );
        assert_eq!(
            strip_verbatim_prefix(r"C:\Users\zlt\proj"),
            r"C:\Users\zlt\proj"
        );
        assert_eq!(
            strip_verbatim_prefix("/Users/demo/proj"),
            "/Users/demo/proj"
        );
    }

    #[test]
    fn discover_claude_matches_trailing_slash_spelling_under_config_dir() {
        let home = scratch_dir("discover-claude");
        let config_dir = home.join("claude-config");
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).unwrap();
        let encoded = super::super::claude_encode_project_path(&workspace.to_string_lossy());
        let project_dir = config_dir.join("projects").join(&encoded);
        std::fs::create_dir_all(&project_dir).unwrap();
        std::fs::write(project_dir.join("s1.jsonl"), "{}\n").unwrap();

        let _guard = ClaudeConfigDirGuard::set(&config_dir);
        let spelled = PathBuf::from(format!("{}/", workspace.to_string_lossy()));
        let found = discover_claude(&spelled);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].session_id, "s1");

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn codex_candidates_include_provider_homes() {
        let home = scratch_dir("codex-candidates-legacy");
        let active = home
            .join(".codex")
            .join("sessions")
            .join("2026")
            .join("09")
            .join("01");
        let managed = home
            .join(".ccgui")
            .join("codex-provider-homes")
            .join("p1")
            .join("sessions")
            .join("2026")
            .join("08")
            .join("19");
        std::fs::create_dir_all(&active).unwrap();
        std::fs::create_dir_all(&managed).unwrap();
        std::fs::write(active.join("rollout-2026-09-01T00-00-00-new.jsonl"), "").unwrap();
        std::fs::write(managed.join("rollout-2026-08-19T00-00-00-old.jsonl"), "").unwrap();

        let _guard = HomeGuard::set(&home);
        let found = codex_candidates();
        let names: Vec<String> = found
            .iter()
            .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
            .collect();
        assert!(names.iter().any(|n| n.contains("new")));
        assert!(names.iter().any(|n| n.contains("old")));

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn peek_head_stays_bounded_when_line_exceeds_cap() {
        let dir = scratch_dir("peek-cap");
        let path = dir.join("big.jsonl");
        let huge = "x".repeat(2 * 1024 * 1024);
        std::fs::write(
            &path,
            format!(
                "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"a\",\"cwd\":\"{huge}\"}}}}}}\n"
            ),
        )
        .unwrap();
        assert!(peek_head_json_lines(&path, 8).is_empty());
        assert_eq!(identify_head("codex", &path), None);
        std::fs::remove_dir_all(&dir).ok();
    }

    fn write_kimi_wire_session(
        index_dir: &Path,
        session_dir: &Path,
        workspace: &Path,
        session_id: &str,
    ) {
        let wire = session_dir
            .join("agents")
            .join(crate::known_names::KIMI_PRIMARY_AGENT);
        std::fs::create_dir_all(index_dir).unwrap();
        std::fs::create_dir_all(&wire).unwrap();
        std::fs::write(wire.join("wire.jsonl"), "{}\n").unwrap();
        let line = format!(
            "{{\"workDir\":\"{}\",\"sessionId\":\"{session_id}\",\"sessionDir\":\"{}\"}}",
            workspace.to_string_lossy().replace('\\', "\\\\"),
            session_dir.to_string_lossy().replace('\\', "\\\\"),
        );
        std::fs::write(index_dir.join("session_index.jsonl"), format!("{line}\n")).unwrap();
    }

    #[test]
    fn discover_kimi_reads_legacy_and_provider_homes() {
        let home = scratch_dir("discover-kimi-legacy");
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).unwrap();
        write_kimi_wire_session(
            &home.join(".kimi"),
            &home.join("old-cli-session"),
            &workspace,
            "old-cli",
        );
        let provider_home = home.join(".ccgui").join("kimi-provider-homes").join("p1");
        write_kimi_wire_session(
            &provider_home,
            &home.join("managed-session"),
            &workspace,
            "managed",
        );

        let _guard = HomeGuard::set(&home);
        let found = discover_kimi(&workspace);
        let mut ids: Vec<&str> = found.iter().map(|f| f.session_id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, ["managed", "old-cli"]);

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn discover_grok_reads_provider_homes() {
        let home = scratch_dir("discover-grok-legacy");
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).unwrap();
        let encoded: String = workspace
            .to_string_lossy()
            .bytes()
            .map(|b| format!("%{b:02X}"))
            .collect();
        let session_dir = home
            .join(".ccgui")
            .join("grok-provider-homes")
            .join("p1")
            .join("sessions")
            .join(encoded)
            .join("g1");
        std::fs::create_dir_all(&session_dir).unwrap();
        std::fs::write(session_dir.join("chat_history.jsonl"), "{}\n").unwrap();

        let _guard = HomeGuard::set(&home);
        let found = discover_grok(&workspace);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].session_id, "g1");

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn qoder_project_slug_matches_qodercli_encoding() {
        assert_eq!(
            qoder_encode_project_slug("/Users/foo/bar"),
            "-Users-foo-bar"
        );
        assert_eq!(
            qoder_encode_project_slug("/Users/foo/bar/"),
            "-Users-foo-bar"
        );
        assert_eq!(qoder_encode_project_slug(r"C:\ws\proj"), "C--ws-proj");
        assert_eq!(qoder_encode_project_slug("/"), "-");
        assert_eq!(qoder_encode_project_slug(""), "");
    }

    #[test]
    fn discover_qoder_finds_workspace_sessions_by_slug() {
        let home = scratch_dir("discover-qoder");
        let workspace = home.join("ws").join("proj");
        std::fs::create_dir_all(&workspace).unwrap();
        let slug = qoder_encode_project_slug(&workspace.to_string_lossy());
        let dir = home.join(".qoder").join("projects").join(&slug);
        std::fs::create_dir_all(&dir).unwrap();
        let line = serde_json::json!({"cwd": workspace.to_string_lossy()});
        std::fs::write(dir.join("sess-1.jsonl"), format!("{line}\n")).unwrap();
        std::fs::write(dir.join("notes.txt"), "x").unwrap();

        let _guard = HomeGuard::set(&home);
        let found = discover_qoder(&workspace, crate::engines::qoder::QoderDistribution::Global);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].engine, "qoder");
        assert_eq!(found[0].session_id, "sess-1");
        assert_eq!(found[0].workspace_path, workspace.to_string_lossy());

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn discover_qoder_cn_reads_the_cn_home() {
        let home = scratch_dir("discover-qoder-cn");
        let workspace = home.join("ws").join("proj");
        std::fs::create_dir_all(&workspace).unwrap();
        let slug = qoder_encode_project_slug(&workspace.to_string_lossy());
        let dir = home.join(".qoder-cn").join("projects").join(&slug);
        std::fs::create_dir_all(&dir).unwrap();
        let line = serde_json::json!({"cwd": workspace.to_string_lossy()});
        std::fs::write(dir.join("sess-cn.jsonl"), format!("{line}\n")).unwrap();

        let _guard = HomeGuard::set(&home);
        let found = discover_qoder(&workspace, crate::engines::qoder::QoderDistribution::Cn);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].engine, "qoder-cn");
        assert_eq!(found[0].session_id, "sess-cn");
        assert!(
            discover_qoder(&workspace, crate::engines::qoder::QoderDistribution::Global).is_empty()
        );

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn qoder_project_dirs_include_reported_chinese_windows_slug() {
        let base = Path::new("projects");
        let dirs = qoder_project_dirs(
            base,
            Path::new(r"E:\公司\深圳睿服科技\04Project\RFKJ\261015RuiFuOperationsBusiPlat"),
        );
        assert!(dirs.iter().any(|dir| dir.path
            == base.join("E------------04Project-RFKJ-261015RuiFuOperationsBusiPlat")));
    }

    #[test]
    fn discover_qoder_accepts_sanitized_and_legacy_dirs_without_duplicates() {
        let home = scratch_dir("qoder-unicode");
        let workspace = home.join("中文 工作区");
        std::fs::create_dir_all(&workspace).unwrap();
        let spelling = workspace.to_string_lossy();
        let sanitized = super::super::claude_encode_project_path(&spelling);
        let legacy = qoder_encode_project_slug(&spelling);
        assert_ne!(sanitized, legacy);
        let _guard = HomeGuard::set(&home);
        for (distribution, config) in [
            (crate::engines::qoder::QoderDistribution::Global, ".qoder"),
            (crate::engines::qoder::QoderDistribution::Cn, ".qoder-cn"),
        ] {
            let base = home.join(config).join("projects");
            for (slug, id) in [
                (&sanitized, "shared"),
                (&legacy, "shared"),
                (&legacy, "legacy-only"),
            ] {
                let dir = base.join(slug);
                std::fs::create_dir_all(&dir).unwrap();
                let content = if slug == &sanitized {
                    serde_json::json!({"cwd": workspace.to_string_lossy()}).to_string()
                } else {
                    "{}".to_string()
                };
                std::fs::write(dir.join(format!("{id}.jsonl")), format!("{content}\n")).unwrap();
            }
            let found = discover_qoder(&workspace, distribution);
            let mut ids: Vec<_> = found.iter().map(|file| file.session_id.as_str()).collect();
            ids.sort();
            assert_eq!(ids, ["legacy-only", "shared"]);
            assert!(found
                .iter()
                .all(|file| file.engine == distribution.engine_id()));
            assert_eq!(
                found
                    .iter()
                    .find(|file| file.session_id == "shared")
                    .unwrap()
                    .file_path,
                base.join(&sanitized).join("shared.jsonl")
            );
        }
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn discover_minimax_links_runtime_rows_to_transcripts() {
        let home = scratch_dir("discover-minimax");
        let data = home.join("minimax-data");
        let workspace = home.join("ws");
        let relative = "2026/09/20/17-19-21-163-session_bXZzX2Nj";
        let session_dir = data.join("v2").join("sessions").join(relative);
        std::fs::create_dir_all(&session_dir).unwrap();
        std::fs::write(session_dir.join("manifest.json"), "{}\n").unwrap();
        std::fs::write(session_dir.join("messages.jsonl"), "{}\n").unwrap();

        let db_dir = data.join("v2").join("sqlite");
        std::fs::create_dir_all(&db_dir).unwrap();
        let conn = rusqlite::Connection::open(db_dir.join("runtime-state.sqlite")).unwrap();
        let ws = workspace.to_string_lossy().replace('\'', "''");
        conn.execute_batch(&format!(
            "CREATE TABLE local_runtime_sessions (
                session_id TEXT PRIMARY KEY, workspace_dir TEXT, project_workspace_dir TEXT,
                history_relative_dir TEXT, session_kind TEXT, visibility TEXT, archived INTEGER);
            INSERT INTO local_runtime_sessions VALUES ('mvs_hit', '{ws}', '{ws}', '{relative}', 'conversation', 'visible', 0);
            INSERT INTO local_runtime_sessions VALUES ('mvs_other_workspace', '/elsewhere', '/elsewhere', '{relative}', 'conversation', 'visible', 0);
            INSERT INTO local_runtime_sessions VALUES ('mvs_task', '{ws}', '{ws}', '{relative}', 'task', 'visible', 0);
            INSERT INTO local_runtime_sessions VALUES ('mvs_archived', '{ws}', '{ws}', '{relative}', 'conversation', 'visible', 1);
            INSERT INTO local_runtime_sessions VALUES ('mvs_missing_transcript', '{ws}', '{ws}', 'gone/session', 'conversation', 'visible', 0);",
        ))
        .unwrap();

        let prev = std::env::var_os("MINIMAX_DATA_DIR");
        std::env::set_var("MINIMAX_DATA_DIR", &data);
        let found = discover_minimax(&workspace);
        match &prev {
            Some(value) => std::env::set_var("MINIMAX_DATA_DIR", value),
            None => std::env::remove_var("MINIMAX_DATA_DIR"),
        }
        assert_eq!(found.len(), 1, "only the matching visible conversation");
        assert_eq!(found[0].session_id, "mvs_hit");
        assert!(found[0].file_path.ends_with("messages.jsonl"));
        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn qoder_cwd_cache_rechecks_changed_files_and_skips_unrelated_cwd() {
        let home = scratch_dir("qoder-cwd-cache");
        let frontend = home.join("前端");
        let backend = home.join("后端");
        let bucket = qoder_cli_project_slug(&frontend.to_string_lossy());
        let transcript = home.join("session.jsonl");
        let read = || {
            qoder_transcript_cwd(
                &transcript,
                &bucket,
                &std::fs::metadata(&transcript).unwrap(),
            )
        };
        std::fs::write(&transcript, "{}\n").unwrap();
        assert_eq!(read(), None);
        let text = [
            serde_json::json!({"cwd": "/unrelated"}),
            serde_json::json!({"cwd": backend}),
            serde_json::json!({"cwd": frontend}),
        ]
        .map(|line| line.to_string())
        .join("\n");
        std::fs::write(&transcript, text).unwrap();
        assert_eq!(read().as_deref(), backend.to_str());
        assert_eq!(read().as_deref(), backend.to_str());
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn qoder_project_dirs_match_cli_for_astral_and_long_paths() {
        let base = Path::new("projects");
        let cases = [
            (r"C:\".to_string(), "C--".to_string()),
            ("/Users/a/🎉项目".to_string(), "-Users-a-----".to_string()),
            ("/Users/a/𠮷野家".to_string(), "-Users-a-----".to_string()),
            (
                format!("/{}", "a".repeat(199)),
                format!("-{}", "a".repeat(199)),
            ),
            (
                format!("/{}", "a".repeat(200)),
                format!("-{}-84q8za", "a".repeat(199)),
            ),
            (
                format!("/Users/foo/{}proj", "很长的目录名/".repeat(40)),
                format!("-Users-foo-{}-cxtcfr", "-".repeat(189)),
            ),
            (
                format!(r"D:\工作\{}proj", r"很长的目录名\".repeat(40)),
                format!("D{}-41qg6d", "-".repeat(199)),
            ),
        ];
        for (workspace, slug) in cases {
            let dirs = qoder_project_dirs(base, Path::new(&workspace));
            assert!(
                dirs.iter().any(|dir| dir.path == base.join(&slug)),
                "{workspace} should map to {slug}, got {dirs:?}"
            );
        }
    }
}
