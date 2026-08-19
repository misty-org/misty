use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use super::command_defaults::{default_command_entries, DefaultCommandEntry};
use crate::error::{ApiError, ApiResult};
use crate::infra::environment::AppEnvironmentService;

#[derive(Debug, Clone)]
pub struct CommandService {
    path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutBinding {
    pub command_id: String,
    pub shortcut: String,
    pub source: ShortcutSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShortcutSource {
    Default,
    User,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutsSnapshot {
    pub path: String,
    pub bindings: Vec<ShortcutBinding>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveShortcutsRequest {
    pub bindings: Vec<ShortcutBinding>,
}

impl CommandService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        Self {
            path: environment.commands_path(),
        }
    }

    pub async fn snapshot(&self) -> ApiResult<ShortcutsSnapshot> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || load_shortcuts(path))
            .await
            .map_err(|err| ApiError::Message(format!("Command worker failed: {err}")))?
    }

    pub async fn save(&self, request: SaveShortcutsRequest) -> ApiResult<ShortcutsSnapshot> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || save_shortcuts(path, request.bindings))
            .await
            .map_err(|err| ApiError::Message(format!("Command worker failed: {err}")))?
    }

    pub async fn reset(&self) -> ApiResult<ShortcutsSnapshot> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || reset_shortcuts(path))
            .await
            .map_err(|err| ApiError::Message(format!("Command worker failed: {err}")))?
    }
}

fn load_shortcuts(path: PathBuf) -> ApiResult<ShortcutsSnapshot> {
    ensure_user_commands_file(&path)?;
    sync_missing_user_commands(&path)?;
    sync_updated_default_shortcuts(&path)?;

    let overrides = parse_command_file_shortcuts(&path);
    let mut merged = BTreeMap::new();

    for entry in default_command_entries() {
        merged.insert(
            entry.id.to_owned(),
            ShortcutBinding {
                command_id: entry.id.to_owned(),
                shortcut: entry.shortcut.to_owned(),
                source: ShortcutSource::Default,
            },
        );
    }

    for (command_id, shortcut) in overrides {
        if command_id.is_empty() || shortcut.is_empty() {
            continue;
        }
        merged.insert(
            command_id.clone(),
            ShortcutBinding {
                command_id,
                shortcut,
                source: ShortcutSource::User,
            },
        );
    }

    Ok(ShortcutsSnapshot {
        path: path.display().to_string(),
        bindings: merged.into_values().collect(),
    })
}

fn save_shortcuts(path: PathBuf, bindings: Vec<ShortcutBinding>) -> ApiResult<ShortcutsSnapshot> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            ApiError::Message(format!("Failed to create shortcut config directory: {err}"))
        })?;
    }

    let mut output = command_file_header();
    for binding in bindings {
        let command_id = binding.command_id.trim();
        let shortcut = binding.shortcut.trim();
        if command_id.is_empty() || shortcut.is_empty() {
            continue;
        }
        write_command_block(&mut output, command_id, shortcut);
    }

    fs::write(&path, output).map_err(|err| {
        ApiError::Message(format!(
            "Failed to write ~/.misty/config/commands.msy: {err}"
        ))
    })?;
    load_shortcuts(path)
}

/// Restores every binding to its built-in default.
///
/// The old "Reset" button reloaded the file from disk, which restored nothing —
/// it only discarded unsaved edits. This rewrites the file from
/// `default_command_entries`, which is what the label always implied.
fn reset_shortcuts(path: PathBuf) -> ApiResult<ShortcutsSnapshot> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            ApiError::Message(format!("Failed to create shortcut config directory: {err}"))
        })?;
    }

    let mut output = command_file_header();
    for entry in default_command_entries() {
        write_command_block(&mut output, entry.id, entry.shortcut);
    }

    fs::write(&path, output).map_err(|err| {
        ApiError::Message(format!(
            "Failed to write ~/.misty/config/commands.msy: {err}"
        ))
    })?;
    load_shortcuts(path)
}

fn ensure_user_commands_file(path: &Path) -> ApiResult<()> {
    if path.as_os_str().is_empty() || path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            ApiError::Message(format!("Failed to create shortcut config directory: {err}"))
        })?;
    }

    let mut output = command_file_header();
    for entry in default_command_entries() {
        write_command_block(&mut output, entry.id, entry.shortcut);
    }
    fs::write(path, output).map_err(|err| {
        ApiError::Message(format!(
            "Failed to create ~/.misty/config/commands.msy: {err}"
        ))
    })
}

