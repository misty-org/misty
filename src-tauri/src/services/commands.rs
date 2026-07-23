use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};
use crate::services::environment::AppEnvironmentService;

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

#[derive(Debug, Clone, Copy)]
struct DefaultCommandEntry {
    id: &'static str,
    shortcut: &'static str,
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
                if key == "mac" {
                    shortcuts.insert(current_command.clone(), value);
                } else if key == "key" && !shortcuts.contains_key(&current_command) {
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

fn default_command_entries() -> &'static [DefaultCommandEntry] {
    #[cfg(target_os = "macos")]
    {
        const ENTRIES: &[DefaultCommandEntry] = &[
            DefaultCommandEntry {
                id: "search.toggle",
                shortcut: "Cmd+K",
            },
            DefaultCommandEntry {
                id: "search.cancel",
                shortcut: "Escape",
            },
            DefaultCommandEntry {
                id: "search.confirm",
                shortcut: "Enter",
            },
            DefaultCommandEntry {
                id: "search.prev",
                shortcut: "Up",
            },
            DefaultCommandEntry {
                id: "search.next",
                shortcut: "Down",
            },
            DefaultCommandEntry {
                id: "explorer.open_palette",
                shortcut: "Cmd+P",
            },
            DefaultCommandEntry {
                id: "explorer.copy",
                shortcut: "Cmd+C",
            },
            DefaultCommandEntry {
                id: "explorer.cut",
                shortcut: "Cmd+X",
            },
            DefaultCommandEntry {
                id: "explorer.paste",
                shortcut: "Cmd+V",
            },
            DefaultCommandEntry {
                id: "explorer.undo",
                shortcut: "Cmd+Z",
            },
            DefaultCommandEntry {
                id: "explorer.redo",
                shortcut: "Cmd+Shift+Z",
            },
            DefaultCommandEntry {
                id: "explorer.delete",
                shortcut: "Delete",
            },
            DefaultCommandEntry {
                id: "explorer.rename",
                shortcut: "F2",
            },
            DefaultCommandEntry {
                id: "explorer.refresh",
                shortcut: "Cmd+R",
            },
            DefaultCommandEntry {
                id: "explorer.next_workspace",
                shortcut: "Cmd+Shift+Grave",
            },
            DefaultCommandEntry {
                id: "explorer.new_tab",
                shortcut: "Cmd+T",
            },
            DefaultCommandEntry {
                id: "explorer.restore_tab",
                shortcut: "Cmd+Shift+T",
            },
            DefaultCommandEntry {
                id: "explorer.close_pane",
                shortcut: "Cmd+W",
            },
            DefaultCommandEntry {
                id: "explorer.restore_pane",
                shortcut: "Cmd+Ctrl+Backslash",
            },
            DefaultCommandEntry {
                id: "explorer.split_vertical",
                shortcut: "Cmd+Backslash",
            },
            DefaultCommandEntry {
                id: "explorer.split_horizontal",
                shortcut: "Cmd+Shift+Backslash",
            },
            DefaultCommandEntry {
                id: "explorer.tab_1",
                shortcut: "Cmd+1",
            },
            DefaultCommandEntry {
                id: "explorer.tab_2",
                shortcut: "Cmd+2",
            },
            DefaultCommandEntry {
                id: "explorer.tab_3",
                shortcut: "Cmd+3",
            },
            DefaultCommandEntry {
                id: "explorer.tab_4",
                shortcut: "Cmd+4",
            },
            DefaultCommandEntry {
                id: "explorer.tab_5",
                shortcut: "Cmd+5",
            },
            DefaultCommandEntry {
                id: "explorer.tab_6",
                shortcut: "Cmd+6",
            },
            DefaultCommandEntry {
                id: "explorer.tab_7",
                shortcut: "Cmd+7",
            },
            DefaultCommandEntry {
                id: "explorer.tab_8",
                shortcut: "Cmd+8",
            },
            DefaultCommandEntry {
                id: "explorer.tab_9",
                shortcut: "Cmd+9",
            },
            DefaultCommandEntry {
                id: "app.open_settings",
                shortcut: "Cmd+Comma",
            },
            DefaultCommandEntry {
                id: "app.toggle_plugin_launcher",
                shortcut: "Cmd+Shift+P",
            },
            DefaultCommandEntry {
                id: "app.toggle_transfers",
                shortcut: "Cmd+Shift+Y",
            },
            DefaultCommandEntry {
                id: "clipboard.publish_shared",
                shortcut: "Cmd+Alt+C",
            },
            DefaultCommandEntry {
                id: "clipboard.apply_shared",
                shortcut: "Cmd+Alt+V",
            },
            DefaultCommandEntry {
                id: "modal.confirm",
                shortcut: "Enter",
            },
            DefaultCommandEntry {
                id: "modal.cancel",
                shortcut: "Escape",
            },
        ];
        ENTRIES
    }

    #[cfg(not(target_os = "macos"))]
    {
        const ENTRIES: &[DefaultCommandEntry] = &[
            DefaultCommandEntry {
                id: "search.toggle",
                shortcut: "Ctrl+K",
            },
            DefaultCommandEntry {
                id: "search.cancel",
                shortcut: "Escape",
            },
            DefaultCommandEntry {
                id: "search.confirm",
                shortcut: "Enter",
            },
            DefaultCommandEntry {
                id: "search.prev",
                shortcut: "Up",
            },
            DefaultCommandEntry {
                id: "search.next",
                shortcut: "Down",
            },
            DefaultCommandEntry {
                id: "explorer.open_palette",
                shortcut: "Ctrl+P",
            },
            DefaultCommandEntry {
                id: "explorer.copy",
                shortcut: "Ctrl+C",
            },
            DefaultCommandEntry {
                id: "explorer.cut",
                shortcut: "Ctrl+X",
            },
            DefaultCommandEntry {
                id: "explorer.paste",
                shortcut: "Ctrl+V",
            },
            DefaultCommandEntry {
                id: "explorer.undo",
                shortcut: "Ctrl+Z",
            },
            DefaultCommandEntry {
                id: "explorer.redo",
                shortcut: "Ctrl+Shift+Z",
            },
            DefaultCommandEntry {
                id: "explorer.delete",
                shortcut: "Delete",
            },
            DefaultCommandEntry {
                id: "explorer.rename",
                shortcut: "F2",
            },
            DefaultCommandEntry {
                id: "explorer.refresh",
                shortcut: "Ctrl+R",
            },
            DefaultCommandEntry {
                id: "explorer.next_workspace",
                shortcut: "Ctrl+Shift+Grave",
            },
            DefaultCommandEntry {
                id: "explorer.new_tab",
                shortcut: "Ctrl+T",
            },
            DefaultCommandEntry {
                id: "explorer.restore_tab",
                shortcut: "Ctrl+Shift+T",
            },
            DefaultCommandEntry {
                id: "explorer.close_pane",
                shortcut: "Ctrl+W",
            },
            DefaultCommandEntry {
                id: "explorer.restore_pane",
                shortcut: "Ctrl+Ctrl+Backslash",
            },
            DefaultCommandEntry {
                id: "explorer.split_vertical",
                shortcut: "Ctrl+Backslash",
            },
            DefaultCommandEntry {
                id: "explorer.split_horizontal",
                shortcut: "Ctrl+Shift+Backslash",
            },
            DefaultCommandEntry {
                id: "explorer.tab_1",
                shortcut: "Ctrl+1",
            },
            DefaultCommandEntry {
                id: "explorer.tab_2",
                shortcut: "Ctrl+2",
            },
            DefaultCommandEntry {
                id: "explorer.tab_3",
                shortcut: "Ctrl+3",
            },
            DefaultCommandEntry {
                id: "explorer.tab_4",
                shortcut: "Ctrl+4",
            },
            DefaultCommandEntry {
                id: "explorer.tab_5",
                shortcut: "Ctrl+5",
            },
            DefaultCommandEntry {
                id: "explorer.tab_6",
                shortcut: "Ctrl+6",
            },
            DefaultCommandEntry {
                id: "explorer.tab_7",
                shortcut: "Ctrl+7",
            },
            DefaultCommandEntry {
                id: "explorer.tab_8",
                shortcut: "Ctrl+8",
            },
            DefaultCommandEntry {
                id: "explorer.tab_9",
                shortcut: "Ctrl+9",
            },
            DefaultCommandEntry {
                id: "app.open_settings",
                shortcut: "Ctrl+Comma",
            },
            DefaultCommandEntry {
                id: "app.toggle_plugin_launcher",
                shortcut: "Ctrl+Shift+P",
            },
            DefaultCommandEntry {
                id: "app.toggle_transfers",
                shortcut: "Ctrl+Shift+Y",
            },
            DefaultCommandEntry {
                id: "clipboard.publish_shared",
                shortcut: "Ctrl+Alt+C",
            },
            DefaultCommandEntry {
                id: "clipboard.apply_shared",
                shortcut: "Ctrl+Alt+V",
            },
            DefaultCommandEntry {
                id: "modal.confirm",
                shortcut: "Enter",
            },
            DefaultCommandEntry {
                id: "modal.cancel",
                shortcut: "Escape",
            },
        ];
        ENTRIES
    }
}
