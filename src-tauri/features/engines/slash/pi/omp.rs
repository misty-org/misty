use super::*;

pub(super) fn omp_tui_only(name: &str) -> Option<Output> {
    let why = match name {
        "vibe" => {
            "omp's vibe mode needs its terminal app: it swaps the session's tools for its vibe \
             workers through the TUI, and rpc mode has no command for that."
        }
        _ => return None,
    };
    Some(Output::done(why))
}

pub(super) fn omp_usage(name: &str, args: &str) -> Option<String> {
    let empty = match name {
        "omfg" => omfg_args(args).1.is_empty(),
        "btw" | "tan" => args.is_empty(),
        _ => false,
    };
    empty.then(|| match name {
        "btw" => "Usage: /btw <question>".to_string(),
        "tan" => "Usage: /tan <work>".to_string(),
        _ => "Usage: /omfg <complaint>".to_string(),
    })
}

pub(super) fn btw_prompt(question: &str) -> String {
    format!(
        "<btw>\nEphemeral side question for current interactive session.\nAnswer briefly, \
         directly; use conversation context already provided.\nNEVER use tools.\nNEVER ask \
         follow-up questions.\nQuestion:\n{}\n</btw>",
        question.trim()
    )
}

pub(super) async fn btw(folder: &Path, session: &str, question: &str) -> Result<Output, String> {
    let answer = side_reply(folder, session, &btw_prompt(question)).await?;
    Ok(Output::info(
        "Side question",
        vec![Section {
            heading: Some(question.to_string()),
            text: Some(answer),
            ..Section::default()
        }],
    ))
}

#[allow(
    clippy::disallowed_methods,
    reason = "removes the side session omp forked, in omp's own session folder wherever it keeps it"
)]
async fn drop_fork(file: &Path) {
    let _ = tokio::fs::remove_file(file).await;
    let _ = tokio::fs::remove_dir_all(file.with_extension("")).await;
}

