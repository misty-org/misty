use futures_util::future::BoxFuture;

use crate::model_calls::{CallOptions, CollectedTurn, ModelError};

pub(crate) type Generated = CollectedTurn;

pub(crate) trait ModelAccess: Send + Sync {
    fn generate(
        &self,
        model_id: &str,
        options: CallOptions,
    ) -> BoxFuture<'_, Result<Generated, ModelError>>;
}

#[cfg(test)]
pub(crate) mod fixtures {
    use std::sync::Mutex;

    use futures_util::future::{ready, FutureExt};

    use super::*;

    #[derive(Default)]
    pub(crate) struct FakeModel {
        pub(crate) answer: Option<String>,
        pub(crate) calls: Mutex<Vec<(String, CallOptions)>>,
    }

    impl FakeModel {
        pub(crate) fn answering(text: &str) -> Self {
            Self {
                answer: Some(text.to_owned()),
                calls: Mutex::default(),
            }
        }

        pub(crate) fn failing() -> Self {
            Self::default()
        }
    }

    impl ModelAccess for FakeModel {
        fn generate(
            &self,
            model_id: &str,
            options: CallOptions,
        ) -> BoxFuture<'_, Result<Generated, ModelError>> {
            self.calls
                .lock()
                .unwrap()
                .push((model_id.to_owned(), options));
            let result = match &self.answer {
                Some(text) => Ok(Generated {
                    text: text.clone(),
                    ..Generated::default()
                }),
                None => Err(ModelError::Network("unavailable".to_owned())),
            };
            ready(result).boxed()
        }
    }
}
