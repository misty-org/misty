//! The servers that are running: one per window, page load, language and project folder, shared
//! by every file open there and counted, so it ends when its last file lets go of it or its
//! window closes. Each is a child process spoken to over stdio: what it says goes to its window
//! as events keyed by the server's id, and the window writes to it through `send`.
//!
//! The ownership and cleanup follow the terminal panel's (`project/terminal.rs`).

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};
use std::time::Duration;

use serde_json::json;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot};

use super::catalog::Language;
use super::framing;
use super::install::Launch;

/// Each server is a process with a few tasks of its own, and some (rust-analyzer, tsserver) take
/// a lot of memory, so only this many run at once.
const MOST_RUNNING: usize = 12;
/// A server asked to stop gets this long to end on its own before it is killed.
const STOP_GRACE: Duration = Duration::from_secs(2);
/// What the server last printed to stderr, kept to say why it ended.
const KEEP_STDERR: usize = 2048;
/// A message from the server, `{ id, message }`, where `message` is the JSON text.
pub(super) const MESSAGE: &str = "misty://code-lsp-message";
/// A server ended on its own, `{ id, message }`, where `message` says why when it can.
pub(super) const CLOSED: &str = "misty://code-lsp-closed";
/// What a write to a server that has ended says.
pub(super) const GONE: &str = "That language server has stopped.";

struct Server {
    language: Language,
    root: PathBuf,
    /// The window that started it, the only one that may use it.
    window: String,
    /// The window's page load: a reloaded window starts its servers over.
    page: String,
    /// The install it runs from.
    dir: PathBuf,
    input: Mutex<Option<mpsc::UnboundedSender<String>>>,
    stop: Mutex<Option<oneshot::Sender<()>>>,
}

impl Server {
    /// Closes its input and asks it to end; the process task kills it if it doesn't.
    fn end(&self) {
        lock(&self.input).take();
        if let Some(stop) = lock(&self.stop).take() {
            let _ = stop.send(());
        }
    }
}

struct Entry {
    server: Arc<Server>,
    /// Files that use it.
    users: usize,
}

static RUNNING: LazyLock<Mutex<HashMap<String, Entry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// Starts one at a time, so two files opening together share one server.
static STARTING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn running() -> MutexGuard<'static, HashMap<String, Entry>> {
    lock(&RUNNING)
}

/// Ends servers in `ended`, outside the registry's lock.
fn end_all(ended: Vec<Entry>) {
    for entry in ended {
        entry.server.end();
    }
}

/// The server for (window, page, language, root), started if there is none, with one more user.
pub(super) async fn start(
    app: &tauri::AppHandle,
    window: &str,
    page: &str,
    language: Language,
    root: PathBuf,
    launch: Launch,
) -> Result<String, String> {
    let _starting = STARTING.lock().await;
    {
        let mut held = running();
        // A window that loaded again has a new page and new clients: its old servers go.
        let stale: Vec<String> = held
            .iter()
            .filter(|(_, entry)| entry.server.window == window && entry.server.page != page)
            .map(|(id, _)| id.clone())
            .collect();
        let stale: Vec<Entry> = stale.iter().filter_map(|id| held.remove(id)).collect();
        let found = held.iter_mut().find(|(_, entry)| {
            entry.server.window == window
                && entry.server.language == language
                && entry.server.root == root
        });
        if let Some((id, entry)) = found {
            entry.users += 1;
            let id = id.clone();
            drop(held);
            end_all(stale);
            return Ok(id);
        }
        let full = held.len() >= MOST_RUNNING;
        drop(held);
        end_all(stale);
        if full {
            return Err("Too many language servers are running. Close some files first.".into());
        }
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    let server = spawn(app, &id, window, page, language, root, launch)?;
    running().insert(id.clone(), Entry { server, users: 1 });
    Ok(id)
}

fn spawn(
    app: &tauri::AppHandle,
    id: &str,
    window: &str,
    page: &str,
    language: Language,
    root: PathBuf,
    launch: Launch,
) -> Result<Arc<Server>, String> {
    let mut command = tokio::process::Command::new(&launch.program);
    command
        .args(&launch.args)
        .current_dir(&root)
        .env("PATH", &launch.path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    crate::engines::hide_console(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("{} couldn't be started: {error}", language.server()))?;
    let (Some(mut stdin), Some(stdout), Some(stderr)) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        let _ = child.start_kill();
        return Err(format!("{} couldn't be started.", language.server()));
    };
    let (input, mut outgoing) = mpsc::unbounded_channel::<String>();
    let (stop, stopped) = oneshot::channel::<()>();
    let server = Arc::new(Server {
        language,
        root,
        window: window.to_string(),
        page: page.to_string(),
        dir: launch.dir,
        input: Mutex::new(Some(input)),
        stop: Mutex::new(Some(stop)),
    });

    // Writes what the window sends, framed. Once every sender is gone the server's input
    // closes, which tells a well-behaved server to end.
    tauri::async_runtime::spawn(async move {
        while let Some(body) = outgoing.recv().await {
            let header = framing::header(&body);
            let written = async {
                stdin.write_all(header.as_bytes()).await?;
                stdin.write_all(body.as_bytes()).await?;
                stdin.flush().await
            }
            .await;
            if written.is_err() {
                break;
            }
        }
    });

    // Sends each message the server prints to its window, in order. Output that isn't LSP
    // ends the server: nothing would read the rest, and it would stall once the pipe filled.
    {
        let app = app.clone();
        let id = id.to_string();
        let server = Arc::clone(&server);
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stdout);
            loop {
                match framing::read_message(&mut reader).await {
                    Ok(Some(message)) => {
                        let _ = app.emit_to(
                            server.window.as_str(),
                            MESSAGE,
                            json!({ "id": id, "message": message }),
                        );
                    }
                    Ok(None) => break,
                    Err(_) => {
                        server.end();
                        break;
                    }
                }
            }
        });
    }

    // Keeps the end of what the server writes to stderr, for when it fails.
    let said = Arc::new(Mutex::new(String::new()));
    {
        let said = Arc::clone(&said);
        tauri::async_runtime::spawn(async move {
            // Read to the end whatever it holds, so a chatty server never stalls on a full pipe.
            let mut reader = BufReader::new(stderr);
            let mut line = Vec::new();
            loop {
                line.clear();
                match reader.read_until(b'\n', &mut line).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
                let mut kept = lock(&said);
                kept.push_str(&String::from_utf8_lossy(&line));
                if kept.len() > KEEP_STDERR {
                    let cut = kept.len() - KEEP_STDERR;
                    let cut = (cut..kept.len())
                        .find(|at| kept.is_char_boundary(*at))
                        .unwrap_or(kept.len());
                    kept.drain(..cut);
                }
            }
        });
    }

    // Waits for the process to end, ending it when asked, and tells the window when it ended
    // on its own.
    {
        let app = app.clone();
        let id = id.to_string();
        let server = Arc::clone(&server);
        tauri::async_runtime::spawn(async move {
            let asked = tokio::select! {
                _ = child.wait() => false,
                _ = stopped => true,
            };
            if asked
                && tokio::time::timeout(STOP_GRACE, child.wait())
                    .await
                    .is_err()
            {
                let _ = child.kill().await;
            }
            let ended_by_itself = {
                let mut held = running();
                let current = held
                    .get(&id)
                    .is_some_and(|entry| Arc::ptr_eq(&entry.server, &server));
                if current {
                    held.remove(&id);
                }
                current && !asked
            };
            if ended_by_itself {
                let last = lock(&said)
                    .lines()
                    .rev()
                    .find(|line| !line.trim().is_empty())
                    .map(|line| line.trim().chars().take(300).collect::<String>());
                let message = match last {
                    Some(last) => format!("{} stopped: {last}", server.language.server()),
                    None => format!("{} stopped.", server.language.server()),
                };
                let _ = app.emit_to(
                    server.window.as_str(),
                    CLOSED,
                    json!({ "id": id, "message": message }),
                );
            }
        });
    }
    Ok(server)
}

