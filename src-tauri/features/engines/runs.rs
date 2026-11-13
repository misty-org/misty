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
use crate::browser::agent_pages::action_confirm::{ask_tool, Answer, ToolAsk};

use super::bridge::{self, RunNote};
use super::gate::Decision;
use super::run_prompt::{
    save_files, save_images, with_attached_files, with_browser_hint, with_history, with_teammates,
};
use super::{store, support};

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

/// Multi-run: the live runs working in exactly this folder (multirun.rs).
pub(crate) fn live_in(folder: &std::path::Path) -> Vec<String> {
    live()
        .iter()
        .filter(|(_, run)| std::path::Path::new(&run.folder) == folder)
        .map(|(id, _)| id.clone())
        .collect()
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

/// Whether the engine may go ahead with what it asked for. Auto runs don't stop for ordinary
/// work, a plan changes nothing, Bypass never asks (the engine skips its own asks), and in Ask
/// the person answers the same question Misty's own agent would raise.
async fn decide(app: &AppHandle, run_id: &str, tool: &str, input: &Value) -> Decision {
    let Some(body) = request_of(run_id) else {
        return Decision::Deny("This run has ended.".into());
    };
    let facts = RunFacts::of_request(run_id, &body);
    // A call into Misty's own server is journaled and gated there, under this run's mode, so the
    // person isn't asked once here and once more by the tool itself. A plan still changes nothing.
    if super::mcp::names_misty_tool(tool, input) && !facts.planning {
        return Decision::Allow;
    }
    match (facts.planning, facts.auto) {
        (true, _) => Decision::Deny(
            "This chat is planning, so nothing is changed yet. Finish the plan instead.".into(),
        ),
        (false, true) => Decision::Allow,
        (false, false) => {
            let about = summarize(input);
            let control = if about.is_empty() {
                tool.to_string()
            } else {
                format!("{tool}: {about}")
            };
            let answer = ask_tool(
                app,
                ToolAsk {
                    account: &facts.account,
                    kind: "action",
                    control: &control,
                    reason: "This chat asks before an agent changes files or runs a command.",
                    site: "",
                    agent_id: &facts.agent_id,
                    task_id: &facts.task_id,
                },
            )
            .await;
            match answer {
                Answer::Allowed => Decision::Allow,
                Answer::Refused => Decision::Deny(
                    "The person declined this. Do not retry it; continue without it or ask them."
                        .into(),
                ),
                Answer::Unanswered => Decision::Deny("Nobody answered in time.".into()),
            }
        }
    }
}

/// What a permission ask is about, in one line.
fn summarize(input: &Value) -> String {
    let field = [
        "command",
        "file_path",
        "filePath",
        "path",
        "url",
        "pattern",
        "query",
    ]
    .iter()
    .find_map(|name| input[name].as_str())
    .map(str::to_string)
    .or_else(|| {
        input["command"]
            .as_array()
            .and_then(|parts| parts.last()?.as_str())
            .map(str::to_string)
    })
    .unwrap_or_default();
    let mut text: String = field.chars().take(600).collect();
    if field.chars().count() > 600 {
        text.push('…');
    }
    text
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

/// What the bridge reports about a run: its engine session, and its end.
fn note(run_id: &str, note: RunNote) {
    match note {
        RunNote::Session(session) => {
            // The cursor companion's turn keeps no session for the chat (`start`).
            let companion = |run: &LiveRun| run.body["mode"].as_str() == Some("companion");
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
        RunNote::Resumed => {
            if let Some(run) = live().get_mut(run_id) {
                run.parked = false;
            }
        }
        RunNote::Ended => {
            if let Some(run) = live().remove(run_id) {
                for image in run.images {
                    let _ = std::fs::remove_file(image);
                }
            }
            STOPPED
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(run_id);
            super::mcp::forget(run_id);
            crate::agents::run_control::take_over::release(run_id);
        }
    }
}

static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// Where an engine works when the chat names no folder: `~/.misty/workspace`, made on first use and
/// shared by every build, since the engines know their sessions by its path. Not a profile's own
/// folder, which holds Misty's database and credential store.
fn default_workspace() -> Result<PathBuf, String> {
    let folder = file_access::paths::misty_shared_dir("workspace")
        .ok_or("Misty couldn't find your home folder.")?;
    std::fs::create_dir_all(&folder)
        .map_err(|error| format!("Misty couldn't make {}: {error}", folder.display()))?;
    Ok(folder)
}

/// Starts a turn on the engine the request names. Returns once it is running; its events follow.
pub(crate) async fn start(app: &AppHandle, run_id: String, body: Value) -> Result<(), String> {
    let engine = body["engine"]["id"]
        .as_str()
        .filter(|id| super::is_engine(id))
        .ok_or("That engine has no adapter.")?
        .to_string();
    let state = support::state().ok_or_else(super::not_ready)?;
    let facts = RunFacts::of_request(&run_id, &body);
    let named = body["engine"]["folder"].as_str().unwrap_or("").to_string();
    let agent_name = body["agent"]["name"].as_str().unwrap_or("").to_string();
    let db = app.state::<MistyRuntime>().environment.store();
    let conversation = body["conversation_id"].as_str().unwrap_or("").to_string();
    let fresh = body["engine"]["fresh"].as_bool() == Some(true);
    // The cursor companion's turn runs apart from the chat's engine session, so its pointing
    // rules never stay in what the chat's later turns resume.
    let companion_turn = body["mode"].as_str() == Some("companion");
    // An agent's first run asks the person where it works. Tutor's pointing turns don't stop to
    // ask: they keep to the folder Misty makes.
    if !companion_turn {
        super::agent_folder::ask_before_first_run(
            app,
            &facts.account,
            &facts.agent_id,
            &agent_name,
            &named,
        )
        .await?;
    }
    // Every chat with an agent works in that agent's one folder, worked out here in native code
    // (`agent_folder.rs`): a page can't point an engine at a folder the person didn't choose. A
    // run with no agent works in Misty's own workspace folder.
    let (folder, linked, session) = {
        let (db, account, agent, conversation, engine) = (
            db.clone(),
            facts.account.clone(),
            facts.agent_id.clone(),
            conversation.clone(),
            engine.clone(),
        );
        tokio::task::spawn_blocking(move || -> Result<_, String> {
            let (folder, linked) =
                match super::agent_folder::for_run(&db, &account, &agent, &agent_name, &named)? {
                    Some(folder) => (folder, true),
                    None if named.is_empty() => (default_workspace()?, true),
                    // A run with no agent that names a folder: one the person linked themselves,
                    // or a multi-run worktree made for this account (multirun.rs).
                    None => {
                        let folder = PathBuf::from(&named);
                        let linked = store::is_linked(&db, &account, &folder).unwrap_or(false)
                            || super::multirun::is_worktree(&db, &account, &folder);
                        (folder, linked)
                    }
                };
            let folder_text = folder.to_string_lossy().into_owned();
            let session = if companion_turn {
                None
            } else if fresh {
                let _ = store::forget_session(&db, &account, &conversation);
                None
            } else {
                store::session(&db, &account, &conversation, &engine, &folder_text)
            };
            Ok((folder, linked, session))
        })
        .await
        .map_err(|error| error.to_string())??
    };
    let folder_text = folder.to_string_lossy().into_owned();
    if !linked || !file_access::fs::is_dir(&folder) {
        return Err("That folder isn't linked to a Space on this computer.".into());
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
            parked: false,
        },
    );
    // Claude Code in a chat may stay alive past its turn for a background task (bridge.rs).
    bridge::open(&run_id, engine == "claude");
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
        super::LaunchExtras { args, key },
    )
    .await;
    if let Err(error) = sent {
        bridge::fail(&run_id, &error);
    }
    Ok(())
}
