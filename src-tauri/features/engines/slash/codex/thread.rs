//! The chat's thread: renaming, forking, side questions, archiving, approving a denied action,
//! deleting, its goal, its background terminals, subagents and rollout.

use super::*;

pub(super) async fn rename(context: &Context) -> Result<Output, String> {
    let Some(thread) = context.session.as_deref() else {
        return Ok(Output::done(NO_THREAD));
    };
    let name = context.args.trim();
    if name.is_empty() {
        return Err("Write the new name after the command: /rename <name>".into());
    }
    on_thread_once(
        context,
        thread,
        "thread/name/set",
        json!({ "threadId": thread, "name": name }),
    )
    .await?;
    Ok(Output::Rename {
        title: name.to_string(),
    })
}

pub(super) async fn fork(context: &Context) -> Result<Output, String> {
    let Some(thread) = context.session.as_deref() else {
        return Ok(Output::done(NO_THREAD));
    };
    let forked = call_once(
        context,
        "thread/fork",
        json!({ "threadId": thread, "excludeTurns": true }),
    )
    .await?;
    let session = text_at(&forked, "/thread/id")
        .ok_or("Codex made no thread for the fork.")?
        .to_string();
    let prompt = context.args.trim();
    Ok(Output::Fork {
        session,
        title: text_at(&forked, "/thread/name").map(str::to_string),
        prompt: (!prompt.is_empty()).then(|| prompt.to_string()),
    })
}

/// A side question: asked in an ephemeral fork, which Codex never saves, so the chat's own
/// thread never sees it. The fork reads only and asks nothing, since nobody is there to approve
/// anything outside a turn.
pub(super) async fn side(context: &Context, name: &str) -> Result<Output, String> {
    let Some(thread) = context.session.as_deref() else {
        return Ok(Output::done(NO_THREAD));
    };
    let question = context.args.trim();
    if question.is_empty() {
        return Err(format!(
            "Write the question after the command: /{name} <question>"
        ));
    }
    let mut rpc = open(context).await?;
    let answer = side_answer(&mut rpc, thread, question).await;
    rpc.stop().await;
    Ok(Output::info(
        "Side question",
        vec![Section {
            heading: Some(question.to_string()),
            text: Some(answer?),
            ..Default::default()
        }],
    ))
}

async fn side_answer(rpc: &mut Session, thread: &str, question: &str) -> Result<String, String> {
    let forked = rpc
        .call(
            "thread/fork",
            json!({
                "threadId": thread,
                "ephemeral": true,
                "excludeTurns": true,
                "sandbox": "read-only",
                "approvalPolicy": "never",
            }),
        )
        .await
        .map_err(text)?;
    let side = text_at(&forked, "/thread/id")
        .ok_or("Codex made no thread for the side question.")?
        .to_string();
    rpc.allow(SIDE_TIMEOUT);
    rpc.call(
        "turn/start",
        json!({ "threadId": side, "input": [{ "type": "text", "text": question }] }),
    )
    .await
    .map_err(text)?;
    // The last agent message of the turn is its answer; earlier ones are commentary.
    let mut answer = String::new();
    loop {
        let message = rpc.next_notification().await.map_err(text)?;
        let params = &message["params"];
        if params["threadId"].as_str() != Some(side.as_str()) {
            continue;
        }
        match message["method"].as_str() {
            Some("item/completed") if params["item"]["type"].as_str() == Some("agentMessage") => {
                if let Some(said) = text_at(params, "/item/text") {
                    answer = said.to_string();
                }
            }
            Some("turn/completed") => {
                if params["turn"]["status"].as_str() == Some("failed") {
                    return Err(text_at(params, "/turn/error/message")
                        .unwrap_or("Codex couldn't answer the side question.")
                        .to_string());
                }
                break;
            }
            _ => {}
        }
    }
    if answer.is_empty() {
        return Err("Codex finished without an answer.".into());
    }
    Ok(answer)
}

/// Archives the thread; the composer archives the chat.
pub(super) async fn archive(context: &Context) -> Result<Output, String> {
    let Some(thread) = context.session.as_deref() else {
        return Ok(Output::done(NO_THREAD));
    };
    on_thread_once(
        context,
        thread,
        "thread/archive",
        json!({ "threadId": thread }),
    )
    .await?;
    Ok(Output::done("Archived this Codex thread."))
}

