//! The interface every provider's client implements.
use std::{collections::VecDeque, pin::Pin};

use futures_util::{future::BoxFuture, stream, Stream, StreamExt};
use serde_json::json;

use super::{
    generate::{collect_turn, stream_failure, CollectedTurn},
    call::CallOptions,
    error::{scrub, scrub_value, ModelError},
    sse::SseDecoder,
    stream::StreamPart,
};

pub type ModelStream = Pin<Box<dyn Stream<Item = StreamPart> + Send>>;

pub trait LanguageModel: Send + Sync {
    /// Starts a call. Dropping the stream cancels it.
    fn stream(&self, options: CallOptions) -> BoxFuture<'_, Result<ModelStream, ModelError>>;

    /// A whole answer, for callers that don't follow along. Reading the stream to its end does it
    /// for most providers, and one whose whole answers come another way can say so.
    fn generate(&self, options: CallOptions) -> BoxFuture<'_, Result<CollectedTurn, ModelError>> {
        Box::pin(async move {
            let turn = collect_turn(self.stream(options).await?).await;
            match turn.errors.first() {
                Some(error) => Err(stream_failure(error)),
                None => Ok(turn),
            }
        })
    }
}

/// Turns one provider's event stream into [`StreamPart`]s.
pub(crate) trait StreamDecoder: Send + 'static {
    fn start(&mut self, out: &mut Vec<StreamPart>);
    fn event(&mut self, data: &str, out: &mut Vec<StreamPart>);
    /// The stream ended, however it ended. Closes what's open and reports the finish.
    fn finish(&mut self, out: &mut Vec<StreamPart>);
}

/// A response body as it arrives.
pub(crate) type BodyStream = Pin<Box<dyn Stream<Item = Result<Vec<u8>, String>> + Send>>;

struct Decoding<D> {
    body: BodyStream,
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
        self.deliver(out);
    }

    fn finish(&mut self) {
        let mut out = Vec::new();
        self.decoder.finish(&mut out);
        self.deliver(out);
    }

    /// A provider's failure can echo the key it was sent, so errors are cleaned on the way out.
    fn deliver(&mut self, parts: Vec<StreamPart>) {
        for mut part in parts {
            if let StreamPart::Error { error } = &mut part {
                scrub_value(error, &self.secret);
            }
            self.ready.push_back(part);
        }
    }
}

/// A response's body, in the form [`decoded_body`] takes.
pub(crate) fn body_of(response: reqwest::Response) -> BodyStream {
    Box::pin(
        response
            .bytes_stream()
            .map(|chunk| chunk.map(|bytes| bytes.to_vec()).map_err(|error| error.to_string())),
    )
}

/// Decodes a response's event stream as it arrives.
pub(crate) fn decoded_stream<D: StreamDecoder>(
    response: reqwest::Response,
    decoder: D,
    secret: &str,
) -> ModelStream {
    decoded_body(body_of(response), decoder, secret)
}

/// Decodes a body a client has already started reading.
pub(crate) fn decoded_body<D: StreamDecoder>(body: BodyStream, mut decoder: D, secret: &str) -> ModelStream {
    let mut started = Vec::new();
    decoder.start(&mut started);
    let state = Decoding {
        body,
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
                    state.finish();
                }
                None => {
                    state.ended = true;
                    // An event with no blank line after it was never finished, so it doesn't count.
                    state.finish();
                }
            }
        }
    }))
}
