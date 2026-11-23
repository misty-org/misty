use super::*;

pub(super) async fn shell_v2(
    server: &Server,
    session: &str,
    command: &str,
) -> Result<Output, String> {
    server
        .call_for(
            Method::POST,
            &format!("/api/session/{session}/shell"),
            Some(json!({ "command": command })),
            SHELL_TIMEOUT,
        )
        .await?;
    let recent = server
        .get(&format!("/api/session/{session}/message?limit=20"))
        .await?;
    let ran =
        data(&recent).as_array().into_iter().flatten().find(|m| {
            text_at(m, "/type") == Some("shell") && text_at(m, "/command") == Some(command)
        });
    let output = ran
        .and_then(|m| text_at(m, "/output/output"))
        .unwrap_or_default();
    let mut output = tail(output.trim_end(), MOST_OUTPUT).to_owned();
    if let Some(exit) = ran
        .and_then(|m| m.get("exit"))
        .and_then(Value::as_i64)
        .filter(|exit| *exit != 0)
    {
        output.push_str(&format!("\n(exit {exit})"));
    }
    Ok(shell_output(command, output.trim_start()))
}

pub(super) async fn shell(server: &Server, session: &str, command: &str) -> Result<Output, String> {
    let agent = shell_agent(server, session).await;
    let reply = server
        .call_for(
            Method::POST,
            &format!("/session/{session}/shell"),
            Some(json!({ "agent": agent, "command": command })),
            SHELL_TIMEOUT,
        )
        .await?;
    let output = reply
        .get("parts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|part| part.get("type").and_then(Value::as_str) == Some("tool"))
        .filter_map(|part| text_at(part, "/state/output"))
        .collect::<Vec<_>>()
        .join("\n");
    Ok(shell_output(command, tail(output.trim_end(), MOST_OUTPUT)))
}

fn shell_output(command: &str, output: &str) -> Output {
    let text = if output.is_empty() {
        "The command printed nothing.".to_string()
    } else {
        let fence = if output.contains("```") {
            "~~~~"
        } else {
            "```"
        };
        format!("{fence}\n{output}\n{fence}")
    };
    Output::info(
        format!("$ {command}"),
        vec![Section {
            text: Some(text),
            ..Default::default()
        }],
    )
}

async fn shell_agent(server: &Server, session: &str) -> String {
    let messages = server.messages(session).await.unwrap_or_default();
    if let Some(agent) =
        opencode_session::last_user_message(&messages).and_then(|m| text_at(m, "/info/agent"))
    {
        return agent.to_owned();
    }
    let agents = server.get("/agent").await.unwrap_or(Value::Null);
    agents
        .as_array()
        .into_iter()
        .flatten()
        .find(|agent| {
            text_at(agent, "/mode") != Some("subagent")
                && agent.get("hidden").and_then(Value::as_bool) != Some(true)
        })
        .and_then(|agent| text_at(agent, "/name"))
        .unwrap_or("build")
        .to_owned()
}
