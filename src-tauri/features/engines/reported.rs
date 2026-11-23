use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

use serde_json::Value;

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
                if hint.is_none() {
                    hint = subcommand_hint(item.pointer("/_meta/subcommands"));
                }
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

const MOST_CHOICES: usize = 160;

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
