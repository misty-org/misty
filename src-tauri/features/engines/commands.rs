//! What a window may ask about engines and a Space's linked folders. Linking happens only
//! through the system's folder picker, so nothing in a page can name a folder for an engine.

use tauri::State;

use crate::app::runtime::MistyRuntime;

use super::support::EngineState;
use super::{store, EngineInfo};

pub(super) fn person_window(webview: &tauri::Webview) -> Result<(), String> {
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

pub(super) async fn blocking<T: Send + 'static>(
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
    // OpenCode reports its commands from its server; asking it now fills the menu before the
    // chat's first turn. The next menu read shows them.
    if engine == "opencode" && !folder.is_empty() {
        let (db, account, folder) = (db.clone(), account.clone(), folder.clone());
        tokio::spawn(async move {
            let path = std::path::PathBuf::from(&folder);
            let linked = tokio::task::spawn_blocking(move || {
                path.is_absolute() && store::is_linked(&db, &account, &path).unwrap_or(false)
            })
            .await
            .unwrap_or(false);
            if !linked {
                return;
            }
            if let Ok(origin) = super::opencode_server::ensure_running().await {
                super::opencode_session::report_commands(origin, folder).await;
            }
        });
    }
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
        match super::plan_review::submit_decision(
            &db,
            &plan_id,
            revision,
            decision,
            feedback.as_deref(),
        )? {
            super::plan_review::SubmitOutcome::Conflict(review) => return Ok(*review),
            super::plan_review::SubmitOutcome::Claimed { .. } => {}
        }
        super::plan_review::mark_applied(&db, &plan_id, revision, decision)?;
        super::plan_review::get_review(&db, &plan_id, revision)?
            .ok_or_else(|| "That plan is gone.".to_string())
    })
    .await?;
    Ok(PlanDecided {
        continue_in_auto: decision == super::plan_review::PlanDecision::Approve,
        review,
        native: false,
    })
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

/// Runs one of an engine's commands Misty runs for it out of turn (`slash/mod.rs`): `/status`,
/// `/rename`, `/fork` and the like, which the engine only runs in its own terminal app. `folder`
/// is the chat's linked folder; one that isn't linked is ignored.
#[tauri::command]
pub async fn engine_command_run(
    webview: tauri::Webview,
    state: State<'_, MistyRuntime>,
    account: String,
    conversation: String,
    engine: String,
    folder: String,
    name: String,
    args: String,
) -> Result<super::slash::Output, String> {
    person_window(&webview)?;
    if !super::is_engine(&engine) {
        return Err("That engine has no adapter.".into());
    }
    let db = state.environment.store();
    let (folder, session) = {
        let db = db.clone();
        let (account, conversation, engine) =
            (account.clone(), conversation.clone(), engine.clone());
        blocking(move || {
            let folder = std::path::PathBuf::from(folder);
            let linked = !folder.as_os_str().is_empty()
                && folder.is_absolute()
                && store::is_linked(&db, &account, &folder).unwrap_or(false);
            let session = linked
                .then(|| {
                    store::session(
                        &db,
                        &account,
                        &conversation,
                        &engine,
                        &folder.to_string_lossy(),
                    )
                })
                .flatten();
            Ok((linked.then_some(folder), session))
        })
        .await?
    };
    let context = super::slash::Context {
        engine,
        account,
        conversation,
        folder,
        session,
        args: args.trim().to_string(),
        db,
    };
    super::slash::run(context, name.trim().trim_start_matches('/')).await
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
