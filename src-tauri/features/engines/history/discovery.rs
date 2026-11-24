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
}
