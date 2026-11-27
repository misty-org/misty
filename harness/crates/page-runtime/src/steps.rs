use serde_json::{json, Map, Value};

pub const MAX_STEPS: usize = 10;
pub const MAX_FORM_FIELDS: usize = 30;
const MAX_TEXT: usize = 20_000;
pub const MAX_WAIT_MS: u64 = 20_000;

const STEP_FIELDS: [&str; 24] = [
    "action",
    "url",
    "slowly",
    "accept",
    "x",
    "y",
    "to",
    "toX",
    "toY",
    "deltaX",
    "deltaY",
    "ref",
    "locator",
    "text",
    "values",
    "key",
    "modifiers",
    "direction",
    "amount",
    "button",
    "clickCount",
    "submit",
    "textGone",
    "timeoutMs",
];

#[derive(Debug, Clone, PartialEq)]
pub struct Locator {
    pub role: String,
    pub name: String,
    pub index: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Step {
    pub action: String,
    pub reference: Option<String>,
    pub locator: Option<Locator>,
    pub text: Option<String>,
    pub values: Option<Vec<String>>,
    pub key: Option<String>,
    pub modifiers: Option<Vec<String>>,
    pub direction: Option<String>,
    pub amount: Option<f64>,
    pub button: Option<String>,
    pub click_count: Option<u8>,
    pub submit: Option<bool>,
    pub text_gone: Option<String>,
    pub timeout_ms: Option<u64>,
    pub accept: Option<bool>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub to: Option<String>,
    pub to_x: Option<f64>,
    pub to_y: Option<f64>,
    pub delta_x: Option<f64>,
    pub delta_y: Option<f64>,
    pub slowly: Option<bool>,
    pub url: Option<String>,
}

fn present<'a>(object: &'a Map<String, Value>, key: &str) -> Option<&'a Value> {
    object.get(key).filter(|value| !value.is_null())
}

fn text_of(object: &Map<String, Value>, key: &str) -> Result<Option<String>, String> {
    match present(object, key) {
        None => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        Some(_) => Err(format!("`{key}` is text.")),
    }
}

fn texts_of(object: &Map<String, Value>, key: &str) -> Result<Option<Vec<String>>, String> {
    match present(object, key) {
        None => Ok(None),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| item.as_str().map(str::to_owned))
            .collect::<Option<Vec<_>>>()
            .map(Some)
            .ok_or_else(|| format!("`{key}` is a list of text.")),
        Some(_) => Err(format!("`{key}` is a list of text.")),
    }
}

fn whole_of(object: &Map<String, Value>, key: &str, most: u64) -> Result<Option<u64>, String> {
    match present(object, key) {
        None => Ok(None),
        Some(value) => value
            .as_u64()
            .filter(|number| *number <= most)
            .map(Some)
            .ok_or_else(|| format!("`{key}` is a whole number.")),
    }
}

fn locator_of(value: &Value) -> Result<Locator, String> {
    let object = value.as_object().ok_or("A locator is an object.")?;
    if let Some(unknown) = object
        .keys()
        .find(|key| !matches!(key.as_str(), "role" | "name" | "index"))
    {
        return Err(format!("A locator has no field `{unknown}`."));
    }
    Ok(Locator {
        role: text_of(object, "role")?.ok_or("A locator needs a role.")?,
        name: text_of(object, "name")?.ok_or("A locator needs a name.")?,
        index: whole_of(object, "index", u64::from(u32::MAX))?.map(|index| index as u32),
    })
}

fn valid_ref(value: &str) -> bool {
    value.len() >= 2
        && value.len() <= 8
        && value.starts_with('e')
        && value[1..].bytes().all(|byte| byte.is_ascii_digit())
}

impl Step {
    pub fn from_value(value: &Value) -> Result<Step, String> {
        let object = value.as_object().ok_or("A step is an object.")?;
        if let Some(unknown) = object
            .keys()
            .find(|key| !STEP_FIELDS.contains(&key.as_str()))
        {
            return Err(format!("A step has no field `{unknown}`."));
        }
        let number = |key: &str| -> Result<Option<f64>, String> {
            match present(object, key) {
                None => Ok(None),
                Some(value) => value
                    .as_f64()
                    .filter(|number| number.is_finite())
                    .map(Some)
                    .ok_or_else(|| format!("`{key}` is a number.")),
            }
        };
        let amount = number("amount")?;
        let flag = |key: &str| -> Result<Option<bool>, String> {
            match present(object, key) {
                None => Ok(None),
                Some(value) => value
                    .as_bool()
                    .map(Some)
                    .ok_or_else(|| format!("`{key}` is true or false.")),
            }
        };
        let submit = flag("submit")?;
        let accept = flag("accept")?;
        let slowly = flag("slowly")?;
        Ok(Step {
            action: text_of(object, "action")?.ok_or("A step needs an action.")?,
            reference: text_of(object, "ref")?,
            locator: present(object, "locator").map(locator_of).transpose()?,
            text: text_of(object, "text")?,
            values: texts_of(object, "values")?,
            key: text_of(object, "key")?,
            modifiers: texts_of(object, "modifiers")?,
            direction: text_of(object, "direction")?,
            amount,
            button: text_of(object, "button")?,
            click_count: whole_of(object, "clickCount", 255)?.map(|count| count as u8),
            submit,
            text_gone: text_of(object, "textGone")?,
            timeout_ms: whole_of(object, "timeoutMs", u64::MAX)?,
            accept,
            x: number("x")?,
            y: number("y")?,
            to: text_of(object, "to")?,
            to_x: number("toX")?,
            to_y: number("toY")?,
            delta_x: number("deltaX")?,
            delta_y: number("deltaY")?,
            slowly,
            url: text_of(object, "url")?,
        })
    }

