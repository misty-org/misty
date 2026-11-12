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
// ===== Limits (matching upstream skills-manager.js / skill-usage.js) =====

pub(super) const FETCH_TIMEOUT: Duration = Duration::from_secs(20); // upstream FETCH_TIMEOUT_MS
pub(super) const DISCOVER_CONCURRENCY: usize = 4; // upstream DISCOVER_CONCURRENCY
pub(super) const DISCOVER_CACHE_TTL_MS: i64 = 60 * 60 * 1000; // 1 hour
pub(super) const UPDATE_CACHE_TTL_MS: i64 = 60 * 60 * 1000; // 1 hour
pub(super) const UPDATE_CHECK_CONCURRENCY: usize = 2; // upstream UPDATE_CHECK_CONCURRENCY
pub(super) const POPULAR_CACHE_TTL_MS: i64 = 6 * 60 * 60 * 1000; // 6 hours
pub(super) const TRASH_TTL_MS: i64 = 5 * 60 * 1000; // 5 minutes
pub(super) const ACTIVITY_MAX: usize = 500; // upstream ACTIVITY_MAX
pub(super) const ACTIVITY_TRIM_BYTES: u64 = 256 * 1024; // past this, keep only the last ACTIVITY_MAX lines
pub(super) const USAGE_CACHE_TTL_MS: i64 = 10 * 60 * 1000; // 10 minutes
pub(super) const MAX_LOCAL_SKILL_SCAN_DEPTH: usize = 3; // upstream MAX_LOCAL_SKILL_SCAN_DEPTH
pub(super) const DISCOVER_MAX_SKILLS_PER_REPO: usize = 200; // upstream discover stops at 200 per repo
pub(super) const POPULAR_SEED_QUERIES: [&str; 12] = [
    "agent", "code", "test", "review", "git", "web", "design", "data", "docs", "python", "api",
    "deploy",
];
pub(super) const HASH_IGNORE: [&str; 4] = [".git", ".DS_Store", "Thumbs.db", ".gitignore"];
/// What usage counts: Claude Code session transcripts (which include Skill tool calls).
pub(super) const USAGE_SCOPE_CLAUDE_TRANSCRIPTS: &str = "claude_code_transcripts";

// ===== Errors: a rate limit has to be told apart in allSettled-style results and surfaced =====

