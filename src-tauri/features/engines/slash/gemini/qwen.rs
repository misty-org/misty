//! Qwen Code's commands Misty runs out of turn.

use super::*;

// ==================== Qwen Code ====================

/// How long Qwen Code may take to start, attach a session and branch it.
const QWEN_ACP_TIMEOUT: Duration = Duration::from_secs(120);
/// The extensions pages Qwen Code's `/extensions explore` opens (`EXTENSION_EXPLORE_URL`).
const QWEN_EXTENSIONS_URLS: &[(&str, &str)] = &[
    ("Gemini", "https://geminicli.com/extensions/"),
    ("ClaudeCode", "https://claudemarketplaces.com/"),
];
/// `/upgrade`'s page: Qwen Chat's plans, with the parameters Qwen Code adds
/// (`getQwenSubscriptionPlansUrl("cli")`).
const QWEN_PLANS_URL: &str =
    "https://chat.qwen.ai/?memberPlan=qwen_code&entry=qwen_code&paywallScene=cli";
/// The GitHub Action `/setup-github` installs, at its quick start.
const QWEN_ACTION_URL: &str = "https://github.com/QwenLM/qwen-code-action#quick-start";
/// `/recap` as a message: Qwen Code's own recap instructions (`RECAP_SYSTEM_PROMPT`), without
/// the tags its side query parses.
const QWEN_RECAP_PROMPT: &str = "The user stepped away and is coming back. Recap this session in under 40 words, 1-2 plain sentences, no markdown. Lead with the overall goal and current task, then the one next action. Skip root-cause narrative, fix internals, secondary to-dos, and em-dash tangents.";

pub(super) async fn run_qwen(context: Context, name: &str) -> Result<Output, String> {
    let folder = context.folder.as_deref();
    let args = context.args.as_str();
    match name {
        "extensions" => qwen_extensions(args),
        "branch" => qwen_branch(&context).await,
        "agents" => {
            let mut dirs = Vec::new();
            if let Some(dir) = qwen_dir() {
                dirs.push(("User", dir.join("agents")));
            }
            if let Some(folder) = folder {
                dirs.push(("Project", folder.join(".qwen").join("agents")));
            }
            Ok(files::agents_info("Qwen Code", &dirs))
        }
        "memory" => Ok(qwen_memory(folder)),
        "permissions" => {
            let dir = qwen_dir().ok_or("No home folder to read Qwen Code's settings from.")?;
            let layers = files::settings_files(&dir, ".qwen", folder, false);
            Ok(files::permissions_info("Qwen Code", &layers))
        }
        "upgrade" => Ok(Output::open(format!("url:{QWEN_PLANS_URL}"))),
        "setup-github" => Ok(Output::open(format!("url:{QWEN_ACTION_URL}"))),
        "commit" => qwen_commit(args),
        "recap" => Ok(Output::send(QWEN_RECAP_PROMPT)),
        _ => Err(format!("Misty doesn't run /{name} for Qwen Code.")),
    }
}

/// Qwen Code's folder: `QWEN_HOME`, else `~/.qwen`.
fn qwen_dir() -> Option<PathBuf> {
    std::env::var_os("QWEN_HOME")
        .filter(|dir| !dir.is_empty())
        .map(PathBuf::from)
        .or_else(|| files::home().map(|home| home.join(".qwen")))
}

/// `/extensions explore [source]` opens the page (Gemini's extensions by default); every other
/// subcommand runs over ACP, so it goes to the turn.
fn qwen_extensions(args: &str) -> Result<Output, String> {
    let (sub, rest) = args.split_once(char::is_whitespace).unwrap_or((args, ""));
    if sub != "explore" {
        return Ok(Output::send(
            format!("/extensions {args}").trim_end().to_string(),
        ));
    }
    let source = match rest.trim() {
        "" => "Gemini",
        source => source,
    };
    QWEN_EXTENSIONS_URLS
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(source))
        .map(|(_, url)| Output::open(format!("url:{url}")))
        .ok_or_else(|| format!("Unknown extensions source: {source}. Use Gemini or ClaudeCode."))
}

/// The memory files Qwen Code loads: `context.fileName` from its settings (QWEN.md and
/// AGENTS.md by default) in `~/.qwen` and in the project's folders.
fn qwen_memory(folder: Option<&Path>) -> Output {
    let dir = qwen_dir();
    let configured = dir
        .as_ref()
        .and_then(|dir| files::read_json(&dir.join("settings.json")))
        .and_then(|settings| settings.pointer("/context/fileName").cloned());
    let names: Vec<String> = match configured {
        Some(Value::String(name)) if !name.trim().is_empty() => vec![name],
        Some(Value::Array(names)) => names
            .iter()
            .filter_map(Value::as_str)
            .filter(|name| !name.trim().is_empty())
            .map(str::to_string)
            .collect(),
        _ => vec!["QWEN.md".to_string(), "AGENTS.md".to_string()],
    };
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    let global: Vec<PathBuf> = dir
        .iter()
        .flat_map(|dir| names.iter().map(move |name| dir.join(name)))
        .collect();
    Output::info(
        "Qwen Code memory",
        vec![files::context_section(
            "Context files",
            &global,
            &names,
            folder,
        )],
    )
}

/// `/commit` as a message: Qwen Code's own `/commit` prompt, read from the installed CLI so it
/// matches its version, with the person's instructions after it as the CLI adds them.
fn qwen_commit(instructions: &str) -> Result<Output, String> {
    let prompt = qwen_commit_prompt().ok_or(
        "Couldn't find Qwen Code's /commit prompt in the installed CLI. Update Qwen Code, or ask for the commit in a message.",
    )?;
    Ok(Output::send(if instructions.is_empty() {
        prompt
    } else {
        format!("{prompt}\n\nAdditional instructions from the user:\n{instructions}")
    }))
}

