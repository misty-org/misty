use super::*;

const SIDE_QUESTION: std::time::Duration = std::time::Duration::from_secs(300);

fn one_line(title: &str) -> String {
    title.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(super) async fn rename(context: &Context) -> Result<Output, String> {
    let title = one_line(&context.args);
    if title.is_empty() {
        return Err("Give the chat a name: /rename <name>.".into());
    }
    if context.session.is_some() {
        ask(
            context,
            json!({ "subtype": "rename_session", "title": title, "source": "host" }),
        )
        .await?;
    }
    Ok(Output::Rename { title })
}

pub(super) async fn branch(context: &Context, fork: bool) -> Result<Output, String> {
    let session = session(context)?;
    let args = context.args.trim().to_string();
    if fork && args.is_empty() {
        return Err("Say what the new chat should do: /fork <directive>.".into());
    }
    let folder = folder(context);
    let mut control = Control::start(&folder, Some(session), true).await?;
    let outcome = branch_with(&mut control, &folder, session, &args, fork).await;
    control.finish().await;
    outcome
}

async fn branch_with(
    control: &mut Control,
    folder: &std::path::Path,
    session: &str,
    args: &str,
    fork: bool,
) -> Result<Output, String> {
    let title = if !fork && !args.is_empty() {
        one_line(args)
    } else {
        let status = control
            .request(json!({ "subtype": "get_status" }), ANSWER)
            .await?;
        let name = list(&status, "sections")
            .iter()
            .flat_map(|part| list(part, "rows"))
            .find(|item| field(item, "label") == "Session name")
            .map(|item| one_line(&field(item, "value")))
            .filter(|name| !name.is_empty());
        match name {
            Some(name) => format!("{name} (Branch)"),
            None => "Branch".to_string(),
        }
    };
    let result = control
        .send_text(folder, &format!("/rename {title}"), ANSWER)
        .await?;
    if result.get("is_error").and_then(Value::as_bool) == Some(true) {
        return Err(field(&result, "result"));
    }
    let copy = field(&result, "session_id");
    if copy.is_empty() || copy == session {
        return Err("Claude Code didn't make a copy of this session.".into());
    }
    Ok(Output::Fork {
        session: copy,
        title: Some(title),
        prompt: fork.then(|| args.to_string()),
    })
}

pub(super) async fn side_question(context: &Context) -> Result<Output, String> {
    let question = context.args.trim();
    if question.is_empty() {
        return Err("Ask your question after /btw.".into());
    }
    let answer = control::ask(
        &folder(context),
        context.session.as_deref(),
        json!({ "subtype": "side_question", "question": question }),
        SIDE_QUESTION,
    )
    .await?;
    let reply = field(&answer, "response");
    if reply.trim().is_empty() {
        return Err("Claude had no answer.".into());
    }
    Ok(Output::info(
        "Side question",
        vec![note(Some(question), reply)],
    ))
}

pub(super) async fn feedback(context: &Context) -> Result<Output, String> {
    let description = context.args.trim();
    if description.is_empty() {
        return Err("Write your feedback after the command.".into());
    }
    let answer = ask(
        context,
        json!({ "subtype": "submit_feedback", "description": description }),
    )
    .await?;
    let id = field(&answer, "feedback_id");
    if !id.is_empty() {
        return Ok(Output::done(format!(
            "Sent to Anthropic. Feedback ID: {id}"
        )));
    }
    let reason = ["unavailable_reason", "failure_reason"]
        .into_iter()
        .map(|key| field(&answer, key))
        .find(|reason| !reason.is_empty())
        .unwrap_or_else(|| "Claude Code couldn't send it.".into());
    Err(reason)
}
