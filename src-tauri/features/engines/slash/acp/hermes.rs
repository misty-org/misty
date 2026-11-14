//! Hermes's commands that its gateway refuses over ACP, run here instead.

use super::*;

/// Hermes's `_FORK_PROMPT` (`agent/side_question.py`), then the question.
pub(super) fn hermes_btw_prompt(question: &str) -> String {
    format!(
        "The user asked a quick SIDE question with /btw while the main work continues in the \
         original session.\nRules:\n- Answer ONLY the side question, using the conversation \
         above as context. Do not continue, redo, or critique the main task.\n- Do NOT call any \
         tools — they are disabled for this side question. Answer directly in text.\n- If the \
         conversation does not contain enough information to answer, say so plainly instead of \
         guessing.\n- Be concise and direct.\n\nSide question:\n{}",
        question.trim()
    )
}

/// How long a side question may take.
const SIDE_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// `/btw <question>`: asked in an ACP fork of the session, so the chat's own session never sees
/// it, and the fork is deleted after (Hermes answers from a detached copy of the agent). The fork
/// is put in Hermes's `default` mode first, which asks before every edit; nobody is here to
/// allow one, so a tool it tries anyway changes nothing.
pub(super) async fn hermes_btw(
    context: &Context,
    folder: &Path,
    session: &str,
) -> Result<Output, String> {
    let question = context.args.clone();
    let mut live = OutOfTurn::open(context, folder).await?;
    let mut side = None;
    let result = async {
        if !live.can("fork") {
            return Err("This version of Hermes can't fork a session.".to_string());
        }
        live.attach(session).await?;
        let params = json!({ "sessionId": session, "cwd": live.cwd(), "mcpServers": [] });
        let forked = live
            .call("session/fork", params, SESSION_NEW_TIMEOUT)
            .await?;
        let id = text(&forked, "sessionId")
            .filter(|id| id != session)
            .ok_or("Hermes forked no session.")?;
        side = Some(id.clone());
        live.call(
            "session/set_mode",
            json!({ "sessionId": id, "modeId": "default" }),
            RPC_HANDSHAKE_TIMEOUT,
        )
        .await?;
        live.prompt(&id, &hermes_btw_prompt(&question), SIDE_TIMEOUT)
            .await
    }
    .await;
    live.close().await;
    if let Some(side) = side {
        // Best effort: Hermes refuses while its gateway still holds the fork busy.
        let _ = hermes_cli(folder, &["sessions", "delete", &side, "--yes"]).await;
    }
    let answer = result?;
    if answer.is_empty() {
        return Err("Hermes finished without an answer.".into());
    }
    Ok(Output::info(
        "Side question",
        vec![Section {
            heading: Some(question),
            text: Some(answer),
            ..Section::default()
        }],
    ))
}

