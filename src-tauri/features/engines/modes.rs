//! Each engine's own modes, as the engine names them. Misty has no modes of its own: an adapter
//! lists the ways its engine can run (`Engine::modes`), in the engine's order, with the id the
//! engine takes and its name in sentence case. Each mode carries one fixed kind, which is all
//! Misty's own gate reads (`agents/run_control/tool_policy.rs`), and the launch level the
//! adapter turns into the engine's flags (`build_command`, `host_command`).
//!
//! A no-asking mode is offered only where the engine's own folder sandbox runs
//! (`Engine::folder_sandbox`), so it writes only inside its folder.

use serde::Serialize;

use super::Engine;

/// What a mode means for Misty's gate.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModeKind {
    /// The engine asks before it changes files or runs a command; each ask reaches the person.
    Asks,
    /// The engine works without asking for ordinary work.
    Edits,
    /// Read-only planning: nothing is changed.
    Plans,
    /// The engine never asks, held inside its folder by its own sandbox.
    NoAsking,
}

impl ModeKind {
    /// The kind an old saved choice (Misty's former Ask, Auto, Plan and Bypass) stands for.
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

/// One of an engine's own modes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct EngineMode {
    /// The engine's own value for it.
    pub id: &'static str,
    /// The engine's own name for it, in sentence case.
    pub label: &'static str,
    pub kind: ModeKind,
    /// The adapter's launch level ("manual" | "auto" | "plan" | "bypass", or one of the
    /// adapter's own), which its `build_command`/`host_command` turns into flags.
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

/// Misty's own runtime (`agents/runs/local_prompt`), which isn't an outside engine: its ways to
/// run, read the same way.
pub(crate) const MISTY_MODES: &[EngineMode] = &[
    mode("ask", "Ask", ModeKind::Asks, "manual"),
    mode("auto", "Auto", ModeKind::Edits, "auto"),
    mode("plan", "Plan", ModeKind::Plans, "plan"),
];

/// The modes the engine offers on this computer: its own list, without a no-asking mode where
/// its folder sandbox doesn't run, and, once the installed engine has listed its modes itself
/// (`learn_reported`), without any it doesn't list. What each mode means for the gate stays the
/// adapter's: the engine only says which of them it has.
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
    // A help text read wrong must not leave the engine with no way to run.
    if kept.is_empty() {
        modes
    } else {
        kept
    }
}

/// One mode as the installed engine listed it: its value, and its own name when it gave one
/// (an ACP handshake's `availableModes`; a help text lists values only).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ListedMode {
    pub id: String,
    pub name: Option<String>,
}

/// Each engine's own list of its modes, as its installed CLI last gave it.
static REPORTED: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, Vec<ListedMode>>>,
> = std::sync::LazyLock::new(Default::default);

/// The mode values the installed engine listed, if it has been asked.
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

/// Keeps what an engine listed of its modes (a handshake's names win over a help's values).
pub(crate) fn learn_listed(engine_id: &str, modes: Vec<ListedMode>) {
    if modes.is_empty() {
        return;
    }
    REPORTED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(engine_id.to_string(), modes);
}

/// A mode as the composer offers it: the adapter's id and kind, under the engine's own name when
/// the engine gave one, else the adapter's.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct NamedMode {
    pub id: &'static str,
    pub label: String,
    pub kind: ModeKind,
}

/// The offered modes, each under the name the installed engine gives it, when it gives one.
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

/// Asks an installed engine for its own list of modes (its `--help` choices for its mode flag),
/// and keeps it for `offered`. Engines with no such flag, or a help that doesn't list choices,
/// keep their adapter's list.
pub(crate) async fn learn_reported(engine: &dyn Engine, bin: &str) {
    let Some(flag) = engine.modes_help_flag() else {
        return;
    };
    let Ok(help) = super::models::run_probe(bin, &["--help"], "help").await else {
        return;
    };
    // A handshake already gave this engine's modes, with their names: keep those.
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

/// The values a CLI's help lists for one flag: `(choices: "a", "b")` across wrapped lines, or a
/// sentence `Choices: a, b, c.` Only the flag itself, never a longer one that starts the same.
pub(crate) fn parse_help_choices(help: &str, flag: &str) -> Option<Vec<String>> {
    let lines: Vec<&str> = help.lines().collect();
    let start = lines.iter().position(|line| {
        let trimmed = line.trim_start();
        trimmed.starts_with(flag)
            && trimmed[flag.len()..].starts_with(|c: char| c == ' ' || c == '=')
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

/// The modes an engine id offers here; Misty's own runtime's for an empty id, none for an id
/// with no adapter.
pub(crate) fn offered_by_id(engine_id: &str) -> Vec<EngineMode> {
    if engine_id.is_empty() || engine_id == "misty" {
        return MISTY_MODES.to_vec();
    }
    super::engine_by_id(engine_id).map_or_else(Vec::new, |engine| offered(engine.as_ref()))
}

/// The mode a run asks for: the id it names, or, for an old request with none, its former
/// Misty mode mapped to the engine's own (`closest`). Unknown ids are refused.
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
    closest(modes, legacy.unwrap_or(ModeKind::Asks))
        .ok_or_else(|| "This engine has no mode to run in here.".to_string())
}

/// The engine's mode of a kind, or the closest one that asks no less: a no-asking choice falls
/// to one that works without asking, then to one that asks; a planning one to one that asks.
/// An engine with nothing closer runs in its first mode, its own default.
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

/// The launch levels an engine's offered modes use, in order, each once.
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
