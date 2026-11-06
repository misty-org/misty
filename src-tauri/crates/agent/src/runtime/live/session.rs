//! One live session: a Soniox stream per channel, diarized within each, with segments relayed to the
//! desktop as they revise. Audio is counted as it arrives and the session stops at its limit
//! (`live/session.ts`).
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use futures_util::future::{join_all, try_join_all, BoxFuture, FutureExt, Shared};
use serde_json::{json, Value};
use tokio::sync::mpsc::UnboundedSender;

use super::super::{js_json::JsValue, text::{js_len, js_prefix, js_trim}};
use super::segment::LiveChannel;
use super::captions::{CaptionOptions, SonioxCaptions};
use super::soniox::{soniox_config, GeneralContext, SonioxConfig, SonioxContext, SonioxResult, TranslationTerm};

/// A stream failed. What it said goes no further, since provider errors can echo request details.
#[derive(Debug)]
pub struct SttError;

/// What a stream reports as it runs.
pub enum SttEvent {
    Result(SonioxResult),
    Endpoint,
    Error,
}

pub type SttEvents = Arc<dyn Fn(SttEvent) + Send + Sync>;

/// The part of a realtime speech-to-text session the relay uses.
pub trait SttStream: Send + Sync {
    fn connect(&self) -> BoxFuture<'_, Result<(), SttError>>;
    /// Fails when the stream isn't connected.
    fn send_audio(&self, data: &[u8]) -> Result<(), SttError>;
    fn finish(&self) -> BoxFuture<'_, Result<(), SttError>>;
    fn close(&self);
}

pub trait SttFactory: Send + Sync {
    fn open(&self, config: &SonioxConfig, events: SttEvents) -> Arc<dyn SttStream>;
}

/// What one session may do. These were a ticket's claims, and only the app can start a session now,
/// so nothing signs them.
#[derive(Clone, Debug)]
pub struct LiveSessionSpec {
    pub sid: String,
    pub channels: Vec<LiveChannel>,
    /// Total audio this session may stream, across channels, in ms.
    pub max_ms: u64,
    pub language: Option<String>,
    pub model: String,
}

/// 16 kHz mono PCM16: 32 bytes per millisecond.
const BYTES_PER_MS: u64 = 32;

struct Lane {
    channel: LiveChannel,
    stream: Arc<dyn SttStream>,
    captions: Arc<Mutex<SonioxCaptions>>,
}

impl Lane {
    fn share(&self) -> Self {
        Self { channel: self.channel, stream: self.stream.clone(), captions: self.captions.clone() }
    }
}

#[derive(Default)]
struct State {
    lanes: Vec<Lane>,
    used_bytes: u64,
    started: bool,
    ending: Option<Shared<BoxFuture<'static, ()>>>,
}

pub(crate) struct LiveSession {
    spec: LiveSessionSpec,
    send: UnboundedSender<Value>,
    factory: Arc<dyn SttFactory>,
    state: Mutex<State>,
    myself: Weak<LiveSession>,
}

fn locked<T: ?Sized>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// What the desktop asked to bring along, within bounds. `Err` is a field that wasn't a list, which
/// threw in the TypeScript and left the session started with no streams.
fn bounded_context(context: Option<&JsValue>) -> Result<Option<SonioxContext>, ()> {
    let Some(context) = context else {
        return Ok(None);
    };
    let list = |key: &str| -> Result<&[JsValue], ()> {
        match context.get(key) {
            None | Some(JsValue::Null) => Ok(&[]),
            Some(JsValue::Array(items)) => Ok(items),
            Some(_) => Err(()),
        }
    };
    let terms = list("terms")?
        .iter()
        .filter_map(JsValue::as_str)
        .map(js_trim)
        .filter(|term| !term.is_empty())
        .map(|term| js_prefix(term, 160).to_owned())
        .take(200)
        .collect();
    let general = list("general")?
        .iter()
        .filter_map(|entry| Some((entry.get("key")?.as_str()?, entry.get("value")?.as_str()?)))
        .take(10)
        .map(|(key, value)| GeneralContext { key: js_prefix(key, 80).to_owned(), value: js_prefix(value, 400).to_owned() })
        .collect();
    let text = context.get("text").and_then(JsValue::as_str).map(|text| js_prefix(text, 4000)).filter(|text| !text.is_empty());
    let translation_terms = list("translation_terms")?
        .iter()
        .filter_map(|term| Some((js_trim(term.get("source")?.as_str()?), js_trim(term.get("target")?.as_str()?))))
        .filter(|(source, target)| !source.is_empty() && !target.is_empty())
        .take(100)
        .map(|(source, target)| TranslationTerm { source: js_prefix(source, 160).to_owned(), target: js_prefix(target, 160).to_owned() })
        .collect();
    Ok(Some(SonioxContext { terms, general, text: text.map(str::to_owned), translation_terms }))
}

impl LiveSession {
    pub(crate) fn new(spec: LiveSessionSpec, send: UnboundedSender<Value>, factory: Arc<dyn SttFactory>) -> Arc<Self> {
        Arc::new_cyclic(|myself| Self { spec, send, factory, state: Mutex::default(), myself: myself.clone() })
    }

    pub(crate) fn used_ms(&self) -> u64 {
        locked(&self.state).used_bytes / BYTES_PER_MS
    }

    fn emit(&self, message: Value) {
        // A gone receiver is the app closing the session, which `close` deals with.
        let _ = self.send.send(message);
    }

