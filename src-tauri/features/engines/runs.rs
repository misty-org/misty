use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{LazyLock, Mutex};

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::agents::run_control::engine_modes;
use crate::agents::run_control::tool_policy::RunFacts;
use crate::app::runtime::MistyRuntime;

use super::bridge;
use super::run_prompt::{
    save_files, save_images, with_attached_files, with_browser_hint, with_history, with_teammates,
};
use super::{store, support};

#[path = "runs_notes.rs"]
mod notes;
#[path = "runs_permission.rs"]
mod permission;
use notes::note;
use permission::decide;
#[cfg(test)]
use permission::summarize;

struct LiveRun {
    body: Value,
    engine: String,
    account: String,
    conversation: String,
    folder: String,
    images: Vec<PathBuf>,
    parked: bool,
    warm: bool,
}

static LIVE: LazyLock<Mutex<HashMap<String, LiveRun>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static STOPPED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

fn live() -> std::sync::MutexGuard<'static, HashMap<String, LiveRun>> {
    LIVE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn request_of(run_id: &str) -> Option<Value> {
    let held = live();
    held.get(&bridge::chat_run_of(run_id))
        .or_else(|| held.get(run_id))
        .map(|run| run.body.clone())
}

pub(crate) fn folder_of(run_id: &str) -> Option<PathBuf> {
    let held = live();
    held.get(&bridge::chat_run_of(run_id))
        .or_else(|| held.get(run_id))
        .map(|run| PathBuf::from(&run.folder))
}

pub(crate) fn wants(body: &Value) -> bool {
    body["engine"]["id"].as_str().is_some_and(super::is_engine)
}

pub(crate) fn is_live(run_id: &str) -> bool {
    live().get(run_id).is_some_and(|run| !run.parked)
}

pub(crate) fn cancel(run_id: &str) -> bool {
    if !is_live(run_id) {
        return false;
    }
    STOPPED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(run_id.to_string());
    kill(run_id);
    bridge::cancel(run_id);
    true
}

fn kill(run_id: &str) {
    if let Some(state) = support::state() {
        let registry = std::sync::Arc::clone(&state.processes);
        let run = bridge::engine_run_of(run_id);
        tokio::task::spawn_blocking(move || registry.kill(&run));
    }
}

pub(crate) fn live_in(folder: &std::path::Path) -> Vec<String> {
    live()
        .iter()
        .filter(|(_, run)| !run.warm && std::path::Path::new(&run.folder) == folder)
        .map(|(id, _)| id.clone())
        .collect()
}

pub(crate) fn end_warm_in(folder: &std::path::Path) {
    let warm: Vec<String> = live()
        .iter()
        .filter(|(_, run)| run.warm && std::path::Path::new(&run.folder) == folder)
        .map(|(id, _)| id.clone())
        .collect();
    for run in warm {
        kill(&run);
    }
    super::warm::retire_in(folder);
}

pub fn stop_all() {
    let runs: Vec<(String, bool)> = live()
        .iter()
        .map(|(id, run)| (id.clone(), run.parked))
        .collect();
    for (run, parked) in runs {
        if parked {
            kill(&run);
        } else {
            cancel(&run);
        }
    }
}

pub(crate) fn install(app: &AppHandle) -> Result<support::EngineState, String> {
    let _ = APP.set(app.clone());
    let runtime = app.state::<MistyRuntime>();
    let store = runtime.environment.store();
    let emit = bridge::Bridge::install(app, note);
    let state = support::EngineState::open(&store, &runtime.environment.misty_root(), emit)?;
    let decider = app.clone();
    super::gate::install(move |run_id, tool, input| {
        let app = decider.clone();
        Box::pin(async move { decide(&app, &run_id, &tool, &input).await })
    });
    Ok(state)
}

fn tutor_voice(body: &Value) -> bool {
    body["mode"].as_str() == Some("companion")
        && body["conversation_id"]
            .as_str()
            .is_some_and(|id| id.starts_with("misty_tutor:"))
}

static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

static SPACE_DIRS: std::sync::LazyLock<std::sync::Mutex<HashMap<String, Vec<String>>>> =
    std::sync::LazyLock::new(Default::default);

pub(super) fn space_dirs(run_id: &str) -> Vec<String> {
    SPACE_DIRS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(run_id)
        .cloned()
        .unwrap_or_default()
}

