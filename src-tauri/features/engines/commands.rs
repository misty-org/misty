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

#[tauri::command]
pub async fn engines_list(webview: tauri::Webview) -> Result<Vec<EngineInfo>, String> {
    person_window(&webview)?;
    Ok(super::list().await)
}

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

pub fn allow_linked_folders(db: &database::store::Store) {
    for folder in store::all_folders(db).unwrap_or_default() {
        file_access::allow_linked_folder(&folder);
    }
    for folder in super::multirun::worktree_folders(db) {
        file_access::allow_linked_folder(&folder);
    }
}

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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDecided {
    pub review: super::PlanReview,
    pub native: bool,
    pub continue_in_auto: bool,
}

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

#[tauri::command]
#[allow(clippy::too_many_arguments)]
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
        let path = std::path::Path::new(&folder);
        if !store::is_linked(&db, &account, path)? || !file_access::fs::is_dir(path) {
            return Ok(());
        }
        if !super::chat_folder::is_scratch(&db, path) {
            store::set_chat_folder(&db, &account, &conversation, &folder, "project")?;
            store::add_project(&db, &account, &folder)?;
        }
        store::keep_session(&db, &account, &conversation, &engine, &folder, &session_id)
    })
    .await
}
