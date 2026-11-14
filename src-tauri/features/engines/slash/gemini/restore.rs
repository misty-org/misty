//! Gemini CLI's `/restore`, and turning its checkpointing on.

use super::*;

const RESTORE_TITLE: &str = "Gemini CLI checkpoints";

/// `/restore` needs Gemini CLI's checkpointing (`general.checkpointing.enabled`), which no flag
/// turns on for one run: off, it saves no checkpoints and its ACP `/restore` has nothing to
/// restore. On, the command goes to the turn, where Gemini runs it; off, `/restore enable` turns
/// it on in the user's settings (the confirmation is the composer's).
pub(super) fn restore(folder: Option<&Path>, args: &str) -> Result<Output, String> {
    let (enabled, set_in) = checkpointing(folder);
    let blocked_by = set_in
        .as_ref()
        .filter(|(label, _)| !enabled && *label != "User");
    if args.eq_ignore_ascii_case("enable") {
        if enabled {
            return Ok(Output::done("Gemini CLI's checkpointing is already on"));
        }
        if let Some((label, path)) = blocked_by {
            return Ok(restore_off(format!(
                "The {} settings ({}) turn checkpointing off, and they win over yours, so Misty \
                 left them alone. Set `general.checkpointing.enabled` to true there to use \
                 /restore.",
                label.to_lowercase(),
                display_path(path)
            )));
        }
        let path = user_settings_path().ok_or("No home folder for Gemini CLI's settings.")?;
        enable_checkpointing(&path)?;
        return Ok(Output::done(format!(
            "Checkpointing is on in {}. Gemini CLI saves a checkpoint before each file change \
             from the next message, and /restore lists them",
            display_path(&path)
        )));
    }
    if enabled {
        return Ok(Output::send(format!("/restore {args}").trim_end()));
    }
    Ok(restore_off(match blocked_by {
        Some((label, path)) => format!(
            "Gemini CLI saves checkpoints only with checkpointing on, and the {} settings ({}) \
             turn it off (`general.checkpointing.enabled`), so there is nothing to restore. \
             Change it there to use /restore.",
            label.to_lowercase(),
            display_path(path)
        ),
        None => format!(
            "Gemini CLI saves checkpoints only with checkpointing on \
             (`general.checkpointing.enabled`), and no flag turns it on for one run, so there is \
             nothing to restore. Type /restore enable to turn it on in {}; checkpoints are saved \
             before file changes from then on.",
            user_settings_path()
                .as_deref()
                .map(display_path)
                .unwrap_or_else(|| "~/.gemini/settings.json".to_string())
        ),
    }))
}

fn restore_off(text: String) -> Output {
    Output::info(
        RESTORE_TITLE,
        vec![Section {
            rows: vec![row("Checkpointing", "Off")],
            text: Some(text),
            ..Default::default()
        }],
    )
}

/// Whether checkpointing is on, and the settings that say so: the system settings win over a
/// trusted project's, which win over the user's, as Gemini CLI merges them. Off when none does.
/// The settings' older flat `checkpointing.enabled` counts too.
fn checkpointing(folder: Option<&Path>) -> (bool, Option<(&'static str, PathBuf)>) {
    let mut layers = Vec::new();
    if let Some(path) = adapter::system_settings_path() {
        layers.push(("System", path));
    }
    if let Some(folder) = folder.filter(|folder| adapter::workspace_trusted(folder)) {
        layers.push(("Project", folder.join(".gemini").join("settings.json")));
    }
    if let Some(path) = user_settings_path() {
        layers.push(("User", path));
    }
    for (label, path) in layers {
        let Some(settings) = files::read_json(&path) else {
            continue;
        };
        let enabled = settings
            .pointer("/general/checkpointing/enabled")
            .or_else(|| settings.pointer("/checkpointing/enabled"))
            .and_then(Value::as_bool);
        if let Some(enabled) = enabled {
            return (enabled, Some((label, path)));
        }
    }
    (false, None)
}

/// Sets `general.checkpointing.enabled` to true in the settings at `path`, creating the file
/// when there is none.
fn enable_checkpointing(path: &Path) -> Result<(), String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("Gemini CLI's settings couldn't be read: {error}")),
    };
    let written = with_checkpointing(&text).ok_or(
        "Gemini CLI's settings.json isn't JSON Misty can change, so nothing was changed. Set \
         `general.checkpointing.enabled` to true there.",
    )?;
    crate::engine_config::support::atomic_write(path, &written)
}

