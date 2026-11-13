//! What the person reads before answering: the whole of what's being approved, or nothing. A call that
//! can't be shown in full is refused, with word to make a smaller one, and never shown cut short.
use serde_json::{Map, Value};

/// Past this the island's scrolling view stops being something a person can read. A shell command (up
/// to 60,000 characters) and a program (up to 20,000) both fit.
pub(crate) const MAX_SHOWN: usize = 64_000;

/// What can't be shown, for the model to hear.
pub(crate) const TOO_LONG: &str = "This call is too long to show the person in full, so it wasn't asked about and nothing was done. Make a smaller call.";

const MASK: &str = "••••••";

/// Handles the person has no use for, which change nothing about what happens.
const INTERNAL: &[&str] = &[
    "scopeId",
    "documentId",
    "__mistyTaskId",
    "includeSnapshot",
    "device",
];

fn secret_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    ["password", "passwd", "passcode"]
        .iter()
        .any(|word| name.contains(word))
}

fn value_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

fn masked(value: &Value) -> Value {
    match value {
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(key, value)| {
                    (
                        key.clone(),
                        if secret_name(key) {
                            Value::String(MASK.to_owned())
                        } else {
                            masked(value)
                        },
                    )
                })
                .collect::<Map<_, _>>(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(masked).collect()),
        other => other.clone(),
    }
}

/// Every field of a call, for a question or an approval card.
pub(crate) fn shown_fields(input: &Value) -> Vec<String> {
    let Some(fields) = input.as_object() else {
        return Vec::new();
    };
    fields
        .iter()
        .filter(|(key, _)| !INTERNAL.contains(&key.as_str()))
        .map(|(key, value)| {
            let shown = if secret_name(key) {
                MASK.to_owned()
            } else {
                value_text(&masked(value))
            };
            format!("{key}: {}", shown.trim())
        })
        .collect()
}

/// A page control, as far as the page can name it.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Control {
    pub(crate) name: String,
    pub(crate) password: bool,
}

pub(crate) type Controls = std::collections::HashMap<String, Control>;

fn control_name(reference: &str, controls: &Controls) -> String {
    controls.get(reference).map_or_else(
        || format!("control {reference}"),
        |control| control.name.clone(),
    )
}

fn is_password(reference: &str, controls: &Controls) -> bool {
    controls
        .get(reference)
        .is_some_and(|control| control.password)
}

