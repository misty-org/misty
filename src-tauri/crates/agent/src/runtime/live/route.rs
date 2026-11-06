//! A live session in-process. `live/route.ts` was a WebSocket at `/v1/live/transcribe`; here the app
//! connects the two channels to the renderer. The ticket's claims became [`LiveSessionSpec`].
use std::sync::Arc;

use futures_util::{future::BoxFuture, stream::FuturesUnordered, StreamExt};
use serde_json::Value;
use tokio::sync::mpsc::{Receiver, UnboundedSender};

use super::super::js_json::JsValue;
use super::segment::LiveChannel;
use super::session::{LiveSession, LiveSessionSpec, SttFactory};

/// What the app's tickets carried for a live session.
const MODEL: &str = "soniox/stt-rt-v5";
/// The longest one session may stream, across its channels.
pub const LIVE_MAX_MS: u64 = 4 * 60 * 60 * 1000;

impl LiveSessionSpec {
    /// One session as the app's `mint` described it. The message is the one the person sees.
    pub fn for_device(channels: &[String], language: &str) -> Result<Self, String> {
        let channels = channels
            .iter()
            .map(|channel| match channel.as_str() {
                "mic" => Some(LiveChannel::Mic),
                "system" => Some(LiveChannel::System),
                _ => None,
            })
            .collect::<Option<Vec<_>>>()
            .filter(|channels| !channels.is_empty())
            .ok_or("Choose the microphone, this computer's sound, or both.")?;
        let sid: String = rand::random::<[u8; 16]>().iter().map(|byte| format!("{byte:02x}")).collect();
        let language = (!language.is_empty() && language != "auto" && language.len() <= 16).then(|| language.to_owned());
        Ok(Self { sid, channels, max_ms: LIVE_MAX_MS, language, model: MODEL.to_owned() })
    }
}

/// Runs one live session until the desktop says `finish` or closes `incoming`. Each frame in is what
/// the socket carried: a channel byte then PCM16, or JSON starting with `{`. Each message out is
/// JSON. Dropping this future stops the streams without waiting for them.
pub async fn run_live_session(spec: LiveSessionSpec, factory: Arc<dyn SttFactory>, mut incoming: Receiver<Vec<u8>>, outgoing: UnboundedSender<Value>) {
    let session = LiveSession::new(spec, outgoing, factory);
    let stop = StopOnDrop(session.clone());
    let mut handling: FuturesUnordered<BoxFuture<'_, bool>> = FuturesUnordered::new();
    loop {
        // Frames run as they did on the socket: each up to its first wait before the next is read.
        tokio::select! {
            biased;
            Some(finished) = handling.next(), if !handling.is_empty() => {
                if finished {
                    break;
                }
            }
            frame = incoming.recv() => {
                let Some(frame) = frame else { break };
                // Audio frames start with a channel byte (0 or 1); control messages are JSON.
                if frame.first() != Some(&0x7b) {
                    session.audio(&frame);
                    continue;
                }
                let Some(control) = std::str::from_utf8(&frame).ok().and_then(JsValue::parse) else {
                    continue;
                };
                match control.get("type").and_then(JsValue::as_str) {
                    Some("start") => {
                        let session = session.clone();
                        handling.push(Box::pin(async move {
                            session.start(&control).await;
                            false
                        }));
                    }
                    Some("finish") => {
                        let ending = session.finish();
                        handling.push(Box::pin(async move {
                            ending.await;
                            true
                        }));
                    }
                    _ => {}
                }
            }
        }
    }
    drop(stop);
}

struct StopOnDrop(Arc<LiveSession>);

impl Drop for StopOnDrop {
    fn drop(&mut self) {
        self.0.close();
    }
}
