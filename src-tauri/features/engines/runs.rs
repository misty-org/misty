// A chat turn on an outside engine: started from the same request as Misty's own runs, sent
// through the engine layer's launch path (`mod.rs`, desktop-cc-gui's), and reported as the same
// run events through the bridge (`bridge.rs`), so the chat shows it without knowing which engine
// answered.
//
// What an engine may do is decided here, in native code, from the mode the run started with, one
// of the engine's own (`modes.rs`): that mode picks the engine's own flags
// (`agents/run_control/engine_modes.rs`), and every permission ask the engine raises comes back
// to `decide`, which in a mode that asks puts it to the person through the same question Misty's
// own agent asks.

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

#[path = "runs_permission.rs"]
mod permission;
#[path = "runs_notes.rs"]
mod notes;
use notes::note;
use permission::decide;
#[cfg(test)]
use permission::summarize;

/// A live run: the request it started with, and what to tidy when it ends.
struct LiveRun {
    body: Value,
    engine: String,
    account: String,
    conversation: String,
    folder: String,
    images: Vec<PathBuf>,
    /// The turn ended in the chat, but its engine process lives on for a background task
    /// (`bridge.rs`, follow-up parking): its request still answers for that process.
    parked: bool,
    /// Parked with nothing running: the process only waits, warm, for the chat's next message,
    /// so the run isn't working in its folder.
    warm: bool,
}

static LIVE: LazyLock<Mutex<HashMap<String, LiveRun>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// Runs the person stopped, so their settle reads as stopped, not finished.
static STOPPED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

fn live() -> std::sync::MutexGuard<'static, HashMap<String, LiveRun>> {
    LIVE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The request a live run on an outside engine started with. An engine run whose process took a
/// later message of the chat answers with that message's request.
pub(crate) fn request_of(run_id: &str) -> Option<Value> {
    let held = live();
    held.get(&bridge::chat_run_of(run_id))
        .or_else(|| held.get(run_id))
        .map(|run| run.body.clone())
}

/// The folder a live run on an outside engine works in.
pub(crate) fn folder_of(run_id: &str) -> Option<PathBuf> {
    let held = live();
    held.get(&bridge::chat_run_of(run_id))
        .or_else(|| held.get(run_id))
        .map(|run| PathBuf::from(&run.folder))
}

/// Whether this request names an outside engine, and so belongs here and not to Misty's runtime.
pub(crate) fn wants(body: &Value) -> bool {
    body["engine"]["id"].as_str().is_some_and(super::is_engine)
}

pub(crate) fn is_live(run_id: &str) -> bool {
    live().get(run_id).is_some_and(|run| !run.parked)
}

/// Stops a run on an outside engine. False when the run isn't one of these.
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

/// Stops the engine process behind a chat run: its own, or a parked one it was written into.
fn kill(run_id: &str) {
    if let Some(state) = support::state() {
        let registry = std::sync::Arc::clone(&state.processes);
        let run = bridge::engine_run_of(run_id);
        tokio::task::spawn_blocking(move || registry.kill(&run));
    }
}

/// Multi-run: the live runs working in exactly this folder (multirun.rs). A process only
/// waiting, warm, for the chat's next message isn't working.
pub(crate) fn live_in(folder: &std::path::Path) -> Vec<String> {
    live()
        .iter()
        .filter(|(_, run)| !run.warm && std::path::Path::new(&run.folder) == folder)
        .map(|(id, _)| id.clone())
        .collect()
}

/// Multi-run: ends the warm processes waiting in this folder, before it is removed.
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

/// Opens the engine layer with its events going to the bridge, and installs the gate's decider.
/// Called once as the app starts.
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

/// Whether a run is a turn of Tutor's own spoken conversation (`companionConversation.ts`): a
/// companion turn under a conversation id no chat ever has, so its engine session carries on to
/// the conversation's next turn, and its process stays warm for it, without the pointing rules
/// ever reaching a chat.
fn tutor_voice(body: &Value) -> bool {
    body["mode"].as_str() == Some("companion")
        && body["conversation_id"]
            .as_str()
            .is_some_and(|id| id.starts_with("misty_tutor:"))
}

static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// Each running turn's Space folders: its Space's drive where it is mounted on this computer
/// (`~/.misty/mnt/<Space>`), which its engine may read beside its own folder (`launch_dirs`).
/// Gone when the run ends.
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

/// Starts a turn on the engine the request names. Returns once it is running; its events follow.
pub(crate) async fn start(app: &AppHandle, run_id: String, body: Value) -> Result<(), String> {
    launch(app, run_id, body, false).await
}

