//! What tool logic needs from the run's control plane, which implements these two traits. Calls and
//! checkpoints are plain JSON values here, so key order survives to whatever stores them.
use futures_util::future::BoxFuture;

use super::{js_json::JsValue, runtime_errors::RuntimeError};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CheckpointState {
    Running,
    Completed,
    Failed,
}

impl CheckpointState {
    pub(crate) fn from_report(state: super::compaction_model::CheckpointState) -> Self {
        match state {
            super::compaction_model::CheckpointState::Running => Self::Running,
            super::compaction_model::CheckpointState::Completed => Self::Completed,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
        }
    }
}

/// One step of a run's progress, as `harness.ts` names it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct HarnessCheckpoint {
    pub(crate) node_id: String,
    pub(crate) state: CheckpointState,
    pub(crate) phase: String,
    pub(crate) progress: u32,
    pub(crate) input: Option<JsValue>,
    pub(crate) output: Option<JsValue>,
    pub(crate) error_message: Option<String>,
}

impl HarnessCheckpoint {
    /// The checkpoint as the server reads it.
    pub(crate) fn to_json(&self) -> JsValue {
        let mut fields = vec![
            ("node_id".to_owned(), string(&self.node_id)),
            ("state".to_owned(), string(self.state.as_str())),
            ("phase".to_owned(), string(&self.phase)),
            ("progress".to_owned(), JsValue::Number(f64::from(self.progress))),
        ];
        if let Some(input) = &self.input {
            fields.push(("input".to_owned(), input.clone()));
        }
        if let Some(output) = &self.output {
            fields.push(("output".to_owned(), output.clone()));
        }
        if let Some(message) = &self.error_message {
            fields.push(("error_message".to_owned(), string(message)));
        }
        JsValue::Object(fields)
    }
}

/// Saves a run's progress.
pub(crate) trait ToolCheckpoints: Send + Sync {
    fn checkpoint(&self, event: HarnessCheckpoint) -> BoxFuture<'_, Result<(), RuntimeError>>;
}

/// Runs a catalog tool through Misty's gateway. `None` is a call that returned nothing.
pub(crate) trait ToolTransport: ToolCheckpoints {
    fn run<'a>(
        &'a self,
        call_id: &'a str,
        name: &'a str,
        input: &'a JsValue,
    ) -> BoxFuture<'a, Result<Option<JsValue>, RuntimeError>>;
}

pub(crate) fn string(text: impl Into<String>) -> JsValue {
    JsValue::String(text.into())
}

/// An object literal, in the order written.
pub(crate) fn object<const N: usize>(fields: [(&str, JsValue); N]) -> JsValue {
    JsValue::Object(fields.into_iter().map(|(name, value)| (name.to_owned(), value)).collect())
}
