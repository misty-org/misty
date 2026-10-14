use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use super::store::Store;
use crate::error::{ApiError, ApiResult};
use crate::infra::environment::AppEnvironmentService;

/// Keyboard shortcut overrides, in `misty.db`. Only changes are stored: a command with no
/// row uses the platform default.
#[derive(Debug, Clone)]
pub struct CommandService {
    store: Store,
    /// `commands.msy` from an earlier layout, imported once.
    legacy_path: PathBuf,
}

/// A missing field inherits the platform default. A present `null` field is
/// intentionally unbound. This distinction is why the nested Options matter.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutOverride {
    pub command_id: String,
    #[serde(
        default,
        deserialize_with = "deserialize_override_slot",
        skip_serializing_if = "Option::is_none"
    )]
    pub primary: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_override_slot",
        skip_serializing_if = "Option::is_none"
    )]
    pub alternate: Option<Option<String>>,
}

fn deserialize_override_slot<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(deserializer).map(Some)
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
            store: environment.store(),
            legacy_path: environment.commands_path(),
        }
    }

    pub async fn snapshot(&self) -> ApiResult<ShortcutsSnapshot> {
        let legacy = self.legacy_path.clone();
        run_command_worker(self.store.clone(), move |store| {
            load_shortcuts(store, &legacy)
        })
        .await
    }

    pub async fn update(&self, request: UpdateShortcutRequest) -> ApiResult<ShortcutsSnapshot> {
        run_command_worker(self.store.clone(), move |store| {
            update_shortcut(store, request)
        })
        .await
    }

    pub async fn reassign(&self, request: ReassignShortcutRequest) -> ApiResult<ShortcutsSnapshot> {
        run_command_worker(self.store.clone(), move |store| {
            reassign_shortcut(store, request)
        })
        .await
    }

    pub async fn replace(&self, entries: Vec<ShortcutOverride>) -> ApiResult<ShortcutsSnapshot> {
        run_command_worker(self.store.clone(), move |store| {
            let mut overrides = BTreeMap::new();
            for entry in entries {
                validate_command_id(&entry.command_id)?;
                overrides.insert(entry.command_id.clone(), entry);
            }
            remove_empty_overrides(&mut overrides);
            write_overrides(&store, &overrides)?;
            snapshot_from(store, overrides)
        })
        .await
    }

    pub async fn reset(&self, request: ResetShortcutRequest) -> ApiResult<ShortcutsSnapshot> {
        run_command_worker(self.store.clone(), move |store| {
            reset_shortcuts(store, request)
        })
        .await
    }
}

async fn run_command_worker<F>(store: Store, worker: F) -> ApiResult<ShortcutsSnapshot>
where
    F: FnOnce(Store) -> ApiResult<ShortcutsSnapshot> + Send + 'static,
{
    tokio::task::spawn_blocking(move || worker(store))
        .await
        .map_err(|err| ApiError::Message(format!("Command worker failed: {err}")))?
}

fn db_error(error: rusqlite::Error) -> ApiError {
    ApiError::Message(format!("Shortcut persistence failed: {error}"))
}

fn load_shortcuts(store: Store, legacy: &Path) -> ApiResult<ShortcutsSnapshot> {
    import_legacy(&store, legacy)?;
    let overrides = read_overrides(&store)?;
    snapshot_from(store, overrides)
}

fn update_shortcut(store: Store, request: UpdateShortcutRequest) -> ApiResult<ShortcutsSnapshot> {
    validate_command_id(&request.command_id)?;
    let mut overrides = read_overrides(&store)?;
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
    write_overrides(&store, &overrides)?;
    snapshot_from(store, overrides)
}

fn reassign_shortcut(
    store: Store,
    request: ReassignShortcutRequest,
) -> ApiResult<ShortcutsSnapshot> {
    validate_command_id(&request.command_id)?;
    validate_command_id(&request.conflicting_command_id)?;
    let mut overrides = read_overrides(&store)?;

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
    write_overrides(&store, &overrides)?;
    snapshot_from(store, overrides)
}

