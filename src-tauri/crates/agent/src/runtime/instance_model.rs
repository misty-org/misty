//! A provider stream that stops sending would otherwise hold the step for the run's whole time budget.
//! Waiting longer than [`STREAM_STALL_MS`] for the response or for its next part fails the step with
//! `model_stream_stalled`, so the step tries again. Ported from `watchStream` in `instance-model.ts`.
use std::{pin::Pin, sync::Arc, time::Duration};

use futures_util::{future::BoxFuture, stream, StreamExt};
use serde_json::json;

use crate::sdk::{CallOptions, LanguageModel, ModelError, ModelStream, StreamPart};

pub(crate) const STREAM_STALL_MS: u64 = 120_000;
pub(crate) const STALLED: &str = "model_stream_stalled";

/// A part that stands for the stream throwing. The SDK's streams carry their failures as parts, and
/// the Workflow adapter ignores those; these are ones that end the step instead.
pub(crate) fn thrown_part(name: &str, message: &str) -> StreamPart {
    StreamPart::Error { error: json!({ "name": name, "message": message, "thrown": true }) }
}

/// The stream, failing when it goes quiet for `stall_ms`. Dropping it cancels the request.
pub(crate) fn watch_parts(parts: ModelStream, stall_ms: u64) -> ModelStream {
    struct Watching {
        parts: Pin<Box<dyn futures_util::Stream<Item = StreamPart> + Send>>,
        done: bool,
    }
    Box::pin(stream::unfold(Watching { parts, done: false }, move |mut state| async move {
        if state.done {
            return None;
        }
        match tokio::time::timeout(Duration::from_millis(stall_ms), state.parts.next()).await {
            Ok(Some(part)) => Some((part, state)),
            Ok(None) => None,
            Err(_) => {
                state.done = true;
                Some((thrown_part("Error", STALLED), state))
            }
        }
    }))
}

/// The run's model, watched for stalls on every try.
pub(crate) struct WatchedModel {
    pub(crate) inner: Arc<dyn LanguageModel>,
    pub(crate) stall_ms: u64,
}

impl LanguageModel for WatchedModel {
    fn stream(&self, options: CallOptions) -> BoxFuture<'_, Result<ModelStream, ModelError>> {
        Box::pin(async move {
            let stall = Duration::from_millis(self.stall_ms);
            match tokio::time::timeout(stall, self.inner.stream(options)).await {
                Ok(started) => Ok(watch_parts(started?, self.stall_ms)),
                Err(_) => Err(ModelError::Unsupported(STALLED.to_owned())),
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use futures_util::future::pending;

    use super::*;

    fn text(delta: &str) -> StreamPart {
        StreamPart::TextDelta { id: "a".to_owned(), delta: delta.to_owned(), provider_metadata: None }
    }

    #[tokio::test(start_paused = true)]
    async fn passes_a_healthy_stream_through() {
        let parts: ModelStream = Box::pin(stream::iter(vec![text("a"), text("b")]));
        let seen: Vec<StreamPart> = watch_parts(parts, 50).collect().await;
        assert_eq!(seen, [text("a"), text("b")]);
    }

    #[tokio::test(start_paused = true)]
    async fn fails_a_stream_that_stops_sending() {
        let parts: ModelStream = Box::pin(stream::iter(vec![text("a")]).chain(stream::pending()));
        let seen: Vec<StreamPart> = watch_parts(parts, 30).collect().await;
        assert_eq!(seen[0], text("a"));
        assert_eq!(seen[1], thrown_part("Error", STALLED));
        assert_eq!(seen.len(), 2);
    }

    struct NeverStarts;

    impl LanguageModel for NeverStarts {
        fn stream(&self, _: CallOptions) -> BoxFuture<'_, Result<ModelStream, ModelError>> {
            Box::pin(pending())
        }
    }

    #[tokio::test(start_paused = true)]
    async fn fails_a_response_that_never_starts() {
        let model = WatchedModel { inner: Arc::new(NeverStarts), stall_ms: 30 };
        let error = model.stream(CallOptions::default()).await.err().unwrap();
        assert_eq!(error.to_string(), STALLED);
    }
}
