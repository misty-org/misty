//! The interface every provider's client implements.
use std::{collections::VecDeque, pin::Pin};

use futures_util::{future::BoxFuture, stream, Stream, StreamExt};
use serde_json::json;

use super::{
    call::CallOptions,
    error::{scrub, ModelError},
    sse::SseDecoder,
    stream::StreamPart,
};

pub type ModelStream = Pin<Box<dyn Stream<Item = StreamPart> + Send>>;

pub trait LanguageModel: Send + Sync {
    /// Starts a call. Dropping the stream cancels it.
    fn stream(&self, options: CallOptions) -> BoxFuture<'_, Result<ModelStream, ModelError>>;
}

/// Turns one provider's event stream into [`StreamPart`]s.
pub(crate) trait StreamDecoder: Send + 'static {
    fn start(&mut self, out: &mut Vec<StreamPart>);
    fn event(&mut self, data: &str, out: &mut Vec<StreamPart>);
    /// The stream ended, however it ended. Closes what's open and reports the finish.
    fn finish(&mut self, out: &mut Vec<StreamPart>);
}

struct Decoding<D> {
    body: Pin<Box<dyn Stream<Item = Result<Vec<u8>, String>> + Send>>,
    events: SseDecoder,
    decoder: D,
    secret: String,
    ready: VecDeque<StreamPart>,
    ended: bool,
}

impl<D: StreamDecoder> Decoding<D> {
    fn handle(&mut self, events: Vec<String>) {
        let mut out = Vec::new();
        for event in events {
            // Providers end with `[DONE]`, which is a marker rather than an event.
            if event != "[DONE]" {
                self.decoder.event(&event, &mut out);
            }
        }
        self.ready.extend(out);
    }
}

/// Decodes a response's event stream as it arrives.
pub(crate) fn decoded_stream<D: StreamDecoder>(
    response: reqwest::Response,
    mut decoder: D,
    secret: &str,
) -> ModelStream {
    let mut started = Vec::new();
    decoder.start(&mut started);
    let body = response
        .bytes_stream()
        .map(|chunk| chunk.map(|bytes| bytes.to_vec()).map_err(|error| error.to_string()));
    let state = Decoding {
        body: Box::pin(body),
        events: SseDecoder::default(),
        decoder,
        secret: secret.to_owned(),
        ready: started.into(),
        ended: false,
    };
    Box::pin(stream::unfold(state, |mut state| async move {
        loop {
            if let Some(part) = state.ready.pop_front() {
                return Some((part, state));
            }
            if state.ended {
                return None;
            }
            match state.body.next().await {
                Some(Ok(bytes)) => {
                    let events = state.events.push(&bytes);
                    state.handle(events);
                }
                Some(Err(message)) => {
                    // The connection dropped mid-answer: say so, and report what arrived.
                    state.ended = true;
                    state.ready.push_back(StreamPart::Error {
                        error: json!({
                            "name": "AI_APICallError",
                            "message": scrub(&message, &state.secret),
                            "isRetryable": true,
                        }),
                    });
                    let mut out = Vec::new();
                    state.decoder.finish(&mut out);
                    state.ready.extend(out);
                }
                None => {
                    state.ended = true;
                    let events = state.events.finish();
                    state.handle(events);
                    let mut out = Vec::new();
                    state.decoder.finish(&mut out);
                    state.ready.extend(out);
                }
            }
        }
    }))
}
