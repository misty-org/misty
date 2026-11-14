//! Gemini CLI's commands that read or open what its terminal app would.

use super::*;

// ==================== Gemini CLI ====================

pub(super) const DOCS_URL: &str = "https://goo.gle/gemini-cli-docs";
/// Gemini CLI's own `/upgrade` page (`UPGRADE_URL_PAGE`).
const UPGRADE_URL: &str = "https://goo.gle/set-up-gemini-code-assist";
/// Gemini CLI's `/bug` page, filled the way its `{title}`, `{info}` and `{problem}` slots are.
const BUG_URL: &str = "https://github.com/google-gemini/gemini-cli/issues/new?template=bug_report.yml&title={title}&info={info}&problem={problem}";

/// What JavaScript's `encodeURIComponent` leaves as it is.
const URI_COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'_')
    .remove(b'.')
    .remove(b'!')
    .remove(b'~')
    .remove(b'*')
    .remove(b'\'')
    .remove(b'(')
    .remove(b')');

pub(super) fn encode_component(text: &str) -> String {
    utf8_percent_encode(text, URI_COMPONENT).to_string()
}

/// `~/.gemini/settings.json`.
pub(super) fn user_settings_path() -> Option<PathBuf> {
    adapter::gemini_dir().map(|dir| dir.join("settings.json"))
}

fn user_setting(pointer: &str) -> Option<Value> {
    files::read_json(&user_settings_path()?)?
        .pointer(pointer)
        .cloned()
}

/// The sign-in Gemini CLI uses (`security.auth.selectedType`): `oauth-personal`,
/// `gemini-api-key`, `vertex-ai`, …
fn auth_type() -> Option<String> {
    user_setting("/security/auth/selectedType")?
        .as_str()
        .map(str::to_string)
}

/// `/commands`: the custom commands from `.toml` files, user and project.
pub(super) fn custom_commands(folder: Option<&Path>) -> Output {
    let commands = adapter::custom_commands(folder);
    let mut sections = Vec::new();
    for scope in ["User", "Project"] {
        let rows: Vec<Row> = commands
            .iter()
            .filter(|command| command.scope == scope)
            .map(|command| row(format!("/{}", command.name), command.description.clone()))
            .collect();
        if rows.is_empty() {
            continue;
        }
        let dir = commands
            .iter()
            .find(|command| command.scope == scope)
            .and_then(|command| commands_dir(&command.path))
            .map(|dir| display_path(&dir))
            .unwrap_or_default();
        sections.push(Section {
            heading: Some(format!("{scope} · {dir}")),
            rows,
            text: None,
        });
    }
    let mut empty = "No custom commands. Gemini CLI reads `.toml` files from `~/.gemini/commands` and the project's `.gemini/commands`.".to_string();
    if let Some(folder) = folder.filter(|folder| !adapter::workspace_trusted(folder)) {
        if folder.join(".gemini").join("commands").is_dir() {
            empty.push_str(" This folder isn't trusted, so its own commands don't load.");
        }
    }
    files::info_or("Gemini CLI custom commands", sections, empty)
}

/// The `commands` folder a command file sits in.
fn commands_dir(path: &Path) -> Option<PathBuf> {
    path.ancestors()
        .find(|dir| dir.file_name().is_some_and(|name| name == "commands"))
        .map(Path::to_path_buf)
}
/// `/bug`: Gemini CLI's issue form, with the description as its title and this computer's
/// system in the info field; `advanced.bugCommand.urlTemplate` replaces the form, as in the CLI.
pub(super) fn bug(description: &str) -> Output {
    let template = user_setting("/advanced/bugCommand/urlTemplate")
        .and_then(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| BUG_URL.to_string());
    let info = format!(
        "* **Operating System:** {} {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    let url = template
        .replace("{title}", &encode_component(description))
        .replace("{info}", &encode_component(&info))
        .replace("{problem}", "");
    Output::open(format!("url:{url}"))
}

/// The privacy notice for the way Gemini CLI signs in: the Gemini API terms for an API key
/// (and for no choice, which its ACP mode treats as one), Google Cloud's service terms for
/// Vertex AI, Gemini Code Assist's privacy notices for a Google account.
pub(super) fn privacy_url() -> &'static str {
    match auth_type().as_deref() {
        Some("vertex-ai") => "https://cloud.google.com/terms/service-terms",
        Some("oauth-personal") | Some("compute-default-credentials") => {
            "https://developers.google.com/gemini-code-assist/resources/privacy-notices"
        }
        _ => "https://ai.google.dev/gemini-api/terms",
    }
}

