//! What the single model calls outside a run's turns share: their settings, and reporting progress.
use futures_util::future::BoxFuture;
use serde::Serialize;
use serde_json::{json, Value};

use crate::sdk::{CallOptions, Message};

use super::transcript::user_message;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CheckpointState {
    Running,
    Completed,
}

/// One progress event, as `HarnessCheckpoint` holds it. `output` is `{}` when a step has none.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct Checkpoint {
    pub(crate) node_id: String,
    pub(crate) state: CheckpointState,
    pub(crate) phase: String,
    pub(crate) progress: u8,
    pub(crate) output: Value,
}

impl Checkpoint {
    pub(crate) fn new(node_id: &str, state: CheckpointState, phase: &str, progress: u8, output: Value) -> Self {
        Self { node_id: node_id.to_owned(), state, phase: phase.to_owned(), progress, output }
    }
}

/// Reports a step's progress to the control plane, as `report` in `compaction-model.ts` did with the
/// run's identity: `{ attempt: 1, ...event }` to `events`, keyed by run, node and state.
pub(crate) trait RunReporter: Send + Sync {
    fn report(&self, checkpoint: Checkpoint) -> BoxFuture<'_, Result<(), String>>;
}

/// One call with a system prompt and one user message, pinned to the run's own model.
pub(crate) fn step_call(model_id: &str, system: &str, user: String, max_output_tokens: u32, reasoning: Option<&str>) -> CallOptions {
    let mut provider_options = crate::sdk::ProviderOptions::new();
    provider_options.insert("gateway".to_owned(), json!({ "models": [model_id] }));
    CallOptions {
        prompt: vec![
            Message::System { content: system.to_owned(), provider_options: None },
            user_message(user),
        ],
        max_output_tokens: Some(max_output_tokens),
        reasoning: reasoning.map(str::to_owned),
        provider_options: Some(provider_options),
        ..CallOptions::default()
    }
}

#[cfg(test)]
pub(crate) mod fixtures {
    use std::sync::Mutex;

    use futures_util::future::{ready, FutureExt};

    use super::*;

    /// Keeps what it was told, or fails.
    #[derive(Default)]
    pub(crate) struct FakeReporter {
        pub(crate) refuse: bool,
        pub(crate) events: Mutex<Vec<Checkpoint>>,
    }

    impl RunReporter for FakeReporter {
        fn report(&self, checkpoint: Checkpoint) -> BoxFuture<'_, Result<(), String>> {
            self.events.lock().unwrap().push(checkpoint);
            ready(if self.refuse { Err("refused".to_owned()) } else { Ok(()) }).boxed()
        }
    }
}