fn step_line(step: &Value, controls: &Controls) -> String {
    let action = step["action"].as_str().unwrap_or("act");
    let mut line = action.to_owned();
    let reference = step["ref"].as_str().unwrap_or("");
    if !reference.is_empty() {
        line.push(' ');
        line.push_str(&control_name(reference, controls));
    }
    if let Some(key) = step["key"].as_str() {
        line.push(' ');
        line.push_str(key);
        if let Some(modifiers) = step["modifiers"]
            .as_array()
            .filter(|items| !items.is_empty())
        {
            line.push_str(&format!(
                " with {}",
                modifiers
                    .iter()
                    .map(value_text)
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }
    if let Some(text) = step["text"].as_str() {
        line.push_str(": ");
        line.push_str(if is_password(reference, controls) {
            MASK
        } else {
            text
        });
    }
    if let Some(values) = step["values"].as_array() {
        line.push_str(": ");
        line.push_str(&values.iter().map(value_text).collect::<Vec<_>>().join(", "));
    }
    if step["submit"] == true {
        line.push_str(", then press Enter");
    }
    line
}

/// A sentence-case name for a tool: `memory.pref.update` is "Memory pref update".
pub(crate) fn tool_title(name: &str) -> String {
    let words: Vec<&str> = name
        .split(['.', '_'])
        .filter(|word| !word.is_empty())
        .collect();
    let joined = words.join(" ");
    let mut letters = joined.chars();
    letters.next().map_or_else(
        || "Change something".to_owned(),
        |first| first.to_uppercase().chain(letters).collect(),
    )
}

/// Every reference a call's steps name, to look up on the page first.
pub(crate) fn page_refs(name: &str, input: &Value) -> Vec<String> {
    let list = match name {
        "browser.steps" => &input["steps"],
        "browser.fill_form" => &input["fields"],
        _ => return Vec::new(),
    };
    list.as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item["ref"].as_str().map(str::to_owned))
        .collect()
}

/// The full text of what this call does. `Err` when it can't be shown whole.
pub(crate) fn question_text(
    name: &str,
    input: &Value,
    controls: &Controls,
) -> Result<String, &'static str> {
    let mut lines = vec![match name {
        "browser.run" => "Run a program in your browser tabs".to_owned(),
        "browser.steps" | "browser.fill_form" | "browser.skill" => "Act on a web page".to_owned(),
        _ => tool_title(name),
    }];
    match name {
        "browser.steps" => {
            lines.extend(
                input["steps"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|step| step_line(step, controls)),
            );
        }
        "browser.fill_form" => {
            for field in input["fields"].as_array().into_iter().flatten() {
                let reference = field["ref"].as_str().unwrap_or("");
                let shown = if is_password(reference, controls) {
                    MASK.to_owned()
                } else {
                    value_text(&field["value"])
                };
                lines.push(format!("{}: {shown}", control_name(reference, controls)));
            }
        }
        _ => lines.extend(shown_fields(input)),
    }
    let text = lines.join("\n");
    if text.chars().count() > MAX_SHOWN {
        return Err(TOO_LONG);
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn none() -> Controls {
        Controls::new()
    }

    #[test]
    fn a_long_command_is_shown_whole() {
        let command = "x".repeat(60_000);
        let text = question_text("shell.run", &json!({ "command": command }), &none()).unwrap();
        assert!(text.contains(&command));
    }

    #[test]
    fn a_program_is_shown_whole() {
        let code = "y".repeat(20_000);
        let text = question_text("browser.run", &json!({ "code": code }), &none()).unwrap();
        assert!(text.contains(&code));
    }

    #[test]
    fn what_cannot_be_shown_is_refused() {
        let call = json!({ "command": "x".repeat(MAX_SHOWN + 1) });
        assert_eq!(question_text("shell.run", &call, &none()), Err(TOO_LONG));
    }

    #[test]
    fn every_field_is_shown_with_nothing_cut_at_ten_keys() {
        let mut call = serde_json::Map::new();
        for index in 0..30 {
            call.insert(format!("field{index}"), json!("z".repeat(500)));
        }
        let text = question_text("note.update", &Value::Object(call), &none()).unwrap();
        for index in 0..30 {
            assert!(text.contains(&format!("field{index}: {}", "z".repeat(500))));
        }
    }

    #[test]
    fn a_step_names_its_control_and_its_text() {
        let mut controls = none();
        controls.insert(
            "e12".into(),
            Control {
                name: "button \"Send\"".into(),
                password: false,
            },
        );
        let call = json!({ "steps": [{ "action": "click", "ref": "e12" }, { "action": "type", "ref": "e9", "text": "hello", "submit": true }, { "action": "key", "key": "Enter", "modifiers": ["Meta"] }] });
        let text = question_text("browser.steps", &call, &controls).unwrap();
        assert!(text.contains("click button \"Send\""));
        assert!(text.contains("type control e9: hello, then press Enter"));
        assert!(text.contains("key Enter with Meta"));
    }

    #[test]
    fn a_form_shows_its_values_and_masks_a_password() {
        let mut controls = none();
        controls.insert(
            "e1".into(),
            Control {
                name: "textbox \"Email\"".into(),
                password: false,
            },
        );
        controls.insert(
            "e2".into(),
            Control {
                name: "textbox \"Password\"".into(),
                password: true,
            },
        );
        let call = json!({ "fields": [{ "ref": "e1", "value": "a@example.com" }, { "ref": "e2", "value": "hunter2" }] });
        let text = question_text("browser.fill_form", &call, &controls).unwrap();
        assert!(text.contains("textbox \"Email\": a@example.com"));
        assert!(text.contains("textbox \"Password\": ••••••"));
        assert!(!text.contains("hunter2"));
        let typed = json!({ "steps": [{ "action": "type", "ref": "e2", "text": "hunter2" }] });
        assert!(!question_text("browser.steps", &typed, &controls)
            .unwrap()
            .contains("hunter2"));
    }

    #[test]
    fn a_skill_shows_its_arguments_and_a_named_password_is_masked() {
        let call = json!({ "skill": "docs", "action": "replace", "args": { "text": "all of it", "password": "hunter2" } });
        let text = question_text("browser.skill", &call, &none()).unwrap();
        assert!(
            text.contains("skill: docs") && text.contains("replace") && text.contains("all of it")
        );
        assert!(!text.contains("hunter2"));
    }

    #[test]
    fn handles_stay_out_of_the_view() {
        let text = question_text(
            "browser.navigate",
            &json!({ "scopeId": "tab-1", "url": "https://example.com" }),
            &none(),
        )
        .unwrap();
        assert_eq!(text, "Browser navigate\nurl: https://example.com");
    }
}
