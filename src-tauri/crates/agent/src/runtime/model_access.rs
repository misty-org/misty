//! How runtime code reaches a model.
use futures_util::future::BoxFuture;

use crate::sdk::{CallOptions, CollectedTurn, ModelError};

/// What one finished model call gave back: its text, tool calls, usage and finish reason among them.
pub(crate) type Generated = CollectedTurn;

/// How runtime code reaches a model, so it can be tested without one. The single calls made outside
/// a run's turns all passed `maxRetries: 1` in the TypeScript, so the real implementation calls
/// `sdk::generate_text` with `max_retries: Some(1)`.
pub(crate) trait ModelAccess: Send + Sync {
    fn generate(&self, model_id: &str, options: CallOptions) -> BoxFuture<'_, Result<Generated, ModelError>>;
}

#[cfg(test)]
pub(crate) mod fixtures {
    use std::sync::Mutex;

    use futures_util::future::{ready, FutureExt};

    use super::*;

    /// Answers with fixed text, or fails, and keeps what it was asked.
    #[derive(Default)]
    pub(crate) struct FakeModel {
        pub(crate) answer: Option<String>,
        pub(crate) calls: Mutex<Vec<(String, CallOptions)>>,
    }

    impl FakeModel {
        pub(crate) fn answering(text: &str) -> Self {
            Self { answer: Some(text.to_owned()), calls: Mutex::default() }
        }

        pub(crate) fn failing() -> Self {
            Self::default()
        }
    }

    impl ModelAccess for FakeModel {
        fn generate(&self, model_id: &str, options: CallOptions) -> BoxFuture<'_, Result<Generated, ModelError>> {
            self.calls.lock().unwrap().push((model_id.to_owned(), options));
            let result = match &self.answer {
                Some(text) => Ok(Generated { text: text.clone(), ..Generated::default() }),
                None => Err(ModelError::Network("unavailable".to_owned())),
            };
            ready(result).boxed()
        }
    }
}