async fn project_thread_folder(
    app: &AppHandle,
    db: &database::store::Store,
    facts: &RunFacts,
    body: &Value,
    conversation: &str,
    companion_turn: bool,
    named: String,
) -> String {
    if named.is_empty() || conversation.is_empty() || companion_turn {
        return named;
    }
    let project = PathBuf::from(&named);
    let linked = {
        let (db, account, project) = (db.clone(), facts.account.clone(), project.clone());
        tokio::task::spawn_blocking(move || {
            !super::multirun::is_worktree(&db, &account, &project)
                && store::is_linked(&db, &account, &project).unwrap_or(false)
                && !super::chat_folder::is_scratch(&db, &project)
        })
        .await
        .unwrap_or(false)
    };
    if !linked {
        return named;
    }
    let misty_root = app.state::<MistyRuntime>().environment.misty_root();
    super::multirun::thread_lane(
        db,
        &misty_root,
        &facts.account,
        body["engine"]["space"].as_str().unwrap_or(""),
        &facts.agent_id,
        conversation,
        &project,
        body["conversation_title"].as_str().unwrap_or(""),
    )
    .await
    .map(|path| path.to_string_lossy().into_owned())
    .unwrap_or(named)
}

pub(crate) async fn start(app: &AppHandle, run_id: String, body: Value) -> Result<(), String> {
    let account = body["account"].as_str().unwrap_or("").to_string();
    let conversation = body["conversation_id"].as_str().unwrap_or("").to_string();
    let started = launch(app, run_id, body, false).await;
    if started.is_err() {
        super::thread_work::after_run(app, account, conversation);
    }
    started
}

pub(crate) async fn warm_up(app: &AppHandle, run_id: String, body: Value) -> Result<(), String> {
    launch(app, run_id, body, true).await
}

