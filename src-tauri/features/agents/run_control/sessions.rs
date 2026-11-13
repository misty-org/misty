//! Voice and live transcription sessions: what WebSockets to the local server carried, on a Tauri
//! channel out and a command in. Only the person's own windows open them (`live.rs`), and only the
//! window that opened one can use it. Audio and control messages keep the order the renderer sent them
//! in, even though each one is its own IPC call, which nothing else promises to deliver in order.
use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, Mutex, MutexGuard, PoisonError},
};

use futures_util::future::BoxFuture;
use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tokio::{
    sync::mpsc::{self, UnboundedReceiver, UnboundedSender},
    task::AbortHandle,
};

/// What the channel carries. `data` is the JSON text a socket's frame was.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionMessage {
    Message { data: String },
    Closed,
}

/// How many messages wait for the session to read them, as a socket's buffer would.
const WAITING: usize = 256;
/// A gap this long in the numbering means a message is never coming.
const MAX_HELD: usize = 1024;
/// The largest message the app takes at all. Well past any audio frame, and past the voice's own limit
/// of 200,000 characters, which it applies by ignoring the message, as it always has.
const MAX_MESSAGE_BYTES: usize = 8 * 1024 * 1024;

/// The way in, as the kind of frame each session reads.
pub(super) enum Frames {
    Text(mpsc::Sender<String>),
    Binary(mpsc::Sender<Vec<u8>>),
}

impl Frames {
    pub(super) fn text() -> (Self, mpsc::Receiver<String>) {
        let (send, receive) = mpsc::channel(WAITING);
        (Self::Text(send), receive)
    }

    pub(super) fn binary() -> (Self, mpsc::Receiver<Vec<u8>>) {
        let (send, receive) = mpsc::channel(WAITING);
        (Self::Binary(send), receive)
    }

    async fn pass(&self, frame: Vec<u8>) {
        // A session that has ended has stopped reading, as a closed socket discards what's sent.
        match self {
            Self::Text(send) => {
                if let Ok(text) = String::from_utf8(frame) {
                    let _ = send.send(text).await;
                }
            }
            Self::Binary(send) => {
                let _ = send.send(frame).await;
            }
        }
    }
}

/// Puts numbered messages back in order. Each comes out once, when all before it have.
#[derive(Default)]
struct InOrder {
    next: u64,
    held: BTreeMap<u64, Vec<u8>>,
}

impl InOrder {
    /// The messages this one releases, or `None` when too many wait on one that never came.
    fn accept(&mut self, number: u64, message: Vec<u8>) -> Option<Vec<Vec<u8>>> {
        if number < self.next {
            return Some(Vec::new());
        }
        self.held.insert(number, message);
        if self.held.len() > MAX_HELD {
            return None;
        }
        let mut ready = Vec::new();
        while let Some(message) = self.held.remove(&self.next) {
            ready.push(message);
            self.next += 1;
        }
        Some(ready)
    }
}

struct Incoming {
    frames: Option<Frames>,
    order: InOrder,
}

struct Session {
    owner: String,
    incoming: tokio::sync::Mutex<Incoming>,
    abort: AbortHandle,
}

static SESSIONS: Mutex<Option<HashMap<String, Arc<Session>>>> = Mutex::new(None);

fn sessions() -> MutexGuard<'static, Option<HashMap<String, Arc<Session>>>> {
    SESSIONS.lock().unwrap_or_else(PoisonError::into_inner)
}

fn forget(id: &str) {
    if let Some(all) = sessions().as_mut() {
        all.remove(id);
    }
}

fn session_of(id: &str, owner: &str) -> Result<Option<Arc<Session>>, String> {
    match sessions().as_ref().and_then(|all| all.get(id)) {
        Some(session) if session.owner != owner => {
            Err("This session belongs to another window.".to_owned())
        }
        found => Ok(found.cloned()),
    }
}

fn message_of(value: &Value) -> SessionMessage {
    SessionMessage::Message {
        data: value.to_string(),
    }
}