pub(super) async fn side_reply(
    folder: &Path,
    session: &str,
    prompt: &str,
) -> Result<String, String> {
    let mut rpc = RpcSession::fork("omp", folder, session, &["--no-tools", "--no-title"]).await?;
    let state = rpc.call("get_state", json!({})).await;
    let fork_file = state
        .as_ref()
        .ok()
        .and_then(|state| state.get("sessionFile"))
        .and_then(Value::as_str)
        .map(PathBuf::from);
    let forked = state
        .as_ref()
        .ok()
        .and_then(|state| state.get("sessionId"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let result = async {
        state?;
        if forked.as_deref() == Some(session) {
            return Err("omp didn't fork the session.".to_string());
        }
        rpc.prompt(prompt, SIDE_TIMEOUT).await?;
        let data = rpc.call("get_last_assistant_text", json!({})).await?;
        data.get("text")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
            .ok_or_else(|| "omp finished without an answer.".to_string())
    }
    .await;
    rpc.close().await;
    if forked.as_deref() != Some(session) {
        if let Some(file) =
            fork_file.filter(|file| file.extension().is_some_and(|ext| ext == "jsonl"))
        {
            drop_fork(&file).await;
        }
    }
    result
}

const TAN_CONTEXT_SWITCH: &str = "<system-notice cause=\"fork\">
Above conversation: parent session.
Fork solely handles user's request below.
Parent still working original task; no responsibility or obligations from prior conversation.

- MUST focus EXCLUSIVELY on immediate user request; nothing else.
- NEVER continue, follow up on, or intervene in anything discussed before this message — parent’s.
- Parent concurrently edits this working directory. Files MAY change between reads, appear mid-refactor, or fail to compile. Parent's live work: NEVER fix, audit, or build on it, even if broken.
- Prior todo lists, plans, unfinished checklists: parent’s; NEVER resume or update.
- After request: STOP. NEVER work on ANY OTHER TASK.
</system-notice>";

pub(super) fn tan_prompt(work: &str) -> String {
    format!("{TAN_CONTEXT_SWITCH}\n\n{}", work.trim())
}

pub(super) fn tan_title(work: &str) -> String {
    let line = work.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.chars().count() <= 80 {
        return line;
    }
    let mut short: String = line.chars().take(79).collect();
    short.push('…');
    short
}

pub(super) async fn tan(folder: &Path, session: &str, work: &str) -> Result<Output, String> {
    let mut rpc = RpcSession::fork("omp", folder, session, &[]).await?;
    let result = async {
        rpc.call("prompt", json!({ "message": "/todo rm" })).await?;
        let state = rpc.call("get_state", json!({})).await?;
        state
            .get("sessionId")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && *id != session)
            .map(str::to_string)
            .ok_or_else(|| "omp didn't fork the session.".to_string())
    }
    .await;
    rpc.close().await;
    Ok(Output::Fork {
        session: result?,
        title: Some(tan_title(work)),
        prompt: Some(tan_prompt(work)),
    })
}
pub(super) fn cleanse_args(args: &str) -> Result<Vec<String>, String> {
    const USAGE: &str = "Usage: /cleanse [request] [--all] [--tests] [-n <agents>] [-m <model>]";
    let mut tokens = args.split_whitespace();
    let mut flags = Vec::new();
    let mut request = Vec::new();
    while let Some(token) = tokens.next() {
        match token {
            "--all" | "-a" => flags.push("--all".to_string()),
            "--tests" | "-t" => flags.push("--tests".to_string()),
            "--agents" | "-n" => {
                let agents = tokens
                    .next()
                    .and_then(|value| value.parse::<u32>().ok())
                    .filter(|agents| *agents > 0)
                    .ok_or(USAGE)?;
                flags.extend(["--agents".to_string(), agents.to_string()]);
            }
            "--model" | "-m" => {
                let model = tokens.next().ok_or(USAGE)?;
                flags.extend(["--model".to_string(), model.to_string()]);
            }
            _ if token.len() > 1
                && token.starts_with('-')
                && !token[1..].starts_with(|char: char| char.is_ascii_digit()) =>
            {
                return Err(USAGE.into());
            }
            _ => request.push(token),
        }
    }
    let mut argv = vec!["cleanse".to_string()];
    if !request.is_empty() {
        argv.push(request.join(" "));
    }
    argv.extend(flags);
    Ok(argv)
}

pub(super) async fn cleanse(folder: &Path, args: &str) -> Result<Output, String> {
    let argv = cleanse_args(args)?;
    let (mut cmd, bin) = crate::engines::pi_family::cli_command("omp", folder)?;
    cmd.args(&argv);
    let run = tokio::time::timeout(CLEANSE_TIMEOUT, cmd.output())
        .await
        .map_err(|_| "omp cleanse didn't finish within an hour; Misty stopped it.".to_string())?
        .map_err(|error| format!("failed to run {bin}: {error}"))?;
    let mut said =
        crate::engines::pi_family::strip_terminal_codes(&String::from_utf8_lossy(&run.stdout));
    let errors =
        crate::engines::pi_family::strip_terminal_codes(&String::from_utf8_lossy(&run.stderr));
    if !errors.trim().is_empty() {
        said.push('\n');
        said.push_str(&errors);
    }
    let lines: Vec<&str> = said
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .collect();
    let shown = lines[lines.len().saturating_sub(80)..].join("\n");
    let status = match run.status.code() {
        Some(0) => "Clean",
        Some(130) => "Cancelled",
        _ => "Not clean",
    };
    Ok(Output::info(
        "Cleanse",
        vec![Section {
            rows: vec![row("Result", status)],
            text: Some(if shown.is_empty() {
                "omp cleanse printed nothing.".to_string()
            } else {
                format!("```\n{shown}\n```")
            }),
            ..Section::default()
        }],
    ))
}
