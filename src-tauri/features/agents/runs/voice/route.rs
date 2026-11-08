//! The companion's spoken conversation as an in-process session. `voice/route.ts` was a WebSocket at
//! `/v1/device/voice`; here the app connects the two channels to the renderer. Only the app can open
//! a session, so there is no ticket: the rest of what the route enforced stays.
use std::{sync::Arc, time::Duration};

use futures_util::{future::BoxFuture, stream::FuturesUnordered, StreamExt};
use serde_json::{json, Value};
use tokio::sync::mpsc::{Receiver, UnboundedSender};

use super::super::{js_json::JsValue, text::js_len};
use super::session::{VoiceModels, VoiceSession};

pub(super) const SESSION: Duration = Duration::from_secs(5 * 60);
const MAX_MESSAGE: usize = 200_000;

fn new_session_id() -> String {
    rand::random::<[u8; 8]>().iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Runs one voice session until the app closes `incoming`, or until it expires. Each message in is
/// the JSON text the socket carried; each one out is its JSON. Dropping this future ends the session
/// and cancels whatever it was waiting on.
///
/// `outgoing` is unbounded because a send must not wait: a turn's checks and its audio have to go
/// out without anything coming between them, as they did on the socket.
pub async fn run_voice_session(models: Arc<dyn VoiceModels>, incoming: Receiver<String>, outgoing: UnboundedSender<Value>) {
    run(&new_session_id(), models.as_ref(), incoming, outgoing, SESSION).await;
}

pub(crate) async fn run(sid: &str, models: &dyn VoiceModels, mut incoming: Receiver<String>, outgoing: UnboundedSender<Value>, limit: Duration) {
    let session = VoiceSession::new(sid, outgoing.clone(), models);
    let session = &session;
    let expiry = tokio::time::sleep(limit);
    tokio::pin!(expiry);
    let mut handling: FuturesUnordered<BoxFuture<'_, ()>> = FuturesUnordered::new();
    loop {
        // Messages arrive as they did on the socket: each one runs up to its first wait before the
        // next is read, and those that wait keep going while later ones, like a cancel, are handled.
        tokio::select! {
            biased;
            Some(()) = handling.next(), if !handling.is_empty() => {}
            () = &mut expiry => {
                let _ = outgoing.send(json!({ "type": "session.expired" }));
                break;
            }
            message = incoming.recv() => {
                let Some(message) = message else { break };
                if js_len(&message) > MAX_MESSAGE {
                    continue;
                }
                let Some(event) = JsValue::parse(&message) else {
                    continue;
                };
                handling.push(Box::pin(async move { session.handle(&event).await }));
            }
        }
    }
    session.close();
}
