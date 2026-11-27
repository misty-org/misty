use serde_json::Value;

const COMMAND_MODIFIERS: &[&str] = if cfg!(target_os = "macos") {
    &["Meta"]
} else {
    &["Meta", "Control"]
};

fn modifiers_valid(input: &Value) -> bool {
    input.get("modifiers").is_none_or(|value| {
        value.as_array().is_some_and(|mods| {
            mods.len() <= 4
                && mods
                    .iter()
                    .all(|v| matches!(v.as_str(), Some("Shift" | "Control" | "Alt" | "Meta")))
        })
    })
}

pub fn validate_native_input(input: &Value) -> Result<(), String> {
    check(input, false)
}

pub fn validate_page_key(input: &Value) -> Result<(), String> {
    check(input, true)
}

pub fn window_shortcut(input: &Value) -> bool {
    check(input, true).is_ok() && check(input, false).is_err()
}

fn check(input: &Value, shortcuts: bool) -> Result<(), String> {
    let point = |key: &str| {
        input[key]
            .as_f64()
            .is_some_and(|v| v.is_finite() && (0.0..=1.0).contains(&v))
    };
    let valid = match input["kind"].as_str().unwrap_or("") {
        "click" => {
            point("x")
                && point("y")
                && input
                    .get("button")
                    .is_none_or(|v| matches!(v.as_str(), Some("left" | "right")))
                && input
                    .get("clickCount")
                    .is_none_or(|v| matches!(v.as_u64(), Some(1 | 2)))
                && modifiers_valid(input)
        }
        "move" => point("x") && point("y"),
        "down" | "up" => {
            point("x")
                && point("y")
                && input
                    .get("button")
                    .is_none_or(|v| matches!(v.as_str(), Some("left" | "right")))
                && modifiers_valid(input)
        }
        "drag" => ["fromX", "fromY", "toX", "toY"]
            .iter()
            .all(|key| point(key)),
        "scroll" => {
            point("x")
                && point("y")
                && ["deltaX", "deltaY"].iter().all(|key| {
                    input[*key]
                        .as_i64()
                        .is_some_and(|v| (-2000..=2000).contains(&v))
                })
        }
        "type" => input["text"]
            .as_str()
            .is_some_and(|text| text.len() <= 16000 && !text.contains('\0')),
        "key" => {
            input["key"].as_str().is_some_and(|key| {
                matches!(
                    key,
                    "Enter"
                        | "Escape"
                        | "Tab"
                        | "Backspace"
                        | "Delete"
                        | "ArrowLeft"
                        | "ArrowRight"
                        | "ArrowUp"
                        | "ArrowDown"
                        | "Home"
                        | "End"
                        | "PageUp"
                        | "PageDown"
                        | "Space"
                        | "Insert"
                        | "F1"
                        | "F2"
                        | "F3"
                        | "F4"
                        | "F5"
                        | "F6"
                        | "F7"
                        | "F8"
                        | "F9"
                        | "F10"
                        | "F11"
                        | "F12"
                ) || (key.len() == 1 && key.as_bytes()[0].is_ascii_graphic())
            }) && modifiers_valid(input)
                && input
                    .get("phase")
                    .is_none_or(|phase| matches!(phase.as_str(), Some("down" | "up")))
        }
        _ => false,
    };
    let is_command = |v: &Value| v.as_str().is_some_and(|m| COMMAND_MODIFIERS.contains(&m));
    let safe_shortcut = shortcuts
        || input["kind"] != "key"
        || !input["modifiers"]
            .as_array()
            .is_some_and(|mods| mods.iter().any(is_command))
        || (matches!(
            input["key"]
                .as_str()
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("a" | "z")
        ) && input["modifiers"]
            .as_array()
            .is_some_and(|mods| mods.iter().all(|v| is_command(v) || v == "Shift")));
    if valid && safe_shortcut {
        Ok(())
    } else {
        Err("Invalid native browser input".into())
    }
}