/// One of Hermes's own subcommands (no model), with its output; its words when it fails.
async fn hermes_cli(folder: &Path, args: &[&str]) -> Result<String, String> {
    let (mut command, bin) = crate::engines::pi_family::cli_command("hermes", folder)?;
    command.args(args);
    let run = tokio::time::timeout(Duration::from_secs(120), command.output())
        .await
        .map_err(|_| "Hermes didn't finish in time.".to_string())?
        .map_err(|error| format!("failed to run {bin}: {error}"))?;
    let stdout = String::from_utf8_lossy(&run.stdout).into_owned();
    if run.status.success() {
        return Ok(stdout);
    }
    let said = [String::from_utf8_lossy(&run.stderr).into_owned(), stdout]
        .into_iter()
        .flat_map(|text| {
            text.lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .last();
    Err(said.unwrap_or_else(|| "Hermes couldn't run it.".into()))
}

/// Hermes's `SAVE_USAGE`, for a bare `/save`.
pub(super) fn hermes_save_usage() -> Output {
    Output::info(
        "Save",
        vec![Section {
            text: Some(
                "/save <format> [filename] [redact]\n\n\
                 - json: full session snapshot\n\
                 - md: readable Markdown transcript\n\
                 - html: standalone single-file HTML page\n\n\
                 The file goes under Hermes's sessions/saved folder unless you name one (taken \
                 from the chat's folder). redact scrubs API keys, tokens and credentials first. \
                 /export saves the chat as Misty shows it."
                    .into(),
            ),
            ..Section::default()
        }],
    )
}

/// What `/save` was asked for: the format, the file named (if any) and whether to redact.
pub(super) fn hermes_save_args(args: &str) -> Result<(&'static str, Option<String>, bool), String> {
    let mut parts: Vec<&str> = args.split_whitespace().collect();
    let redact = parts
        .last()
        .is_some_and(|last| matches!(last.to_lowercase().as_str(), "redact" | "--redact"));
    if redact {
        parts.pop();
    }
    let format = match parts.first().map(|format| format.to_lowercase()).as_deref() {
        Some("json" | "snapshot") => "json",
        Some("md" | "markdown") => "md",
        Some("html") => "html",
        Some(other) => {
            return Err(format!(
                "Unknown format {other:?}. Use json, md or html: /save <format> [filename] [redact]"
            ))
        }
        None => return Err("/save <json|md|html> [filename] [redact]".into()),
    };
    Ok((format, parts.get(1).map(|name| name.to_string()), redact))
}

/// `/save <json|md|html> [filename] [redact]`: Hermes's own export of the stored session
/// (`hermes sessions export`, what its `/save` renders), written where its CLI writes it.
pub(super) async fn hermes_save(
    context: &Context,
    folder: &Path,
    session: &str,
) -> Result<Output, String> {
    let (format, name, redact) = hermes_save_args(&context.args)?;
    let target = match name {
        Some(name) => {
            let path = crate::engine_config::support::expand_user_path(&name);
            if path.is_absolute() {
                path
            } else {
                folder.join(path)
            }
        }
        None => crate::engine_config::support::hermes_home()
            .join("sessions")
            .join("saved")
            .join(format!(
                "hermes_conversation_{}.{format}",
                chrono::Local::now().format("%Y%m%d_%H%M%S")
            )),
    };
    if let Some(parent) = target.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("Couldn't create {}: {error}", parent.display()))?;
    }
    let mut args = vec!["sessions", "export"];
    // md writes one file per session into a folder, named by Hermes: it goes to a scratch
    // folder and is moved to the name asked for.
    let scratch = std::env::temp_dir().join(format!(
        "misty-hermes-save-{}",
        chrono::Local::now()
            .timestamp_nanos_opt()
            .unwrap_or_default()
    ));
    let target_text = target.to_string_lossy().into_owned();
    let scratch_text = scratch.to_string_lossy().into_owned();
    match format {
        "json" => args.extend(["-", "--format", "jsonl"]),
        "html" => args.extend([target_text.as_str(), "--format", "html"]),
        _ => args.extend([scratch_text.as_str(), "--format", "md"]),
    }
    args.extend(["--session-id", session]);
    if redact {
        args.push("--redact");
    }
    let said = hermes_cli(folder, &args).await;
    let written = async {
        let said = said?;
        match format {
            "json" => {
                // One session per line; /save writes it indented.
                let snapshot = said
                    .lines()
                    .rev()
                    .find_map(|line| serde_json::from_str::<Value>(line.trim()).ok())
                    .ok_or("Hermes exported nothing for this session.")?;
                let pretty = serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?;
                tokio::fs::write(&target, pretty)
                    .await
                    .map_err(|e| e.to_string())
            }
            "md" => {
                let file = std::fs::read_dir(&scratch)
                    .map_err(|error| error.to_string())?
                    .flatten()
                    .map(|entry| entry.path())
                    .find(|path| path.extension().is_some_and(|ext| ext == "md"))
                    .ok_or("Hermes exported nothing for this session.")?;
                tokio::fs::copy(&file, &target)
                    .await
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            }
            _ => Ok(()),
        }
    }
    .await;
    let _ = tokio::fs::remove_dir_all(&scratch).await;
    written?;
    let label = match format {
        "json" => "JSON",
        "md" => "Markdown",
        _ => "HTML",
    };
    Ok(Output::done(format!(
        "Saved the conversation as {label} to {}",
        target.display()
    )))
}

/// `/rollback`: Hermes's checkpoints for the chat's folder, read from its shadow git store
/// (`tools/checkpoint_manager.py`: `checkpoints/store`, one `refs/hermes/<sha256(folder)[:16]>`
/// branch per folder). A restore runs on its gateway, which also rewinds the session there, and
/// ACP has no call for it, so a number points to Misty's own rewind.
pub(super) async fn hermes_rollback(context: &Context, folder: &Path) -> Result<Output, String> {
    if !context.args.is_empty() {
        return Ok(Output::done(
            "Hermes restores a checkpoint on its gateway, which its ACP server doesn't offer. To \
             put files back, rewind the chat to a message in Misty: it restores what the agent \
             changed since and asks before overwriting files you edited.",
        ));
    }
    let store = crate::engine_config::support::hermes_home()
        .join("checkpoints")
        .join("store");
    let folder = std::fs::canonicalize(folder).unwrap_or_else(|_| folder.to_path_buf());
    let checkpoints = if store.join("HEAD").exists() {
        checkpoint_list(&store, &folder).await
    } else {
        Vec::new()
    };
    let text = if checkpoints.is_empty() {
        format!(
            "No checkpoints found for {}. Hermes takes them before its edits only when \
             checkpoints are on in its config (checkpoints.enabled, off by default).",
            folder.display()
        )
    } else {
        "Hermes restores these on its gateway, which ACP doesn't reach; rewind the chat to a \
         message in Misty to put files back."
            .to_string()
    };
    Ok(Output::info(
        "Checkpoints",
        vec![Section {
            heading: Some(folder.display().to_string()),
            rows: checkpoints,
            text: Some(text),
        }],
    ))
}

