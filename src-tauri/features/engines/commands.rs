//! What a window may ask about engines and a Space's linked folders. Linking happens only
//! through the system's folder picker, so nothing in a page can name a folder for an engine.

use tauri::State;

use crate::app::runtime::MistyRuntime;

use super::support::EngineState;
use super::{store, EngineInfo};

fn person_window(webview: &tauri::Webview) -> Result<(), String> {
    if crate::browser::app_windows::is_person_window(webview.label()) {
        Ok(())
    } else {
        Err("Only a profile's window can do this.".into())
    }
}

/// A Space's key in the folder table: its id, or `personal` for the person's own Space.
pub(super) fn space_key(space: &str) -> Result<String, String> {
    let key = space.trim();
    if key.len() > 200 || key.chars().any(char::is_control) {
        return Err("That Space can't have folders.".into());
    }
    Ok(if key.is_empty() {
        "personal".into()
    } else {
        key.to_string()
    })
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

/// The engines Misty has adapters for, and which are installed on this computer.
#[tauri::command]
pub async fn engines_list(webview: tauri::Webview) -> Result<Vec<EngineInfo>, String> {
    person_window(&webview)?;
    Ok(super::list().await)
}

/// The models an engine offers, for the agent editor's model choice.
#[tauri::command]
pub async fn engine_models(
    webview: tauri::Webview,
    engine: String,
) -> Result<Vec<super::EngineModel>, String> {
    person_window(&webview)?;
    if !super::is_engine(&engine) {
        return Err("That engine has no adapter.".into());
    }
    Ok(super::models(&engine).await)
}

/// The project folders linked to a Space on this computer.
#[tauri::command]
pub async fn space_folder_list(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    space: String,
) -> Result<Vec<String>, String> {
    person_window(&webview)?;
    let (db, space) = (state.environment.store(), space_key(&space)?);
    blocking(move || store::folders(&db, &account, &space)).await
}

/// Links the folder the person picks to a Space, or nothing if they cancel.
#[tauri::command]
pub async fn space_folder_link(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    space: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    person_window(&webview)?;
    let space = space_key(&space)?;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose a project folder for this Space")
        .pick_folder(move |folder| {
            let _ = send.send(folder);
        });
    let Some(folder) = receive
        .await
        .map_err(|_| "No folder was chosen.".to_string())?
    else {
        return Ok(None);
    };
    let path = folder
        .into_path()
        .map_err(|_| "Choose a folder on this computer.".to_string())?;
    // The person chose it in the system's own dialog, which is what lets Misty reach it.
    file_access::allow_linked_folder(&path);
    let real = file_access::fs::canonicalize(&path).map_err(|error| error.to_string())?;
    if real != path {
        file_access::revoke_linked_folder(&path);
        file_access::allow_linked_folder(&real);
    }
    let text = real.to_string_lossy().to_string();
    let (db, kept) = (state.environment.store(), text.clone());
    blocking(move || store::link_folder(&db, &account, &space, &kept)).await?;
    let linked = text.clone();
    tokio::task::spawn_blocking(move || super::folder_linked(&linked));
    Ok(Some(text))
}

/// Unlinks a folder from a Space. Its files are left as they are.
#[tauri::command]
pub async fn space_folder_unlink(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    space: String,
    path: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let (db, space, gone) = (state.environment.store(), space_key(&space)?, path.clone());
    let still_linked = blocking(move || store::unlink_folder(&db, &account, &space, &gone)).await?;
    if !still_linked {
        file_access::revoke_linked_folder(std::path::Path::new(&path));
    }
    Ok(())
}

/// Lets the file gate reach every folder linked on this computer. Runs once as the app starts.
pub fn allow_linked_folders(db: &database::store::Store) {
    for folder in store::all_folders(db).unwrap_or_default() {
        file_access::allow_linked_folder(&folder);
    }
    // Multi-run: the worktrees it made are reached the same way (multirun.rs).
    for folder in super::multirun::worktree_folders(db) {
        file_access::allow_linked_folder(&folder);
    }
}

/// An engine's slash commands and skills, for the composer's `/` and `$` menus. `folder` is the
/// chat's linked folder; a folder that isn't linked is ignored, so a page can't make Misty read
/// another folder's command files.
#[tauri::command]
pub async fn engine_catalog(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    engine: String,
    folder: String,
) -> Result<super::catalog::Catalog, String> {
    person_window(&webview)?;
    if !super::is_engine(&engine) {
        return Err("That engine has no adapter.".into());
    }
    let db = state.environment.store();
    blocking(move || {
        let home = dirs::home_dir().ok_or("Misty can't find your home folder.")?;
        let folder = std::path::PathBuf::from(folder);
        let project = (!folder.as_os_str().is_empty()
            && folder.is_absolute()
            && store::is_linked(&db, &account, &folder).unwrap_or(false))
        .then_some(folder);
        Ok(super::catalog::catalog_for(
            &engine,
            &home,
            project.as_deref(),
        ))
    })
    .await
}

// ---- Engine turns: questions, plan reviews, settings, history, fork ----


/// Answers a question card an engine raised (Claude's AskUserQuestion, Codex's
/// `requestUserInput`, an ACP form). `answers` maps each question's text to the chosen label, or
/// an array of labels for a multi-select question, or the person's own words; None dismisses it.
#[tauri::command]
pub async fn engine_answer_question(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    run_id: String,
    request_id: String,
    answers: Option<serde_json::Value>,
) -> Result<(), String> {
    person_window(&webview)?;
    if !super::runs::is_live(&run_id) {
        return Err("That turn has ended.".into());
    }
    super::answer_question(state, run_id, request_id, answers).await
}

/// What the chat does after a plan decision.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDecided {
    pub review: super::PlanReview,
    /// The engine carries the plan out in the same turn (its native request was answered).
    pub native: bool,
    /// The chat switches to Auto and asks the engine to carry the plan out.
    pub continue_in_auto: bool,
}

