use super::*;

async fn live_turn(session: &str) -> Option<crate::engines::ChildEntry> {
    let entry = crate::engines::support::state()?.processes.get(session)?;
    let open = entry.stdin.as_ref()?.lock().await.is_some();
    open.then_some(entry)
}

fn live_tasks(session: &str, turn: &crate::engines::ChildEntry) -> Vec<BackgroundTask> {
    claude::background_tasks(session)
        .filter(|listed| listed.pid.is_none_or(|pid| pid == turn.pid))
        .map(|listed| listed.tasks)
        .unwrap_or_default()
}

fn task_kind(task: &BackgroundTask) -> String {
    let kind = match task.kind.as_str() {
        "local_bash" => "Shell",
        "local_agent" => "Agent",
        "remote_agent" => "Cloud agent",
        "local_workflow" => "Workflow",
        "in_process_teammate" => "Teammate",
        "monitor_mcp" | "monitor_ws" => "Monitor",
        "dream" => "Memory",
        "" => "Task",
        other => other,
    };
    match task.agent.as_deref() {
        Some(agent) => format!("{kind} ({agent})"),
        None => kind.to_string(),
    }
}

fn task_status(status: &str) -> String {
    let mut chars = status.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => "Running".into(),
    }
}

pub(super) async fn tasks(context: &Context) -> Result<Output, String> {
    let mut words = context.args.split_whitespace();
    match (words.next(), words.next(), words.next()) {
        (None, ..) => list_tasks(context).await,
        (Some("stop" | "kill"), Some(id), None) => stop_task(context, id).await,
        (Some("stop" | "kill"), None, _) => Err("Say which task to stop: /tasks stop <id>.".into()),
        _ => Err("Use /tasks to list background tasks, or /tasks stop <id> to stop one.".into()),
    }
}

const NOTHING_RUNNING: &str = "Nothing is running in the background.";

async fn list_tasks(context: &Context) -> Result<Output, String> {
    let Some(session) = context.session.as_deref() else {
        return Ok(Output::done(NOTHING_RUNNING));
    };
    let Some(turn) = live_turn(session).await else {
        let ended = claude::background_tasks(session).is_some();
        claude::forget_background_tasks(session);
        return Ok(Output::done(if ended {
            "Nothing is running in the background: Claude Code's background tasks live in the process of the turn that started them, and ended with the last turn."
        } else {
            NOTHING_RUNNING
        }));
    };
    let tasks = live_tasks(session, &turn);
    if tasks.is_empty() {
        return Ok(Output::done(NOTHING_RUNNING));
    }
    let mut sections: Vec<Section> = tasks
        .iter()
        .map(|task| Section {
            heading: Some(if task.description.is_empty() {
                task.id.clone()
            } else {
                task.description.clone()
            }),
            rows: vec![
                row("Kind", task_kind(task)),
                row("Status", task_status(&task.status)),
                row("ID", task.id.clone()),
            ],
            text: None,
        })
        .collect();
    sections.push(note(None, "Stop one with /tasks stop <id>."));
    Ok(Output::info("Background tasks", sections))
}

async fn stop_task(context: &Context, id: &str) -> Result<Output, String> {
    let live = match context.session.as_deref() {
        Some(session) => live_turn(session).await.map(|turn| (session, turn)),
        None => None,
    };
    let Some((session, turn)) = live else {
        return Ok(Output::done(format!(
            "{NOTHING_RUNNING} There's no task to stop."
        )));
    };
    let tasks = live_tasks(session, &turn);
    let Some(task) = tasks.iter().find(|task| task.id == id) else {
        return Err(format!(
            "No background task has the ID {id}. /tasks lists the ones running."
        ));
    };
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let request_id = format!(
        "misty-stop-{}",
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    );
    let line = json!({
        "type": "control_request",
        "request_id": request_id,
        "request": { "subtype": "stop_task", "task_id": task.id },
    })
    .to_string();
    let state = crate::engines::support::state()
        .ok_or_else(|| "Misty's engines aren't open yet.".to_string())?;
    state.processes.write_line(session, line).await?;
    let name = if task.description.is_empty() {
        &task.id
    } else {
        &task.description
    };
    if !stopped(session, &turn, &task.id).await {
        return Ok(Output::done(format!("Stopping {name}")));
    }
    if live_tasks(session, &turn).is_empty() {
        if let Some(parked) = state.processes.take_awaiting_followup(session) {
            state.processes.close_stdin(&parked.run_id);
        }
    }
    Ok(Output::done(format!("Stopped {name}")))
}

const STOP_REPORT: std::time::Duration = std::time::Duration::from_secs(10);

async fn stopped(session: &str, turn: &crate::engines::ChildEntry, id: &str) -> bool {
    let deadline = tokio::time::Instant::now() + STOP_REPORT;
    loop {
        let running = live_tasks(session, turn)
            .iter()
            .any(|task| task.id == id && task.status == "running");
        if !running {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}