/// Everything the session says, in order, then that it closed. A panic in the session drops its
/// sender like any other end, so the renderer always hears, and the rest of the app never does.
async fn forward(
    id: String,
    channel: Channel<SessionMessage>,
    mut outgoing: UnboundedReceiver<Value>,
    mut task: tokio::task::JoinHandle<()>,
) {
    let mut listening = true;
    loop {
        tokio::select! {
            biased;
            message = outgoing.recv() => {
                let Some(message) = message else { break };
                if channel.send(message_of(&message)).is_err() {
                    listening = false;
                    task.abort();
                    break;
                }
            }
            _ = &mut task => {
                // Something may still hold a sender, so take only what has already been said.
                while let Ok(message) = outgoing.try_recv() {
                    let _ = channel.send(message_of(&message));
                }
                break;
            }
        }
    }
    forget(&id);
    if listening {
        let _ = channel.send(SessionMessage::Closed);
    }
}

/// Starts a session. `run` gets the sender its messages go out on and returns the session to run,
/// which ends when `frames` closes.
pub(super) fn open(
    owner: &str,
    channel: Channel<SessionMessage>,
    frames: Frames,
    run: impl FnOnce(UnboundedSender<Value>) -> BoxFuture<'static, ()>,
) -> String {
    let id = uuid::Uuid::new_v4().simple().to_string();
    let (outgoing, heard) = mpsc::unbounded_channel();
    let task = tokio::spawn(run(outgoing));
    let session = Arc::new(Session {
        owner: owner.to_owned(),
        incoming: tokio::sync::Mutex::new(Incoming {
            frames: Some(frames),
            order: InOrder::default(),
        }),
        abort: task.abort_handle(),
    });
    sessions()
        .get_or_insert_with(HashMap::new)
        .insert(id.clone(), session);
    tokio::spawn(forward(id.clone(), channel, heard, task));
    id
}

/// One message from the renderer. A session that has ended takes it and drops it, as a socket does.
pub(super) async fn deliver(
    owner: &str,
    id: &str,
    number: u64,
    frame: Vec<u8>,
) -> Result<(), String> {
    if frame.len() > MAX_MESSAGE_BYTES {
        return Err("This voice message is too large.".to_owned());
    }
    let Some(session) = session_of(id, owner)? else {
        return Ok(());
    };
    let mut incoming = session.incoming.lock().await;
    let Some(ready) = incoming.order.accept(number, frame) else {
        // Its audio can't be put right any more, so the session ends and the renderer hears.
        session.abort.abort();
        return Err("This session's messages stopped arriving.".to_owned());
    };
    if let Some(frames) = &incoming.frames {
        for frame in ready {
            frames.pass(frame).await;
        }
    }
    Ok(())
}

/// The renderer closed its side. The session ends the way it did when its socket closed, and the
/// renderer hears `Closed` when it has.
pub(super) async fn close(owner: &str, id: &str) -> Result<(), String> {
    if let Some(session) = session_of(id, owner)? {
        session.incoming.lock().await.frames = None;
    }
    Ok(())
}

/// A window's renderer reloaded or it closed. Nothing can hear these any more, and an open live
/// session would keep streaming to Soniox on the person's key.
pub fn close_for_window(owner: &str) {
    if let Some(all) = sessions().as_mut() {
        all.retain(|_, session| {
            let keep = session.owner != owner;
            if !keep {
                session.abort.abort();
            }
            keep
        });
    }
}

pub(super) fn stop_all() {
    if let Some(all) = sessions().take() {
        for session in all.values() {
            session.abort.abort();
        }
    }
}

/// Registered on the app builder: a window's renderer loading again starts with no sessions.
pub fn on_renderer_load(webview: &tauri::Webview, payload: &tauri::webview::PageLoadPayload<'_>) {
    if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
        close_for_window(webview.label());
    }
}

#[cfg(test)]
#[path = "sessions_tests.rs"]
mod tests;
