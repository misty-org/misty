//! The shape of a batch of page actions, checked before anything runs.
use serde::Deserialize;
use serde_json::{json, Value};

pub(super) const MAX_STEPS: usize = 10;
pub(super) const MAX_FORM_FIELDS: usize = 30;
const MAX_TEXT: usize = 20_000;
pub(super) const MAX_WAIT_MS: u64 = 20_000;

/// A ref-free target recorded for workflow replays: role, accessible name and
/// which of the same-named controls it is.
#[derive(Debug, Clone, Deserialize, serde::Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(super) struct Locator {
    pub role: String,
    pub name: String,
    #[serde(default)]
    pub index: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Step {
    pub action: String,
    #[serde(rename = "ref", default)]
    pub reference: Option<String>,
    /// Replays name their target by locator instead of a ref.
    #[serde(default)]
    pub locator: Option<Locator>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub values: Option<Vec<String>>,
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub modifiers: Option<Vec<String>>,
    #[serde(default)]
    pub direction: Option<String>,
    #[serde(default)]
    pub amount: Option<f64>,
    #[serde(default)]
    pub button: Option<String>,
    #[serde(default)]
    pub click_count: Option<u8>,
    #[serde(default)]
    pub submit: Option<bool>,
    #[serde(default)]
    pub text_gone: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

fn valid_ref(value: &str) -> bool {
    value.len() >= 2
        && value.len() <= 8
        && value.starts_with('e')
        && value[1..].bytes().all(|byte| byte.is_ascii_digit())
}

impl Step {
    fn needs_ref(&self) -> bool {
        matches!(
            self.action.as_str(),
            "click" | "fill" | "select" | "check" | "uncheck" | "hover"
        ) || (self.action == "scroll"
            && self.direction.as_deref() == Some("into_view")
            && self.text.is_none())
    }

    /// The key input native dispatch would receive, validated the same way.
    pub fn native_key(&self) -> Value {
        json!({"kind": "key", "key": self.key, "modifiers": self.modifiers.clone().unwrap_or_default()})
    }

    pub fn validate(&self) -> Result<(), String> {
        let action = self.action.as_str();
        if !matches!(
            action,
            "click"
                | "fill"
                | "select"
                | "check"
                | "uncheck"
                | "hover"
                | "key"
                | "scroll"
                | "wait_for"
        ) {
            return Err(format!("Unknown step action “{action}”."));
        }
        if let Some(locator) = &self.locator {
            if self.reference.is_some()
                || locator.role.is_empty()
                || locator.role.len() > 40
                || locator.name.len() > 200
                || locator.index.is_some_and(|index| index > 200)
            {
                return Err(
                    "A locator has a role, a name and an optional index, and replaces the ref."
                        .into(),
                );
            }
        }
        match &self.reference {
            Some(reference) if !valid_ref(reference) => {
                return Err("Refs look like e12 and come from the latest snapshot.".into())
            }
            None if self.locator.is_none() && self.needs_ref() => {
                return Err(format!("A {action} step needs a ref."))
            }
            _ => {}
        }
        if self
            .text
            .as_ref()
            .is_some_and(|text| text.len() > MAX_TEXT || text.contains('\0'))
        {
            return Err("Step text is too long.".into());
        }
        match action {
            "fill" if self.text.is_none() => return Err("A fill step needs text.".into()),
            "select" => {
                let values = self.values.as_deref().unwrap_or_default();
                if values.is_empty()
                    || values.len() > 50
                    || values.iter().any(|value| value.len() > 500)
                {
                    return Err("A select step needs 1–50 option values.".into());
                }
            }
            "key" => {
                if self.key.is_none() {
                    return Err("A key step needs a key.".into());
                }
                super::super::native_input::validate(&self.native_key())
                    .map_err(|_| "That key or shortcut is not supported.".to_owned())?;
            }
            "scroll" => {
                if !matches!(
                    self.direction.as_deref(),
                    Some("up" | "down" | "left" | "right" | "into_view")
                ) {
                    return Err("Scroll direction is up, down, left, right or into_view.".into());
                }
                if self
                    .amount
                    .is_some_and(|amount| !(0.1..=10.0).contains(&amount))
                {
                    return Err("Scroll amount is 0.1–10 screens.".into());
                }
            }
            "wait_for" => {
                if self.text.is_none() && self.text_gone.is_none() {
                    return Err("A wait_for step needs text or textGone.".into());
                }
                if self
                    .timeout_ms
                    .is_some_and(|ms| !(100..=MAX_WAIT_MS).contains(&ms))
                {
                    return Err("wait_for timeout is 100–20000 ms.".into());
                }
            }
            _ => {}
        }
        if self
            .button
            .as_deref()
            .is_some_and(|button| !matches!(button, "left" | "right"))
            || self
                .click_count
                .is_some_and(|count| !(1..=2).contains(&count))
        {
            return Err("Clicks use the left or right button, once or twice.".into());
        }
        Ok(())
    }
}

/// Reads browser.steps input: 1–10 steps, all valid, before any of them runs.
pub(super) fn parse_steps(input: &Value) -> Result<Vec<Step>, String> {
    let steps: Vec<Step> =
        serde_json::from_value(input.get("steps").cloned().unwrap_or(Value::Null))
            .map_err(|error| format!("Steps are invalid: {error}"))?;
    if steps.is_empty() || steps.len() > MAX_STEPS {
        return Err(format!("Send 1–{MAX_STEPS} steps."));
    }
    for (index, step) in steps.iter().enumerate() {
        step.validate()
            .map_err(|error| format!("Step {}: {error}", index + 1))?;
    }
    Ok(steps)
}

/// Turns browser.fill_form fields into steps: text fills, list choices and
/// checkbox states, in the order given.
pub(super) fn form_steps(input: &Value) -> Result<Vec<Step>, String> {
    let fields = input
        .get("fields")
        .and_then(Value::as_array)
        .filter(|fields| !fields.is_empty() && fields.len() <= MAX_FORM_FIELDS)
        .ok_or_else(|| format!("Send 1–{MAX_FORM_FIELDS} fields."))?;
    let mut steps = Vec::with_capacity(fields.len() + 1);
    for (index, field) in fields.iter().enumerate() {
        let reference = field.get("ref").and_then(Value::as_str).map(str::to_owned);
        let mut step = Step {
            action: String::new(),
            reference,
            locator: None,
            text: None,
            values: None,
            key: None,
            modifiers: None,
            direction: None,
            amount: None,
            button: None,
            click_count: None,
            submit: None,
            text_gone: None,
            timeout_ms: None,
        };
        match field.get("value") {
            Some(Value::String(text)) => {
                step.action = "fill".into();
                step.text = Some(text.clone());
            }
            Some(Value::Number(number)) => {
                step.action = "fill".into();
                step.text = Some(number.to_string());
            }
            Some(Value::Bool(checked)) => {
                step.action = if *checked { "check" } else { "uncheck" }.into();
            }
            Some(Value::Array(values)) => {
                step.action = "select".into();
                step.values = Some(
                    values
                        .iter()
                        .map(|value| value.as_str().map(str::to_owned))
                        .collect::<Option<Vec<_>>>()
                        .ok_or_else(|| format!("Field {}: list values are text.", index + 1))?,
                );
            }
            _ => {
                return Err(format!(
                    "Field {}: value is text, a number, true/false or a list.",
                    index + 1
                ))
            }
        }
        step.validate()
            .map_err(|error| format!("Field {}: {error}", index + 1))?;
        steps.push(step);
    }
    Ok(steps)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps_are_checked_before_any_runs() {
        let ok = json!({"steps": [
            {"action": "click", "ref": "e3"},
            {"action": "fill", "ref": "e4", "text": "hello", "submit": true},
            {"action": "select", "ref": "e5", "values": ["Blue"]},
            {"action": "key", "key": "Enter"},
            {"action": "scroll", "direction": "down", "amount": 2.0},
            {"action": "wait_for", "text": "Saved", "timeoutMs": 5000},
            {"action": "scroll", "direction": "into_view", "text": "Class schedule"}
        ]});
        assert_eq!(parse_steps(&ok).unwrap().len(), 7);
        let replay = json!({"steps": [{"action": "click", "locator": {"role": "button", "name": "Save", "index": 1}}]});
        assert_eq!(
            parse_steps(&replay).unwrap()[0]
                .locator
                .as_ref()
                .unwrap()
                .index,
            Some(1)
        );
        for bad in [
            json!({"steps": []}),
            json!({"steps": [{"action": "click"}]}),
            json!({"steps": [{"action": "click", "ref": "button"}]}),
            json!({"steps": [{"action": "drag", "ref": "e1"}]}),
            json!({"steps": [{"action": "fill", "ref": "e1"}]}),
            json!({"steps": [{"action": "key", "key": "c", "modifiers": ["Meta"]}]}),
            json!({"steps": [{"action": "scroll", "direction": "sideways"}]}),
            json!({"steps": [{"action": "scroll", "direction": "into_view"}]}),
            json!({"steps": [{"action": "wait_for", "timeoutMs": 50, "text": "x"}]}),
            json!({"steps": [{"action": "click", "ref": "e1", "clickCount": 3}]}),
            json!({"steps": [{"action": "click", "ref": "e1", "script": "alert(1)"}]}),
            json!({"steps": [{"action": "click", "ref": "e1", "locator": {"role": "button", "name": "Save"}}]}),
            json!({"steps": [{"action": "click", "locator": {"role": "", "name": "Save"}}]}),
            json!({"steps": (0..11).map(|_| json!({"action": "key", "key": "Tab"})).collect::<Vec<_>>()}),
        ] {
            assert!(parse_steps(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn form_fields_become_fill_select_and_check_steps() {
        let steps = form_steps(&json!({"fields": [
            {"ref": "e1", "value": "Ada"},
            {"ref": "e2", "value": true},
            {"ref": "e3", "value": false},
            {"ref": "e4", "value": ["Large"]},
            {"ref": "e5", "value": 42}
        ]}))
        .unwrap();
        let actions: Vec<_> = steps.iter().map(|step| step.action.as_str()).collect();
        assert_eq!(actions, ["fill", "check", "uncheck", "select", "fill"]);
        assert_eq!(steps[4].text.as_deref(), Some("42"));
        assert!(form_steps(&json!({"fields": [{"ref": "e1", "value": null}]})).is_err());
        assert!(form_steps(&json!({"fields": [{"value": "x"}]})).is_err());
        assert!(form_steps(&json!({"fields": []})).is_err());
    }
}
