use tauri::Manager;

use super::bridge::RunNote;
use super::*;

pub(super) fn note(run_id: &str, note: RunNote) {
    match note {
        RunNote::Session(session) => {
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
                    let _ = file_access::fs::remove_file(image);
                }
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
