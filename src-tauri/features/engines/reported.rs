//! What an engine says about itself while it runs: the slash commands and skills it offers in the
//! mode Misty runs it in. Claude Code names them in its `system/init` line; an ACP engine sends
//! `available_commands_update` (Qwen adds its skills in `_meta.availableSkills`). The composer's
//! `/` menu lists these in place of a guessed list, so it offers what the engine will run.
//!
//! Kept in memory for the app's life: the next run reports again, and until an engine has run
//! once its menu falls back to the commands known to work (`catalog.rs`).

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use serde_json::Value;

/// One command or skill as the engine named it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Named {
    pub name: String,
    pub description: String,
    pub argument_hint: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct Report {
    pub commands: Option<Vec<Named>>,
    pub skills: Option<Vec<Named>>,
}

static REPORTS: LazyLock<Mutex<HashMap<String, Report>>> = LazyLock::new(Default::default);

/// The last report from `engine`, if it has run since the app started.
pub fn report_of(engine: &str) -> Report {
    REPORTS
        .lock()
        .ok()
        .and_then(|reports| reports.get(engine).cloned())
        .unwrap_or_default()
}

fn store(engine: &str, commands: Option<Vec<Named>>, skills: Option<Vec<Named>>) {
    let Ok(mut reports) = REPORTS.lock() else {
        return;
    };
    let report = reports.entry(engine.to_owned()).or_default();
    if commands.is_some() {
        report.commands = commands;
    }
    if skills.is_some() {
        report.skills = skills;
    }
}

/// A name the menu can show: a short word, no spaces or control characters, so a misbehaving
/// engine can't put arbitrary text in the menu.
fn clean_name(raw: &str) -> Option<String> {
    let name = raw.trim().trim_start_matches(['/', '$']);
    (!name.is_empty()
        && name.chars().count() <= 80
        && !name.chars().any(|c| c.is_whitespace() || c.is_control()))
    .then(|| name.to_owned())
}

fn clean_text(raw: Option<&str>, most: usize) -> String {
    raw.unwrap_or_default()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(most)
        .collect()
}

fn names_in(list: Option<&Value>) -> Option<Vec<Named>> {
    let items = list?.as_array()?;
    Some(
        items
            .iter()
            .filter_map(|item| {
                let (name, description) = match item {
                    Value::String(name) => (name.as_str(), None),
                    Value::Object(_) => (
                        item.get("name").and_then(Value::as_str)?,
                        item.get("description").and_then(Value::as_str),
                    ),
                    _ => return None,
                };
                Some(Named {
                    name: clean_name(name)?,
                    description: clean_text(description, 200),
                    argument_hint: None,
                })
            })
            .collect(),
    )
}

/// Claude Code's `system/init` line: `slash_commands` (names; skills are among them) and
/// `skills`. `engine` is the id it runs as (Claude Code or CodeBuddy, which shares the format).
pub fn claude_init(engine: &str, init: &Value) {
    let skills = names_in(init.get("skills"));
    let commands = names_in(init.get("slash_commands")).map(|commands| {
        let skill_names: Vec<&str> = skills
            .iter()
            .flatten()
            .map(|skill| skill.name.as_str())
            .collect();
        commands
            .into_iter()
            .filter(|command| !skill_names.contains(&command.name.as_str()))
            .collect()
    });
    store(engine, commands, skills);
}