    fn needs_ref(&self) -> bool {
        matches!(
            self.action.as_str(),
            "click" | "fill" | "select" | "check" | "uncheck" | "hover" | "drop"
        ) || (self.action == "scroll"
            && self.direction.as_deref() == Some("into_view")
            && self.text.is_none())
    }

    pub fn native_key(&self) -> Value {
        let mut key = json!({"kind": "key", "key": self.key, "modifiers": self.modifiers.clone().unwrap_or_default()});
        match self.action.as_str() {
            "key_down" => key["phase"] = json!("down"),
            "key_up" => key["phase"] = json!("up"),
            _ => {}
        }
        key
    }

    pub fn validate(&self) -> Result<(), String> {
        let action = self.action.as_str();
        if !matches!(
            action,
            "click"
                | "fill"
                | "type"
                | "select"
                | "check"
                | "uncheck"
                | "hover"
                | "key"
                | "scroll"
                | "wait_for"
                | "dialog"
                | "click_at"
                | "move_to"
                | "mouse_down"
                | "mouse_up"
                | "wheel"
                | "drag"
                | "key_down"
                | "key_up"
                | "drop"
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
            "type" if self.text.is_none() => return Err("A type step needs text.".into()),
            "select" => {
                let values = self.values.as_deref().unwrap_or_default();
                if values.is_empty()
                    || values.len() > 50
                    || values.iter().any(|value| value.len() > 500)
                {
                    return Err("A select step needs 1–50 option values.".into());
                }
            }
            "key" | "key_down" | "key_up" => {
                if self.key.is_none() {
                    return Err(format!("A {action} step needs a key."));
                }
                crate::native::validate_page_key(&self.native_key())
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
            "dialog" if self.accept.is_none() => {
                return Err("A dialog step says whether to accept the next dialog.".into());
            }
            "click_at" | "move_to" if self.x.is_none() || self.y.is_none() => {
                return Err(format!(
                    "A {action} step needs x and y, in CSS pixels of the view."
                ));
            }
            "mouse_down" | "mouse_up" if self.x.is_some() != self.y.is_some() => {
                return Err(format!("A {action} step takes both x and y, or neither."));
            }
            "wheel" if self.delta_x.is_none() && self.delta_y.is_none() => {
                return Err("A wheel step needs deltaX or deltaY, in pixels.".into());
            }
            "wheel"
                if self
                    .delta_x
                    .into_iter()
                    .chain(self.delta_y)
                    .any(|delta| delta.abs() > 5000.0) =>
            {
                return Err("A wheel step moves at most 5000 pixels.".into());
            }
            "drag" => {
                let by_ref = self.reference.is_some() && self.to.as_deref().is_some_and(valid_ref);
                let by_point = self.x.is_some()
                    && self.y.is_some()
                    && self.to_x.is_some()
                    && self.to_y.is_some();
                if by_ref == by_point {
                    return Err(
                        "A drag goes from ref to the ref in to, or from x and y to toX and toY."
                            .into(),
                    );
                }
            }
            "drop" => {
                if self.text.is_none() && self.url.is_none() {
                    return Err("A drop step drops text, a url or both.".into());
                }
                if self.url.as_deref().is_some_and(|url| {
                    url.len() > 4000 || !(url.starts_with("https://") || url.starts_with("http://"))
                }) {
                    return Err("A drop step's url is an http or https address.".into());
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

pub fn steps_of(raw: &Value, most: usize) -> Result<Vec<Step>, String> {
    let items = raw.as_array().ok_or("Steps are a list.")?;
    if items.is_empty() || items.len() > most {
        return Err(format!("Send 1–{most} steps."));
    }
    let mut steps = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let step = Step::from_value(item)
            .and_then(|step| step.validate().map(|()| step))
            .map_err(|error| format!("Step {}: {error}", index + 1))?;
        steps.push(step);
    }
    Ok(steps)
}

pub fn parse_steps(input: &Value) -> Result<Vec<Step>, String> {
    steps_of(input.get("steps").unwrap_or(&Value::Null), MAX_STEPS)
}

pub fn form_steps(input: &Value) -> Result<Vec<Step>, String> {
    let fields = input
        .get("fields")
        .and_then(Value::as_array)
        .filter(|fields| !fields.is_empty() && fields.len() <= MAX_FORM_FIELDS)
        .ok_or_else(|| format!("Send 1–{MAX_FORM_FIELDS} fields."))?;
    let mut steps = Vec::with_capacity(fields.len() + 1);
    for (index, field) in fields.iter().enumerate() {
        let mut step = Step {
            reference: field.get("ref").and_then(Value::as_str).map(str::to_owned),
            ..Step::default()
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
mod tests;
