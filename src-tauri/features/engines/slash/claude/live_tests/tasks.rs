//! `/tasks` and `/tasks stop` on a real turn: Claude Code (haiku) starts a background shell,
//! and while its process stays alive for that shell, Misty lists the task and stops it.

use std::time::Duration;

use super::super::super::live_turn;
use super::*;

/// A command no other program on the machine runs, so `pgrep` finds only the test's shell.
const SHELL: &str = "sleep 127";

fn shell_running() -> bool {
    std::process::Command::new("pgrep")
        .args(["-f", SHELL])
        .output()
        .is_ok_and(|output| !output.stdout.is_empty())
}

fn pending_tasks(events: &[(String, serde_json::Value)]) -> Option<u64> {
    events
        .iter()
        .rev()
        .find(|(kind, _)| kind == "background_tasks")
        .and_then(|(_, data)| data["pending"].as_u64())
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "runs a real Claude Code turn (haiku) that starts a background shell"]
async fn tasks_lists_and_stops_a_background_shell() {
    let scratch = scratch();
    assert!(!shell_running(), "`{SHELL}` is already running elsewhere");
    // Claude Code asks for Bash in its acceptEdits mode; Misty's gate allows it here.
    live_turn::engines(true);
    let prompt = format!(
        "Use your Bash tool with run_in_background set to true to run `{SHELL}`. Don't wait \
         for it or check on it. Then reply with just the word started."
    );
    let run = live_turn::send(
        "claude",
        &scratch.folder,
        None,
        &prompt,
        "haiku",
        None,
        "auto",
    )
    .await;
    // The turn settles in the chat while the shell runs; its process stays for the follow-up.
    let events = live_turn::wait_for(
        &run,
        Duration::from_secs(180),
        "the turn to settle with a background task",
        |events| live_turn::settled(events) && pending_tasks(events).is_some_and(|n| n > 0),
    )
    .await;
    live_turn::print(&run);
    let session = live_turn::session_of(&events).expect("the turn's session id");
    println!("session {session}");
    assert!(shell_running(), "the background shell runs");

    let listed = show(context(&scratch, Some(&session), ""), "tasks")
        .await
        .expect("/tasks");
    let Output::Info { sections, .. } = &listed else {
        panic!("/tasks lists the task: {listed:?}");
    };
    let value = |section: &crate::engines::slash::Section, label: &str| {
        section
            .rows
            .iter()
            .find(|row| row.label == label)
            .map(|row| row.value.clone())
    };
    let shell = sections
        .iter()
        .find(|section| value(section, "Kind").as_deref() == Some("Shell"))
        .expect("a Shell task");
    assert_eq!(value(shell, "Status").as_deref(), Some("Running"));
    let id = value(shell, "ID").expect("the task's id");

    let stopped = show(
        context(&scratch, Some(&session), &format!("stop {id}")),
        "tasks",
    )
    .await
    .expect("/tasks stop");
    assert!(
        matches!(&stopped, Output::Done { notice: Some(notice) } if notice.starts_with("Stopped")),
        "{stopped:?}"
    );

    // Claude Code says so in its own events: the task's status changes (`task_updated`) or
    // the next list leaves it out (`background_tasks_changed`).
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    let task_state = loop {
        let state = crate::engines::claude::background_tasks(&session)
            .and_then(|listed| listed.tasks.into_iter().find(|task| task.id == id))
            .map(|task| task.status);
        if state.as_deref() != Some("running") {
            break state;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "Claude Code never reported the task stopped"
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
    };
    println!("task after the stop: {task_state:?}");
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while shell_running() {
        assert!(
            tokio::time::Instant::now() < deadline,
            "`{SHELL}` still runs after the stop"
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    // With nothing left in the background the parked process ends, as a finished turn's does.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    let state = live_turn::engines(true);
    while state.processes.get(&session).is_some() && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    println!("\nafter the stop:");
    live_turn::print(&run);
    let after = show(context(&scratch, Some(&session), ""), "tasks")
        .await
        .expect("/tasks after");
    if state.processes.get(&session).is_some() {
        state.processes.kill(&session);
        panic!("the turn's process stayed alive after its task stopped");
    }
    assert!(
        matches!(&after, Output::Done { notice: Some(notice) } if notice.starts_with("Nothing is running")),
        "{after:?}"
    );
    assert!(
        live_turn::events(&run)
            .iter()
            .any(|(kind, _)| kind == "process_closed"),
        "the bridge hears the parked process end"
    );
}
