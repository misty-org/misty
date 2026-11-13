// Each engine's own sign-in (or sign-out) command, as its CLI offers it, for `sign_in.rs`.
//
// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong). See NOTICE.

use serde::Serialize;

/// What a sign-in starts: the program's arguments, a line typed once its screen is up (an empty
/// one is just Return), and what the person does meanwhile.
#[derive(Debug, PartialEq)]
pub(super) struct Plan {
    pub(super) args: Vec<String>,
    pub(super) then_type: Option<String>,
    pub(super) asks: Asks,
}

/// What the person does while a sign-in runs, for the dialog to ask for it plainly.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Asks {
    /// The CLI opens a page in the browser and waits for the code that page shows to be pasted
    /// back: the dialog has one field for it, and the terminal stays folded away.
    Code,
    /// The CLI opens the provider's page, which asks for a short code the CLI prints (GitHub's
    /// and xAI's device sign-in): the code is under Show details.
    DeviceCode,
    /// The CLI's own screen asks (a menu of ways to sign in, a provider, an account): the person
    /// answers in the terminal.
    Menu,
    /// The CLI finishes on its own, through a page in the browser or nothing at all.
    Nothing,
}

/// What Misty found out before the sign-in starts.
#[derive(Debug, Default)]
pub(super) struct Found {
    /// The CLI's version, for engines whose direct sign-in is newer than an older copy has
    /// (see [`needs_version`]).
    pub(super) version: Option<(u64, u64, u64)>,
    /// Gemini CLI's own settings pick its Google sign-in (see [`google_sign_in_choice`]).
    pub(super) google_chosen: bool,
}

/// `pi auth login <provider>` and `pi auth logout <provider>` (Pi 1.5.1): the browser sign-in,
/// then an exit, with no screen of its own.
const PI_AUTH_COMMANDS: (u64, u64, u64) = (1, 5, 1);
/// `omp login <provider>` (Oh My Pi 18.3.0) opens the browser itself; the older
/// `omp auth-broker login` only prints the address.
const OMP_LOGIN: (u64, u64, u64) = (18, 3, 0);
/// `kimi login --region` (Kimi Code 0.38.0): its device sign-in, page opened with the code in it.
const KIMI_LOGIN: (u64, u64, u64) = (0, 38, 0);
/// `qodercli login` (Qoder CLI 0.2.14): "Starting browser login...", then an exit.
const QODER_LOGIN: (u64, u64, u64) = (0, 2, 14);

/// Engines whose plan depends on the version found (see [`Found::version`]).
pub(super) fn needs_version(engine: &str) -> bool {
    matches!(engine, "pi" | "omp" | "kimi" | "qoder" | "qoder-cn")
}

fn at_least(found: &Found, least: (u64, u64, u64)) -> bool {
    found.version.is_some_and(|version| version >= least)
}

/// The most a pasted code can be; Claude Code's and Antigravity's are a few hundred characters.
const LONGEST_CODE: usize = 2048;

/// A code pasted into the dialog, as typed into the CLI: one line, nothing that would act as a
/// key in its screen. The message never repeats the code.
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