fn reset_shortcuts(store: Store, request: ResetShortcutRequest) -> ApiResult<ShortcutsSnapshot> {
    let mut overrides = read_overrides(&store)?;
    if let Some(command_id) = request.command_id {
        overrides.remove(&command_id);
    } else if !request.command_ids.is_empty() {
        for command_id in request.command_ids {
            overrides.remove(&command_id);
        }
    } else {
        overrides.clear();
    }
    write_overrides(&store, &overrides)?;
    snapshot_from(store, overrides)
}

fn snapshot_from(
    store: Store,
    overrides: BTreeMap<String, ShortcutOverride>,
) -> ApiResult<ShortcutsSnapshot> {
    Ok(ShortcutsSnapshot {
        path: store.path().display().to_string(),
        overrides: overrides.into_values().collect(),
    })
}

/// A slot is stored as NULL (use the default), '' (deliberately unbound) or a binding.
fn slot_to_column(slot: &Option<Option<String>>) -> Option<String> {
    slot.as_ref().map(|value| value.clone().unwrap_or_default())
}

fn column_to_slot(column: Option<String>) -> Option<Option<String>> {
    column.map(binding_value)
}

fn read_overrides(store: &Store) -> ApiResult<BTreeMap<String, ShortcutOverride>> {
    let connection = store.connect().map_err(db_error)?;
    let mut statement = connection
        .prepare("SELECT command_id, primary_binding, alternate_binding FROM shortcut_overrides")
        .map_err(db_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok(ShortcutOverride {
                command_id: row.get(0)?,
                primary: column_to_slot(row.get(1)?),
                alternate: column_to_slot(row.get(2)?),
            })
        })
        .map_err(db_error)?;
    let mut overrides = BTreeMap::new();
    for entry in rows {
        let entry = entry.map_err(db_error)?;
        overrides.insert(entry.command_id.clone(), entry);
    }
    Ok(overrides)
}

fn write_overrides(store: &Store, overrides: &BTreeMap<String, ShortcutOverride>) -> ApiResult<()> {
    let mut connection = store.connect().map_err(db_error)?;
    let transaction = connection.transaction().map_err(db_error)?;
    transaction
        .execute("DELETE FROM shortcut_overrides", [])
        .map_err(db_error)?;
    for entry in overrides.values() {
        transaction
            .execute(
                "INSERT INTO shortcut_overrides (command_id, primary_binding, alternate_binding)
                 VALUES (?1, ?2, ?3)",
                rusqlite::params![
                    entry.command_id,
                    slot_to_column(&entry.primary),
                    slot_to_column(&entry.alternate)
                ],
            )
            .map_err(db_error)?;
    }
    transaction.commit().map_err(db_error)
}

/// Imports `commands.msy` from an earlier layout, once.
fn import_legacy(store: &Store, legacy: &Path) -> ApiResult<()> {
    store
        .import_once("commands.msy", |connection| -> Result<(), rusqlite::Error> {
            for entry in parse_command_file(legacy).into_values() {
                connection.execute(
                    "INSERT OR IGNORE INTO shortcut_overrides (command_id, primary_binding, alternate_binding)
                     VALUES (?1, ?2, ?3)",
                    rusqlite::params![
                        entry.command_id,
                        slot_to_column(&entry.primary),
                        slot_to_column(&entry.alternate)
                    ],
                )?;
            }
            Ok(())
        })
        .map_err(db_error)
}

/// The `commands.msy` text format: `command.id { primary = "Cmd+K"  alternate = "" }`.
fn parse_command_file(path: &Path) -> BTreeMap<String, ShortcutOverride> {
    let Ok(raw) = fs::read_to_string(path) else {
        return BTreeMap::new();
    };
    let mut overrides: BTreeMap<String, ShortcutOverride> = BTreeMap::new();
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
        if current_command.is_empty() || validate_command_id(&current_command).is_err() {
            continue;
        }
        let key = trimmed[..eq].trim();
        let value = unquote(trimmed[eq + 1..].trim()).to_owned();
        let entry = overrides
            .entry(current_command.clone())
            .or_insert_with(|| ShortcutOverride {
                command_id: current_command.clone(),
                ..ShortcutOverride::default()
            });
        match key {
            "primary" => entry.primary = Some(binding_value(value)),
            "alternate" => entry.alternate = Some(binding_value(value)),
            _ => {}
        }
    }
    overrides.retain(|_, entry| entry.primary.is_some() || entry.alternate.is_some());
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