/// An ACP `session/update` params object. Only `available_commands_update` is kept: its
/// commands, with their input hint, and the skills Qwen lists in `_meta.availableSkills`.
pub fn acp_update(engine: &str, params: &Value) {
    let update = params.get("update").unwrap_or(params);
    if update.get("sessionUpdate").and_then(Value::as_str) != Some("available_commands_update") {
        return;
    }
    let commands = update
        .get("availableCommands")
        .and_then(Value::as_array)
        .map(|items| {
            let mut commands: Vec<Named> = Vec::new();
            for item in items {
                let Some(raw) = item.get("name").and_then(Value::as_str) else {
                    continue;
                };
                let description = clean_text(item.get("description").and_then(Value::as_str), 200);
                let mut hint = item
                    .pointer("/input/hint")
                    .and_then(Value::as_str)
                    .map(|hint| clean_text(Some(hint), 80))
                    .filter(|hint| !hint.is_empty());
                // Qwen names a command's subcommands in `_meta.subcommands`.
                if hint.is_none() {
                    hint = subcommand_hint(item.pointer("/_meta/subcommands"));
                }
                // Gemini reports a subcommand as its own two-word entry ("memory show"): it
                // becomes one of its command's choices instead.
                let mut words = raw.trim().trim_start_matches(['/', '$']).split_whitespace();
                let (Some(first), second) = (words.next(), words.next()) else {
                    continue;
                };
                let Some(name) = clean_name(first) else {
                    continue;
                };
                if super::slash::acp::withheld(engine).contains(&name.as_str()) {
                    continue;
                }
                match second.and_then(clean_name) {
                    Some(sub) => add_subcommand(&mut commands, name, sub),
                    None => match commands.iter_mut().find(|command| command.name == name) {
                        Some(known) => {
                            known.description = description;
                            if hint.is_some() {
                                known.argument_hint = hint;
                            }
                        }
                        None => commands.push(Named {
                            name,
                            description,
                            argument_hint: hint,
                        }),
                    },
                }
            }
            commands
        });
    // Qwen names its skills alone in `availableSkills`; their descriptions are in
    // `availableSkillDetails`, and on the command each one also is.
    let details = names_in(update.pointer("/_meta/availableSkillDetails")).unwrap_or_default();
    let skills = names_in(update.pointer("/_meta/availableSkills")).map(|skills| {
        skills
            .into_iter()
            .map(|mut skill| {
                if skill.description.is_empty() {
                    let named = details
                        .iter()
                        .chain(commands.iter().flatten())
                        .find(|named| named.name == skill.name && !named.description.is_empty());
                    if let Some(named) = named {
                        skill.description = named.description.clone();
                    }
                }
                skill
            })
            .collect()
    });
    store(engine, commands, skills);
}

/// The longest hint a command's subcommands make. Only whole choices go in, so a list that
/// runs over loses its last choices rather than ending in half a word.
const MOST_CHOICES: usize = 160;

/// `choices` joined as a hint, with as many whole choices as fit.
fn choices_hint<'a>(choices: impl IntoIterator<Item = &'a str>) -> Option<String> {
    let mut hint = String::new();
    for choice in choices {
        let more = if hint.is_empty() { 0 } else { 3 } + choice.chars().count();
        if hint.chars().count() + more > MOST_CHOICES {
            break;
        }
        if !hint.is_empty() {
            hint.push_str(" | ");
        }
        hint.push_str(choice);
    }
    (!hint.is_empty()).then_some(hint)
}

/// The choices a command's `_meta.subcommands` lists (names, or objects with a name), as a hint.
fn subcommand_hint(list: Option<&Value>) -> Option<String> {
    let names: Vec<String> = list?
        .as_array()?
        .iter()
        .filter_map(|item| {
            let name = item
                .as_str()
                .or_else(|| item.get("name").and_then(Value::as_str))?;
            clean_name(name)
        })
        .collect();
    choices_hint(names.iter().map(String::as_str))
}

/// Adds `sub` to the choices of the command `name`, adding the command when it isn't listed yet.
fn add_subcommand(commands: &mut Vec<Named>, name: String, sub: String) {
    let command = match commands.iter().position(|command| command.name == name) {
        Some(at) => &mut commands[at],
        None => {
            commands.push(Named {
                name,
                description: String::new(),
                argument_hint: None,
            });
            commands.last_mut().expect("just pushed")
        }
    };
    let hint = command.argument_hint.take().unwrap_or_default();
    let mut choices: Vec<&str> = hint
        .split(" | ")
        .filter(|choice| !choice.is_empty())
        .collect();
    if !choices.contains(&sub.as_str()) {
        choices.push(&sub);
    }
    command.argument_hint = choices_hint(choices).or(Some(hint).filter(|hint| !hint.is_empty()));
}

#[cfg(test)]
pub(crate) fn forget(engine: &str) {
    if let Ok(mut reports) = REPORTS.lock() {
        reports.remove(engine);
    }
}

#[cfg(test)]
#[path = "reported_tests.rs"]
mod tests;
