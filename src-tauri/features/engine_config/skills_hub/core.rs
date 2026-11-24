// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//! The skills hub's shared pieces: limits, errors, where the hub keeps its own copy of each skill
//! (`~/.misty/engine-config/skills-hub`) and the engines it syncs skills into.
//!
//! Upstream traces back to TokenTracker's `skills-manager.js` / `skill-usage.js` (MIT). Changes
//! for Misty:
//! 1. The hub's single source of truth (SSOT) lives in Misty's own data folder, overridable with
//!    `MISTY_SKILLS_HUB_HOME` for tests.
//! 2. Targets cover every CLI that reads a user skills folder, plus the cross-agent `~/.agents`.
//!    Each CLI's home follows its own environment variable. A target whose engine home doesn't
//!    exist is marked `available: false` and hidden. Folders that only appear in a CLI's own tree
//!    and aren't managed here are read-only sources (Codex `.system` and plugin caches).
//! 3. Skill usage is counted from Claude Code transcripts (`<claude home>/projects/**/*.jsonl`);
//!    the response names that scope. Other engines keep no reliable record of skill calls.
//! 4. Delete and uninstall refuse read-only sources (built-in, system, plugin).

use file_access::fs;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::fsutil::*;

pub(super) const FETCH_TIMEOUT: Duration = Duration::from_secs(20);
pub(super) const DISCOVER_CONCURRENCY: usize = 4;
pub(super) const DISCOVER_CACHE_TTL_MS: i64 = 60 * 60 * 1000;
pub(super) const UPDATE_CACHE_TTL_MS: i64 = 60 * 60 * 1000;
pub(super) const UPDATE_CHECK_CONCURRENCY: usize = 2;
pub(super) const POPULAR_CACHE_TTL_MS: i64 = 6 * 60 * 60 * 1000;
pub(super) const TRASH_TTL_MS: i64 = 5 * 60 * 1000;
pub(super) const ACTIVITY_MAX: usize = 500;
pub(super) const ACTIVITY_TRIM_BYTES: u64 = 256 * 1024;
pub(super) const USAGE_CACHE_TTL_MS: i64 = 10 * 60 * 1000;
pub(super) const MAX_LOCAL_SKILL_SCAN_DEPTH: usize = 3;
pub(super) const DISCOVER_MAX_SKILLS_PER_REPO: usize = 200;
pub(super) const POPULAR_SEED_QUERIES: [&str; 12] = [
    "agent", "code", "test", "review", "git", "web", "design", "data", "docs", "python", "api",
    "deploy",
];
pub(super) const HASH_IGNORE: [&str; 4] = [".git", ".DS_Store", "Thumbs.db", ".gitignore"];
pub(super) const USAGE_SCOPE_CLAUDE_TRANSCRIPTS: &str = "claude_code_transcripts";

