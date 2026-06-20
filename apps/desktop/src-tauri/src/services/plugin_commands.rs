use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::Value;

use crate::error::{ApiError, ApiResult};
use crate::services::environment::AppEnvironmentService;

#[derive(Debug, Clone)]
pub struct PluginCommandService {
    roots: Vec<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommandsSnapshot {
    pub roots: Vec<String>,
    pub commands: Vec<PluginCommandEntry>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommandEntry {
    pub id: String,
    pub label: String,
    pub hint: String,
    pub plugin_id: String,
    pub plugin_name: String,
    pub default_shortcut: String,
    pub source: String,
}

#[derive(Debug, Clone)]
struct PluginMetadata {
    id: String,
    name: String,
    description: String,
    enabled: bool,
    installed: bool,
    launcher_enabled: bool,
}

impl PluginCommandService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        Self {
            roots: vec![
                environment.plugins_private_dir(),
                environment.plugins_public_dir(),
            ],
        }
    }

    pub async fn snapshot(&self) -> ApiResult<PluginCommandsSnapshot> {
        let roots = self.roots.clone();
        tokio::task::spawn_blocking(move || snapshot_plugin_commands(roots))
            .await
            .map_err(|err| ApiError::Message(format!("Plugin command worker failed: {err}")))?
    }
}

fn snapshot_plugin_commands(roots: Vec<PathBuf>) -> ApiResult<PluginCommandsSnapshot> {
    let mut commands = BTreeMap::<String, PluginCommandEntry>::new();
    for root in &roots {
        if !root.is_dir() {
            continue;
        }
        let entries = fs::read_dir(root).map_err(|err| {
            ApiError::Message(format!(
                "Failed to read plugin root {}: {err}",
                root.display()
            ))
        })?;
        for entry in entries.flatten() {
            let plugin_dir = entry.path();
            if !plugin_dir.is_dir() {
                continue;
            }
            for command in commands_for_plugin_dir(&plugin_dir)? {
                commands.entry(command.id.clone()).or_insert(command);
            }
        }
    }

    Ok(PluginCommandsSnapshot {
        roots: roots
            .iter()
            .map(|root| root.display().to_string())
            .collect(),
        commands: commands.into_values().collect(),
    })
}

fn commands_for_plugin_dir(plugin_dir: &Path) -> ApiResult<Vec<PluginCommandEntry>> {
    let detail = read_json(plugin_dir.join("plugin.json"))
        .or_else(|| read_json(plugin_dir.join("detail.json")));
    let manifest = read_json(plugin_dir.join("manifest.json"));
    let metadata = plugin_metadata(plugin_dir, detail.as_ref(), manifest.as_ref());
    if !metadata.enabled || !metadata.installed {
        return Ok(Vec::new());
    }

    let mut commands = Vec::new();
    if let Some(detail) = detail.as_ref() {
        commands.extend(static_commands_from_json(detail, &metadata, "detail"));
    }
    if let Some(manifest) = manifest.as_ref() {
        commands.extend(static_commands_from_json(manifest, &metadata, "manifest"));
        if let Some(plugin) = manifest.get("plugin") {
            commands.extend(static_commands_from_json(plugin, &metadata, "manifest"));
        }
    }
    if metadata.launcher_enabled
        && !commands
            .iter()
            .any(|command| command.id == launcher_command_id(&metadata.id))
    {
        commands.push(PluginCommandEntry {
            id: launcher_command_id(&metadata.id),
            label: format!("Open {}", metadata.name),
            hint: if metadata.description.is_empty() {
                "Open plugin from the launcher".to_owned()
            } else {
                metadata.description.clone()
            },
            plugin_id: metadata.id.clone(),
            plugin_name: metadata.name.clone(),
            default_shortcut: String::new(),
            source: "launcher".to_owned(),
        });
    }
    Ok(commands)
}

