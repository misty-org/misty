use super::*;

pub(super) async fn rename(server: &Server, session: &str, title: &str) -> Result<Output, String> {
    let info = server
        .call(
            Method::PATCH,
            &server.path(
                format!("/session/{session}"),
                format!("/api/session/{session}"),
            ),
            Some(json!({ "title": title })),
        )
        .await?;
    let title = text_at(data(&info), "/title").unwrap_or(title).to_owned();
    Ok(Output::Rename { title })
}

pub(super) async fn fork(server: &Server, session: &str, message: &str) -> Result<Output, String> {
    let info = server
        .call(
            Method::POST,
            &server.path(
                format!("/session/{session}/fork"),
                format!("/api/session/{session}/fork"),
            ),
            Some(json!({})),
        )
        .await?;
    let info = data(&info);
    let forked = text_at(info, "/id").ok_or("OpenCode's fork gave no session id")?;
    Ok(Output::Fork {
        session: forked.to_owned(),
        title: text_at(info, "/title").map(str::to_owned),
        prompt: (!message.is_empty()).then(|| message.to_owned()),
    })
}

pub(super) async fn undo(server: &Server, session: &str) -> Result<Output, String> {
    let _ = server
        .call(Method::POST, &format!("/session/{session}/abort"), None)
        .await;
    let info = server.get(&format!("/session/{session}")).await?;
    let messages = server.messages(session).await?;
    let reverted_at = text_at(&info, "/revert/messageID");
    let in_place =
        match reverted_at.and_then(|id| messages.iter().position(|m| message_id(m) == Some(id))) {
            Some(index) => &messages[..index],
            None => &messages[..],
        };
    let Some(last) = opencode_session::last_user_message(in_place) else {
        return Ok(Output::done("There's nothing to undo."));
    };
    let id = message_id(last).unwrap_or_default();
    server
        .call(
            Method::POST,
            &format!("/session/{session}/revert"),
            Some(json!({ "messageID": id })),
        )
        .await?;
    let said = first_line(&prompt_text(last));
    Ok(Output::done(if said.is_empty() {
        "Undid your last message and its file changes. /redo brings them back.".to_string()
    } else {
        format!("Undid \"{said}\" and its file changes. /redo brings them back.")
    }))
}

pub(super) async fn redo(server: &Server, session: &str) -> Result<Output, String> {
    let info = server.get(&format!("/session/{session}")).await?;
    let Some(reverted_at) = text_at(&info, "/revert/messageID").map(str::to_owned) else {
        return Ok(Output::done("There's nothing to redo."));
    };
    let messages = server.messages(session).await?;
    let next = messages.iter().find(|message| {
        opencode_session::is_user_message(message)
            && message_id(message).is_some_and(|id| id > reverted_at.as_str())
    });
    match next.and_then(message_id) {
        Some(id) => {
            server
                .call(
                    Method::POST,
                    &format!("/session/{session}/revert"),
                    Some(json!({ "messageID": id })),
                )
                .await?;
            Ok(Output::done(
                "Brought back one message. /redo again for the next.",
            ))
        }
        None => {
            server
                .call(Method::POST, &format!("/session/{session}/unrevert"), None)
                .await?;
            Ok(Output::done("Brought back everything undo took."))
        }
    }
}

pub(super) async fn undo_v2(server: &Server, session: &str) -> Result<Output, String> {
    let base = format!("/api/session/{session}");
    let _ = server
        .call(Method::POST, &format!("{base}/interrupt"), None)
        .await;
    let _ = server
        .call(
            Method::POST,
            &format!("/api/experimental/session/{session}/wait"),
            None,
        )
        .await;
    let info = server.get(&base).await?;
    let messages = server.messages(session).await?;
    let reverted_at = text_at(data(&info), "/revert/messageID");
    let in_place = match reverted_at
        .and_then(|id| messages.iter().position(|m| text_at(m, "/id") == Some(id)))
    {
        Some(index) => &messages[..index],
        None => &messages[..],
    };
    let Some(last) = in_place.iter().rev().find(|message| {
        text_at(message, "/type") == Some("user")
            && text_at(message, "/text").is_some_and(|text| !text.trim().is_empty())
    }) else {
        return Ok(Output::done("There's nothing to undo."));
    };
    server
        .call(
            Method::POST,
            &format!("{base}/revert/stage"),
            Some(json!({ "messageID": text_at(last, "/id") })),
        )
        .await?;
    let said = first_line(text_at(last, "/text").unwrap_or_default());
    Ok(Output::done(format!(
        "Undid \"{said}\" and its file changes. /redo brings them back."
    )))
}

pub(super) async fn redo_v2(server: &Server, session: &str) -> Result<Output, String> {
    let base = format!("/api/session/{session}");
    let info = server.get(&base).await?;
    if text_at(data(&info), "/revert/messageID").is_none() {
        return Ok(Output::done("There's nothing to redo."));
    }
    server
        .call(Method::DELETE, &format!("{base}/revert"), None)
        .await?;
    Ok(Output::done("Brought back everything undo took."))
}

pub(super) async fn share(server: &Server, session: &str) -> Result<Output, String> {
    let info = server
        .call(Method::POST, &format!("/session/{session}/share"), None)
        .await?;
    Ok(Output::done(match text_at(&info, "/share/url") {
        Some(url) => format!("Shared at {url}"),
        None => "Shared this session.".to_string(),
    }))
}

pub(super) async fn unshare(server: &Server, session: &str) -> Result<Output, String> {
    server
        .call(Method::DELETE, &format!("/session/{session}/share"), None)
        .await?;
    Ok(Output::done("Stopped sharing this session."))
}