/// Approves one retry of the action Codex's auto-review last denied in this chat, as the
/// terminal app's `/approve` does. The turn kept the denial (`codex_app_denials.rs`); Codex
/// writes the approval into the thread for the model to read on the next turn.
pub(super) async fn approve(context: &Context) -> Result<Output, String> {
    let Some(thread) = context.session.as_deref() else {
        return Ok(Output::done(NO_THREAD));
    };
    let Some(event) = denials::take(thread) else {
        return Ok(Output::done(
            "Nothing to approve: Codex's auto-review hasn't denied anything in this chat.",
        ));
    };
    let mut rpc = open(context).await?;
    let approved = approve_denial(&mut rpc, thread, &event).await;
    rpc.stop().await;
    if let Err(error) = approved {
        denials::restore(thread, event);
        return Err(error);
    }
    Ok(Output::done(format!(
        "Approved one retry of this action: {}. Ask Codex to try it again.",
        denials::summary(&event)
    )))
}

async fn approve_denial(rpc: &mut Session, thread: &str, event: &Value) -> Result<(), String> {
    // This app-server has just started, so the thread isn't loaded, and Codex approves only on
    // a loaded thread; resuming also says where its rollout file is.
    let resumed = rpc
        .call(
            "thread/resume",
            json!({ "threadId": thread, "excludeTurns": true }),
        )
        .await
        .map_err(text)?;
    let rollout = text_at(&resumed, "/thread/path").map(Path::new);
    let start = match rollout {
        Some(path) => tokio::fs::metadata(path).await.map_or(0, |meta| meta.len()),
        None => 0,
    };
    rpc.call(
        "thread/approveGuardianDeniedAction",
        json!({ "threadId": thread, "event": event }),
    )
    .await
    .map_err(text)?;
    // Codex answers once the approval is queued and writes it into the thread after, so the
    // app-server must not stop before the rollout file has it.
    match rollout {
        Some(path) => approval_saved(path, start).await,
        None => {
            tokio::time::sleep(Duration::from_secs(1)).await;
            Ok(())
        }
    }
}

