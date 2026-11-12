// The terminal panel: the person's own shells in a linked folder, one real pseudo-terminal per tab.
// A shell outlives the panel: it ends when its tab is closed, when the window that opened it
// closes, or when the app quits.
//
// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong): terminal.rs and the
// output batching of event_sink.rs. See NOTICE.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};
use std::time::Duration;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use serde_json::json;
use tauri::Emitter;

use super::{linked_path, person_window};

/// Each shell owns a process and a reader thread, so open tabs are capped.
const MOST_OPEN: usize = 32;
/// Output is sent as an array of `{ id, data }`, gathered for this long or until this many bytes,
/// so a flood (a `cat` of a large file) is a few messages instead of one per read.
const FLUSH_INTERVAL: Duration = Duration::from_millis(32);
const FLUSH_BYTES: usize = 64 * 1024;
const OUTPUT: &str = "misty://terminal-output";
const CLOSED: &str = "misty://terminal-closed";
/// What a write to a shell that has ended says; the panel reopens the shell when it sees this.
const GONE: &str = "That terminal has closed.";

struct Session {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    /// The window that opened it, the only one that may use it.
    window: String,
}

impl Session {
    fn kill(&self) {
        let _ = lock(&self.child).kill();
    }
}

static OPEN: LazyLock<Mutex<HashMap<String, Arc<Session>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn open() -> MutexGuard<'static, HashMap<String, Arc<Session>>> {
    lock(&OPEN)
}

/// The shell a session runs: the person's login shell, or `cmd.exe` on Windows.
fn shell() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into())
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into())
    }
}

/// A UTF-8 locale, so tools that print more than ASCII (git, ls, the CLIs) don't fall back to the
/// C locale and garble it.
fn locale() -> String {
    let found = std::env::var("LC_ALL")
        .or_else(|_| std::env::var("LANG"))
        .unwrap_or_default();
    utf8_locale(&found)
}

fn utf8_locale(found: &str) -> String {
    let lower = found.to_lowercase();
    if lower.contains("utf-8") || lower.contains("utf8") {
        found.to_string()
    } else {
        "en_US.UTF-8".to_string()
    }
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.max(2),
        rows: rows.max(2),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// Turns the bytes a shell prints into text without ever cutting a character in two: a character
/// split across two reads waits for its other half, and bytes that can never be text are dropped.
#[derive(Default)]
struct Utf8Stream {
    held: Vec<u8>,
}

impl Utf8Stream {
    fn feed(&mut self, bytes: &[u8]) -> String {
        self.held.extend_from_slice(bytes);
        let mut text = String::new();
        loop {
            match std::str::from_utf8(&self.held) {
                Ok(whole) => {
                    text.push_str(whole);
                    self.held.clear();
                    return text;
                }
                Err(error) => {
                    let good = error.valid_up_to();
                    text.push_str(&String::from_utf8_lossy(&self.held[..good]));
                    self.held.drain(..good);
                    match error.error_len() {
                        // A character cut off at the end: wait for the rest.
                        None => return text,
                        // Bytes that are not text: drop them and carry on after them.
                        Some(bad) => {
                            self.held.drain(..bad.min(self.held.len()));
                        }
                    }
                }
            }
        }
    }
}

/// Output waiting to be sent to one window, already turned into JSON.
#[derive(Default)]
struct Pending {
    events: Vec<String>,
    bytes: usize,
    scheduled: bool,
}

/// What adding output to a window's batch calls for.
#[derive(Debug, PartialEq, Eq)]
enum Next {
    /// Enough is waiting: send it now.
    Flush,
    /// The first output since the last send: send it after the interval.
    Schedule,
    /// A send is already on its way.
    Wait,
}

impl Pending {
    fn push(&mut self, event: String) -> Next {
        self.bytes += event.len();
        self.events.push(event);
        if self.bytes >= FLUSH_BYTES {
            Next::Flush
        } else if self.scheduled {
            Next::Wait
        } else {
            self.scheduled = true;
            Next::Schedule
        }
    }

    /// The batch as a JSON array, or nothing when it is empty. Either way a new send may be
    /// scheduled after this.
    fn take(&mut self) -> Option<String> {
        self.scheduled = false;
        if self.events.is_empty() {
            return None;
        }
        self.bytes = 0;
        Some(format!("[{}]", std::mem::take(&mut self.events).join(",")))
    }
}

static BATCHES: LazyLock<Mutex<HashMap<String, Pending>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn flush(app: &tauri::AppHandle, window: &str) {
    let payload = lock(&BATCHES).get_mut(window).and_then(Pending::take);
    let Some(payload) = payload else { return };
    if let Ok(raw) = serde_json::value::RawValue::from_string(payload) {
        let _ = app.emit_to(window, OUTPUT, raw);
    }
}

/// Queues output for the window that owns the terminal.
fn send(app: &tauri::AppHandle, window: &str, id: &str, data: String) {
    if data.is_empty() {
        return;
    }
    let event = json!({ "id": id, "data": data }).to_string();
    let next = lock(&BATCHES)
        .entry(window.to_string())
        .or_default()
        .push(event);
    match next {
        Next::Flush => flush(app, window),
        Next::Schedule => {
            let app = app.clone();
            let window = window.to_string();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(FLUSH_INTERVAL).await;
                flush(&app, &window);
            });
        }
        Next::Wait => {}
    }
}

