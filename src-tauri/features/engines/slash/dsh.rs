use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};

use super::{misty, turn, Command, Context, Output};
use crate::engines::dsh_session::{host_call_slow, slow_client};
use crate::engines::support::dsh_host;

pub const COMMANDS: &[Command] = &[
    turn("compact", "Compact older conversation history"),
    turn("goal", "Set or view the goal for a long-running task")
        .hint("[<objective>|clear|edit <objective>|pause|resume]"),
    turn(
        "permission",
        "Switch the permission preset (sandbox mode and approval policy)",
    )
    .hint("<preset>"),
    turn("feedback", "Record feedback about this session").hint("<text>"),
    misty("rename", "Rename this session").hint("<title>"),
    misty(
        "fork",
        "Copy this session up to its last finished turn into a new chat",
    )
    .hint("[message]"),
    misty("export", "Save this session's log as a ZIP archive"),
];

const SESSION_CALL_TIMEOUT: Duration = Duration::from_secs(60);
const EXPORT_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub async fn run(context: Context, name: &str) -> Result<Output, String> {
    let session = context.session.as_deref().ok_or(
        "This chat has no DeepSeek Harness session yet. Send a message first, then try again.",
    )?;
    let origin = host_origin().await?;
    match name {
        "rename" => rename(&origin, session, &context.args).await,
        "fork" => fork(&origin, session, &context.args).await,
        "export" => export(&origin, session, context.folder.as_deref()).await,
        _ => Err(format!("Misty doesn't run /{name} for this engine.")),
    }
}

async fn host_origin() -> Result<String, String> {
    let settings = crate::engines::support::settings::read_settings().unwrap_or_default();
    let state = crate::engines::support::state().ok_or("Misty's engine layer isn't open.")?;
    dsh_host::ensure_host(&state.dsh_host, &settings).await?;
    Ok(dsh_host::configured_origin(&settings))
}

async fn rename(origin: &str, session: &str, title: &str) -> Result<Output, String> {
    if title.is_empty() {
        return Err("Give the session a title: /rename <title>".to_string());
    }
    let renamed = host_call_slow(
        origin,
        "session/rename",
        json!({ "request": { "sessionId": session, "title": title } }),
        SESSION_CALL_TIMEOUT,
    )
    .await?;
    let title = renamed
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or(title)
        .to_string();
    Ok(Output::Rename { title })
}

async fn fork(origin: &str, session: &str, message: &str) -> Result<Output, String> {
    let forked = host_call_slow(
        origin,
        "session/fork",
        json!({ "request": { "sessionId": session } }),
        SESSION_CALL_TIMEOUT,
    )
    .await?;
    let session = forked
        .get("sessionId")
        .and_then(Value::as_str)
        .ok_or("session/fork returned no sessionId")?
        .to_string();
    Ok(Output::Fork {
        session,
        title: None,
        prompt: (!message.is_empty()).then(|| message.to_string()),
    })
}

async fn export(origin: &str, session: &str, folder: Option<&Path>) -> Result<Output, String> {
    let mut request = slow_client(origin)
        .get(format!("{origin}/api/session.export"))
        .query(&[("sessionId", session), ("includeDescendants", "true")])
        .timeout(EXPORT_TIMEOUT);
    if let Some(cookie) = dsh_host::host_cookie(origin) {
        request = request.header(reqwest::header::COOKIE, cookie);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the DSH host at {origin} ({e})"))?;
    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(format!(
            "The DSH host couldn't export this session ({status}): {}",
            detail.trim()
        ));
    }
    let archive = response
        .bytes()
        .await
        .map_err(|e| format!("The session log download broke off ({e})"))?;
    let dir = folder.map_or_else(
        || crate::engines::support::paths::app_home().join("exports"),
        Path::to_path_buf,
    );
    file_access::fs_async::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Couldn't create {} ({e})", dir.display()))?;
    let path = archive_path(&dir, session);
    file_access::fs_async::write(&path, &archive)
        .await
        .map_err(|e| format!("Couldn't save {} ({e})", path.display()))?;
    Ok(Output::done(format!(
        "Saved the session log to {}",
        path.display()
    )))
}

fn archive_path(dir: &Path, session: &str) -> PathBuf {
    let id: String = session
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    dir.join(format!("dsh-session-{id}.zip"))
}
