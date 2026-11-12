// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//! The hub registry (`registry.json`), trash purging and the activity log.

use file_access::fs;
use serde_json::{json, Map, Value};

use super::core::*;
use super::fsutil::*;
// ===== Registry reads and writes, and trash purging =====

pub(super) struct Registry {
    pub(super) repos: Vec<Value>,
    pub(super) skills: Vec<Value>,
}

/// upstream DEFAULT_REPOS。
pub(super) fn default_repos() -> Vec<Value> {
    vec![
        json!({"owner": "anthropics", "name": "skills", "branch": crate::known_names::DEFAULT_BRANCH, "enabled": true}),
        json!({"owner": "ComposioHQ", "name": "awesome-claude-skills", "branch": "master", "enabled": true}),
        json!({"owner": "cexll", "name": "myclaude", "branch": "master", "enabled": true}),
        json!({"owner": "JimLiu", "name": "baoyu-skills", "branch": crate::known_names::DEFAULT_BRANCH, "enabled": true}),
    ]
}

/// upstream readRegistry: a missing or unreadable file → defaults; repos not an array → DEFAULT_REPOS;
/// skills not an array → [].
pub(super) fn read_registry() -> Registry {
    if let Some(value) = read_json(&registry_path()) {
        if value.is_object() {
            let repos = value
                .get("repos")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_else(default_repos);
            let skills = value
                .get("skills")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            return Registry { repos, skills };
        }
    }
    Registry {
        repos: default_repos(),
        skills: Vec::new(),
    }
}

pub(super) fn save_registry(registry: &Registry) -> SkillResult<()> {
    write_json(
        &registry_path(),
        &json!({"repos": &registry.repos, "skills": &registry.skills}),
    )
}

/// An entry's trashedAt (JavaScript truthiness: only a non-zero number counts as trashed).
pub(super) fn trashed_at_of(skill: &Value) -> Option<f64> {
    skill
        .get("trashedAt")
        .and_then(Value::as_f64)
        .filter(|n| *n != 0.0)
}

/// upstream purgeExpiredTrash: trashedAt at least TRASH_TTL_MS ago → delete the trash folder and the
/// registry entry; best-effort throughout.
pub(super) fn purge_expired_trash() {
    let now = now_ms();
    let mut registry = read_registry();
    let mut dirty = false;
    registry.skills.retain(|skill| {
        let Some(trashed_at) = trashed_at_of(skill) else {
            return true;
        };
        if now as f64 - trashed_at < TRASH_TTL_MS as f64 {
            return true;
        }
        if let Some(trashed_directory) = skill.get("trashedDirectory").and_then(Value::as_str) {
            if !trashed_directory.is_empty() {
                remove_path(&trash_dir().join(trashed_directory));
            }
        }
        dirty = true;
        false
    });
    if dirty {
        let _ = save_registry(&registry);
    }
}

// ===== Activity log (best-effort, never blocks a mutation) =====

/// upstream appendActivity: appends `{ts, ...event}` as one JSON line (0o600); past 256KB keeps
/// only the last 500 lines; swallows every error.
pub(super) fn append_activity(event: Value) {
    let _ = (|| -> std::io::Result<()> {
        ensure_dir(&skills_root())?;
        let mut record = Map::new();
        record.insert("ts".to_string(), json!(now_ms()));
        if let Value::Object(map) = event {
            record.extend(map);
        }
        let line = serde_json::to_string(&Value::Object(record)).unwrap_or_default();
        append_line_private(&activity_path(), &format!("{line}\n"))?;
        let size = fs::metadata(activity_path())
            .map(|meta| meta.len())
            .unwrap_or(0);
        if size > ACTIVITY_TRIM_BYTES {
            if let Some(raw) = read_text(&activity_path()) {
                let lines: Vec<&str> = raw.split('\n').filter(|l| !l.is_empty()).collect();
                let kept = &lines[lines.len().saturating_sub(ACTIVITY_MAX)..];
                write_file_private(&activity_path(), &format!("{}\n", kept.join("\n")))?;
            }
        }
        Ok(())
    })();
}

/// upstream readActivity: the last `limit` lines (clamped to [1,500], 0 → 100), unreadable lines dropped, newest first.
pub(super) fn read_activity(limit: i64) -> Vec<Value> {
    let want = (if limit == 0 { 100 } else { limit }).clamp(1, ACTIVITY_MAX as i64) as usize;
    let Some(raw) = read_text(&activity_path()) else {
        return Vec::new();
    };
    let lines: Vec<&str> = raw.split('\n').filter(|l| !l.is_empty()).collect();
    lines[lines.len().saturating_sub(want)..]
        .iter()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .rev()
        .collect()
}
