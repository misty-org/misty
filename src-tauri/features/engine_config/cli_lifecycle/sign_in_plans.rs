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

pub(super) fn sign_in_plan(engine: &str, sign_out: bool) -> Result<Plan, String> {
    Ok(match (engine, sign_out) {
        ("claude", false) => runs(&["auth", "login"], Asks::Code),
        ("claude", true) => runs(&["auth", "logout"], Asks::Nothing),
        ("codex", false) => runs(&["login"], Asks::Nothing),
        ("codex", true) => runs(&["logout"], Asks::Nothing),
        ("agy", false) => runs(&["--print", "Reply with just: Signed in"], Asks::Code),
        ("agy", true) => types("/logout"),
        (_, true) => return Err("Sign out from the CLI itself.".into()),
        _ => return Err("Misty can't sign in to that engine.".into()),
    })
}

pub(super) fn remembers_sign_in(engine: &str) -> bool {
    engine == "agy"
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