#[derive(Debug)]
pub(super) enum SkillError {
    /// GitHub / skills.sh rate limiting (HTTP 429|403); the wording matches upstream.
    RateLimited(String),
    /// A failure with a code, which the renderer turns into the matching way out.
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

// ===== Paths: the SSOT root (overridable) and the engine targets the hub manages =====

pub(super) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The SSOT root: `MISTY_SKILLS_HUB_HOME` when set (for tests), else
/// `~/.misty/engine-config/skills-hub` (Misty's own data folder).
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

// ===== Target engines: each CLI's own user-level skills root =====
//
// Only folders a CLI really reads are listed: a copy written anywhere else is invisible to the
// engine, which would be a fake sync. Each folder follows the CLI's own environment variable
// (Claude's `CLAUDE_CONFIG_DIR`, Codex's `CODEX_HOME`, Grok's `GROK_HOME`…), and a target whose
// engine home doesn't exist (the CLI isn't installed) is marked unavailable and hidden, so no
// empty folders are made out of nothing.

/// pi / omp keep user skills in their agent folder (`$PI_CODING_AGENT_DIR` /
/// `$OMP_CODING_AGENT_DIR`, else `~/.pi/agent`, `~/.omp/agent`), not the config root; omp is a
/// fork of pi and reads both variables.
fn coding_agent_home(env_keys: &[&str], home_dir_name: &str) -> PathBuf {
    for key in env_keys {
        if let Some(dir) = std::env::var_os(key).filter(|value| !value.is_empty()) {
            return PathBuf::from(dir);
        }
    }
    crate::engine_config::support::engine_home(None, home_dir_name).join("agent")
}

/// One Antigravity target covers three homes: the `agy` CLI, the Antigravity app and the
/// Antigravity IDE (the reference implementation's scan range).
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

/// The sync targets the hub manages. `agents` is the shared cross-agent skills root (Claude,
/// Codex, Kimi, dsh and others read it), a hidden target as in the reference implementation: not
/// in the engine list, but scanned, classified and synced, so "remove one engine's copy" stays whole.
pub(super) enum TargetKind {
    Claude,
    Codex,
    Kimi,
    Grok,
    Pi,
    Omp,
    Dsh,
    Agy,
    Gemini,
    Opencode,
    Qoder,
    QoderCn,
    Hermes,
    Agents,
}

pub(super) struct Target {
    pub(super) id: &'static str,
    pub(super) label: &'static str,
    pub(super) visible: bool, // visible=false stays out of targetList
    pub(super) kind: TargetKind,
}

/// The user-level skills root of every CLI that has one, in the engine list's order, with Gemini
/// CLI and Hermes at the end.
pub(super) static TARGETS: [Target; 14] = [
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
        id: "kimi",
        label: "Kimi",
        visible: true,
        kind: TargetKind::Kimi,
    },
    Target {
        id: "grok",
        label: "Grok",
        visible: true,
        kind: TargetKind::Grok,
    },
    Target {
        id: "pi",
        label: "PI",
        visible: true,
        kind: TargetKind::Pi,
    },
    Target {
        id: "omp",
        label: "OMP",
        visible: true,
        kind: TargetKind::Omp,
    },
    Target {
        id: "dsh",
        label: "DeepSeek",
        visible: true,
        kind: TargetKind::Dsh,
    },
    Target {
        id: "agy",
        label: "Antigravity",
        visible: true,
        kind: TargetKind::Agy,
    },
    Target {
        id: "gemini",
        label: "Gemini",
        visible: true,
        kind: TargetKind::Gemini,
    },
    Target {
        id: "opencode",
        label: "OpenCode",
        visible: true,
        kind: TargetKind::Opencode,
    },
    Target {
        id: "qoder",
        label: "Qoder",
        visible: true,
        kind: TargetKind::Qoder,
    },
    Target {
        id: "qoder-cn",
        label: "Qoder CN",
        visible: true,
        kind: TargetKind::QoderCn,
    },
    Target {
        id: "hermes",
        label: "Hermes",
        visible: true,
        kind: TargetKind::Hermes,
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

fn skills_dirs_for_id(id: &str) -> Vec<PathBuf> {
    target_by_id(id).map(target_dirs).unwrap_or_default()
}

/// A target's engine home (the skills root's parent); a multi-folder target (Antigravity) has several.
pub(super) fn target_home_dirs(target: &Target) -> Vec<PathBuf> {
    match target.kind {
        TargetKind::Claude => vec![crate::engine_config::support::engine_home(
            Some("CLAUDE_CONFIG_DIR"),
            ".claude",
        )],
        TargetKind::Codex => vec![crate::engine_config::support::codex_home()],
        TargetKind::Kimi => vec![crate::engine_config::support::engine_home(
            Some("KIMI_CODE_HOME"),
            ".kimi-code",
        )],
        TargetKind::Grok => vec![crate::engine_config::support::engine_home(
            Some("GROK_HOME"),
            ".grok",
        )],
        TargetKind::Pi => vec![coding_agent_home(&["PI_CODING_AGENT_DIR"], ".pi")],
        TargetKind::Omp => vec![coding_agent_home(
            &["OMP_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"],
            ".omp",
        )],
        TargetKind::Dsh => vec![crate::engine_config::support::engine_home(
            Some("DSH_HOME"),
            ".dsh",
        )],
        TargetKind::Agy => antigravity_homes(),
        TargetKind::Gemini => vec![crate::engine_config::support::engine_home(
            Some("GEMINI_DIR"),
            ".gemini",
        )],
        TargetKind::Opencode => {
            vec![
                crate::engine_config::support::engine_home(Some("XDG_CONFIG_HOME"), ".config")
                    .join("opencode"),
            ]
        }
        TargetKind::Qoder => vec![crate::engine_config::support::engine_home(None, ".qoder")],
        TargetKind::QoderCn => vec![crate::engine_config::support::engine_home(
            None,
            ".qoder-cn",
        )],
        TargetKind::Hermes => vec![crate::engine_config::support::engine_home(
            Some("HERMES_HOME"),
            ".hermes",
        )],
        TargetKind::Agents => vec![crate::engine_config::support::engine_home(None, ".agents")],
    }
}

/// Target folders are resolved from env and home at call time (tests steer them through env).
pub(super) fn target_dirs(target: &Target) -> Vec<PathBuf> {
    target_home_dirs(target)
        .into_iter()
        .map(|home| home.join("skills"))
        .collect()
}

/// upstream targetPrimaryDir (a multi-folder target shows its first in the UI).
pub(super) fn target_primary_dir(target: &Target) -> PathBuf {
    target_dirs(target).into_iter().next().unwrap_or_default()
}

/// Whether the engine is installed (its home exists): the UI hides the ones that aren't. Copies that
/// already exist (including orphans whose copy is gone) still show: uninstalling a CLI mustn't hide the way to clean up.
fn target_available(target: &Target) -> bool {
    target_dirs(target)
        .iter()
        .any(|dir| is_dir(dir) || dir.parent().is_some_and(is_dir))
}

/// upstream targetList: visible targets only. `available` is Misty's addition.
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

// ===== Read-only sources: skill folders the hub doesn't manage and only lists =====

/// The kind of a read-only source. The UI tells built-in, system and plugin apart by it and turns off every delete.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum ReadonlyKind {
    /// A skill shipped with the app (Misty ships none today).
    Builtin,
    /// Codex's own `.system` skills.
    System,
    /// Skills that come with a plugin in Codex's plugin cache.
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

/// Folder names of the skills shipped with the app. They count as built-in wherever they appear,
/// even in a managed target root: read-only, never deleted or imported. Misty ships none.
pub(super) fn bundled_skill_names() -> HashSet<String> {
    HashSet::new()
}

/// The read-only source folders that exist now. The engines' own `.system` (Codex / dsh) and plugin
/// cache folders are missing until installed, and only existing ones are returned.
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
    // dsh's user skills root has a `.system` folder too (shipped with the CLI).
    for dir in skills_dirs_for_id("dsh") {
        push_system(dir.join(".system"));
    }
    for (dir, _) in crate::engines::catalog::codex_plugin_skills_dirs(&codex_home) {
        out.push(ReadonlySource {
            kind: ReadonlyKind::Plugin,
            dir,
        });
    }
    out
}

/// The source kind of a skill folder (for the UI's badge and to gate writes).
pub(super) fn readonly_kind_for_dir(directory: &str) -> Option<ReadonlyKind> {
    let leaf = install_name_from_directory(directory)?;
    if bundled_skill_names().contains(&leaf) {
        // A built-in skill's name is reserved everywhere: a folder of the same name is protected as
        // built-in, so a stray copy isn't deleted by the general path or overwritten by a sync.
        return Some(ReadonlyKind::Builtin);
    }
    for source in readonly_sources() {
        if super::scan::find_skill_marker(&source.dir.join(&leaf)).is_some() {
            return Some(source.kind);
        }
    }
    None
}

/// Whether the folder has a built-in skill's name (wherever it is; checked before import and delete).
pub(super) fn is_bundled_skill_name(directory: &str) -> bool {
    install_name_from_directory(directory)
        .map(|leaf| bundled_skill_names().contains(&leaf))
        .unwrap_or(false)
}