/// Reads what the shell prints on a thread of its own until the shell ends. A read that fails
/// while the shell still runs ends the shell too, so none is left without an owner.
fn pump(
    app: tauri::AppHandle,
    id: String,
    session: Arc<Session>,
    mut reader: Box<dyn Read + Send>,
) {
    std::thread::spawn(move || {
        let mut stream = Utf8Stream::default();
        let mut chunk = [0_u8; 8192];
        let mut failed = false;
        loop {
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => send(&app, &session.window, &id, stream.feed(&chunk[..read])),
                Err(_) => {
                    failed = true;
                    break;
                }
            }
        }
        if failed {
            session.kill();
        }
        // What was still waiting goes out before the window hears the shell ended.
        flush(&app, &session.window);
        // Only a shell that ended on its own is announced: one closed from the panel, or replaced
        // by a new shell under the same id (a rerun launch script), is already known there.
        let ended_by_itself = {
            let mut held = open();
            let current = held
                .get(&id)
                .is_some_and(|current| Arc::ptr_eq(current, &session));
            if current {
                held.remove(&id);
            }
            current
        };
        if ended_by_itself {
            let _ = app.emit_to(session.window.as_str(), CLOSED, json!({ "id": id }));
        }
    });
}

/// The session `id` names, if this window opened it.
fn owned(webview: &tauri::Webview, id: &str) -> Result<Option<Arc<Session>>, String> {
    let Some(session) = open().get(id).cloned() else {
        return Ok(None);
    };
    if session.window != webview.label() {
        return Err("That terminal belongs to another window.".into());
    }
    Ok(Some(session))
}

/// Opens a terminal in a linked folder. Opening one that is already open changes nothing, so a
/// panel that shows a tab again simply reattaches to its shell.
#[tauri::command]
pub async fn project_terminal_open(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    account: String,
    id: String,
    folder: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    person_window(&webview)?;
    if id.is_empty() || id.len() > 128 {
        return Err("That isn't a terminal.".into());
    }
    let folder = linked_path(&app, &account, &folder).await?;
    if !file_access::fs::is_dir(&folder) {
        return Err("That folder is gone.".into());
    }
    {
        let held = open();
        if let Some(existing) = held.get(&id) {
            if existing.window != webview.label() {
                return Err("That terminal belongs to another window.".into());
            }
            return Ok(());
        }
        if held.len() >= MOST_OPEN {
            return Err("Close a terminal before opening another.".into());
        }
    }
    let pair = native_pty_system()
        .openpty(size(cols, rows))
        .map_err(|error| format!("A terminal could not be opened: {error}"))?;
    let mut command = CommandBuilder::new(shell());
    // An interactive shell, for the person's aliases and prompt. cmd.exe has no such flag.
    #[cfg(not(windows))]
    command.arg("-i");
    command.cwd(&folder);
    command.env("PATH", crate::engines::resolve::search_path());
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    let locale = locale();
    command.env("LANG", &locale);
    command.env("LC_ALL", &locale);
    command.env("LC_CTYPE", &locale);
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("The shell could not be started: {error}"))?;
    drop(pair.slave);
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let session = Arc::new(Session {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
        window: webview.label().to_string(),
    });
    {
        let mut held = open();
        // Another open of the same tab won the race: keep its shell and end this one.
        if held.contains_key(&id) {
            drop(held);
            session.kill();
            return Ok(());
        }
        held.insert(id.clone(), Arc::clone(&session));
    }
    pump(app, id, session, reader);
    Ok(())
}

