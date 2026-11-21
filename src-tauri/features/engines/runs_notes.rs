//! What the bridge reports about an outside engine's run (`runs.rs`): its engine session, which
//! a chat keeps for its next turn, and the run being parked, kept warm, resumed or over.

use tauri::Manager;

use super::bridge::RunNote;
use super::*;

/// What the bridge reports about a run: its engine session, and its end.
pub(super) fn note(run_id: &str, note: RunNote) {
    match note {
        RunNote::Session(session) => {
            // The cursor companion's turn keeps no session for the chat (`start`); Tutor's spoken
            // conversation keeps its own.
            let companion = |run: &LiveRun| {
                run.body["mode"].as_str() == Some("companion") && !tutor_voice(&run.body)
            };
            let Some(run) = live().get(run_id).filter(|run| !companion(run)).map(|run| {
                (
                    run.account.clone(),
                    run.conversation.clone(),
                    run.engine.clone(),
                    run.folder.clone(),
                )
            }) else {
                return;
            };
            let Some(app) = APP.get() else {
                return;
            };
            let db = app.state::<MistyRuntime>().environment.store();
            tokio::task::spawn_blocking(move || {
                let (account, conversation, engine, folder) = run;
                if !conversation.is_empty() {
                    let _ = store::keep_session(
                        &db,
                        &account,
                        &conversation,
                        &engine,
                        &folder,
                        &session,
                    );
                }
            });
        }
        RunNote::Parked => {
            if let Some(run) = live().get_mut(run_id) {
                run.parked = true;
            }
        }
        RunNote::Warm => {
            if let Some(run) = live().get_mut(run_id) {
                run.parked = true;
                run.warm = true;
            }
        }
        RunNote::Resumed => {
            if let Some(run) = live().get_mut(run_id) {
                run.parked = false;
                run.warm = false;
            }
        }
        RunNote::Ended => {
            if let Some(run) = live().remove(run_id) {
                for image in run.images {
                    let _ = std::fs::remove_file(image);
                }
                // A run with no chat worked in a scratch folder of its own (`chat_folder.rs`).
                if run.conversation.is_empty() {
                    if let Some(app) = APP.get() {
                        let db = app.state::<MistyRuntime>().environment.store();
                        crate::engines::chat_folder::end_run(&db, run_id);
                    }
                }
            }
            STOPPED
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(run_id);
            crate::engines::mcp::forget(run_id);
            SPACE_DIRS
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(run_id);
            crate::agents::run_control::take_over::release(run_id);
        }
    }
}
