//! Grok's own `_x.ai/session/*` calls.

use super::*;

/// Grok's own fork (`_x.ai/session/fork`): it copies the saved session to a new id in the same
/// folder and starts nothing, so the next turn loads the copy as any session.
pub(super) async fn grok_fork(
    context: &Context,
    folder: &Path,
    session: &str,
) -> Result<Output, String> {
    let cwd = folder.to_string_lossy();
    let result = grok_call(
        context,
        folder,
        "_x.ai/session/fork",
        json!({ "sourceSessionId": session, "sourceCwd": cwd, "newCwd": cwd }),
    )
    .await?;
    let forked = text(unwrapped(&result), "newSessionId").ok_or("Grok forked no session.")?;
    Ok(Output::Fork {
        session: forked,
        title: fork_title(context),
        prompt: None,
    })
}

/// Grok's own rename (`_x.ai/session/rename`), which writes the title into its saved session.
pub(super) async fn grok_rename(
    context: &Context,
    folder: &Path,
    session: &str,
) -> Result<Output, String> {
    let title = context.args.clone();
    if title.is_empty() {
        return Err("Give the new title: /rename <title>".into());
    }
    grok_call(
        context,
        folder,
        "_x.ai/session/rename",
        json!({ "sessionId": session, "title": title, "cwd": folder.to_string_lossy() }),
    )
    .await?;
    Ok(Output::Rename { title })
}

/// One of Grok's calls on its saved sessions, which needs no session open.
async fn grok_call(
    context: &Context,
    folder: &Path,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    let mut live = OutOfTurn::open(context, folder).await?;
    let result = live.call(method, params, SESSION_NEW_TIMEOUT).await;
    live.close().await;
    result
}

/// Grok's `/session-info` out of turn (`_x.ai/session/info`), on the session opened here. It
/// answers only for a session this process has open, with an empty object otherwise.
pub(super) async fn grok_status(
    context: &Context,
    folder: &Path,
    session: &str,
) -> Result<Output, String> {
    let mut live = OutOfTurn::open(context, folder).await?;
    let result = async {
        live.attach(session).await?;
        live.call(
            "_x.ai/session/info",
            json!({ "sessionId": session }),
            RPC_HANDSHAKE_TIMEOUT,
        )
        .await
    }
    .await;
    live.close().await;
    let result = result?;
    let info = unwrapped(&result);
    let rows = grok_info_rows(info);
    if rows.is_empty() {
        return Err("Grok didn't report on this session.".into());
    }
    Ok(Output::info(
        "Session",
        vec![Section {
            rows,
            ..Section::default()
        }],
    ))
}

/// Grok's `SessionInfoResponse` (`session/acp_types.rs`) as rows.
pub(super) fn grok_info_rows(info: &Value) -> Vec<super::super::Row> {
    let number = |value: &Value, key: &str| value.get(key).and_then(Value::as_u64);
    let mut rows = Vec::new();
    if let Some(model) = text(info, "modelDisplayName").or_else(|| text(info, "model")) {
        rows.push(row("Model", model));
    }
    if let Some(agent) = text(info, "agentName") {
        rows.push(row("Agent", agent));
    }
    if let Some(turns) = number(info, "turns") {
        rows.push(row("Turns", turns.to_string()));
    }
    let context = &info["context"];
    if let (Some(used), Some(total)) = (number(context, "used"), number(context, "total")) {
        if total > 0 {
            let percent = number(context, "usagePct").unwrap_or(used * 100 / total);
            rows.push(row(
                "Context",
                format!("{used} of {total} tokens ({percent}%)"),
            ));
        }
    }
    if let Some(at) = number(context, "autoCompactThresholdPercent") {
        rows.push(row("Compacts at", format!("{at}%")));
    }
    for (key, label) in [
        ("compactionCount", "Compactions"),
        ("messageCount", "Messages"),
        ("toolCallCount", "Tool calls"),
    ] {
        if let Some(count) = number(context, key) {
            rows.push(row(label, count.to_string()));
        }
    }
    if !rows.is_empty() {
        if let Some(id) = text(info, "sessionId") {
            rows.push(row("Session", id));
        }
        if let Some(cwd) = text(info, "cwd") {
            rows.push(row("Folder", cwd));
        }
    }
    rows
}