/// Hermes's `list_checkpoints`, newest first, numbered as its `/rollback` numbers them.
async fn checkpoint_list(store: &Path, folder: &Path) -> Vec<super::super::Row> {
    use sha2::{Digest, Sha256};
    let folder_text = folder.to_string_lossy().into_owned();
    let hash = hex::encode(Sha256::digest(folder_text.as_bytes()));
    let reference = format!("refs/hermes/{}", &hash[..16]);
    let log = shadow_git(
        store,
        folder,
        &["log", &reference, "--format=%H|%h|%aI|%s", "-n", "50"],
    )
    .await
    .unwrap_or_default();
    let mut rows = Vec::new();
    for (index, line) in log.lines().enumerate() {
        let parts: Vec<&str> = line.splitn(4, '|').collect();
        let [full, short, taken, reason] = parts[..] else {
            continue;
        };
        let stat = shadow_git(
            store,
            folder,
            &["diff", "--shortstat", &format!("{full}~1"), full],
        )
        .await
        .map(|stat| stat.trim().to_string())
        .filter(|stat| !stat.is_empty())
        .map(|stat| format!(" ({stat})"))
        .unwrap_or_default();
        let when = taken.get(..16).unwrap_or(taken).replace('T', " ");
        rows.push(row(
            (index + 1).to_string(),
            format!("{short}  {when}  {reason}{stat}"),
        ));
    }
    rows
}

/// A read-only git call on Hermes's store, isolated from the person's git config as Hermes
/// isolates it.
async fn shadow_git(store: &Path, folder: &Path, args: &[&str]) -> Option<String> {
    let mut command = tokio::process::Command::new("git");
    command
        .args(args)
        .env("GIT_DIR", store)
        .env("GIT_WORK_TREE", folder)
        .env_remove("GIT_INDEX_FILE")
        .env(
            "GIT_CONFIG_GLOBAL",
            if cfg!(windows) { "NUL" } else { "/dev/null" },
        )
        .env(
            "GIT_CONFIG_SYSTEM",
            if cfg!(windows) { "NUL" } else { "/dev/null" },
        )
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("PATH", crate::engines::resolve::cli_search_path())
        .current_dir(folder)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    crate::engines::hide_console(&mut command);
    let run = tokio::time::timeout(Duration::from_secs(30), command.output())
        .await
        .ok()?
        .ok()?;
    run.status
        .success()
        .then(|| String::from_utf8_lossy(&run.stdout).into_owned())
}

/// `/agents`: the background processes Hermes's tools started, from the list its process
/// registry keeps on disk (`<hermes home>/processes.json`, rewritten as they start and exit).
/// Its subagents and delegations live only in the gateway's memory.
pub(super) fn hermes_agents() -> Result<Output, String> {
    let path = crate::engine_config::support::hermes_home().join("processes.json");
    let entries: Vec<Value> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| serde_json::from_str(text.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_default();
    let now = chrono::Utc::now().timestamp() as f64;
    let rows = hermes_process_rows(&entries, now);
    let text = if rows.is_empty() {
        "No background processes are running.".to_string()
    } else {
        "Hermes's subagents and delegations run on its gateway, which ACP doesn't reach; this \
         chat's show in Misty's Steps panel."
            .to_string()
    };
    Ok(Output::info(
        "Agents",
        vec![Section {
            heading: Some(format!("Running processes ({})", rows.len())),
            rows,
            text: Some(text),
        }],
    ))
}

/// One row per process: its id, how long it has run and its command, as Hermes's `/agents`.
pub(super) fn hermes_process_rows(entries: &[Value], now: f64) -> Vec<super::super::Row> {
    entries
        .iter()
        .filter(|entry| entry.get("pid").and_then(Value::as_u64).is_some())
        .map(|entry| {
            let id = text(entry, "session_id").unwrap_or_else(|| "?".into());
            let command = entry["command"]
                .as_str()
                .unwrap_or("")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            let mut command: String = command.chars().take(90).collect();
            if entry["command"].as_str().unwrap_or("").chars().count() > 90 {
                command.push('…');
            }
            let value = match entry["started_at"].as_f64() {
                Some(started) => format!("{} · {command}", uptime((now - started).max(0.0) as u64)),
                None => command,
            };
            row(id, value)
        })
        .collect()
}

/// Hermes's `format_uptime_short`: `45s`, `12m`, `3h 5m`.
pub(super) fn uptime(seconds: u64) -> String {
    match seconds {
        0..=59 => format!("{seconds}s"),
        60..=3599 => format!("{}m", seconds / 60),
        _ => format!("{}h {}m", seconds / 3600, seconds % 3600 / 60),
    }
}

/// `/reload-mcp` and `/reload-skills` run inside Hermes's gateway (`reload.mcp`,
/// `skills.reload`), which its ACP server doesn't expose.
pub(super) fn hermes_reload(name: &str) -> Output {
    Output::done(if name == "reload-mcp" {
        "Hermes reloads MCP servers inside its gateway, which its ACP server doesn't expose. The \
         gateway brings its servers in line with its config on its housekeeping pass, and each \
         Misty turn re-attaches this chat, so the turn after that has them. `hermes gateway \
         restart` reloads them at once, for every chat on the gateway."
    } else {
        "Hermes rescans its skills inside its gateway, which its ACP server doesn't expose. \
         `hermes gateway restart` rescans them at once, for every chat on the gateway."
    })
}