/// `COMMIT_PROMPT` from the installed Qwen Code: the package beside the `qwen` program keeps
/// its code in `chunks/*.js`, and the prompt is a template literal there.
fn qwen_commit_prompt() -> Option<String> {
    const START: &str = "var COMMIT_PROMPT=`";
    let package = qwen_package_dir()?;
    let mut chunks: Vec<PathBuf> = std::fs::read_dir(package.join("chunks"))
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "js"))
        .collect();
    chunks.sort();
    for path in chunks {
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Some(at) = text.find(START) else {
            continue;
        };
        return template_literal(&text[at + START.len()..]);
    }
    None
}

/// The folder of the installed Qwen Code package: where the `qwen` program's link points.
fn qwen_package_dir() -> Option<PathBuf> {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = crate::engines::engine_bin(&settings, "qwen");
    let program = if Path::new(&bin).is_absolute() {
        PathBuf::from(&bin)
    } else {
        crate::engines::resolve::find_program(&bin)?
    };
    let entry = std::fs::canonicalize(program).ok()?;
    entry
        .ancestors()
        .find(|dir| dir.join("package.json").is_file() && dir.join("chunks").is_dir())
        .map(Path::to_path_buf)
}

/// A JavaScript template literal's text, from just after its opening backtick to the closing
/// one, with its escapes undone. None for one that interpolates (`${`), which can't be read
/// without running it.
fn template_literal(text: &str) -> Option<String> {
    let mut out = String::new();
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        match c {
            '`' => return Some(out),
            '$' if chars.clone().next() == Some('{') => return None,
            '\\' => match chars.next()? {
                'n' => out.push('\n'),
                't' => out.push('\t'),
                'r' => out.push('\r'),
                'u' => {
                    let code = if chars.clone().next() == Some('{') {
                        chars.next();
                        let hex: String = chars.by_ref().take_while(|c| *c != '}').collect();
                        u32::from_str_radix(&hex, 16).ok()?
                    } else {
                        let hex: String = chars.by_ref().take(4).collect();
                        u32::from_str_radix(&hex, 16).ok()?
                    };
                    out.push(char::from_u32(code)?);
                }
                '\n' => {}
                other => out.push(other),
            },
            other => out.push(other),
        }
    }
    None
}

/// `/branch [name]`: Qwen Code's own session branch (`qwen/control/session/branch`, the ACP
/// extension method behind its terminal app's `/branch`), which copies the session's records
/// into a new one without a model call. The session has to be live in the process, so it's
/// loaded first. The new session opens as a new chat.
async fn qwen_branch(context: &Context) -> Result<Output, String> {
    let session = context
        .session
        .as_deref()
        .ok_or("Qwen Code has no session for this chat yet. Send a message first.")?;
    let folder = context
        .folder
        .as_deref()
        .ok_or("This chat has no folder for Qwen Code's session.")?;
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = crate::engines::engine_bin(&settings, "qwen");
    let mut command = crate::engines::resolve::command_for_binary(&bin);
    command.arg("--acp");
    for (key, value) in crate::engine_config::engine_env::env_for("qwen").unwrap_or_default() {
        command.env(key, value);
    }
    let mut params = json!({ "sessionId": session });
    if !context.args.is_empty() {
        params["name"] = json!(context.args);
    }
    let result = tokio::time::timeout(QWEN_ACP_TIMEOUT, async {
        let mut spawned = acp::spawn_piped_acp(&mut command, &bin, folder)?;
        let killed = AtomicBool::new(false);
        let cwd = folder.to_string_lossy().into_owned();
        let mut refuse = refuse_requests;
        let result = async {
            let client = &mut spawned.acp;
            client
                .routed(
                    "initialize",
                    acp::initialize_params(),
                    acp::RPC_HANDSHAKE_TIMEOUT,
                    &killed,
                    None,
                    &mut refuse,
                )
                .await?;
            client
                .routed(
                    "session/load",
                    json!({ "cwd": cwd, "mcpServers": [], "sessionId": session }),
                    acp::SESSION_NEW_TIMEOUT,
                    &killed,
                    None,
                    &mut refuse,
                )
                .await?;
            client
                .routed(
                    "qwen/control/session/branch",
                    params,
                    acp::RPC_HANDSHAKE_TIMEOUT,
                    &killed,
                    None,
                    &mut refuse,
                )
                .await
        }
        .await;
        acp::teardown(&mut spawned.child).await;
        result
    })
    .await
    .map_err(|_| "Qwen Code took too long to branch the session.".to_string())?
    .map_err(|error| bare_rpc_error(&error))?;
    let forked = result
        .get("newSessionId")
        .and_then(Value::as_str)
        .ok_or("Qwen Code's branch gave no session id.")?;
    let title = result
        .get("displayName")
        .or_else(|| result.get("title"))
        .and_then(Value::as_str)
        .map(str::to_string);
    Ok(Output::Fork {
        session: forked.to_string(),
        title,
        prompt: None,
    })
}

/// An out-of-turn ACP call has nothing to grant: any request the CLI makes is refused.
pub(super) fn refuse_requests(line: &AcpLine) -> Option<Value> {
    match line {
        AcpLine::AgentRequest { id, .. } => Some(acp::jsonrpc_error_response(
            id,
            acp::JSONRPC_METHOD_NOT_FOUND,
            "Misty answers no requests outside a turn",
        )),
        _ => None,
    }
}

/// The message part of an `rpc:<code>:<method>: <message>` error.
fn bare_rpc_error(error: &str) -> String {
    error
        .strip_prefix("rpc:")
        .and_then(|rest| rest.splitn(3, ':').nth(2))
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .unwrap_or(error)
        .to_string()
}
