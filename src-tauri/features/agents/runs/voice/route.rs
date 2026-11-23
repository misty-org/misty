use std::{sync::Arc, time::Duration};

use futures_util::{future::BoxFuture, stream::FuturesUnordered, StreamExt};
use serde_json::{json, Value};
use tokio::sync::mpsc::{Receiver, UnboundedSender};

use super::super::{js_json::JsValue, text::js_len};
use super::session::{VoiceModels, VoiceSession};

pub(super) const SESSION: Duration = Duration::from_secs(5 * 60);
const MAX_MESSAGE: usize = 200_000;

fn new_session_id() -> String {
    rand::random::<[u8; 8]>()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub async fn run_voice_session(
    models: Arc<dyn VoiceModels>,
    incoming: Receiver<String>,
    outgoing: UnboundedSender<Value>,
) {
    run(
        &new_session_id(),
        models.as_ref(),
        incoming,
        outgoing,
        SESSION,
    )
    .await;
}

pub(crate) async fn run(
    sid: &str,
    models: &dyn VoiceModels,
    mut incoming: Receiver<String>,
    outgoing: UnboundedSender<Value>,
    limit: Duration,
) {
    let session = VoiceSession::new(sid, outgoing.clone(), models);
    let session = &session;
    let expiry = tokio::time::sleep(limit);
    tokio::pin!(expiry);
    let mut handling: FuturesUnordered<BoxFuture<'_, ()>> = FuturesUnordered::new();
    loop {
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