/// `text` with `general.checkpointing.enabled` set to true. Only that is written into the text,
/// so the rest of the file (its order, layout and comments) stays as the person left it. None
/// when the file isn't a JSON object, or a level on the way isn't an object.
pub(super) fn with_checkpointing(text: &str) -> Option<String> {
    const PATH: [&str; 3] = ["general", "checkpointing", "enabled"];
    if text.trim().is_empty() {
        return Some(
            "{\n  \"general\": {\n    \"checkpointing\": {\n      \"enabled\": true\n    }\n  }\n}\n"
                .to_string(),
        );
    }
    let parsed: Value = serde_json::from_str(&files::strip_json_comments(text)).ok()?;
    let mut object = &parsed;
    let mut open = json_text::skip_blank(text, 0);
    if text.as_bytes().get(open) != Some(&b'{') {
        return None;
    }
    let mut written = None;
    for (depth, key) in PATH.iter().enumerate() {
        match json_text::member(text, open, key) {
            Some((start, end)) if depth == PATH.len() - 1 => {
                written = Some(format!("{}true{}", &text[..start], &text[end..]));
            }
            Some((start, _)) if text.as_bytes()[start] == b'{' => {
                open = start;
                object = object.get(key)?;
                continue;
            }
            Some(_) => return None,
            None => {
                let rest = &PATH[depth..];
                let mut entry = "true".to_string();
                for key in rest[1..].iter().rev() {
                    entry = format!("{{ \"{key}\": {entry} }}");
                }
                let empty = object.as_object().is_some_and(serde_json::Map::is_empty);
                written = Some(format!(
                    "{}\n  \"{}\": {entry}{}{}",
                    &text[..open + 1],
                    rest[0],
                    if empty { "\n" } else { "," },
                    &text[open + 1..]
                ));
            }
        }
        break;
    }
    let written = written?;
    let checks =
        serde_json::from_str::<Value>(&files::strip_json_comments(&written)).is_ok_and(|value| {
            value.pointer("/general/checkpointing/enabled") == Some(&Value::Bool(true))
        });
    checks.then_some(written)
}

/// Finding a member's value in JSON text that may carry comments, to change it in place.
mod json_text {
    /// The first byte at or after `at` that isn't whitespace or a comment.
    pub fn skip_blank(text: &str, mut at: usize) -> usize {
        let bytes = text.as_bytes();
        loop {
            while bytes.get(at).is_some_and(u8::is_ascii_whitespace) {
                at += 1;
            }
            let rest = bytes.get(at..).unwrap_or_default();
            if rest.starts_with(b"//") {
                at = text[at..].find('\n').map_or(bytes.len(), |end| at + end);
            } else if rest.starts_with(b"/*") {
                at = text[at + 2..]
                    .find("*/")
                    .map_or(bytes.len(), |end| at + 2 + end + 2);
            } else {
                return at;
            }
        }
    }

    /// Just past the string that opens at `at`.
    fn skip_string(bytes: &[u8], at: usize) -> Option<usize> {
        let mut i = at + 1;
        while i < bytes.len() {
            match bytes[i] {
                b'\\' => i += 2,
                b'"' => return Some(i + 1),
                _ => i += 1,
            }
        }
        None
    }

    /// Just past the value that starts at `at`.
    fn skip_value(text: &str, at: usize) -> Option<usize> {
        let bytes = text.as_bytes();
        match *bytes.get(at)? {
            b'"' => skip_string(bytes, at),
            b'{' | b'[' => {
                let mut depth = 0usize;
                let mut i = at;
                loop {
                    i = skip_blank(text, i);
                    match *bytes.get(i)? {
                        b'"' => {
                            i = skip_string(bytes, i)?;
                            continue;
                        }
                        b'{' | b'[' => depth += 1,
                        b'}' | b']' => {
                            depth -= 1;
                            if depth == 0 {
                                return Some(i + 1);
                            }
                        }
                        _ => {}
                    }
                    i += 1;
                }
            }
            _ => {
                let mut i = at;
                while bytes
                    .get(i)
                    .is_some_and(|b| !b.is_ascii_whitespace() && !b",}]/".contains(b))
                {
                    i += 1;
                }
                Some(i)
            }
        }
    }

    /// Where `key`'s value starts and ends in the object whose `{` is at `open`, when it has
    /// that key.
    pub fn member(text: &str, open: usize, key: &str) -> Option<(usize, usize)> {
        let bytes = text.as_bytes();
        let mut at = skip_blank(text, open + 1);
        while *bytes.get(at)? == b'"' {
            let end = skip_string(bytes, at)?;
            let name: String = serde_json::from_str(&text[at..end]).ok()?;
            let colon = skip_blank(text, end);
            if *bytes.get(colon)? != b':' {
                return None;
            }
            let start = skip_blank(text, colon + 1);
            let stop = skip_value(text, start)?;
            if name == key {
                return Some((start, stop));
            }
            at = skip_blank(text, stop);
            if *bytes.get(at)? == b',' {
                at = skip_blank(text, at + 1);
            }
        }
        None
    }
}
