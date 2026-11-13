// Each engine's own sign-in (or sign-out) command, as its CLI offers it, for `sign_in.rs`.
//
// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong). See NOTICE.

/// What a sign-in starts: the program's arguments, and a command typed once its screen is up.
#[derive(Debug, PartialEq)]
pub(super) struct Plan {
    pub(super) args: Vec<String>,
    pub(super) then_type: Option<String>,
}

pub(super) fn plan(args: &[&str], then_type: Option<String>) -> Plan {
    Plan {
        args: args.iter().map(|arg| (*arg).to_string()).collect(),
        then_type,
    }
}

/// A provider id as Pi and Oh My Pi name them (`anthropic`, `openai-codex`): typed into the CLI,
/// so nothing but those characters.
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

/// Each engine's own sign-in (or sign-out), as its CLI offers it.
pub(super) fn sign_in_plan(
    engine: &str,
    provider: Option<&str>,
    sign_out: bool,
) -> Result<Plan, String> {
    let provider = provider_id(provider)?;
    Ok(match (engine, sign_out) {
        ("claude", false) => plan(&["auth", "login"], None),
        ("claude", true) => plan(&["auth", "logout"], None),
        ("codex", false) => plan(&["login"], None),
        ("codex", true) => plan(&["logout"], None),
        ("opencode", false) => plan(&["auth", "login"], None),
        ("opencode", true) => plan(&["auth", "logout"], None),
        // Their own "Login with Google" (or a key) is the auth dialog of their screen.
        ("gemini" | "qwen", _) => plan(&[], Some("/auth".into())),
        // Slash commands can't go through argv (Pi would send them to the model as a prompt).
        ("pi", false) => plan(
            &[],
            Some(match provider {
                Some(id) => format!("/login {id}"),
                None => "/login".into(),
            }),
        ),
        // Pi's `/logout` asks which account itself; Misty never chooses for the person.
        ("pi", true) => plan(&[], Some("/logout".into())),
        ("omp", false) => match provider {
            Some(id) => plan(&["auth-broker", "login", id], None),
            None => plan(&[], Some("/login".into())),
        },
        ("omp", true) => match provider {
            Some(id) => plan(&["auth-broker", "logout", id], None),
            None => return Err("Choose the provider to sign out of.".into()),
        },
        // Kimi Code and Qoder CLI sign in and out only through slash commands in their own
        // screen (no `login` subcommand; Qoder's `/signin` is an alias). Checked against their
        // docs (moonshotai.github.io/kimi-code, docs.qoder.com/cli/auth); ccgui has no sign-in
        // for either.
        ("codebuddy" | "kimi" | "qoder" | "qoder-cn", false) => plan(&[], Some("/login".into())),
        ("codebuddy" | "kimi" | "qoder" | "qoder-cn", true) => plan(&[], Some("/logout".into())),
        // Grok Build: `grok login` opens xAI's sign-in page (`--device-auth` prints a code for a
        // remote machine, which the person can run in the terminal themselves).
        ("grok", false) => plan(&["login"], None),
        ("grok", true) => plan(&["logout"], None),
        // MiniMax Code: `mcode login` is a mainland China account, `--region global` a Global
        // one; the person picks, Misty never guesses.
        ("minimax", false) => match provider {
            Some("global") => plan(&["login", "--region", "global"], None),
            Some("cn") | None => plan(&["login"], None),
            Some(_) => return Err("Choose Global or China.".into()),
        },
        ("minimax", true) => plan(&["logout"], None),
        // Antigravity has no login subcommand: its first question to the model signs in (a
        // browser page, then a code pasted back here). One short question signs in and ends,
        // so its clean exit says the sign-in finished. It signs out with `/logout` in its prompt.
        ("agy", false) => plan(&["--print", "Reply with just: Signed in"], None),
        ("agy", true) => plan(&[], Some("/logout".into())),
        ("dsh", _) => {
            return Err("DeepSeek Harness keeps its providers in its own web page.".into())
        }
        (_, true) => return Err("Sign out from the CLI itself.".into()),
        _ => return Err("Misty can't sign in to that engine.".into()),
    })
}

/// Engines whose sign-in Misty remembers, having no way to ask the CLI (see `agy_sign_in`).
pub(super) fn remembers_sign_in(engine: &str) -> bool {
    engine == "agy"
}

/// The line the dialog shows for what runs.
pub(super) fn shown_command(program: &str, plan: &Plan) -> String {
    let mut line = std::iter::once(program.to_string())
        .chain(plan.args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ");
    if let Some(typed) = &plan.then_type {
        line.push_str(", then ");
        line.push_str(typed);
    }
    line
}
