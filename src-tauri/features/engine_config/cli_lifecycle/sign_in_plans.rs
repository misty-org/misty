// Each engine's own sign-in (or sign-out) command, as its CLI offers it, for `sign_in.rs`.
//
// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong). See NOTICE.

use serde::Serialize;

#[derive(Debug, PartialEq)]
pub(super) struct Plan {
    pub(super) args: Vec<String>,
    pub(super) then_type: Option<String>,
    pub(super) asks: Asks,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Asks {
    Code,
    Menu,
    Nothing,
}

#[derive(Debug, Default)]
pub(super) struct Found {
    pub(super) version: Option<(u64, u64, u64)>,
    pub(super) google_chosen: bool,
}

const KIMI_LOGIN: (u64, u64, u64) = (0, 38, 0);
const QODER_LOGIN: (u64, u64, u64) = (0, 2, 14);

pub(super) fn needs_version(engine: &str) -> bool {
    matches!(engine, "kimi" | "qoder" | "qoder-cn")
}

fn at_least(found: &Found, least: (u64, u64, u64)) -> bool {
    found.version.is_some_and(|version| version >= least)
}

const LONGEST_CODE: usize = 2048;

pub(super) fn pasted_code(code: &str) -> Result<&str, String> {
    let code = code.trim();
    if code.is_empty() {
        return Err("Paste the code first.".into());
    }
    if code.len() > LONGEST_CODE {
        return Err("That's longer than a sign-in code. Copy just the code.".into());
    }
    if code.chars().any(char::is_control) {
        return Err("Paste just the code, on one line.".into());
    }
    Ok(code)
}

fn runs(args: &[&str], asks: Asks) -> Plan {
    Plan {
        args: args.iter().map(|arg| (*arg).to_string()).collect(),
        then_type: None,
        asks,
    }
}

fn types(line: impl Into<String>) -> Plan {
    Plan {
        args: Vec::new(),
        then_type: Some(line.into()),
        asks: Asks::Menu,
    }
}

pub(super) fn provider_id(provider: Option<&str>) -> Result<Option<&str>, String> {
    match provider.map(str::trim).filter(|id| !id.is_empty()) {
        None => Ok(None),
        Some(id)
            if id.len() <= 64
                && id
                    .chars()
                    .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-') =>
        {
            Ok(Some(id))
        }
        Some(_) => Err("That isn't a provider.".into()),
    }
}

const GEMINI_QUESTION: &str = "Reply with just: Signed in";

pub(super) fn sign_in_plan(
    engine: &str,
    provider: Option<&str>,
    sign_out: bool,
    found: &Found,
) -> Result<Plan, String> {
    let provider = provider_id(provider)?;
    Ok(match (engine, sign_out) {
        ("claude", false) => runs(&["auth", "login"], Asks::Code),
        ("claude", true) => runs(&["auth", "logout"], Asks::Nothing),
        ("codex", false) => runs(&["login"], Asks::Nothing),
        ("codex", true) => runs(&["logout"], Asks::Nothing),
        ("gemini", false) if found.google_chosen => Plan {
            args: vec!["--prompt".into(), GEMINI_QUESTION.into()],
            then_type: Some("y".into()),
            asks: Asks::Nothing,
        },
        ("gemini" | "qwen", _) => types("/auth"),
        ("kimi", false) if at_least(found, KIMI_LOGIN) => match provider {
            Some("global") => runs(&["login", "--region", "global"], Asks::Nothing),
            Some("cn") => runs(&["login", "--region", "mainland-cn"], Asks::Nothing),
            None => runs(&["login"], Asks::Nothing),
            Some(_) => return Err("Choose Global or China.".into()),
        },
        ("qoder" | "qoder-cn", false) if at_least(found, QODER_LOGIN) => {
            runs(&["login"], Asks::Nothing)
        }
        ("kimi" | "qoder" | "qoder-cn", false) => types("/login"),
        ("kimi" | "qoder" | "qoder-cn", true) => types("/logout"),
        ("grok", false) => runs(&["login"], Asks::Nothing),
        ("grok", true) => runs(&["logout"], Asks::Nothing),
        ("minimax", false) => match provider {
            Some("global") => runs(&["login", "--region", "global"], Asks::Nothing),
            Some("cn") | None => runs(&["login"], Asks::Nothing),
            Some(_) => return Err("Choose Global or China.".into()),
        },
        ("minimax", true) => runs(&["logout"], Asks::Nothing),
        ("agy", false) => runs(&["--print", "Reply with just: Signed in"], Asks::Code),
        ("agy", true) => types("/logout"),
        ("hermes", false) => runs(&["model"], Asks::Menu),
        ("hermes", true) => runs(&["auth", "logout"], Asks::Nothing),
        (_, true) => return Err("Sign out from the CLI itself.".into()),
        _ => return Err("Misty can't sign in to that engine.".into()),
    })
}

pub(super) fn remembers_sign_in(engine: &str) -> bool {
    matches!(engine, "agy" | "hermes" | "kimi" | "minimax")
}

pub(crate) fn remembered_sign_in(engine: &str) -> Option<(Option<bool>, Option<String>)> {
    remembers_sign_in(engine).then(|| {
        let here = crate::engines::support::settings::signed_in_here(engine);
        (Some(here), None)
    })
}

pub(super) fn shown_command(program: &str, plan: &Plan) -> String {
    let mut line = std::iter::once(program.to_string())
        .chain(plan.args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ");
    if let Some(typed) = plan
        .then_type
        .as_deref()
        .filter(|typed| typed.starts_with('/'))
    {
        line.push_str(", then ");
        line.push_str(typed);
    }
    line
}

const GOOGLE_SIGN_IN: &str = "oauth-personal";

#[derive(Debug, PartialEq)]
pub(super) enum GoogleChoice {
    Chosen,
    Write(String),
    Leave,
}

pub(super) fn google_sign_in_choice(settings: Option<&str>) -> GoogleChoice {
    let text = settings.unwrap_or("").trim();
    let fresh = "{\n  \"security\": {\n    \"auth\": {\n      \"selectedType\": \"oauth-personal\"\n    }\n  }\n}\n";
    if text.is_empty() {
        return GoogleChoice::Write(fresh.to_string());
    }
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(text) else {
        return GoogleChoice::Leave;
    };
    let value = serde_json::Value::Object(map);
    let selected = value
        .pointer("/security/auth/selectedType")
        .or_else(|| value.get("selectedAuthType"));
    match selected {
        Some(serde_json::Value::String(kind)) if kind == GOOGLE_SIGN_IN => {
            return GoogleChoice::Chosen
        }
        Some(serde_json::Value::String(kind)) if !kind.is_empty() => return GoogleChoice::Leave,
        _ => {}
    }
    if value.get("security").is_some() {
        return GoogleChoice::Leave;
    }
    let empty = value.as_object().is_some_and(serde_json::Map::is_empty);
    let open = text.find('{').unwrap_or(0) + 1;
    let entry = format!(
        "\n  \"security\": {{ \"auth\": {{ \"selectedType\": \"{GOOGLE_SIGN_IN}\" }} }}{}",
        if empty { "\n" } else { "," }
    );
    let written = format!("{}{entry}{}\n", &text[..open], &text[open..]);
    let checks = serde_json::from_str::<serde_json::Value>(&written).is_ok_and(|parsed| {
        parsed.pointer("/security/auth/selectedType") == Some(&GOOGLE_SIGN_IN.into())
    });
    if checks {
        GoogleChoice::Write(written)
    } else {
        GoogleChoice::Leave
    }
}