/// Waits until the rollout file has Codex's approval note past `start`, where it stood before
/// the approval.
async fn approval_saved(path: &Path, start: u64) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + APPROVAL_SAVE_TIMEOUT;
    loop {
        if rollout_has_note(path, start).await {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("Codex didn't save the approval in time. Try /approve again.".to_string());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn rollout_has_note(path: &Path, start: u64) -> bool {
    let Ok(mut file) = tokio::fs::File::open(path).await else {
        return false;
    };
    if file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
        return false;
    }
    let mut added = Vec::new();
    if file.read_to_end(&mut added).await.is_err() {
        return false;
    }
    String::from_utf8_lossy(&added).contains(APPROVAL_NOTE)
}

pub(super) async fn delete(context: &Context) -> Result<Output, String> {
    let Some(thread) = context.session.as_deref() else {
        return Ok(Output::done(NO_THREAD));
    };
    on_thread_once(
        context,
        thread,
        "thread/delete",
        json!({ "threadId": thread }),
    )
    .await?;
    Ok(Output::done(
        "Deleted this Codex thread and its subagent threads.",
    ))
}

pub(super) async fn goal(context: &Context) -> Result<Output, String> {
    let Some(thread) = context.session.as_deref() else {
        return Ok(Output::done(NO_THREAD));
    };
    let args = context.args.trim();
    let (method, params) = match args {
        "" => ("thread/goal/get", json!({ "threadId": thread })),
        "clear" => ("thread/goal/clear", json!({ "threadId": thread })),
        "pause" => (
            "thread/goal/set",
            json!({ "threadId": thread, "status": "paused" }),
        ),
        "resume" => (
            "thread/goal/set",
            json!({ "threadId": thread, "status": "active" }),
        ),
        objective => (
            "thread/goal/set",
            json!({ "threadId": thread, "objective": objective }),
        ),
    };
    let result = on_thread_once(context, thread, method, params).await?;
    if args == "clear" {
        return Ok(Output::done("Cleared the goal."));
    }
    let goal = &result["goal"];
    if goal.is_null() {
        return Ok(Output::done(
            "No goal is set. Set one with /goal <objective>.",
        ));
    }
    let mut rows = vec![
        row("Objective", goal["objective"].as_str().unwrap_or_default()),
        row("Status", goal["status"].as_str().unwrap_or("unknown")),
    ];
    if let Some(seconds) = goal["timeUsedSeconds"].as_i64() {
        rows.push(row("Time used", duration(seconds)));
    }
    if let Some(tokens) = goal["tokensUsed"].as_i64() {
        let used = match goal["tokenBudget"].as_i64() {
            Some(budget) => format!("{} of {}", count(tokens), count(budget)),
            None => count(tokens),
        };
        rows.push(row("Tokens used", used));
    }
    Ok(Output::info("Goal", vec![rows_only(rows)]))
}

pub(super) async fn background_terminals(context: &Context) -> Result<Output, String> {
    let Some(thread) = context.session.as_deref() else {
        return Ok(Output::done(NO_THREAD));
    };
    let mut rpc = open(context).await?;
    let listed = match on_thread(
        &mut rpc,
        thread,
        "thread/backgroundTerminals/list",
        json!({ "threadId": thread }),
    )
    .await
    {
        Ok(first) => {
            let mut items = first["data"].as_array().cloned().unwrap_or_default();
            if let Some(cursor) = first["nextCursor"].as_str().filter(|c| !c.is_empty()) {
                items.extend(
                    all_pages(
                        &mut rpc,
                        "thread/backgroundTerminals/list",
                        json!({ "threadId": thread, "cursor": cursor }),
                    )
                    .await
                    .unwrap_or_default(),
                );
            }
            Ok(items)
        }
        Err(error) => Err(error),
    };
    rpc.stop().await;
    let terminals = listed?;
    if terminals.is_empty() {
        return Ok(Output::done("No background terminals are running."));
    }
    let rows = terminals
        .iter()
        .map(|terminal| {
            let mut value = terminal["cwd"].as_str().unwrap_or_default().to_string();
            if let Some(pid) = terminal["osPid"].as_i64() {
                value.push_str(&format!(" · pid {pid}"));
            }
            row(terminal["command"].as_str().unwrap_or("terminal"), value)
        })
        .collect();
    Ok(Output::info("Background terminals", vec![rows_only(rows)]))
}

pub(super) async fn stop_background_terminals(context: &Context) -> Result<Output, String> {
    let Some(thread) = context.session.as_deref() else {
        return Ok(Output::done(NO_THREAD));
    };
    on_thread_once(
        context,
        thread,
        "thread/backgroundTerminals/clean",
        json!({ "threadId": thread }),
    )
    .await?;
    Ok(Output::done("Stopped all background terminals."))
}

/// The subagent threads this chat's thread spawned, at any depth. Misty sends every message to
/// the chat's own thread, so this lists them without switching to one.
pub(super) async fn subagents(context: &Context) -> Result<Output, String> {
    let Some(thread) = context.session.as_deref() else {
        return Ok(Output::done(NO_THREAD));
    };
    let mut rpc = open(context).await?;
    let listed = all_pages(
        &mut rpc,
        "thread/list",
        json!({ "ancestorThreadId": thread, "sourceKinds": SUBAGENT_SOURCES, "limit": 100 }),
    )
    .await;
    rpc.stop().await;
    let threads = listed?;
    if threads.is_empty() {
        return Ok(Output::done("This chat has no subagent threads."));
    }
    let rows = threads
        .iter()
        .map(|child| {
            let name = text_at(child, "/agentNickname")
                .or_else(|| text_at(child, "/name"))
                .or_else(|| text_at(child, "/id"))
                .unwrap_or("subagent");
            let mut value = text_at(child, "/agentRole").unwrap_or_default().to_string();
            if let Some(preview) = text_at(child, "/preview") {
                if !value.is_empty() {
                    value.push_str(" · ");
                }
                value.push_str(&short(preview, 100));
            }
            row(name, value)
        })
        .collect();
    Ok(Output::info(
        "Subagents",
        vec![Section {
            rows,
            text: Some(
                "Misty sends each message to this chat's main thread; it can't switch to a \
                 subagent's thread."
                    .into(),
            ),
            ..Default::default()
        }],
    ))
}

pub(super) async fn rollout(context: &Context) -> Result<Output, String> {
    let Some(thread) = context.session.as_deref() else {
        return Ok(Output::done(NO_THREAD));
    };
    let read = call_once(
        context,
        "thread/read",
        json!({ "threadId": thread, "includeTurns": false }),
    )
    .await?;
    match text_at(&read, "/thread/path") {
        Some(path) => Ok(Output::info(
            "Rollout",
            vec![rows_only(vec![row("File", path)])],
        )),
        None => Ok(Output::done(
            "Codex hasn't written this thread's rollout file yet.",
        )),
    }
}
