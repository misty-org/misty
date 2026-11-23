// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryRequest {
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub bucket: Option<String>,
    #[serde(default)]
    pub tz_offset_minutes: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStatRow {
    pub bucket: String,
    pub engine: String,
    pub model: String,
    pub project: Option<String>,
    pub sessions: i64,
    pub requests: i64,
    pub input: i64,
    pub output: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub reasoning: i64,
    pub cost: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResponse {
    pub rows: Vec<UsageStatRow>,
    pub first_day: Option<String>,
    pub scanned_at: Option<i64>,
    pub scanning: bool,
    pub unknown_models: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStatus {
    pub engine: String,
    pub label: String,
    pub roots: Vec<String>,
    pub env: Option<String>,
    pub files: i64,
    pub status: String,
    pub error: Option<String>,
    pub last_scan_at: Option<i64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub files_scanned: i64,
    pub events_added: i64,
    pub duration_ms: i64,
    pub scanned_at: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceInfo {
    pub source: String,
    pub snapshot_date: String,
    pub updated_at: Option<i64>,
    pub models: i64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Tokens {
    pub input: i64,
    pub output: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    pub reasoning: i64,
}

impl Tokens {
    pub fn is_zero(&self) -> bool {
        self.input == 0
            && self.output == 0
            && self.cache_read == 0
            && self.cache_write == 0
            && self.reasoning == 0
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct UsageEvent {
    pub key: String,
    pub ts_ms: i64,
    pub engine: &'static str,
    pub model: String,
    pub project: Option<String>,
    pub session_id: Option<String>,
    pub tokens: Tokens,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Engine {
    Claude,
    Codex,
    Pi,
    Omp,
}

impl Engine {
    pub const ALL: [Engine; 4] = [Engine::Claude, Engine::Codex, Engine::Pi, Engine::Omp];

    pub fn id(self) -> &'static str {
        match self {
            Engine::Claude => "claude",
            Engine::Codex => "codex",
            Engine::Pi => "pi",
            Engine::Omp => "omp",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Engine::Claude => "Claude Code",
            Engine::Codex => "Codex",
            Engine::Pi => "Pi",
            Engine::Omp => "oh-my-pi",
        }
    }

    pub fn env(self) -> Option<&'static str> {
        match self {
            Engine::Claude => Some("CLAUDE_CONFIG_DIR"),
            Engine::Codex => Some("CODEX_HOME"),
            Engine::Pi | Engine::Omp => None,
        }
    }

    pub fn accepts_file(self, name: &str) -> bool {
        match self {
            Engine::Codex => name.starts_with("rollout-") && name.ends_with(".jsonl"),
            Engine::Claude | Engine::Pi | Engine::Omp => name.ends_with(".jsonl"),
        }
    }
}
