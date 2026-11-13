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
            items
                .iter()
                .filter_map(|item| {
                    Some(Named {
                        name: clean_name(item.get("name").and_then(Value::as_str)?)?,
                        description: clean_text(
                            item.get("description").and_then(Value::as_str),
                            200,
                        ),
                        argument_hint: item
                            .pointer("/input/hint")
                            .and_then(Value::as_str)
                            .map(|hint| clean_text(Some(hint), 80))
                            .filter(|hint| !hint.is_empty()),
                    })
                })
                .collect()
        });
    let skills = names_in(update.pointer("/_meta/availableSkills"));
    store(engine, commands, skills);
}

#[cfg(test)]
pub(crate) fn forget(engine: &str) {
    if let Ok(mut reports) = REPORTS.lock() {
        reports.remove(engine);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn claude_init_keeps_commands_apart_from_skills() {
        claude_init(
            "test-claude",
            &json!({
                "slash_commands": ["compact", "context", "review", "pdf", "bad name", ""],
                "skills": ["pdf"],
            }),
        );
        let report = report_of("test-claude");
        let commands: Vec<_> = report
            .commands
            .unwrap()
            .into_iter()
            .map(|c| c.name)
            .collect();
        assert_eq!(commands, ["compact", "context", "review"]);
        assert_eq!(report.skills.unwrap()[0].name, "pdf");
        forget("test-claude");
    }

    #[test]
    fn acp_commands_carry_their_description_and_hint() {
        acp_update(
            "test-acp",
            &json!({"update": {
                "sessionUpdate": "available_commands_update",
                "availableCommands": [
                    {"name": "init", "description": "Analyze the project\nand write a file"},
                    {"name": "/memory", "description": "Manage memory", "input": {"hint": "show | add"}},
                ],
                "_meta": {"availableSkills": ["review-pr"]},
            }}),
        );
        let report = report_of("test-acp");
        let commands = report.commands.unwrap();
        assert_eq!(
            commands[0].description,
            "Analyze the project and write a file"
        );
        assert_eq!(commands[1].name, "memory");
        assert_eq!(commands[1].argument_hint.as_deref(), Some("show | add"));
        assert_eq!(report.skills.unwrap()[0].name, "review-pr");
        // Other updates change nothing.
        acp_update(
            "test-acp",
            &json!({"update": {"sessionUpdate": "agent_message_chunk"}}),
        );
        assert_eq!(report_of("test-acp").commands.unwrap().len(), 2);
        forget("test-acp");
    }
}