/// Types into a terminal. A large paste can fill the terminal's buffer and wait, so it is
/// written off the async workers.
#[tauri::command]
pub async fn project_terminal_write(
    webview: tauri::Webview,
    id: String,
    data: String,
) -> Result<(), String> {
    person_window(&webview)?;
    let session = owned(&webview, &id)?.ok_or(GONE)?;
    tokio::task::spawn_blocking(move || {
        let mut writer = lock(&session.writer);
        writer
            .write_all(data.as_bytes())
            .and_then(|()| writer.flush())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn project_terminal_resize(
    webview: tauri::Webview,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    person_window(&webview)?;
    let Some(session) = owned(&webview, &id)? else {
        return Ok(());
    };
    let master = lock(&session.master);
    master
        .resize(size(cols, rows))
        .map_err(|error| error.to_string())
}

/// Closes a terminal and ends its shell. Closing one that is gone changes nothing.
#[tauri::command]
pub fn project_terminal_close(webview: tauri::Webview, id: String) -> Result<(), String> {
    person_window(&webview)?;
    if owned(&webview, &id)?.is_none() {
        return Ok(());
    }
    if let Some(session) = open().remove(&id) {
        session.kill();
    }
    Ok(())
}

/// What the panel needs to quote input for the shell that really runs it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    platform: &'static str,
    shell_path: String,
}

#[tauri::command]
pub fn project_terminal_host_info(webview: tauri::Webview) -> Result<HostInfo, String> {
    person_window(&webview)?;
    Ok(HostInfo {
        platform: std::env::consts::OS,
        shell_path: shell(),
    })
}

/// Ends the shells a window opened, as it closes.
pub fn close_window(window: &str) {
    let ended: Vec<Arc<Session>> = {
        let mut held = open();
        let ids: Vec<String> = held
            .iter()
            .filter(|(_, session)| session.window == window)
            .map(|(id, _)| id.clone())
            .collect();
        ids.iter().filter_map(|id| held.remove(id)).collect()
    };
    for session in ended {
        session.kill();
    }
    lock(&BATCHES).remove(window);
}

/// Ends every shell, as the app quits.
pub fn close_all() {
    let ended: Vec<Arc<Session>> = open().drain().map(|(_, session)| session).collect();
    for session in ended {
        session.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_split_across_reads_is_kept_whole() {
        let mut stream = Utf8Stream::default();
        let text = "héllo 中文";
        let bytes = text.as_bytes();
        // "中" is three bytes; cut inside it.
        let cut = text.find('中').unwrap() + 1;
        let first = stream.feed(&bytes[..cut]);
        let second = stream.feed(&bytes[cut..]);
        assert_eq!(first, "héllo ");
        assert_eq!(format!("{first}{second}"), text);
    }

    #[test]
    fn bytes_that_are_not_text_are_dropped_and_reading_goes_on() {
        let mut stream = Utf8Stream::default();
        assert_eq!(stream.feed(b"ok\xff\xfeend"), "okend");
        assert_eq!(stream.feed(b"\xe4"), "");
        assert_eq!(stream.feed("\u{4e2d}".as_bytes()[1..].as_ref()), "中");
    }

    #[test]
    fn output_waits_for_the_interval_unless_it_is_large() {
        let mut pending = Pending::default();
        assert_eq!(pending.push("\"a\"".into()), Next::Schedule);
        assert_eq!(pending.push("\"b\"".into()), Next::Wait);
        assert_eq!(pending.take().as_deref(), Some("[\"a\",\"b\"]"));
        assert_eq!(pending.take(), None);
        // After a send, the next output schedules again.
        assert_eq!(pending.push("\"c\"".into()), Next::Schedule);
        let big = format!("\"{}\"", "x".repeat(FLUSH_BYTES));
        assert_eq!(pending.push(big), Next::Flush);
        assert!(pending.take().unwrap().starts_with("[\"c\","));
        assert_eq!(pending.bytes, 0);
    }

    #[test]
    fn the_locale_is_always_utf8() {
        assert_eq!(utf8_locale("de_DE.UTF-8"), "de_DE.UTF-8");
        assert_eq!(utf8_locale("C"), "en_US.UTF-8");
        assert_eq!(utf8_locale(""), "en_US.UTF-8");
    }
}