fn plugin_metadata(
    plugin_dir: &Path,
    detail: Option<&Value>,
    manifest: Option<&Value>,
) -> PluginMetadata {
    let fallback_id = plugin_dir
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("plugin")
        .to_owned();
    let id = string_field(detail, "id")
        .or_else(|| string_field(manifest, "id"))
        .unwrap_or(fallback_id);
    let name = string_field(detail, "name")
        .or_else(|| string_field(manifest, "name"))
        .unwrap_or_else(|| id.clone());
    let description = string_field(detail, "overview")
        .or_else(|| string_field(manifest, "description"))
        .unwrap_or_default();
    let status = string_field(detail, "status")
        .unwrap_or_default()
        .to_ascii_lowercase();
    let enabled = manifest
        .and_then(|value| value.get("enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let launcher_enabled = detail
        .and_then(|value| value.get("launcher"))
        .and_then(|launcher| launcher.get("show_in_launcher"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    PluginMetadata {
        id,
        name,
        description,
        enabled,
        installed: status.is_empty() || status == "installed" || status == "enabled",
        launcher_enabled,
    }
}

fn static_commands_from_json(
    value: &Value,
    plugin: &PluginMetadata,
    source: &str,
) -> Vec<PluginCommandEntry> {
    let Some(commands) = value.get("commands").and_then(Value::as_array) else {
        return Vec::new();
    };
    commands
        .iter()
        .filter_map(|command| static_command_from_json(command, plugin, source))
        .collect()
}

fn static_command_from_json(
    command: &Value,
    plugin: &PluginMetadata,
    source: &str,
) -> Option<PluginCommandEntry> {
    let id = string_field(Some(command), "id")
        .or_else(|| string_field(Some(command), "command_id"))
        .or_else(|| string_field(Some(command), "commandId"))?;
    let label = string_field(Some(command), "title")
        .or_else(|| string_field(Some(command), "label"))
        .or_else(|| string_field(Some(command), "name"))
        .unwrap_or_else(|| id.clone());
    let hint = string_field(Some(command), "hint")
        .or_else(|| string_field(Some(command), "description"))
        .unwrap_or_else(|| format!("Run {} from {}", label, plugin.name));
    let default_shortcut = string_field(Some(command), "default_shortcut")
        .or_else(|| string_field(Some(command), "defaultShortcut"))
        .or_else(|| string_field(Some(command), "shortcut"))
        .unwrap_or_default();

    if id.trim().is_empty() || label.trim().is_empty() {
        return None;
    }

    Some(PluginCommandEntry {
        id: id.trim().to_owned(),
        label: label.trim().to_owned(),
        hint: hint.trim().to_owned(),
        plugin_id: plugin.id.clone(),
        plugin_name: plugin.name.clone(),
        default_shortcut: default_shortcut.trim().to_owned(),
        source: source.to_owned(),
    })
}

fn launcher_command_id(plugin_id: &str) -> String {
    format!("plugin.{plugin_id}.open")
}

fn string_field(value: Option<&Value>, key: &str) -> Option<String> {
    value?
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn read_json(path: PathBuf) -> Option<Value> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_launcher_command_from_installed_plugin_detail() {
        let detail = serde_json::json!({
            "id": "themes",
            "name": "Themes",
            "status": "installed",
            "overview": "Customize Misty themes.",
            "launcher": { "show_in_launcher": true }
        });
        let metadata = plugin_metadata(Path::new("/tmp/themes"), Some(&detail), None);
        let commands = commands_for_values(&metadata, Some(&detail), None);

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].id, "plugin.themes.open");
        assert_eq!(commands[0].label, "Open Themes");
        assert_eq!(commands[0].source, "launcher");
    }

    #[test]
    fn reads_static_manifest_commands() {
        let manifest = serde_json::json!({
            "id": "sample",
            "name": "Sample",
            "enabled": true,
            "commands": [
                {
                    "id": "sample.convert",
                    "title": "Convert Selection",
                    "description": "Convert selected files.",
                    "default_shortcut": "Cmd+Shift+C"
                }
            ]
        });
        let metadata = plugin_metadata(Path::new("/tmp/sample"), None, Some(&manifest));
        let commands = commands_for_values(&metadata, None, Some(&manifest));

        assert_eq!(commands.len(), 1);
        assert_eq!(commands[0].id, "sample.convert");
        assert_eq!(commands[0].label, "Convert Selection");
        assert_eq!(commands[0].default_shortcut, "Cmd+Shift+C");
        assert_eq!(commands[0].source, "manifest");
    }

    #[test]
    fn skips_disabled_or_uninstalled_plugins() {
        let detail = serde_json::json!({
            "id": "candidate",
            "name": "Candidate",
            "status": "uninstalled",
            "launcher": { "show_in_launcher": true }
        });
        let manifest = serde_json::json!({ "enabled": false });
        let metadata = plugin_metadata(Path::new("/tmp/candidate"), Some(&detail), Some(&manifest));

        assert!(!metadata.enabled);
        assert!(!metadata.installed);
    }

    fn commands_for_values(
        metadata: &PluginMetadata,
        detail: Option<&Value>,
        manifest: Option<&Value>,
    ) -> Vec<PluginCommandEntry> {
        let mut commands = Vec::new();
        if metadata.enabled && metadata.installed {
            if let Some(detail) = detail {
                commands.extend(static_commands_from_json(detail, metadata, "detail"));
            }
            if let Some(manifest) = manifest {
                commands.extend(static_commands_from_json(manifest, metadata, "manifest"));
            }
            if metadata.launcher_enabled
                && !commands
                    .iter()
                    .any(|command| command.id == launcher_command_id(&metadata.id))
            {
                commands.push(PluginCommandEntry {
                    id: launcher_command_id(&metadata.id),
                    label: format!("Open {}", metadata.name),
                    hint: metadata.description.clone(),
                    plugin_id: metadata.id.clone(),
                    plugin_name: metadata.name.clone(),
                    default_shortcut: String::new(),
                    source: "launcher".to_owned(),
                });
            }
        }
        commands
    }
}