/// `/upgrade`, which Gemini CLI offers only to a Google account sign-in.
pub(super) fn upgrade() -> Output {
    match auth_type().as_deref() {
        Some("oauth-personal") => Output::open(format!("url:{UPGRADE_URL}")),
        _ => Output::done("The /upgrade command is only available when logged in with Google."),
    }
}

/// `/permissions` alone opens Misty's mode picker, as for every engine; `/permissions trust
/// [dir]` shows what Gemini CLI's folder trust says about a folder, and every rule it keeps.
pub(super) fn permissions(folder: Option<&Path>, args: &str) -> Result<Output, String> {
    let (sub, rest) = args.split_once(char::is_whitespace).unwrap_or((args, ""));
    match sub {
        "" => Ok(Output::open("picker:mode")),
        "trust" => trust(folder, rest.trim()),
        _ => Err(format!(
            "Gemini CLI's /permissions has no `{sub}`. Use trust [<directory-path>]."
        )),
    }
}

fn trust(folder: Option<&Path>, dir: &str) -> Result<Output, String> {
    let target = match dir {
        "" => folder
            .map(Path::to_path_buf)
            .ok_or("This chat has no folder. Give one: /permissions trust <directory-path>")?,
        dir => resolve_dir(folder, dir),
    };
    if !target.is_dir() {
        return Err(format!("Path is not a directory: {}", target.display()));
    }
    // Shown, and judged, as the folder it is (`..` and links resolved), as the CLI judges it.
    let target = std::fs::canonicalize(&target).unwrap_or(target);
    let state = match adapter::trust_of(&target) {
        Some(true) => "Trusted",
        Some(false) => "Not trusted",
        None => "No rule (Gemini CLI asks, and treats it as untrusted until then)",
    };
    let mut sections = vec![Section {
        heading: Some(display_path(&target)),
        rows: vec![row("Trust", state)],
        text: None,
    }];
    let rules: Vec<Row> = adapter::trust_rules()
        .into_iter()
        .map(|(path, level)| row(display_rule_path(&path), level))
        .collect();
    let file = adapter::trusted_folders_path()
        .map(|path| display_path(&path))
        .unwrap_or_default();
    sections.push(Section {
        heading: Some(format!("Rules · {file}")),
        text: rules.is_empty().then(|| "No trust rules yet.".to_string()),
        rows: rules,
    });
    Ok(Output::info("Gemini CLI folder trust", sections))
}

/// A folder in `trustedFolders.json` with the home folder as `~`. On macOS and Windows Gemini
/// CLI writes the paths there in lower case (`/users/…`), so the home folder matches without
/// case there.
fn display_rule_path(rule: &str) -> String {
    let shown = display_path(Path::new(rule));
    if shown != rule || !cfg!(any(target_os = "macos", windows)) {
        return shown;
    }
    let Some(home) = files::home() else {
        return shown;
    };
    let home = home.to_string_lossy().into_owned();
    match rule.get(..home.len()) {
        Some(head) if head.eq_ignore_ascii_case(&home) => {
            let rest = &rule[home.len()..];
            if rest.is_empty() {
                "~".to_string()
            } else if rest.starts_with(std::path::MAIN_SEPARATOR) {
                format!("~{rest}")
            } else {
                shown
            }
        }
        _ => shown,
    }
}

/// A folder the person typed: `~` for home, relative to the chat's folder.
fn resolve_dir(folder: Option<&Path>, dir: &str) -> PathBuf {
    if let Some(rest) = dir
        .strip_prefix("~/")
        .or_else(|| (dir == "~").then_some(""))
    {
        if let Some(home) = files::home() {
            return home.join(rest);
        }
    }
    let path = PathBuf::from(dir);
    match folder {
        Some(folder) if path.is_relative() => folder.join(path),
        _ => path,
    }
}

