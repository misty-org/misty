//! The companion's spoken conversation, on the desktop's own models. One
//! session is one push-to-talk session in the protocol `companionConversation.ts` speaks: a turn is
//! heard (audio, or typed text), answered on the fast model, which may hand work to the app as a tool
//! call, and spoken sentence by sentence. Context and task status come from the app, which keeps the
//! chat. A session is never reconnected: work is never replayed.
use std::sync::{Mutex, MutexGuard};

use futures_util::future::{pending, select, BoxFuture, Either};
use serde_json::{json, Value};
use tokio::sync::{mpsc::UnboundedSender, watch};

use super::super::{
    device::{zod::node_base64, CallError},
    js_json::JsValue,
    text::js_prefix,
};
use crate::{runtime::logger::process_log, sdk::Message};

/// The reply: words to say, or one tool to call. A field is `None` when the model didn't write it as
/// text, which ends the turn in a session failure when the turn needs that field.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct VoiceDecision {
    pub say: Option<String>,
    pub tool: Option<String>,
    pub instruction: Option<String>,
}

/// The models a voice session runs on. Dropping a future cancels the call.
pub trait VoiceModels: Send + Sync {
    /// What was said in 24 kHz 16-bit mono PCM.
    fn transcribe<'a>(&'a self, pcm: &'a [u8]) -> BoxFuture<'a, Result<String, CallError>>;
    /// The reply: words to say, or one tool to call.
    fn reply<'a>(&'a self, system: &'a str, messages: Vec<Message>, tools: &'a [String]) -> BoxFuture<'a, Result<VoiceDecision, CallError>>;
    /// One sentence as 24 kHz 16-bit mono PCM; its neighbours keep the delivery continuous.
    fn speak<'a>(&'a self, text: &'a str, previous: &'a str, next: &'a str) -> BoxFuture<'a, Result<Vec<u8>, CallError>>;
}

const MAX_TURNS: u32 = 8;
const MAX_PCM_BYTES: usize = 24_000 * 2 * 60;
const STOPPED: &str = "The voice session stopped. Your tasks and saved conversation are still available. Try voice again.";

/// A protocol error or a failed call: either ends what's going on with the one message.
#[derive(Debug)]
pub(super) enum Stop {
    Protocol(&'static str),
    Call(CallError),
    Aborted,
}

impl From<CallError> for Stop {
    fn from(error: CallError) -> Self {
        Self::Call(error)
    }
}

pub(super) struct Pending {
    pub(super) call_id: String,
    pub(super) name: String,
}

pub(super) struct Turn {
    /// Which `begin` this is. An object's identity did this job in the TypeScript.
    pub(super) number: u32,
    pub(super) id: String,
    pub(super) prompt: String,
    pub(super) reply: String,
    pub(super) interrupted: bool,
    sequence: f64,
    pub(super) pcm: Vec<u8>,
    pub(super) bytes: usize,
    committed: bool,
    pub(super) result_only: bool,
    pub(super) rounds: u32,
    abort: watch::Sender<bool>,
    pub(super) pending: Option<Pending>,
}

pub(super) struct State {
    pub(super) history: Vec<Message>,
    pub(super) context: String,
    pub(super) task: String,
    pub(super) turn: Option<Turn>,
    pub(super) turns: u32,
    closed: bool,
}

pub(crate) struct VoiceSession<'m> {
    pub(super) sid: String,
    send: UnboundedSender<Value>,
    pub(super) models: &'m dyn VoiceModels,
    state: Mutex<State>,
}

/// `value.length > limit ? value.slice(0, limit) : value`.
pub(super) fn clip(value: &str, limit: usize) -> &str {
    js_prefix(value, limit)
}

impl<'m> VoiceSession<'m> {
    pub(crate) fn new(sid: &str, send: UnboundedSender<Value>, models: &'m dyn VoiceModels) -> Self {
        let session = Self {
            sid: sid.to_owned(),
            send,
            models,
            state: Mutex::new(State {
                history: Vec::new(),
                context: "[]".to_owned(),
                task: String::new(),
                turn: None,
                turns: 0,
                closed: false,
            }),
        };
        session.emit(json!({ "type": "ready" }));
        session
    }

    pub(super) fn emit(&self, event: Value) {
        // A gone receiver is the app closing the session, which `close` deals with.
        let _ = self.send.send(event);
    }

