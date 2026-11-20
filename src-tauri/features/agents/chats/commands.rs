//! Agent chats, kept on this computer.
use tauri::State;

use crate::app::runtime::MistyRuntime;

/// Hands what was kept signed out to the account that just signed in.
#[tauri::command]
pub async fn agent_chats_adopt(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    from: String,
    to: String,
) -> Result<u64, String> {
    require_person_window(&webview)?;
    if state
        .agent_chats
        .adoptable(from.clone(), to.clone())
        .await?
        > 0
        && !crate::browser::agent_pages::action_confirm::ask_to_adopt(&app, webview.label(), &to)
            .await
    {
        return Ok(0);
    }
    state.agent_chats.adopt(from, to).await
}

#[tauri::command]
pub async fn agent_chats_list(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    kind: String,
) -> Result<Vec<String>, String> {
    require_person_window(&webview)?;
    state.agent_chats.list(account, kind).await
}

#[tauri::command]
pub async fn agent_chats_get(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    kind: String,
    id: String,
) -> Result<Option<String>, String> {
    require_person_window(&webview)?;
    state.agent_chats.get(account, kind, id).await
}

#[tauri::command]
pub async fn agent_chats_messages_page(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    conversation: String,
    before_seq: Option<i64>,
    limit: usize,
) -> Result<super::AgentChatMessagePage, String> {
    require_person_window(&webview)?;
    state
        .agent_chats
        .messages_page(account, conversation, before_seq, limit)
        .await
}

#[tauri::command]
pub async fn agent_chats_messages_upsert(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    conversation: String,
    messages: Vec<String>,
    deleted: Vec<String>,
) -> Result<(), String> {
    require_person_window(&webview)?;
    state
        .agent_chats
        .upsert_messages(account, conversation, messages, deleted)
        .await
}

#[tauri::command]
pub async fn agent_chats_swap(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    kind: String,
    id: String,
    expected: Option<String>,
    document: String,
) -> Result<bool, String> {
    require_person_window(&webview)?;
    state
        .agent_chats
        .swap(account, kind, id, expected, document)
        .await
}

#[tauri::command]
pub async fn agent_chats_put(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    kind: String,
    id: String,
    document: String,
) -> Result<(), String> {
    require_person_window(&webview)?;
    state.agent_chats.put(account, kind, id, document).await
}

#[tauri::command]
pub async fn agent_chats_delete(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    kind: String,
    id: String,
) -> Result<(), String> {
    require_person_window(&webview)?;
    // A deleted chat takes its folder record, engine sessions and scratch folder with it
    // (`engines/chat_folder.rs`); a project it worked in is the person's and stays.
    if kind == "conversation" {
        let (db, owner, chat) = (state.environment.store(), account.clone(), id.clone());
        tokio::task::spawn_blocking(move || {
            crate::engines::chat_folder::forget_chat(&db, &owner, &chat)
        })
        .await
        .map_err(|error| error.to_string())?
        .unwrap_or_else(|error| eprintln!("[chats] couldn't clear a deleted chat's folder: {error}"));
    }
    state.agent_chats.delete(account, kind, id).await
}

/// Chats are only for a profile's own window: never a page, and never an incognito window.
fn require_person_window(webview: &tauri::Webview) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only a profile's window can read agent chats.".into());
    }
    Ok(())
}