/// `/hooks`: the hooks in Gemini CLI's system, user and project settings, and the switches
/// in `hooksConfig` that stop some or all of them.
pub(super) fn hooks(folder: Option<&Path>) -> Output {
    let mut layers = Vec::new();
    if let Some(path) = adapter::system_settings_path() {
        layers.push(("System", path));
    }
    if let Some(path) = user_settings_path() {
        layers.push(("User", path));
    }
    if let Some(folder) = folder {
        layers.push(("Project", folder.join(".gemini").join("settings.json")));
    }
    let mut sections: Vec<Section> = layers
        .iter()
        .filter_map(|(label, path)| files::hooks_section(label, path))
        .collect();
    let mut notes = Vec::new();
    for (_, path) in &layers {
        let Some(settings) = files::read_json(path) else {
            continue;
        };
        if settings.pointer("/hooksConfig/enabled") == Some(&Value::Bool(false)) {
            notes.push(format!(
                "Hooks are turned off (`hooksConfig.enabled: false` in {}).",
                display_path(path)
            ));
        }
        let disabled: Vec<&str> = settings
            .pointer("/hooksConfig/disabled")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect();
        if !disabled.is_empty() {
            notes.push(format!("Turned off: {}", disabled.join(", ")));
        }
    }
    if !notes.is_empty() && !sections.is_empty() {
        sections.push(Section {
            text: Some(notes.join("\n\n")),
            ..Default::default()
        });
    }
    files::info_or(
        "Gemini CLI hooks",
        sections,
        "No hooks configured in the system, user or project settings.",
    )
}
/// `/policies`: the rules in Gemini CLI's policy files (`[[rule]]` tables in the system, user
/// and project `policies` folders). Its built-in defaults apply under them.
pub(super) fn policies(folder: Option<&Path>) -> Output {
    let mut dirs = vec![("System", adapter::system_config_dir().join("policies"))];
    if let Some(dir) = adapter::gemini_dir() {
        dirs.push(("User", dir.join("policies")));
    }
    if let Some(folder) = folder {
        dirs.push(("Project", folder.join(".gemini").join("policies")));
    }
    let mut sections = Vec::new();
    for (label, dir) in dirs {
        let mut paths: Vec<PathBuf> = std::fs::read_dir(&dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.extension().is_some_and(|ext| ext == "toml"))
            .collect();
        paths.sort();
        for path in paths {
            let rows = policy_rows(&path);
            if !rows.is_empty() {
                sections.push(Section {
                    heading: Some(format!("{label} · {}", display_path(&path))),
                    rows,
                    text: None,
                });
            }
        }
    }
    if !sections.is_empty() {
        sections.push(Section {
            text: Some("Gemini CLI's built-in default policies also apply.".into()),
            ..Default::default()
        });
    }
    files::info_or(
        "Gemini CLI policies",
        sections,
        "No policy files. Gemini CLI applies its built-in default policies.",
    )
}

/// One row per `[[rule]]`: what it matches, and its decision, priority and modes.
fn policy_rows(path: &Path) -> Vec<Row> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return vec![row("Unreadable", display_path(path))];
    };
    let Ok(table) = text.parse::<toml::Table>() else {
        return vec![row("Not valid TOML", display_path(path))];
    };
    let joined = |value: Option<&toml::Value>| -> Option<String> {
        match value? {
            toml::Value::String(text) => Some(text.clone()),
            toml::Value::Array(items) => Some(
                items
                    .iter()
                    .filter_map(toml::Value::as_str)
                    .collect::<Vec<_>>()
                    .join(", "),
            ),
            _ => None,
        }
    };
    table
        .get("rule")
        .and_then(toml::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(toml::Value::as_table)
        .map(|rule| {
            let mut matches = joined(rule.get("toolName"))
                .or_else(|| joined(rule.get("mcpName")).map(|name| format!("MCP {name}")))
                .unwrap_or_else(|| "Any tool".to_string());
            for key in ["commandPrefix", "commandRegex", "argsPattern"] {
                if let Some(pattern) = joined(rule.get(key)) {
                    matches.push_str(&format!(" · {pattern}"));
                }
            }
            let mut decision = rule
                .get("decision")
                .and_then(toml::Value::as_str)
                .unwrap_or("?")
                .to_string();
            if let Some(priority) = rule.get("priority") {
                decision.push_str(&format!(" (priority {priority})"));
            }
            if let Some(modes) = joined(rule.get("modes")) {
                decision.push_str(&format!(" in {modes}"));
            }
            row(matches, decision)
        })
        .collect()
}
