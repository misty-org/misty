use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tempfile::NamedTempFile;

use super::command_defaults::default_command_entries;
use crate::error::{ApiError, ApiResult};
use crate::infra::environment::AppEnvironmentService;

#[derive(Debug, Clone)]
pub struct CommandService {
    path: PathBuf,
}

/// A missing field inherits the platform default. A present `null` field is
/// intentionally unbound. This distinction is why the nested Options matter.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutOverride {
    pub command_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alternate: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutsSnapshot {
    pub path: String,
    pub overrides: Vec<ShortcutOverride>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateShortcutRequest {
    pub command_id: String,
    pub slot: ShortcutSlot,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShortcutSlot {
    Primary,
    Alternate,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReassignShortcutRequest {
    pub command_id: String,
    pub slot: ShortcutSlot,
    pub value: Option<String>,
    pub conflicting_command_id: String,
    pub conflicting_slot: ShortcutSlot,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetShortcutRequest {
    pub command_id: Option<String>,
    #[serde(default)]
    pub command_ids: Vec<String>,
}

impl CommandService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        Self {
            path: environment.commands_path(),
        }
    }

    pub async fn snapshot(&self) -> ApiResult<ShortcutsSnapshot> {
        run_command_worker(self.path.clone(), load_shortcuts).await
    }

    pub async fn update(&self, request: UpdateShortcutRequest) -> ApiResult<ShortcutsSnapshot> {
        run_command_worker(self.path.clone(), move |path| {
            update_shortcut(path, request)
        })
        .await
    }

    pub async fn reassign(&self, request: ReassignShortcutRequest) -> ApiResult<ShortcutsSnapshot> {
        run_command_worker(self.path.clone(), move |path| {
            reassign_shortcut(path, request)
        })
        .await
    }

    pub async fn reset(&self, request: ResetShortcutRequest) -> ApiResult<ShortcutsSnapshot> {
        run_command_worker(self.path.clone(), move |path| {
            reset_shortcuts(path, request)
        })
        .await
    }
}

async fn run_command_worker<F>(path: PathBuf, worker: F) -> ApiResult<ShortcutsSnapshot>
where
    F: FnOnce(PathBuf) -> ApiResult<ShortcutsSnapshot> + Send + 'static,
{
    tokio::task::spawn_blocking(move || worker(path))
        .await
        .map_err(|err| ApiError::Message(format!("Command worker failed: {err}")))?
}

fn load_shortcuts(path: PathBuf) -> ApiResult<ShortcutsSnapshot> {
    ensure_user_commands_file(&path)?;
    let parsed = parse_command_file(&path);
    if parsed.used_legacy_format {
        let migrated = migrate_legacy_defaults(parsed.overrides);
        write_overrides(&path, &migrated)?;
        return snapshot_from(path, migrated);
    }
    snapshot_from(path, parsed.overrides)
}

fn update_shortcut(path: PathBuf, request: UpdateShortcutRequest) -> ApiResult<ShortcutsSnapshot> {
    validate_command_id(&request.command_id)?;
    ensure_user_commands_file(&path)?;
    let mut overrides = parse_command_file(&path).overrides;
    set_slot(
        overrides
            .entry(request.command_id.clone())
            .or_insert_with(|| ShortcutOverride {
                command_id: request.command_id,
                ..ShortcutOverride::default()
            }),
        request.slot,
        Some(request.value.map(normalize_binding).transpose()?),
    );
    remove_empty_overrides(&mut overrides);
    write_overrides(&path, &overrides)?;
    snapshot_from(path, overrides)
}

fn reassign_shortcut(
    path: PathBuf,
    request: ReassignShortcutRequest,
) -> ApiResult<ShortcutsSnapshot> {
    validate_command_id(&request.command_id)?;
    validate_command_id(&request.conflicting_command_id)?;
    ensure_user_commands_file(&path)?;
    let mut overrides = parse_command_file(&path).overrides;

    let conflict = overrides
        .entry(request.conflicting_command_id.clone())
        .or_insert_with(|| ShortcutOverride {
            command_id: request.conflicting_command_id,
            ..ShortcutOverride::default()
        });
    set_slot(conflict, request.conflicting_slot, Some(None));

    let target = overrides
        .entry(request.command_id.clone())
        .or_insert_with(|| ShortcutOverride {
            command_id: request.command_id,
            ..ShortcutOverride::default()
        });
    set_slot(
        target,
        request.slot,
        Some(request.value.map(normalize_binding).transpose()?),
    );

    remove_empty_overrides(&mut overrides);
    write_overrides(&path, &overrides)?;
    snapshot_from(path, overrides)
}

fn reset_shortcuts(path: PathBuf, request: ResetShortcutRequest) -> ApiResult<ShortcutsSnapshot> {
    ensure_user_commands_file(&path)?;
    let mut overrides = parse_command_file(&path).overrides;
    if let Some(command_id) = request.command_id {
        overrides.remove(&command_id);
    } else if !request.command_ids.is_empty() {
        for command_id in request.command_ids {
            overrides.remove(&command_id);
        }
    } else {
        overrides.clear();
    }
    write_overrides(&path, &overrides)?;
    snapshot_from(path, overrides)
}

fn snapshot_from(
    path: PathBuf,
    overrides: BTreeMap<String, ShortcutOverride>,
) -> ApiResult<ShortcutsSnapshot> {
    Ok(ShortcutsSnapshot {
        path: path.display().to_string(),
        overrides: overrides.into_values().collect(),
    })
}

fn ensure_user_commands_file(path: &Path) -> ApiResult<()> {
    if path.as_os_str().is_empty() || path.exists() {
        return Ok(());
    }
    write_overrides(path, &BTreeMap::new())
}

fn write_overrides(path: &Path, overrides: &BTreeMap<String, ShortcutOverride>) -> ApiResult<()> {
    let parent = path.parent().ok_or_else(|| {
        ApiError::Message("Shortcut config path has no parent directory.".to_owned())
    })?;
    fs::create_dir_all(parent).map_err(|err| {
        ApiError::Message(format!("Failed to create shortcut config directory: {err}"))
    })?;

    let mut temporary = NamedTempFile::new_in(parent).map_err(|err| {
        ApiError::Message(format!("Failed to create temporary shortcut config: {err}"))
    })?;
    temporary
        .write_all(command_file(overrides).as_bytes())
        .and_then(|_| temporary.flush())
        .map_err(|err| ApiError::Message(format!("Failed to write shortcut config: {err}")))?;
    temporary.persist(path).map_err(|err| {
        ApiError::Message(format!(
            "Failed to replace shortcut config atomically: {err}"
        ))
    })?;
    Ok(())
}

fn command_file(overrides: &BTreeMap<String, ShortcutOverride>) -> String {
    let mut output = "# Misty keyboard command overrides\n\
        # Missing commands and slots use Misty's defaults for this operating system.\n\
        # An empty value explicitly unbinds a slot.\n\n"
        .to_owned();
    for entry in overrides.values() {
        output.push_str(&entry.command_id);
        output.push_str(" {\n");
        if let Some(value) = &entry.primary {
            write_slot(&mut output, "primary", value.as_deref());
        }
        if let Some(value) = &entry.alternate {
            write_slot(&mut output, "alternate", value.as_deref());
        }
        output.push_str("}\n\n");
    }
    output
}

fn write_slot(output: &mut String, slot: &str, value: Option<&str>) {
    output.push_str("  ");
    output.push_str(slot);
    output.push_str(" = \"");
    output.push_str(&escape_shortcut(value.unwrap_or_default()));
    output.push_str("\"\n");
}

#[derive(Default)]
struct ParsedCommandFile {
    overrides: BTreeMap<String, ShortcutOverride>,
    used_legacy_format: bool,
}

fn parse_command_file(path: &Path) -> ParsedCommandFile {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return ParsedCommandFile::default(),
    };
    let mut parsed = ParsedCommandFile::default();
    let mut current_command = String::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(brace) = trimmed.find('{') {
            current_command = trimmed[..brace].trim().to_owned();
            continue;
        }
        if trimmed == "}" {
            current_command.clear();
            continue;
        }
        let Some(eq) = trimmed.find('=') else {
            continue;
        };
        let key = trimmed[..eq].trim();
        let value = unquote(trimmed[eq + 1..].trim()).to_owned();

        if current_command.is_empty() {
            parsed.used_legacy_format = true;
            if !key.is_empty() {
                insert_legacy_primary(&mut parsed.overrides, key, value);
            }
            continue;
        }

        let entry = parsed
            .overrides
            .entry(current_command.clone())
            .or_insert_with(|| ShortcutOverride {
                command_id: current_command.clone(),
                ..ShortcutOverride::default()
            });
        match key {
            "primary" => entry.primary = Some(binding_value(value)),
            "alternate" => entry.alternate = Some(binding_value(value)),
            "key" => {
                parsed.used_legacy_format = true;
                if entry.primary.is_none() {
                    entry.primary = Some(Some(value));
                }
            }
            "mac" if cfg!(target_os = "macos") => {
                parsed.used_legacy_format = true;
                entry.primary = Some(Some(value));
            }
            "mac" => parsed.used_legacy_format = true,
            _ => {}
        }
    }
    parsed
}