/// Approves a plan, asks for changes, or defers it. A plan the engine is still waiting on is
/// answered natively; any other (Claude Code's, Codex's) is recorded, and on approval the chat
/// switches to Auto and continues the same engine session.
#[tauri::command]
pub async fn engine_plan_respond(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    plan_id: String,
    revision: i64,
    decision: super::plan_review::PlanDecision,
    feedback: Option<String>,
) -> Result<PlanDecided, String> {
    person_window(&webview)?;
    let review = super::plan_review::get_review(&state.db, &plan_id, revision)?
        .ok_or("That plan is gone.")?;
    if review.review_kind == super::PlanReviewKind::NativeRequest {
        let outcome =
            super::respond_plan_review(state, plan_id, revision, decision, feedback).await?;
        let review = match outcome {
            super::PlanRespondOutcome::Applied { review }
            | super::PlanRespondOutcome::Conflict { review } => review,
        };
        return Ok(PlanDecided {
            review,
            native: true,
            continue_in_auto: false,
        });
    }
    let db = std::sync::Arc::clone(&state.db);
    let review = blocking(move || {
        match super::plan_review::submit_decision(&db, &plan_id, revision, decision, feedback.as_deref())? {
            super::plan_review::SubmitOutcome::Conflict(review) => return Ok(*review),
            super::plan_review::SubmitOutcome::Claimed { .. } => {}
        }
        super::plan_review::mark_applied(&db, &plan_id, revision, decision)?;
        super::plan_review::get_review(&db, &plan_id, revision)?.ok_or_else(|| "That plan is gone.".to_string())
    })
    .await?;
    Ok(PlanDecided {
        continue_in_auto: decision == super::plan_review::PlanDecision::Approve,
        review,
        native: false,
    })
}

/// The plans an engine session has shown for review, newest revision last.
#[tauri::command]
pub async fn engine_plan_reviews(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    engine: String,
    session_id: String,
) -> Result<Vec<super::PlanReview>, String> {
    person_window(&webview)?;
    super::list_plan_reviews(state, engine, session_id).await
}

/// This device's engine settings (default models and efforts, Codex Fast, program overrides).
#[tauri::command]
pub async fn engine_settings_get(
    webview: tauri::Webview,
) -> Result<super::support::settings::AppSettings, String> {
    person_window(&webview)?;
    blocking(super::support::settings::read_settings).await
}

#[tauri::command]
pub async fn engine_settings_set(
    webview: tauri::Webview,
    settings: super::support::settings::AppSettings,
) -> Result<(), String> {
    person_window(&webview)?;
    blocking(move || super::support::settings::write_settings(&settings)).await
}

/// Forgets a chat's engine session (`/clear`): the chat stays, its next turn starts fresh.
#[tauri::command]
pub async fn engine_chat_clear(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    conversation: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let db = state.environment.store();
    blocking(move || store::forget_session(&db, &account, &conversation)).await
}

/// Points a chat at a session from an engine's own history, or a fork, so its next turn
/// resumes it. The folder must be linked.
#[tauri::command]
pub async fn engine_chat_resume(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    conversation: String,
    engine: String,
    folder: String,
    session_id: String,
) -> Result<(), String> {
    person_window(&webview)?;
    if !super::is_engine(&engine) {
        return Err("That engine has no adapter.".into());
    }
    let db = state.environment.store();
    blocking(move || {
        if !store::is_linked(&db, &account, std::path::Path::new(&folder))? {
            return Err("That folder isn't linked to a Space on this computer.".into());
        }
        store::keep_session(&db, &account, &conversation, &engine, &folder, &session_id)
    })
    .await
}