#[derive(Debug)]
pub(super) enum SkillError {
    RateLimited(String),
    Coded(&'static str, String),
    Other(String),
}

impl SkillError {
    pub(super) fn other(message: impl Into<String>) -> Self {
        Self::Other(message.into())
    }
    pub(super) fn coded(code: &'static str, message: impl Into<String>) -> Self {
        Self::Coded(code, message.into())
    }
    pub(super) fn is_rate_limited(&self) -> bool {
        matches!(self, Self::RateLimited(_))
    }
}

impl std::fmt::Display for SkillError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RateLimited(m) | Self::Coded(_, m) | Self::Other(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for SkillError {}

impl From<std::io::Error> for SkillError {
    fn from(error: std::io::Error) -> Self {
        let code = match error.kind() {
            std::io::ErrorKind::NotFound => "not_found",
            std::io::ErrorKind::PermissionDenied => "permission",
            std::io::ErrorKind::AlreadyExists => "conflict",
            _ => "internal",
        };
        Self::coded(code, error.to_string())
    }
}

pub(super) type SkillResult<T> = Result<T, SkillError>;

pub(super) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub(super) fn skills_root() -> PathBuf {
    if let Some(override_dir) = std::env::var_os("MISTY_SKILLS_HUB_HOME") {
        if !override_dir.is_empty() {
            return PathBuf::from(override_dir);
        }
    }
    crate::engine_config::support::app_home().join("skills-hub")
}

pub(super) fn registry_path() -> PathBuf {
    skills_root().join("registry.json")
}
pub(super) fn ssot_dir() -> PathBuf {
    skills_root().join("managed")
}
pub(super) fn trash_dir() -> PathBuf {
    skills_root().join(".trash")
}
pub(super) fn tmp_dir() -> PathBuf {
    skills_root().join("tmp")
}
pub(super) fn discover_cache_path() -> PathBuf {
    skills_root().join("discover-cache.json")
}
pub(super) fn updates_cache_path() -> PathBuf {
    skills_root().join("updates-cache.json")
}
pub(super) fn popular_cache_path() -> PathBuf {
    skills_root().join("popular-cache.json")
}
pub(super) fn activity_path() -> PathBuf {
    skills_root().join("activity.jsonl")
}
pub(super) fn usage_cache_path() -> PathBuf {
    skills_root().join("usage-cache.json")
}

pub(super) fn is_dir(path: &Path) -> bool {
    fs::metadata(path)
        .map(|meta| meta.is_dir())
        .unwrap_or(false)
}

fn antigravity_homes() -> Vec<PathBuf> {
    let mut homes = vec![crate::engine_config::support::engine_home(
        Some("ANTIGRAVITY_HOME"),
        ".gemini/antigravity-cli",
    )];
    for home in [".gemini/antigravity", ".gemini/antigravity-ide"] {
        homes.push(crate::engine_config::support::engine_home(None, home));
    }
    homes
}

pub(super) enum TargetKind {
    Claude,
    Codex,
    Agy,
    Agents,
}

pub(super) struct Target {
    pub(super) id: &'static str,
    pub(super) label: &'static str,
    pub(super) visible: bool,
    pub(super) kind: TargetKind,
}

pub(super) static TARGETS: [Target; 4] = [
    Target {
        id: "claude",
        label: "Claude",
        visible: true,
        kind: TargetKind::Claude,
    },
    Target {
        id: "codex",
        label: "Codex",
        visible: true,
        kind: TargetKind::Codex,
    },
    Target {
        id: "agy",
        label: "Antigravity",
        visible: true,
        kind: TargetKind::Agy,
    },
    Target {
        id: "agents",
        label: "Agents",
        visible: false,
        kind: TargetKind::Agents,
    },
];

pub(super) fn target_by_id(id: &str) -> Option<&'static Target> {
    TARGETS.iter().find(|target| target.id == id)
}

pub(super) fn target_home_dirs(target: &Target) -> Vec<PathBuf> {
    match target.kind {
        TargetKind::Claude => vec![crate::engine_config::support::engine_home(
            Some("CLAUDE_CONFIG_DIR"),
            ".claude",
        )],
        TargetKind::Codex => vec![crate::engine_config::support::codex_home()],
        TargetKind::Agy => antigravity_homes(),
        TargetKind::Agents => vec![crate::engine_config::support::engine_home(None, ".agents")],
    }
}

pub(super) fn target_dirs(target: &Target) -> Vec<PathBuf> {
    target_home_dirs(target)
        .into_iter()
        .map(|home| home.join("skills"))
        .collect()
}

pub(super) fn target_primary_dir(target: &Target) -> PathBuf {
    target_dirs(target).into_iter().next().unwrap_or_default()
}

fn target_available(target: &Target) -> bool {
    target_dirs(target)
        .iter()
        .any(|dir| is_dir(dir) || dir.parent().is_some_and(is_dir))
}

pub(super) fn target_list() -> Vec<Value> {
    TARGETS
        .iter()
        .filter(|target| target.visible)
        .map(|t| {
            json!({
                "id": t.id,
                "label": t.label,
                "path": target_primary_dir(t).to_string_lossy(),
                "readonly": false,
                "available": target_available(t),
            })
        })
        .collect()
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum ReadonlyKind {
    Builtin,
    System,
    Plugin,
}

impl ReadonlyKind {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Builtin => "builtin",
            Self::System => "system",
            Self::Plugin => "plugin",
        }
    }
}

pub(super) struct ReadonlySource {
    pub(super) kind: ReadonlyKind,
    pub(super) dir: PathBuf,
}

pub(super) fn bundled_skill_names() -> HashSet<String> {
    HashSet::new()
}

pub(super) fn readonly_sources() -> Vec<ReadonlySource> {
    let mut out: Vec<ReadonlySource> = Vec::new();
    let mut push_system = |dir: PathBuf| {
        if is_dir(&dir) {
            out.push(ReadonlySource {
                kind: ReadonlyKind::System,
                dir,
            });
        }
    };
    let codex_home = crate::engine_config::support::codex_home();
    push_system(codex_home.join("skills").join(".system"));
    for (dir, _) in crate::engines::catalog::codex_plugin_skills_dirs(&codex_home) {
        out.push(ReadonlySource {
            kind: ReadonlyKind::Plugin,
            dir,
        });
    }
    out
}

pub(super) fn readonly_kind_for_dir(directory: &str) -> Option<ReadonlyKind> {
    let leaf = install_name_from_directory(directory)?;
    if bundled_skill_names().contains(&leaf) {
        return Some(ReadonlyKind::Builtin);
    }
    for source in readonly_sources() {
        if super::scan::find_skill_marker(&source.dir.join(&leaf)).is_some() {
            return Some(source.kind);
        }
    }
    None
}

pub(super) fn is_bundled_skill_name(directory: &str) -> bool {
    install_name_from_directory(directory)
        .map(|leaf| bundled_skill_names().contains(&leaf))
        .unwrap_or(false)
}