fn sync_missing_user_commands(path: &Path) -> ApiResult<()> {
    if path.as_os_str().is_empty() || !path.exists() {
        return Ok(());
    }

    let parsed = parse_command_file_shortcuts(path);
    let existing: BTreeSet<_> = parsed.keys().cloned().collect();
    let mut output = String::new();
    let mut wrote_header = false;

    for entry in default_command_entries() {
        if existing.contains(entry.id) {
            continue;
        }
        if !wrote_header {
            output.push_str("\n# Added automatically after upgrading Misty\n");
            wrote_header = true;
        }
        write_command_block(&mut output, entry.id, entry.shortcut);
    }

    if output.is_empty() {
        return Ok(());
    }

    let mut raw = fs::read_to_string(path).unwrap_or_default();
    raw.push_str(&output);
    fs::write(path, raw).map_err(|err| {
        ApiError::Message(format!(
            "Failed to update ~/.misty/config/commands.msy: {err}"
        ))
    })
}

fn sync_updated_default_shortcuts(path: &Path) -> ApiResult<()> {
    if path.as_os_str().is_empty() || !path.exists() {
        return Ok(());
    }

    let raw = fs::read_to_string(path).map_err(|err| {
        ApiError::Message(format!(
            "Failed to read ~/.misty/config/commands.msy: {err}"
        ))
    })?;
    let legacy_close = if cfg!(target_os = "macos") {
        "Cmd+D"
    } else {
        "Ctrl+D"
    };
    let updated_close = if cfg!(target_os = "macos") {
        "Cmd+W"
    } else {
        "Ctrl+W"
    };
    let mut current_command = String::new();
    let mut updated = false;
    let mut lines = Vec::new();

    for line in raw.lines() {
        let trimmed = trim(line);
        let mut next_line = line.to_owned();
        if !trimmed.is_empty() && !trimmed.starts_with('#') {
            if let Some(brace) = trimmed.find('{') {
                current_command = trim(&trimmed[..brace]).to_owned();
            } else if trimmed == "}" {
                current_command.clear();
            } else if let Some(eq) = trimmed.find('=') {
                let key = trim(&trimmed[..eq]);
                let value = unquote(trim(&trimmed[eq + 1..]));
                if current_command == "explorer.close_pane" {
                    let should_update = if cfg!(target_os = "macos") {
                        (key == "mac" || key == "key") && value == legacy_close
                    } else {
                        key == "key" && value == legacy_close
                    };
                    if should_update {
                        next_line = format!("  {key} = \"{updated_close}\"");
                        updated = true;
                    }
                } else if current_command.is_empty()
                    && key == "explorer.close_pane"
                    && value == legacy_close
                {
                    next_line = format!("explorer.close_pane = {updated_close}");
                    updated = true;
                }
            }
        }
        lines.push(next_line);
    }

    if updated {
        fs::write(path, format!("{}\n", lines.join("\n"))).map_err(|err| {
            ApiError::Message(format!(
                "Failed to update ~/.misty/config/commands.msy: {err}"
            ))
        })?;
    }
    Ok(())
}

fn parse_command_file_shortcuts(path: &Path) -> BTreeMap<String, String> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return BTreeMap::new(),
    };
    let mut shortcuts = BTreeMap::new();
    let mut current_command = String::new();

    for line in raw.lines() {
        let trimmed = trim(line);
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(brace) = trimmed.find('{') {
            current_command = trim(&trimmed[..brace]).to_owned();
            continue;
        }
        if trimmed == "}" {
            current_command.clear();
            continue;
        }
        let Some(eq) = trimmed.find('=') else {
            continue;
        };
        let key = trim(&trimmed[..eq]);
        let value = unquote(trim(&trimmed[eq + 1..])).to_owned();

        if !current_command.is_empty() {
            if cfg!(target_os = "macos") {
                if key == "mac" || (key == "key" && !shortcuts.contains_key(&current_command)) {
                    shortcuts.insert(current_command.clone(), value);
                }
            } else if key == "key" {
                shortcuts.insert(current_command.clone(), value);
            }
            continue;
        }

        if !key.is_empty() && !value.is_empty() {
            shortcuts.insert(key.to_owned(), value);
        }
    }

    shortcuts
}

fn command_file_header() -> String {
    "# Misty keyboard commands\n\
     # Runtime source of truth: ~/.misty/config/commands.msy\n\
     # Format:\n\
     # command.id {\n\
     #   key = \"CmdOrCtrl+K\"\n\
     #   mac = \"Enter\"   # optional platform override\n\
     # }\n\n"
        .to_owned()
}

fn write_command_block(output: &mut String, command_id: &str, shortcut: &str) {
    output.push_str(command_id);
    output.push_str(" {\n");
    output.push_str("  key = \"");
    output.push_str(&escape_shortcut(shortcut));
    output.push_str("\"\n");
    output.push_str("}\n\n");
}

fn escape_shortcut(shortcut: &str) -> String {
    shortcut.replace('\\', "\\\\").replace('"', "\\\"")
}

fn trim(value: &str) -> &str {
    value.trim()
}

fn unquote(value: &str) -> &str {
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        &value[1..value.len() - 1]
    } else {
        value
    }
}