/// The sessions each engine's own files hold for the folders linked on this computer.
#[tauri::command]
pub async fn engine_history_list(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    runtime: State<'_, MistyRuntime>,
) -> Result<Vec<super::history::SessionMeta>, String> {
    person_window(&webview)?;
    let linked = {
        let db = runtime.environment.store();
        blocking(move || store::all_folders(&db)).await?
    };
    let sessions = super::history::reader::list_sessions(state).await?;
    Ok(sessions
        .into_iter()
        .filter(|session| linked.iter().any(|folder| std::path::Path::new(&session.workspace_path) == folder))
        .collect())
}

/// One page of a session's messages, read from the engine's own file.
#[tauri::command]
pub async fn engine_history_page(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    engine: String,
    session_id: String,
    limit: Option<usize>,
    before_seq: Option<i64>,
) -> Result<super::history::reader::SessionPage, String> {
    person_window(&webview)?;
    super::history::reader::load_session_page(state, engine, session_id, limit, before_seq, None).await
}

/// Full-text search over every indexed session's messages.
#[tauri::command]
pub async fn engine_history_search(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    query: String,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<super::history::search::MessageSearchPage, String> {
    person_window(&webview)?;
    super::history::search::search_messages(state, query, limit, offset).await
}

/// Renames a session, written back where the engine keeps its own title.
#[tauri::command]
pub async fn engine_history_rename(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    engine: String,
    session_id: String,
    title: String,
) -> Result<(), String> {
    person_window(&webview)?;
    super::history::reader::rename_session(state, engine, session_id, title)
        .await
        .map(|_| ())
}

/// Scans the engines' session files again.
#[tauri::command]
pub fn engine_history_rescan(webview: tauri::Webview, state: State<'_, EngineState>) -> Result<(), String> {
    person_window(&webview)?;
    super::history::reader::rescan_sessions(state);
    Ok(())
}

/// A session's own file, as text, to read or edit in place.
#[tauri::command]
pub async fn engine_history_read_file(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    engine: String,
    session_id: String,
) -> Result<super::history::edit::SessionFileDocument, String> {
    person_window(&webview)?;
    super::history::edit::read_session_file(state, engine, session_id, None, None).await
}

/// Saves an edited session file. Refused while a turn runs on that session, or when the file
/// changed since it was read (`expected_version`).
#[tauri::command]
pub async fn engine_history_write_file(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    engine: String,
    session_id: String,
    content: String,
    expected_version: String,
) -> Result<super::history::edit::SessionFileDocument, String> {
    person_window(&webview)?;
    super::history::edit::write_session_file(state, engine, session_id, content, expected_version, None, None)
        .await
}

/// Opens a session's own file in the person's text editor.
#[tauri::command]
pub async fn engine_history_open_file(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    engine: String,
    session_id: String,
) -> Result<(), String> {
    person_window(&webview)?;
    super::history::edit::open_session_file_in_default_editor(state, engine, session_id).await
}

/// Forks a chat's engine session at one of the person's messages into a new chat: the new
/// chat's next turn resumes a session holding the history before that message, in the engine's
/// own format. `later_same` counts later messages with the same text, to pick the right one.
#[tauri::command]
pub async fn engine_chat_fork(
    webview: tauri::Webview,
    state: State<'_, EngineState>,
    runtime: State<'_, MistyRuntime>,
    account: String,
    conversation: String,
    new_conversation: String,
    user_text: Option<String>,
    later_same: Option<u32>,
) -> Result<super::fork::ForkPlan, String> {
    person_window(&webview)?;
    let db = runtime.environment.store();
    let (lookup, from) = (db.clone(), (account.clone(), conversation.clone()));
    let (engine, session, _folder) = blocking(move || {
        store::chat_session(&lookup, &from.0, &from.1)
            .ok_or_else(|| "This chat has no engine session to fork yet.".to_string())
    })
    .await?;
    let at = user_text.map(|text| super::fork::ForkAnchor {
        user_text_sha256: super::fork::text_sha256_hex(&text),
        seq_hint: None,
        tail_occurrence: later_same,
    });
    let plan = super::fork::fork_session(state, engine.clone(), session, at).await?;
    let (target, folder) = (plan.target_session_id.clone(), plan.workspace_path.clone());
    blocking(move || store::keep_session(&db, &account, &new_conversation, &engine, &folder, &target))
        .await?;
    Ok(plan)
}