/// Warms up the engine for the first turn of a Tutor spoken session, while the person is still
/// talking (`warm_up.rs`): the turn's request, with no prompt yet. Claude Code is launched under a
/// session id of Misty's and waits, warm, for the turn. Nothing happens for another engine, for a
/// session that has had a turn, or for any other run. Returns once the process is waiting.
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
    // An engine Misty installed in shared/engines is brought up to this build's minimum first; a
    // failed update leaves the run on the version that is there.
    if let Err(error) = crate::engine_config::cli_lifecycle::upkeep::ensure_minimum(&engine).await {
        eprintln!("[engines] updating {engine} before the run failed: {error}");
    }
    let facts = RunFacts::of_request(&run_id, &body);
    let named = body["engine"]["folder"].as_str().unwrap_or("").to_string();
    let db = app.state::<MistyRuntime>().environment.store();
    let conversation = body["conversation_id"].as_str().unwrap_or("").to_string();
    let fresh = body["engine"]["fresh"].as_bool() == Some(true);
    // The cursor companion's turn runs apart from the chat's engine session, so its pointing
    // rules never stay in what the chat's later turns resume. Tutor's spoken conversation has a
    // session of its own, which it carries on.
    let companion_turn = body["mode"].as_str() == Some("companion");
    let tutor_voice = tutor_voice(&body);
    if warming && !(tutor_voice && engine == "claude") {
        return Ok(());
    }
    // Every chat works in its own folder, worked out here in native code (`chat_folder.rs`): the
    // project the person picked for it, or a scratch folder of its own. A page can't point an
    // engine at a folder the person didn't choose; a run with no chat gets a scratch folder too.
    let (folder, session) = {
        let (db, account, conversation, engine, run) = (
            db.clone(),
            facts.account.clone(),
            conversation.clone(),
            engine.clone(),
            run_id.clone(),
        );
        tokio::task::spawn_blocking(move || -> Result<_, String> {
            let folder = super::chat_folder::for_run(&db, &account, &conversation, &run, &named)?;
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
    // A warm-up names the session the turn will have, and keeps it for the conversation, so the
    // turn finds it and the process waiting under it.
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
    if let Some(space) = body["engine"]["space"].as_str().filter(|space| !space.is_empty()) {
        // The Space's drive, where it is mounted on this computer: the engine reads it, and
        // writes there only as its mode allows, like a project folder.
        let dirs: Vec<String> = crate::spaces_drive::run_folder(space)
            .map(|drive| vec![drive.to_string_lossy().into_owned()])
            .unwrap_or_default();
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
    // The engine's own mode, checked against what it offers here, and that mode's flags.
    let permission = engine_modes::launch_for(engine_impl.as_ref(), &body)?;
    // The run's tool list, in the engine's own names, which the engine then enforces; and the
    // agent's own arguments for it, never one that changes what it may do.
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
    // The cursor companion's turn brings the person's screens and the pointing rules (companion.rs).
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
    // Teach mode's lesson rules and the lesson so far, so a lesson runs on an engine as it does on
    // Misty's own runtime.
    let prompt = match agent_runs::engine_teach_note(&body) {
        Some(note) => format!("{prompt}\n\n{note}"),
        None => prompt,
    };
    // PDFs and documents are saved as files the engine opens with its own tools.
    let prompt = with_attached_files(prompt, &save_files(&body["attachments"], &run_id));
    // `/compact` on Oh My Pi is its native compaction call; other engines take the command as
    // text, which their CLI runs itself.
    let native_compact = prompt.trim() == "/compact";
    // In a shared Space, the files teammates' agents are changing right now go first, as advice.
    let prompt = with_teammates(prompt, &body["engine"]["teammates"]);
    // A chat the engine has no session for yet starts with its earlier turns written out.
    let prompt = match &session {
        Some(_) => prompt,
        None => with_history(prompt, &body["history_turns"]),
    };
    live().insert(
        run_id.clone(),
        LiveRun {
            body: body.clone(),
            engine: engine.clone(),
            account: facts.account.clone(),
            conversation,
            folder: folder_text.clone(),
            images: images.clone(),
            // A warm-up only waits for the turn, which takes its process.
            parked: warming,
            warm: warming,
        },
    );
    // Claude Code in a chat may stay alive past its turn for a background task (bridge.rs), and
    // Claude Code or CodeBuddy stays warm for the chat's next message.
    // A warm-up shows nothing of its own: the turn that takes its process shows what it does.
    if !warming {
        bridge::open(&run_id, matches!(engine.as_str(), "claude" | "codebuddy"));
    }
    let mut mcp_servers = super::mcp::servers_for(app, &run_id).await;
    // The agent's own MCP servers go in the same per-run config as Misty's Space server.
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
    // What tells this launch apart from another, so a parked process only takes a message that
    // would have started it the same way.
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
            // The chat's next message resumes this session: its process stays warm for it, as
            // it does for Tutor's next spoken turn. Tutor's other pointing turns keep no session,
            // so theirs ends with the turn.
            warm: !companion_turn || tutor_voice,
        },
    )
    .await;
    if let Err(error) = sent {
        if warming {
            // Nothing waits under the session: the turn starts it itself.
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