async fn launch(app: &AppHandle, run_id: String, body: Value, warming: bool) -> Result<(), String> {
    let engine = body["engine"]["id"]
        .as_str()
        .filter(|id| super::is_engine(id))
        .ok_or("That engine has no adapter.")?
        .to_string();
    let state = support::state().ok_or_else(super::not_ready)?;
    if let Err(error) = crate::engine_config::cli_lifecycle::upkeep::ensure_minimum(&engine).await {
        eprintln!("[engines] updating {engine} before the run failed: {error}");
    }
    let facts = RunFacts::of_request(&run_id, &body);
    let named = body["engine"]["folder"].as_str().unwrap_or("").to_string();
    let db = app.state::<MistyRuntime>().environment.store();
    let conversation = body["conversation_id"].as_str().unwrap_or("").to_string();
    let fresh = body["engine"]["fresh"].as_bool() == Some(true);
    let companion_turn = body["mode"].as_str() == Some("companion");
    let tutor_voice = tutor_voice(&body);
    if warming && !(tutor_voice && engine == "claude") {
        return Ok(());
    }
    let named = project_thread_folder(
        app,
        &db,
        &facts,
        &body,
        &conversation,
        companion_turn,
        named,
    )
    .await;
    let opened = match super::thread_work::Place::of_request(&body) {
        Some(place) if named.is_empty() && !conversation.is_empty() && !companion_turn => {
            super::thread_work::open(app, &db, &facts.account, &conversation, &place).await?
        }
        _ => None,
    };
    let (folder, session) = {
        let (db, account, conversation, engine, run, thread_folder) = (
            db.clone(),
            facts.account.clone(),
            conversation.clone(),
            engine.clone(),
            run_id.clone(),
            opened.as_ref().map(|opened| opened.cwd.clone()),
        );
        tokio::task::spawn_blocking(move || -> Result<_, String> {
            let folder = match thread_folder {
                Some(folder) => folder,
                None => super::chat_folder::for_run(&db, &account, &conversation, &run, &named)?,
            };
            let folder_text = folder.to_string_lossy().into_owned();
            let session = if companion_turn && !tutor_voice {
                None
            } else if fresh {
                let _ = store::forget_session(&db, &account, &conversation);
                None
            } else {
                store::session(&db, &account, &conversation, &engine, &folder_text)
            };
            Ok((folder, session))
        })
        .await
        .map_err(|error| error.to_string())??
    };
    let session = if warming {
        if session.is_some() {
            return Ok(());
        }
        let named = uuid::Uuid::new_v4().to_string();
        let (db, account, conversation, engine, folder_text, kept) = (
            db.clone(),
            facts.account.clone(),
            conversation.clone(),
            engine.clone(),
            folder.to_string_lossy().into_owned(),
            named.clone(),
        );
        tokio::task::spawn_blocking(move || {
            store::keep_session(&db, &account, &conversation, &engine, &folder_text, &kept)
        })
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
        super::warm_up::begin(&named);
        Some(named)
    } else {
        session
    };
    if let Some(space) = body["engine"]["space"]
        .as_str()
        .filter(|space| !space.is_empty())
    {
        let dirs: Vec<String> = opened
            .as_ref()
            .map(|opened| opened.workspace.to_string_lossy().into_owned())
            .into_iter()
            .chain(
                crate::spaces_drive::run_folder(space)
                    .map(|drive| drive.to_string_lossy().into_owned()),
            )
            .collect();
        if !dirs.is_empty() {
            SPACE_DIRS
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .insert(run_id.clone(), dirs);
        }
    }
    let folder_text = folder.to_string_lossy().into_owned();
    if !file_access::fs::is_dir(&folder) {
        return Err("That folder isn't one of your projects on this computer.".into());
    }
    let engine_impl = super::engine_by_id(&engine).ok_or("That engine has no adapter.")?;
    let permission = engine_modes::launch_for(engine_impl.as_ref(), &body)?;
    let allowed_tools = engine_modes::engine_tools(engine_impl.as_ref(), &facts)?;
    let args = engine_modes::engine_args(&body)?;
    let agent_servers: Vec<String> = body["engine"]["mcp_servers"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect();
    let pick = |name: &str| {
        body["engine"][name]
            .as_str()
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let companion = super::companion::companion_turn(&body, engine_impl.supports_images());
    let images = [companion.images, save_images(&body["attachments"])].concat();
    let prompt = with_browser_hint(
        body["prompt"].as_str().unwrap_or(""),
        body["browser"].as_bool() == Some(true),
    );
    let prompt = match companion.note {
        Some(note) => format!("{prompt}\n\n{note}"),
        None => prompt,
    };
    let prompt = match agent_runs::engine_teach_note(&body) {
        Some(note) => format!("{prompt}\n\n{note}"),
        None => prompt,
    };
    let prompt = with_attached_files(prompt, &save_files(&body["attachments"], &run_id));
    let native_compact = prompt.trim() == "/compact";
    let prompt = with_teammates(prompt, &body["engine"]["teammates"]);
    let prompt = match &session {
        Some(_) => prompt,
        None => with_history(prompt, &body["history_turns"]),
    };
    let prompt = match (&session, &opened) {
        (None, Some(opened)) => format!("{prompt}\n\n{}", opened.note),
        _ => prompt,
    };
    let prompt = super::agent_memory::with_memory(prompt, &body, &engine, session.is_some()).await;
    live().insert(
        run_id.clone(),
        LiveRun {
            body: body.clone(),
            engine: engine.clone(),
            account: facts.account.clone(),
            conversation,
            folder: folder_text.clone(),
            images: images.clone(),
            parked: warming,
            warm: warming,
        },
    );
    if !warming {
        bridge::open(&run_id, matches!(engine.as_str(), "claude" | "codebuddy"));
    }
    let mut mcp_servers = super::mcp::servers_for(app, &run_id).await;
    if !agent_servers.is_empty() {
        let (engine, folder) = (engine.clone(), folder_text.clone());
        let found = tokio::task::spawn_blocking(move || {
            super::mcp::agent_servers(&engine, &folder, &agent_servers)
        })
        .await
        .unwrap_or_default();
        if !found.is_empty() {
            let merged = mcp_servers.get_or_insert_with(|| Value::Object(Default::default()));
            if let Some(merged) = merged.as_object_mut() {
                for (name, server) in found {
                    merged.entry(name).or_insert(server);
                }
            }
        }
    }
    let mut key = args.clone();
    key.extend(
        body["engine"]["mcp_servers"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(|name| format!("mcp:{name}")),
    );
    for flag in ["browser", "computer_use"] {
        if body[flag].as_bool() == Some(true) {
            key.push(flag.to_string());
        }
    }
    let sent = super::send_message_inner(
        state,
        engine,
        folder_text,
        session,
        prompt,
        Vec::new(),
        Some(native_compact),
        Some(
            images
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
        ),
        pick("model"),
        pick("effort"),
        Some(permission.to_string()),
        None,
        Some(run_id.clone()),
        mcp_servers,
        allowed_tools,
        super::LaunchExtras {
            args,
            key,
            warm: !companion_turn || tutor_voice,
        },
    )
    .await;
    if let Err(error) = sent {
        if warming {
            live().remove(&run_id);
            return Err(error);
        }
        bridge::fail(&run_id, &error);
    }
    Ok(())
}

#[cfg(test)]
#[path = "runs_tests.rs"]
mod tests;
