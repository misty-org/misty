//! The permission asks an engine raises during a run, answered from the mode the run started
//! with: allowed, refused, or put to the person through the same question Misty's own agent asks.

use serde_json::Value;
use tauri::AppHandle;

use crate::agents::run_control::tool_policy::RunFacts;
use crate::browser::agent_pages::action_confirm::{ask_tool, Answer, ToolAsk};
use crate::engines::gate::Decision;

/// Whether the engine may go ahead with what it asked for. Auto runs don't stop for ordinary
/// work, a plan changes nothing, Bypass never asks (the engine skips its own asks), and in Ask
/// the person answers the same question Misty's own agent would raise.
pub(super) async fn decide(app: &AppHandle, run_id: &str, tool: &str, input: &Value) -> Decision {
    let Some(body) = super::request_of(run_id) else {
        return Decision::Deny("This run has ended.".into());
    };
    let facts = RunFacts::of_request(run_id, &body);
    // A call into Misty's own server is journaled and gated there, under this run's mode, so the
    // person isn't asked once here and once more by the tool itself. A plan still changes nothing.
    let misty = crate::engines::mcp::names_misty_tool(tool, input);
    if misty && !facts.planning {
        return Decision::Allow;
    }
    match (facts.planning, facts.auto) {
        (true, _) => Decision::Deny(
            "This chat is planning, so nothing is changed yet. Finish the plan instead.".into(),
        ),
        (false, true) => Decision::Allow,
        (false, false) => {
            let about = summarize(input);
            let control = if about.is_empty() {
                tool.to_string()
            } else {
                format!("{tool}: {about}")
            };
            let answer = ask_tool(
                app,
                ToolAsk {
                    account: &facts.account,
                    kind: "action",
                    control: &control,
                    reason: "This chat asks before an agent changes files or runs a command.",
                    site: "",
                    agent_id: &facts.agent_id,
                    task_id: &facts.task_id,
                },
            )
            .await;
            match answer {
                Answer::Allowed => Decision::Allow,
                Answer::Refused => Decision::Deny(
                    "The person declined this. Do not retry it; continue without it or ask them."
                        .into(),
                ),
                Answer::Unanswered => Decision::Deny("Nobody answered in time.".into()),
            }
        }
    }
}

/// What a permission ask is about, in one line. Engines spell the same field differently
/// (`file_path`, `filePath`, Antigravity's `Path` and `CommandLine`), so keys are matched without
/// case or underscores.
pub(super) fn summarize(input: &Value) -> String {
    let fields = input.as_object();
    let named = |name: &str| {
        fields?.iter().find_map(|(key, value)| {
            let key = key.replace('_', "").to_ascii_lowercase();
            (key == name).then_some(value)
        })
    };
    let names = [
        "command",
        "commandline",
        "filepath",
        "path",
        "targetfile",
        "absolutepath",
        "url",
        "pattern",
        "query",
    ];
    let field = names
        .iter()
        .find_map(|name| named(name)?.as_str())
        .map(str::to_string)
        .or_else(|| {
            named("command")?
                .as_array()
                .and_then(|parts| parts.last()?.as_str())
                .map(str::to_string)
        })
        .unwrap_or_default();
    let mut text: String = field.chars().take(600).collect();
    if field.chars().count() > 600 {
        text.push('…');
    }
    text
}
