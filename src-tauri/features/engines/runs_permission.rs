use serde_json::Value;
use tauri::AppHandle;

use crate::agents::run_control::tool_policy::RunFacts;
use crate::browser::agent_pages::action_confirm::{ask_tool, Answer, ToolAsk};
use crate::engines::gate::Decision;

pub(super) async fn decide(app: &AppHandle, run_id: &str, tool: &str, input: &Value) -> Decision {
    let Some(body) = super::request_of(run_id) else {
        return Decision::Deny("This run has ended.".into());
    };
    let facts = RunFacts::of_request(run_id, &body);
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