    pub(crate) async fn start(&self, message: &JsValue) {
        {
            let mut state = locked(&self.state);
            if state.started || state.ending.is_some() {
                return;
            }
            state.started = true;
        }
        let short_text = |key: &str| message.get(key).and_then(JsValue::as_str).filter(|text| js_len(text) <= 16);
        let language = short_text("language")
            .or(self.spec.language.as_deref().filter(|language| !language.is_empty()))
            .unwrap_or("auto")
            .to_owned();
        let target = short_text("target").unwrap_or(&language).to_owned();
        let model = self.spec.model.strip_prefix("soniox/").unwrap_or(&self.spec.model);
        let Ok(context) = bounded_context(message.get("context")) else {
            return;
        };
        let streams: Vec<Arc<dyn SttStream>> = self
            .spec
            .channels
            .iter()
            .map(|channel| self.open_lane(*channel, &language, &target, model, context.clone()))
            .collect();
        if try_join_all(streams.iter().map(|stream| stream.connect())).await.is_err() {
            self.fail("Live transcription couldn't start. Try again in a moment.");
            return;
        }
        let channels: Vec<&str> = self.spec.channels.iter().map(|channel| channel.as_str()).collect();
        self.emit(json!({ "type": "ready", "channels": channels, "maxMs": self.spec.max_ms }));
    }

    fn open_lane(&self, channel: LiveChannel, language: &str, target: &str, model: &str, context: Option<SonioxContext>) -> Arc<dyn SttStream> {
        let send = self.send.clone();
        let captions = Arc::new(Mutex::new(SonioxCaptions::new(
            format!("{}:{}", self.spec.sid, channel.as_str()),
            language,
            target,
            Box::new(move |segment| {
                let _ = send.send(json!({ "type": "segment", "segment": segment }));
            }),
            CaptionOptions { channel: Some(channel), no_translation: target == language },
        )));
        let hearing = captions.clone();
        let session = self.myself.clone();
        let events: SttEvents = Arc::new(move |event| match event {
            SttEvent::Result(result) => locked(&hearing).ingest(&result, result.total_audio_proc_ms),
            SttEvent::Endpoint => locked(&hearing).flush(),
            // Provider errors can echo request details; report only that it failed.
            SttEvent::Error => {
                if let Some(session) = session.upgrade() {
                    session.fail("Live transcription stopped. Check your connection and try again.");
                }
            }
        });
        let stream = self.factory.open(&soniox_config(language, target, model, context), events);
        locked(&self.state).lanes.push(Lane { channel, stream: stream.clone(), captions });
        stream
    }

    /// A binary frame: one channel byte (0 mic, 1 system), then PCM16 audio.
    pub(crate) fn audio(&self, frame: &[u8]) {
        if frame.len() < 3 {
            return;
        }
        let channel = match frame[0] {
            0 => LiveChannel::Mic,
            1 => LiveChannel::System,
            _ => return,
        };
        let pcm = &frame[1..];
        let (stream, allowed) = {
            let mut state = locked(&self.state);
            if !state.started || state.ending.is_some() {
                return;
            }
            let Some(stream) = state.lanes.iter().find(|lane| lane.channel == channel).map(|lane| lane.stream.clone()) else {
                return;
            };
            let room = (self.spec.max_ms * BYTES_PER_MS).saturating_sub(state.used_bytes);
            let allowed = pcm.len().min((room - room % 2) as usize);
            state.used_bytes += allowed as u64;
            (stream, allowed)
        };
        // Audio that comes before the stream connects is counted and dropped, as it was.
        if allowed > 0 && stream.send_audio(&pcm[..allowed]).is_err() {
            return;
        }
        if allowed < pcm.len() {
            self.emit(json!({ "type": "limit", "message": "This session reached its voice limit. What was heard so far is kept." }));
            tokio::spawn(self.finish());
        }
    }

    /// Graceful end: let Soniox finalize, then flush every lane.
    pub(crate) fn finish(&self) -> Shared<BoxFuture<'static, ()>> {
        let mut state = locked(&self.state);
        if let Some(ending) = &state.ending {
            return ending.clone();
        }
        let lanes: Vec<Lane> = state.lanes.iter().map(Lane::share).collect();
        let session = self.myself.clone();
        let ending: BoxFuture<'static, ()> = Box::pin(async move {
            join_all(lanes.iter().map(|lane| async move {
                // A failed finish still flushes what was confirmed.
                let _ = lane.stream.finish().await;
                locked(&lane.captions).flush();
            }))
            .await;
            if let Some(session) = session.upgrade() {
                session.emit(json!({ "type": "finished", "usedMs": session.used_ms() }));
            }
        });
        let ending = ending.shared();
        state.ending = Some(ending.clone());
        ending
    }

    /// The desktop disconnected: stop streams without waiting.
    pub(crate) fn close(&self) {
        for stream in self.streams() {
            stream.close();
        }
    }

    fn streams(&self) -> Vec<Arc<dyn SttStream>> {
        locked(&self.state).lanes.iter().map(|lane| lane.stream.clone()).collect()
    }

    fn fail(&self, message: &str) {
        {
            let mut state = locked(&self.state);
            if state.ending.is_some() {
                return;
            }
            let done: BoxFuture<'static, ()> = Box::pin(async {});
            state.ending = Some(done.shared());
        }
        self.emit(json!({ "type": "error", "message": message }));
        self.close();
    }
}
