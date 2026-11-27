use serde::Serialize;

use super::Engine;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModeKind {
    Asks,
    Edits,
    Plans,
    NoAsking,
}

impl ModeKind {
    pub(crate) fn of_legacy(value: &str) -> Option<Self> {
        match value {
            "ask" | "manual" => Some(Self::Asks),
            "auto" => Some(Self::Edits),
            "plan" => Some(Self::Plans),
            "bypass" => Some(Self::NoAsking),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct EngineMode {
    pub id: &'static str,
    pub label: &'static str,
    pub kind: ModeKind,
    #[serde(skip)]
    pub launch: &'static str,
}

pub(crate) const fn mode(
    id: &'static str,
    label: &'static str,
    kind: ModeKind,
    launch: &'static str,
) -> EngineMode {
    EngineMode {
        id,
        label,
        kind,
        launch,
    }
}

pub(crate) const MISTY_MODES: &[EngineMode] = &[
    mode("ask", "Ask", ModeKind::Asks, "manual"),
    mode("auto", "Auto", ModeKind::Edits, "auto"),
    mode("plan", "Plan", ModeKind::Plans, "plan"),
];

pub(crate) fn offered(engine: &dyn Engine) -> Vec<EngineMode> {
    let modes = offered_from(engine.modes(), engine.folder_sandbox());
    let Some(listed) = reported(engine.id()) else {
        return modes;
    };
    let kept: Vec<EngineMode> = modes
        .iter()
        .copied()
        .filter(|mode| {
            engine
                .mode_values(mode.id)
                .iter()
                .any(|value| listed.iter().any(|id| id == value))
        })
        .collect();
    if kept.is_empty() {
        modes
    } else {
        kept
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ListedMode {
    pub id: String,
    pub name: Option<String>,
}

static REPORTED: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, Vec<ListedMode>>>,
> = std::sync::LazyLock::new(Default::default);

pub(crate) fn reported(engine_id: &str) -> Option<Vec<String>> {
    listed(engine_id).map(|modes| modes.into_iter().map(|mode| mode.id).collect())
}

fn listed(engine_id: &str) -> Option<Vec<ListedMode>> {
    REPORTED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(engine_id)
        .cloned()
}

pub(crate) fn learn_listed(engine_id: &str, modes: Vec<ListedMode>) {
    if modes.is_empty() {
        return;
    }
    REPORTED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(engine_id.to_string(), modes);
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct NamedMode {
    pub id: &'static str,
    pub label: String,
    pub kind: ModeKind,
}

pub(crate) fn named(engine: &dyn Engine) -> Vec<NamedMode> {
    let listed = listed(engine.id()).unwrap_or_default();
    offered(engine)
        .into_iter()
        .map(|mode| {
            let values = engine.mode_values(mode.id);
            let name = listed
                .iter()
                .find(|item| values.iter().any(|value| *value == item.id))
                .and_then(|item| item.name.clone());
            NamedMode {
                id: mode.id,
                label: name.unwrap_or_else(|| mode.label.to_string()),
                kind: mode.kind,
            }
        })
        .collect()
}

pub(crate) async fn learn_reported(engine: &dyn Engine, bin: &str) {
    let Some(flag) = engine.modes_help_flag() else {
        return;
    };
    let Ok(help) = super::models::run_probe(bin, &["--help"], "help").await else {
        return;
    };
    if listed(engine.id()).is_some_and(|modes| modes.iter().any(|mode| mode.name.is_some())) {
        return;
    }
    if let Some(ids) = parse_help_choices(&help, flag) {
        learn_listed(
            engine.id(),
            ids.into_iter()
                .map(|id| ListedMode { id, name: None })
                .collect(),
        );
    }
}

pub(crate) fn parse_help_choices(help: &str, flag: &str) -> Option<Vec<String>> {
    let lines: Vec<&str> = help.lines().collect();
    let start = lines.iter().position(|line| {
        let trimmed = line.trim_start();
        trimmed.starts_with(flag) && trimmed[flag.len()..].starts_with([' ', '='])
    })?;
    let mut block = lines[start].trim().to_string();
    for line in &lines[start + 1..] {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('-') {
            break;
        }
        block.push(' ');
        block.push_str(trimmed);
    }
    let at = block.to_ascii_lowercase().find("choices:")? + "choices:".len();
    let rest = &block[at..];
    let end = [
        rest.find(')'),
        rest.find(". "),
        rest.strip_suffix('.').map(str::len),
    ]
    .into_iter()
    .flatten()
    .min()
    .unwrap_or(rest.len());
    let ids: Vec<String> = rest[..end]
        .split(',')
        .map(|part| {
            part.trim()
                .trim_matches(|c: char| c == '"' || c == '\'' || c == '.')
        })
        .filter(|id| {
            !id.is_empty()
                && id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        })
        .map(str::to_string)
        .collect();
    (!ids.is_empty()).then_some(ids)
}

fn offered_from(modes: &[EngineMode], sandboxed: bool) -> Vec<EngineMode> {
    modes
        .iter()
        .copied()
        .filter(|mode| mode.kind != ModeKind::NoAsking || sandboxed)
        .collect()
}

pub(crate) fn offered_by_id(engine_id: &str) -> Vec<EngineMode> {
    if engine_id.is_empty() || engine_id == "misty" {
        return MISTY_MODES.to_vec();
    }
    super::engine_by_id(engine_id).map_or_else(Vec::new, |engine| offered(engine.as_ref()))
}

pub(crate) fn chosen<'a>(
    modes: &'a [EngineMode],
    id: &str,
    legacy: Option<ModeKind>,
) -> Result<&'a EngineMode, String> {
    let id = id.trim();
    if !id.is_empty() {
        return modes
            .iter()
            .find(|mode| mode.id == id)
            .ok_or_else(|| format!("This engine has no mode called “{id}”."));
    }
    closest(modes, legacy.unwrap_or(ModeKind::NoAsking))
        .ok_or_else(|| "This engine has no mode to run in here.".to_string())
}

pub(crate) fn closest(modes: &[EngineMode], kind: ModeKind) -> Option<&EngineMode> {
    let order: &[ModeKind] = match kind {
        ModeKind::NoAsking => &[ModeKind::NoAsking, ModeKind::Edits, ModeKind::Asks],
        ModeKind::Edits => &[ModeKind::Edits, ModeKind::Asks],
        ModeKind::Plans => &[ModeKind::Plans, ModeKind::Asks],
        ModeKind::Asks => &[ModeKind::Asks],
    };
    order
        .iter()
        .find_map(|kind| modes.iter().find(|mode| mode.kind == *kind))
        .or_else(|| modes.first())
}

pub(crate) fn launch_levels(modes: &[EngineMode], sandboxed: bool) -> Vec<&'static str> {
    let mut levels: Vec<&'static str> = Vec::new();
    for mode in offered_from(modes, sandboxed) {
        if !levels.contains(&mode.launch) {
            levels.push(mode.launch);
        }
    }
    levels
}

#[cfg(test)]
#[path = "modes_tests.rs"]
mod tests;
