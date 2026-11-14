//! Codex's own terminal commands (`/compact`, `/review`, `/init`) as the app-server runs them,
//! and the turn id a turn they start reports in its `turn/started`.

use serde_json::{json, Value};

/// The turn id a `turn/started` notification gives for `thread`; another thread's (a
/// sub-agent's) is not this turn's.
pub(super) fn started_turn_id<'a>(value: &'a Value, thread: &str) -> Option<&'a str> {
    if value.get("method").and_then(Value::as_str) != Some("turn/started")
        || value.pointer("/params/threadId").and_then(Value::as_str) != Some(thread)
    {
        return None;
    }
    value
        .pointer("/params/turn/id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
}

/// What a message that is one of Codex's own commands turns into.
#[derive(Debug, PartialEq)]
pub(super) enum NativeCommand {
    /// An app-server call that starts the turn itself.
    Call(&'static str, Value),
    /// An ordinary turn with this text instead of the message.
    Prompt(&'static str),
}

/// Codex's own prompt for `/init`, as its terminal app sends it (`prompt_for_init_command.md`,
/// codex 0.147.0). The prompt itself tells the model to leave an existing AGENTS.md alone.
const INIT_PROMPT: &str = r#"Generate a file named AGENTS.md that serves as a contributor guide for this repository.
Before writing, check whether AGENTS.md already exists in the current working directory. If it does, do not overwrite or modify it.
Your goal is to produce a clear, concise, and well-structured document with descriptive headings and actionable explanations for each section.
Follow the outline below, but adapt as needed — add sections if relevant, and omit those that do not apply to this project.

Document Requirements

- Title the document "Repository Guidelines".
- Use Markdown headings (#, ##, etc.) for structure.
- Keep the document concise. 200-400 words is optimal.
- Keep explanations short, direct, and specific to this repository.
- Provide examples where helpful (commands, directory paths, naming patterns).
- Maintain a professional, instructional tone.

Recommended Sections

Project Structure & Module Organization

- Outline the project structure, including where the source code, tests, and assets are located.

Build, Test, and Development Commands

- List key commands for building, testing, and running locally (e.g., npm test, make build).
- Briefly explain what each command does.

Coding Style & Naming Conventions

- Specify indentation rules, language-specific style preferences, and naming patterns.
- Include any formatting or linting tools used.

Testing Guidelines

- Identify testing frameworks and coverage requirements.
- State test naming conventions and how to run tests.

Commit & Pull Request Guidelines

- Summarize commit message conventions found in the project’s Git history.
- Outline pull request requirements (descriptions, linked issues, screenshots, etc.).

(Optional) Add other sections if relevant, such as Security & Configuration Tips, Architecture Overview, or Agent-Specific Instructions.
"#;

/// The app-server call for a message that is one of Codex's own commands, if it is: `/compact`
/// alone compacts the thread; `/review` reviews the uncommitted changes, or follows the
/// instructions written after it; `/init` alone asks for an AGENTS.md with Codex's own prompt.
/// Anything else, or a message with images, is a turn.
pub(super) fn native_command(
    prompt: &str,
    images: &[String],
    thread_id: &str,
) -> Option<NativeCommand> {
    if !images.is_empty() {
        return None;
    }
    let text = prompt.trim();
    if text == "/compact" {
        return Some(NativeCommand::Call(
            "thread/compact/start",
            json!({ "threadId": thread_id }),
        ));
    }
    if text == "/init" {
        return Some(NativeCommand::Prompt(INIT_PROMPT));
    }
    let rest = text.strip_prefix("/review")?;
    if !rest.is_empty() && !rest.starts_with(char::is_whitespace) {
        return None;
    }
    let instructions = rest.trim();
    let target = if instructions.is_empty() {
        json!({ "type": "uncommittedChanges" })
    } else {
        json!({ "type": "custom", "instructions": instructions })
    };
    Some(NativeCommand::Call(
        "review/start",
        json!({ "threadId": thread_id, "target": target, "delivery": "inline" }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use crate::engines::codex_app::tests::{recorded, test_core};
    use crate::engines::codex_app::*;

    #[test]
    fn codex_commands_go_to_the_app_servers_own_calls() {
        let target = |command: Option<NativeCommand>| match command {
            Some(NativeCommand::Call(_, params)) => Some(params["target"].clone()),
            _ => None,
        };
        assert_eq!(
            native_command(" /compact ", &[], "t1"),
            Some(NativeCommand::Call(
                "thread/compact/start",
                json!({ "threadId": "t1" })
            ))
        );
        assert_eq!(
            target(native_command("/review", &[], "t1")),
            Some(json!({ "type": "uncommittedChanges" }))
        );
        assert_eq!(
            target(native_command("/review only the parser", &[], "t1")),
            Some(json!({ "type": "custom", "instructions": "only the parser" }))
        );
        assert_eq!(
            native_command(" /init ", &[], "t1"),
            Some(NativeCommand::Prompt(INIT_PROMPT))
        );
        assert_eq!(native_command("/init now", &[], "t1"), None);
        assert_eq!(native_command("/reviewer", &[], "t1"), None);
        assert_eq!(native_command("/compact this", &[], "t1"), None);
        assert_eq!(native_command("/compact", &["a.png".into()], "t1"), None);
        assert_eq!(native_command("please /compact", &[], "t1"), None);
    }

    /// `thread/compact/start` answers without a turn id, so the id comes from the main
    /// thread's `turn/started`; a sub-agent's turn or another frame is not it.
    #[test]
    fn the_turn_id_comes_from_the_main_threads_turn_started() {
        let started = |thread: &str, turn: &str| {
            json!({
                "method": "turn/started",
                "params": { "threadId": thread, "turn": { "id": turn, "items": [], "status": "inProgress" } },
            })
        };
        assert_eq!(
            started_turn_id(&started("t1", "turn-7"), "t1"),
            Some("turn-7")
        );
        assert_eq!(started_turn_id(&started("child", "turn-8"), "t1"), None);
        assert_eq!(started_turn_id(&started("t1", ""), "t1"), None);
        let completed = json!({
            "method": "turn/completed",
            "params": { "threadId": "t1", "turn": { "id": "turn-7" } },
        });
        assert_eq!(started_turn_id(&completed, "t1"), None);
    }

    /// Stopping `/compact`: its reply had no turn id, so the pump interrupts the turn
    /// `turn/started` named instead of ending the CLI.
    #[cfg(unix)]
    #[tokio::test(start_paused = true)]
    async fn stopping_a_compact_interrupts_the_turn_it_started() {
        let (core, _registry, _emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        let directory =
            std::env::temp_dir().join(format!("ccgui-codex-compact-stop-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let received = directory.join("received");
        let mut command = Command::new("sh");
        command.args([
            "-c",
            &format!(
                "printf '%s\\n' '{}'; cat > '{}'; exec sleep 30",
                r#"{"method":"turn/started","params":{"threadId":"t1","turn":{"id":"turn-c","items":[],"status":"inProgress"}}}"#,
                received.display()
            ),
        ]);
        let mut spawned = spawn_app_server(&mut command, &directory).unwrap();
        let killed = Arc::new(AtomicBool::new(false));
        let started = TurnStarted {
            thread_id: "t1".into(),
            turn_id: None,
        };
        let (result, ()) = timeout(Duration::from_secs(40 * 60), async {
            tokio::join!(
                pump_turn_to_end(
                    &mut spawned.server,
                    &core,
                    &mut state,
                    &mut view,
                    &started,
                    &killed,
                ),
                async {
                    tokio::time::sleep(Duration::from_secs(60)).await;
                    killed.store(true, Ordering::SeqCst);
                },
            )
        })
        .await
        .expect("Stop must end the compaction");
        let sent = recorded(&received, "\"turn/interrupt\"");
        teardown(&mut spawned.child).await;
        let _ = std::fs::remove_dir_all(&directory);
        assert_eq!(result.unwrap_err(), CANCELLED);
        assert_eq!(view.turn_id.as_deref(), Some("turn-c"));
        assert!(sent.contains("\"turn/interrupt\""), "{sent}");
        assert!(sent.contains("\"turnId\":\"turn-c\""), "{sent}");
    }
}