    pub(super) fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) fn close(&self) {
        let mut state = self.state();
        state.closed = true;
        if let Some(turn) = &state.turn {
            turn.abort.send_replace(true);
        }
    }

    /// One event from the app. A protocol error reports its message and leaves the session open.
    pub(crate) async fn handle(&self, event: &JsValue) {
        if let Err(stop) = self.dispatch(event).await {
            self.fail(&stop);
        }
    }

    async fn dispatch(&self, event: &JsValue) -> Result<(), Stop> {
        let text = |key: &str| event.get(key).and_then(JsValue::as_str).unwrap_or("");
        match event.get("type").and_then(JsValue::as_str) {
            Some("ping") => {
                self.emit(json!({ "type": "pong" }));
                Ok(())
            }
            Some("context") => {
                // The chat's recent turns (JSON) and its current task, kept by the app.
                let mut state = self.state();
                let history = clip(text("history"), 24_000);
                state.context = if history.is_empty() { "[]".to_owned() } else { history.to_owned() };
                state.task = clip(text("task"), 200).to_owned();
                Ok(())
            }
            Some("turn.begin") => self.begin(),
            Some("audio.append") => {
                let sequence = event.get("sequence").map_or(f64::NAN, JsValue::to_js_number);
                self.append(sequence, text("audio"))
            }
            Some("audio.commit") => self.commit_audio().await,
            Some("text.commit") => self.commit_text(text("text")).await,
            Some("task.read") => self.read_task(text("invocationId"), text("result")).await,
            Some("tool.result") => self.tool_result(text("callId"), text("invocationId"), text("result")).await,
            Some("playback.done") => {
                self.finish();
                Ok(())
            }
            Some("turn.cancel") => {
                self.cancel();
                Ok(())
            }
            _ => Err(Stop::Protocol("unsupported voice event")),
        }
    }

    fn begin(&self) -> Result<(), Stop> {
        let mut state = self.state();
        if state.turn.is_some() {
            return Err(Stop::Protocol("a voice turn is already open"));
        }
        if state.turns >= MAX_TURNS {
            drop(state);
            self.emit(json!({ "type": "session.expired" }));
            return Ok(());
        }
        state.turns += 1;
        let number = state.turns;
        state.turn = Some(Turn {
            number,
            id: format!("voice-{}-{number}", self.sid),
            prompt: String::new(),
            reply: String::new(),
            interrupted: false,
            sequence: 0.0,
            pcm: Vec::new(),
            bytes: 0,
            committed: false,
            result_only: false,
            rounds: 0,
            abort: watch::channel(false).0,
            pending: None,
        });
        drop(state);
        self.emit(json!({ "type": "turn.ready" }));
        Ok(())
    }

    fn append(&self, sequence: f64, audio: &str) -> Result<(), Stop> {
        let mut state = self.state();
        let turn = state.turn.as_mut().ok_or(Stop::Protocol("no voice turn"))?;
        if turn.committed || sequence != turn.sequence {
            return Err(Stop::Protocol("voice audio out of order"));
        }
        let pcm = node_base64(audio);
        turn.bytes += pcm.len();
        if turn.bytes > MAX_PCM_BYTES {
            return Err(Stop::Protocol("voice recording too long"));
        }
        turn.sequence += 1.0;
        turn.pcm.extend_from_slice(&pcm);
        Ok(())
    }

    /// Marks the open turn as submitted, and gives back what the steps after it need.
    pub(super) fn commit(&self) -> Result<u32, Stop> {
        let mut state = self.state();
        let turn = state.turn.as_mut().ok_or(Stop::Protocol("no voice turn"))?;
        if turn.committed {
            return Err(Stop::Protocol("voice turn already submitted"));
        }
        turn.committed = true;
        Ok(turn.number)
    }

    /// Runs a model call until it answers or the turn is aborted, which reads as a failed call.
    pub(super) async fn abortable<T>(&self, number: u32, call: BoxFuture<'_, Result<T, CallError>>) -> Result<T, Stop> {
        let mut aborted = {
            let state = self.state();
            let turn = state.turn.as_ref().filter(|turn| turn.number == number);
            turn.ok_or(Stop::Aborted)?.abort.subscribe()
        };
        let abort = Box::pin(async move {
            // A turn that ended without an abort lets its call finish, and then says nothing.
            if aborted.wait_for(|stopped| *stopped).await.is_err() {
                pending::<()>().await;
            }
        });
        match select(call, abort).await {
            Either::Left((result, _)) => Ok(result?),
            Either::Right(_) => Err(Stop::Aborted),
        }
    }

    fn cancel(&self) {
        {
            let mut state = self.state();
            let Some(turn) = state.turn.as_mut() else {
                return;
            };
            turn.interrupted = true;
            turn.abort.send_replace(true);
            if !turn.reply.is_empty() {
                turn.reply = "[Voice reply interrupted; unfinished speech omitted.]".to_owned();
            }
        }
        self.finish();
    }

    fn finish(&self) {
        let Some(turn) = self.state().turn.take() else {
            return;
        };
        self.emit(json!({
            "type": "turn.done",
            "id": turn.id,
            "prompt": turn.prompt,
            "reply": turn.reply,
            "interrupted": turn.interrupted,
        }));
    }

    /// A turn the person interrupted, or a closed session, says nothing more.
    pub(super) fn stale(&self, number: u32) -> bool {
        let state = self.state();
        state.closed || state.turn.as_ref().map_or(true, |turn| turn.number != number || turn.interrupted)
    }

    fn fail(&self, stop: &Stop) {
        if self.state().closed {
            return;
        }
        match stop {
            Stop::Protocol(message) => process_log(&format!("voice session failed {message}")),
            Stop::Call(error) => process_log(&format!("voice session failed {error}")),
            Stop::Aborted => process_log("voice session failed This operation was aborted"),
        }
        self.emit(json!({ "type": "error", "message": STOPPED }));
    }
}
