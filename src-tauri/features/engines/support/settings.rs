// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// src-tauri/src/settings.rs: the engine settings the launch path reads (default model and effort
// per engine, Codex Fast, Codex home, program overrides). They belong to this device: one JSON
// document in misty.db (`cli_settings`), never synced.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub default_models: HashMap<String, String>,
    pub default_efforts: HashMap<String, String>,
    pub custom_models: HashMap<String, Vec<String>>,
    pub codex_service_tier: Option<String>,
    pub claude_fast_mode: Option<bool>,
    pub codex_home: Option<String>,
    pub bin_overrides: HashMap<String, Value>,
}

impl AppSettings {
    pub fn bin_override(&self, engine: &str) -> Option<&str> {
        self.bin_overrides
            .get(&bin_override_key(engine))
            .and_then(Value::as_str)
    }
}

fn bin_override_key(engine: &str) -> String {
    let mut key = String::with_capacity(engine.len() + 3);
    let mut uppercase_next = false;
    for ch in engine.chars() {
        if ch == '-' {
            uppercase_next = true;
        } else if std::mem::take(&mut uppercase_next) {
            key.extend(ch.to_uppercase());
        } else {
            key.push(ch);
        }
    }
    key.push_str("Bin");
    key
}

#[allow(
    clippy::disallowed_methods,
    reason = "resolves the engine program the person pointed Misty at, which lives outside the gate"
)]
pub(crate) fn validate_bin_override(value: &str) -> Result<std::path::PathBuf, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("empty path".to_string());
    }
    let path = std::path::PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(format!("{trimmed}: not an absolute path"));
    }
    let canonical = std::fs::canonicalize(&path)
        .map_err(|e| format!("{}: cannot resolve ({e})", path.display()))?;
    reject_temp_root(&canonical, "binaries")?;
    Ok(canonical)
}

const TEMP_ROOTS: &[&str] = &[
    "/tmp",
    "/var/folders",
    "/private/tmp",
    "/private/var/folders",
];

fn reject_temp_root(path: &std::path::Path, kind: &str) -> Result<(), String> {
    for root in TEMP_ROOTS {
        if path.starts_with(root) {
            return Err(format!(
                "{}: {kind} under {root} are not allowed",
                path.display()
            ));
        }
    }
    Ok(())
}

#[allow(
    clippy::disallowed_methods,
    reason = "checks the engine home the person chose, which may sit outside the engine folders the gate grants"
)]
fn validate_home_override(value: &str) -> Result<std::path::PathBuf, String> {
    let expanded = crate::engines::support::open_app::expand_user_path(value.trim())?;
    if !expanded.is_absolute() {
        return Err(format!("{}: not an absolute path", expanded.display()));
    }
    if expanded.exists() && !expanded.is_dir() {
        return Err(format!("{}: not a directory", expanded.display()));
    }
    let check = if expanded.exists() {
        std::fs::canonicalize(&expanded).unwrap_or_else(|_| expanded.clone())
    } else {
        expanded.clone()
    };
    reject_temp_root(&check, "homes")?;
    Ok(expanded)
}

pub fn read_settings() -> Result<AppSettings, String> {
    let Some(db) = crate::engines::support::db::global() else {
        return Ok(AppSettings::default());
    };
    let text: Option<String> = {
        let conn = db.read();
        conn.query_row(
            "SELECT document FROM cli_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .ok()
    };
    match text {
        Some(text) if !text.trim().is_empty() => {
            serde_json::from_str(&text).map_err(|e| format!("engine settings: {e}"))
        }
        _ => Ok(AppSettings::default()),
    }
}

pub fn write_settings(settings: &AppSettings) -> Result<(), String> {
    for value in settings.bin_overrides.values() {
        if let Some(path) = value.as_str().filter(|path| !path.trim().is_empty()) {
            validate_bin_override(path)?;
        }
    }
    if let Some(home) = settings
        .codex_home
        .as_deref()
        .filter(|home| !home.trim().is_empty())
    {
        validate_home_override(home)?;
    }
    let db = crate::engines::support::db::global().ok_or("The engine store isn't open.")?;
    let text = serde_json::to_string(settings).map_err(|e| e.to_string())?;
    let conn = db.0.lock();
    conn.execute(
        "INSERT INTO cli_settings (id, document) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET document = excluded.document",
        [text],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn signed_in_here(engine: &str) -> bool {
    let Some(db) = crate::engines::support::db::global() else {
        return false;
    };
    let conn = db.read();
    conn.query_row(
        "SELECT 1 FROM cli_signed_in_here WHERE engine = ?1",
        [engine],
        |_| Ok(()),
    )
    .is_ok()
}

pub fn set_signed_in_here(engine: &str, signed_in: bool) -> Result<(), String> {
    let db = crate::engines::support::db::global().ok_or("The engine store isn't open.")?;
    let conn = db.0.lock();
    let statement = if signed_in {
        "INSERT OR IGNORE INTO cli_signed_in_here (engine) VALUES (?1)"
    } else {
        "DELETE FROM cli_signed_in_here WHERE engine = ?1"
    };
    conn.execute(statement, [engine])
        .map_err(|e| e.to_string())?;
    Ok(())
}
