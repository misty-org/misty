//! Between Codex and the rest: `/import` from Claude Code, `/feedback` to Codex's maintainers,
//! and `/app`, which opens the chat's folder in the Codex desktop app.

use super::*;

/// What Codex can bring over from Claude Code. Without `yes` this only shows it; `yes` imports
/// all of it, as found again right then.
pub(super) async fn import(context: &Context) -> Result<Output, String> {
    let confirmed = match context.args.trim() {
        "" => false,
        "yes" => true,
        _ => return Err("Use /import to see what Codex can bring over, then /import yes.".into()),
    };
    let mut detect = json!({ "includeHome": true });
    if let Some(folder) = folder(context) {
        detect["cwds"] = json!([folder]);
    }
    let mut rpc = open(context).await?;
    let result = import_in(&mut rpc, detect, confirmed).await;
    rpc.stop().await;
    result
}

async fn import_in(rpc: &mut Session, detect: Value, confirmed: bool) -> Result<Output, String> {
    let found = rpc
        .call("externalAgentConfig/detect", detect)
        .await
        .map_err(text)?;
    let items = found["items"].as_array().cloned().unwrap_or_default();
    if items.is_empty() {
        return Ok(Output::done(
            "Codex found nothing to import from Claude Code.",
        ));
    }
    if !confirmed {
        let rows = items
            .iter()
            .map(|item| {
                let mut about = item["description"].as_str().unwrap_or_default().to_string();
                if let Some(cwd) = text_at(item, "/cwd") {
                    about.push_str(&format!(" ({cwd})"));
                }
                row(
                    kind_name(item["itemType"].as_str().unwrap_or("other")),
                    about,
                )
            })
            .collect();
        return Ok(Output::info(
            "Import from Claude Code",
            vec![Section {
                rows,
                text: Some("Import all of this with /import yes.".into()),
                ..Default::default()
            }],
        ));
    }
    let started = rpc
        .call(
            "externalAgentConfig/import",
            json!({ "migrationItems": items }),
        )
        .await
        .map_err(text)?;
    let import_id = started["importId"].as_str().unwrap_or_default().to_string();
    // The import runs inside the app-server and reports when it's done.
    rpc.allow(IMPORT_TIMEOUT);
    let results = loop {
        let message = rpc.next_notification().await.map_err(text)?;
        if message["method"].as_str() == Some("externalAgentConfig/import/completed")
            && message["params"]["importId"].as_str() == Some(import_id.as_str())
        {
            break message["params"]["itemTypeResults"].clone();
        }
    };
    let mut failures = Vec::new();
    let rows = results
        .as_array()
        .into_iter()
        .flatten()
        .map(|result| {
            let done = result["successes"].as_array().map_or(0, Vec::len);
            let failed = result["failures"].as_array().map_or(0, Vec::len);
            for failure in result["failures"].as_array().into_iter().flatten() {
                if let Some(message) = text_at(failure, "/message") {
                    failures.push(format!("- {message}"));
                }
            }
            let value = if failed > 0 {
                format!("{done} imported, {failed} failed")
            } else {
                format!("{done} imported")
            };
            row(
                kind_name(result["itemType"].as_str().unwrap_or("other")),
                value,
            )
        })
        .collect();
    Ok(Output::info(
        "Imported from Claude Code",
        vec![Section {
            rows,
            text: (!failures.is_empty()).then(|| failures.join("\n")),
            ..Default::default()
        }],
    ))
}

fn kind_name(kind: &str) -> String {
    match kind {
        "AGENTS_MD" => "Instructions".into(),
        "MCP_SERVER_CONFIG" => "MCP servers".into(),
        other => title_case(&other.replace('_', " ").to_ascii_lowercase()),
    }
}

/// Sends feedback, with Codex's logs and this chat's thread, to Codex's maintainers.
pub(super) async fn feedback(context: &Context) -> Result<Output, String> {
    let args = context.args.trim();
    let (first, rest) = split_first(args);
    let (kind, reason) = if FEEDBACK_KINDS.contains(&first) {
        (first, rest)
    } else {
        ("other", args)
    };
    if args.is_empty() {
        return Err(format!(
            "Write what happened: /feedback [{}] <text>",
            FEEDBACK_KINDS.join("|")
        ));
    }
    let mut params = json!({ "classification": kind, "includeLogs": true });
    if !reason.is_empty() {
        params["reason"] = json!(reason);
    }
    let mut rpc = open(context).await?;
    if let Some(thread) = loaded_thread(&mut rpc, context).await {
        params["threadId"] = json!(thread);
    }
    let sent = rpc.call("feedback/upload", params).await.map_err(text);
    rpc.stop().await;
    let sent = sent?;
    Ok(Output::done(match text_at(&sent, "/threadId") {
        Some(id) => format!("Sent your feedback to Codex's maintainers (id {id})."),
        None => "Sent your feedback to Codex's maintainers.".into(),
    }))
}

/// Opens the chat's folder in the Codex desktop app (`codex app`, which offers to install the
/// app when it's missing). The CLI hands off to the app and exits; it is reaped in the
/// background, out of Misty's process group.
pub(super) fn desktop_app(context: &Context) -> Result<Output, String> {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let bin = crate::engines::engine_bin(&settings, "codex");
    let folder = context
        .folder
        .clone()
        .or_else(dirs::home_dir)
        .unwrap_or_default();
    let mut command = crate::engines::command_for_binary(&bin);
    command
        .arg("app")
        .arg(&folder)
        .current_dir(&folder)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    crate::engines::hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Codex could not be started: {error}"))?;
    tokio::spawn(async move {
        let _ = child.wait().await;
    });
    Ok(Output::done(
        "Opening this folder in the Codex desktop app.",
    ))
}