fn insert_legacy_primary(
    overrides: &mut BTreeMap<String, ShortcutOverride>,
    command_id: &str,
    value: String,
) {
    overrides.insert(
        command_id.to_owned(),
        ShortcutOverride {
            command_id: command_id.to_owned(),
            primary: Some(Some(value)),
            alternate: None,
        },
    );
}

fn migrate_legacy_defaults(
    mut overrides: BTreeMap<String, ShortcutOverride>,
) -> BTreeMap<String, ShortcutOverride> {
    let defaults = default_command_entries()
        .iter()
        .map(|entry| (entry.id, entry.shortcut))
        .collect::<BTreeMap<_, _>>();
    overrides.retain(|command_id, entry| {
        let unchanged_default = entry.alternate.is_none()
            && matches!(
                &entry.primary,
                Some(Some(value)) if defaults.get(command_id.as_str()).is_some_and(|default| value == default)
            );
        !unchanged_default
    });
    overrides
}

fn set_slot(entry: &mut ShortcutOverride, slot: ShortcutSlot, value: Option<Option<String>>) {
    match slot {
        ShortcutSlot::Primary => entry.primary = value,
        ShortcutSlot::Alternate => entry.alternate = value,
    }
}

fn remove_empty_overrides(overrides: &mut BTreeMap<String, ShortcutOverride>) {
    overrides.retain(|_, entry| entry.primary.is_some() || entry.alternate.is_some());
}

fn normalize_binding(value: String) -> ApiResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(ApiError::Message(
            "Use null to unbind a shortcut instead of an empty binding.".to_owned(),
        ));
    }
    if value.len() > 80 || value.contains(['\n', '\r', '{', '}']) {
        return Err(ApiError::Message("Invalid shortcut binding.".to_owned()));
    }
    Ok(value.to_owned())
}

fn validate_command_id(command_id: &str) -> ApiResult<()> {
    if command_id.is_empty()
        || command_id.len() > 160
        || !command_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._:-".contains(character))
    {
        return Err(ApiError::Message("Invalid shortcut command ID.".to_owned()));
    }
    Ok(())
}

fn binding_value(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn escape_shortcut(shortcut: &str) -> String {
    shortcut.replace('\\', "\\\\").replace('"', "\\\"")
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

#[cfg(test)]
#[path = "commands_tests.rs"]
mod tests;