/// The program's own screen, with `line` typed into it once it is up: the person answers there.
fn types(line: impl Into<String>) -> Plan {
    Plan {
        args: Vec::new(),
        then_type: Some(line.into()),
        asks: Asks::Menu,
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

/// Pi's and Oh My Pi's direct sign-in to `id`. GitHub Copilot first asks for an Enterprise
/// domain, which Return leaves at github.com; its page, and xAI's, then ask for the code the CLI
/// prints.
fn provider_sign_in(args: &[&str], id: &str) -> Plan {
    let mut plan = runs(args, Asks::Nothing);
    plan.args.push(id.to_string());
    if id == "github-copilot" {
        plan.then_type = Some(String::new());
    }
    if matches!(id, "github-copilot" | "xai" | "xai-oauth") {
        plan.asks = Asks::DeviceCode;
    }
    plan
}

/// Gemini's one short question: the Google sign-in happens before it, and its answer ends the run.
const GEMINI_QUESTION: &str = "Reply with just: Signed in";

/// Each engine's own sign-in (or sign-out), as its CLI offers it.
pub(super) fn sign_in_plan(
    engine: &str,
    provider: Option<&str>,
    sign_out: bool,
    found: &Found,
) -> Result<Plan, String> {
    let provider = provider_id(provider)?;
    Ok(match (engine, sign_out) {
        // `auth login` waits at "Paste code here if prompted" when its page can't reach it back.
        ("claude", false) => runs(&["auth", "login"], Asks::Code),
        ("claude", true) => runs(&["auth", "logout"], Asks::Nothing),
        // Codex takes its page's answer on a local address.
        ("codex", false) => runs(&["login"], Asks::Nothing),
        ("codex", true) => runs(&["logout"], Asks::Nothing),
        // OpenCode's `auth login` starts with its list of providers.
        ("opencode", false) => runs(&["auth", "login"], Asks::Menu),
        ("opencode", true) => runs(&["auth", "logout"], Asks::Nothing),
        // With Google sign-in chosen in its settings, a headless question signs in first: Gemini
        // asks "Do you want to continue? [Y/n]" before it opens the page, and the "y" answers
        // that, the person having just asked to sign in. Its clean exit says the sign-in finished.
        ("gemini", false) if found.google_chosen => Plan {
            args: vec!["--prompt".into(), GEMINI_QUESTION.into()],
            then_type: Some("y".into()),
            asks: Asks::Nothing,
        },
        // Qwen Code removed `qwen auth`: its Qwen account sign-in checks the plan and sets up its
        // provider inside `/auth`, which its docs say can't be done from outside.
        ("gemini" | "qwen", _) => types("/auth"),
        ("pi", false) => {
            let id = provider.ok_or("Choose a provider to sign in with.")?;
            if at_least(found, PI_AUTH_COMMANDS) {
                provider_sign_in(&["auth", "login"], id)
            } else {
                // Slash commands can't go through argv (Pi would send them to the model).
                types(format!("/login {id}"))
            }
        }
        ("pi", true) => match provider {
            Some(id) if at_least(found, PI_AUTH_COMMANDS) => {
                runs(&["auth", "logout", id], Asks::Nothing)
            }
            // Pi's `/logout` asks which account itself; Misty never chooses for the person.
            _ => types("/logout"),
        },
        ("omp", false) => {
            let id = provider.ok_or("Choose a provider to sign in with.")?;
            if !at_least(found, OMP_LOGIN) {
                // Prints the page's address without opening it.
                runs(&["auth-broker", "login", id], Asks::Menu)
            } else if id == "google-antigravity" {
                // Asks the person to type "yes" to Google's warning first.
                runs(&["login", id], Asks::Menu)
            } else {
                provider_sign_in(&["login"], id)
            }
        }
        ("omp", true) => match provider {
            Some(id) => runs(&["auth-broker", "logout", id], Asks::Nothing),
            None => return Err("Choose the provider to sign out of.".into()),
        },
        // Kimi Code's `kimi login` opens its device page with the code already in it; `--region`
        // picks a kimi.ai (Global) or kimi.com (China) account, and without it the CLI decides.
        ("kimi", false) if at_least(found, KIMI_LOGIN) => match provider {
            Some("global") => runs(&["login", "--region", "global"], Asks::Nothing),
            Some("cn") => runs(&["login", "--region", "mainland-cn"], Asks::Nothing),
            None => runs(&["login"], Asks::Nothing),
            Some(_) => return Err("Choose Global or China.".into()),
        },
        // Qoder CLI's `login` subcommand opens the browser sign-in and exits.
        ("qoder" | "qoder-cn", false) if at_least(found, QODER_LOGIN) => {
            runs(&["login"], Asks::Nothing)
        }
        // CodeBuddy signs in only through `/login` in its own screen, which asks for the site
        // (China, international, an enterprise domain or iOA); older Kimi Code and Qoder CLI too.
        ("codebuddy" | "kimi" | "qoder" | "qoder-cn", false) => types("/login"),
        ("codebuddy" | "kimi" | "qoder" | "qoder-cn", true) => types("/logout"),
        // Grok Build: `grok login` opens xAI's sign-in page and takes its answer on a local
        // address (`--device-auth` prints a code for a remote machine).
        ("grok", false) => runs(&["login"], Asks::Nothing),
        ("grok", true) => runs(&["logout"], Asks::Nothing),
        // MiniMax Code: `mcode login` is a mainland China account, `--region global` a Global
        // one; the person picks, Misty never guesses.
        ("minimax", false) => match provider {
            Some("global") => runs(&["login", "--region", "global"], Asks::Nothing),
            Some("cn") | None => runs(&["login"], Asks::Nothing),
            Some(_) => return Err("Choose Global or China.".into()),
        },
        ("minimax", true) => runs(&["logout"], Asks::Nothing),
        // Antigravity has no login subcommand: its first question to the model signs in (a
        // browser page, then a code pasted back here). One short question signs in and ends,
        // so its clean exit says the sign-in finished. It signs out with `/logout` in its prompt.
        ("agy", false) => runs(&["--print", "Reply with just: Signed in"], Asks::Code),
        ("agy", true) => types("/logout"),
        // Hermes Agent: `hermes model` is its provider wizard (a sign-in or a key, kept in its own
        // files). `hermes auth add <provider>` signs in without choosing the provider and model
        // Hermes runs on, and `hermes setup --portal` still asks for a model in its own picker.
        ("hermes", false) => runs(&["model"], Asks::Menu),
        ("hermes", true) => runs(&["auth", "logout"], Asks::Nothing),
        ("dsh", _) => {
            return Err("DeepSeek Harness keeps its providers in its own web page.".into())
        }
        (_, true) => return Err("Sign out from the CLI itself.".into()),
        _ => return Err("Misty can't sign in to that engine.".into()),
    })
}

/// Engines whose sign-in Misty remembers, having no way to ask the CLI: a sign-in it watched
/// finish, or one the person said they finished in the CLI's own screen. Pi and Oh My Pi say
/// it in their own stores (`engine_cli_signed_in`).
pub(super) fn remembers_sign_in(engine: &str) -> bool {
    matches!(
        engine,
        "agy" | "hermes" | "kimi" | "grok" | "qoder" | "qoder-cn" | "codebuddy" | "minimax"
    )
}

/// Whether the person is signed in to an engine with no status command, as far as Misty can
/// tell, and `None` for an engine with a way of its own. Pi and Oh My Pi count any account or key
/// in their own stores (only which providers hold one is looked at); the others count a sign-in
/// Misty remembered (see [`remembers_sign_in`]).
pub(crate) fn remembered_sign_in(engine: &str) -> Option<(Option<bool>, Option<String>)> {
    if matches!(engine, "pi" | "omp") {
        let stored =
            crate::engines::pi_family_auth::pi_family_auth_list(engine.to_string()).map(|list| {
                !list.oauth_providers.is_empty()
                    || list.providers.iter().any(|item| item.state == "configured")
            });
        return Some((stored.ok(), None));
    }
    remembers_sign_in(engine).then(|| {
        let here = crate::engines::support::settings::signed_in_here(engine);
        (Some(here), None)
    })
}

/// The line the dialog shows for what runs.
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

/// Gemini CLI's `selectedType` for "Login with Google".
const GOOGLE_SIGN_IN: &str = "oauth-personal";

/// What Gemini CLI's `settings.json` says about its sign-in, and what to write so that it picks
/// "Login with Google" the way its own `/auth` menu would. Only the choice is written, never a
/// credential. A file that isn't plain JSON (Gemini allows comments) or already names another way
/// is left as it is, and the sign-in goes through `/auth`.
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
    // Written into the text as it is, so the person's layout and order stay.
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