/// The running server `id` names, if this window started it.
fn owned(window: &str, id: &str) -> Result<Option<Arc<Server>>, String> {
    let Some(server) = running().get(id).map(|entry| Arc::clone(&entry.server)) else {
        return Ok(None);
    };
    if server.window != window {
        return Err("That language server belongs to another window.".into());
    }
    Ok(Some(server))
}

/// Hands messages to the server, in the order given.
pub(super) fn send(window: &str, id: &str, messages: Vec<String>) -> Result<(), String> {
    if messages
        .iter()
        .any(|message| message.len() > framing::MOST_BYTES)
    {
        return Err("That message is too large for the language server.".into());
    }
    let server = owned(window, id)?.ok_or(GONE)?;
    let input = lock(&server.input);
    let input = input.as_ref().ok_or(GONE)?;
    for message in messages {
        input.send(message).map_err(|_| GONE.to_string())?;
    }
    Ok(())
}

/// One file stops using a server. Whether the server ended because it was the last.
pub(super) fn release(window: &str, id: &str) -> Result<bool, String> {
    if owned(window, id)?.is_none() {
        return Ok(true);
    }
    let ended = {
        let mut held = running();
        let last = match held.get_mut(id) {
            Some(entry) => {
                entry.users = entry.users.saturating_sub(1);
                entry.users == 0
            }
            None => return Ok(true),
        };
        if last {
            held.remove(id)
        } else {
            None
        }
    };
    match ended {
        Some(entry) => {
            entry.server.end();
            Ok(true)
        }
        None => Ok(false),
    }
}

/// The installs running servers use, which an update must leave in place.
pub(super) fn dirs_in_use() -> Vec<PathBuf> {
    let dirs: HashSet<PathBuf> = running()
        .values()
        .map(|entry| entry.server.dir.clone())
        .collect();
    dirs.into_iter().collect()
}

/// Ends the servers a window started, as it closes.
pub(super) fn close_window(window: &str) {
    let ended: Vec<Entry> = {
        let mut held = running();
        let ids: Vec<String> = held
            .iter()
            .filter(|(_, entry)| entry.server.window == window)
            .map(|(id, _)| id.clone())
            .collect();
        ids.iter().filter_map(|id| held.remove(id)).collect()
    };
    end_all(ended);
}

/// Ends every server, as the app quits. A server whose process outlives the request ends when
/// its input closes with the app.
pub(super) fn close_all() {
    let ended: Vec<Entry> = running().drain().map(|(_, entry)| entry).collect();
    end_all(ended);
}
