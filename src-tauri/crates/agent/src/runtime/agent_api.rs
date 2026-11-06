//! What the app passes to `AgentRuntime` and what it gets back. The routes in `index.ts` answered with
//! these codes, and the server reads them.
use std::{fmt, path::PathBuf, sync::Arc};

use thiserror::Error;

use super::logger::Logger;

/// Lets a test make a tool misbehave.
#[doc(hidden)]
pub type ToolHook = Arc<dyn Fn(&str) + Send + Sync>;

/// A method's refusal or failure, by the code its route answered with.
#[derive(Clone, Copy, Debug, Error, PartialEq, Eq)]
pub enum RuntimeApiError {
    #[error("invalid_run_id")]
    InvalidRunId,
    #[error("harness_version_unavailable")]
    HarnessVersionUnavailable,
    #[error("invalid_run_key")]
    InvalidRunKey,
    #[error("The original workflow start is not yet confirmed. Misty will not submit a duplicate.")]
    WorkflowStartUnconfirmed,
    #[error("Misty could not confirm the workflow start.")]
    WorkflowStartFailed,
    #[error("invalid_runtime_run_id")]
    InvalidRuntimeRunId,
    #[error("workflow_status_unavailable")]
    WorkflowStatusUnavailable,
    #[error("Misty could not cancel this work. Please try again shortly.")]
    WorkflowCancelFailed,
    #[error("invalid_device_resume")]
    InvalidDeviceResume,
    #[error("This device request can no longer be resumed.")]
    DeviceResumeFailed,
    #[error("invalid_models")]
    InvalidModels,
}

impl RuntimeApiError {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidRunId => "invalid_run_id",
            Self::HarnessVersionUnavailable => "harness_version_unavailable",
            Self::InvalidRunKey => "invalid_run_key",
            Self::WorkflowStartUnconfirmed => "workflow_start_unconfirmed",
            Self::WorkflowStartFailed => "workflow_start_failed",
            Self::InvalidRuntimeRunId => "invalid_runtime_run_id",
            Self::WorkflowStatusUnavailable => "workflow_status_unavailable",
            Self::WorkflowCancelFailed => "workflow_cancel_failed",
            Self::InvalidDeviceResume => "invalid_device_resume",
            Self::DeviceResumeFailed => "device_resume_failed",
            Self::InvalidModels => "invalid_models",
        }
    }
}

/// What a run starts from. `run_key` never prints.
#[derive(Clone, Default)]
pub struct StartRequest {
    pub run_id: String,
    pub callback_url: Option<String>,
    /// `None` means this runtime's own version.
    pub adapter_version: Option<String>,
    pub run_key: String,
    pub receipt_callback: String,
}

impl fmt::Debug for StartRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("StartRequest").field("run_id", &self.run_id).field("callback_url", &self.callback_url).field("adapter_version", &self.adapter_version).field("receipt_callback", &self.receipt_callback).finish_non_exhaustive()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StartedRun {
    pub runtime_run_id: String,
    pub adapter_version: &'static str,
}

/// What `resume_unfinished` did, by run ID.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ResumedRuns {
    pub resumed: Vec<String>,
    /// Files that couldn't be read. Each run was failed and reported, or could not be reported.
    pub failed: Vec<String>,
}

/// What the app builds `AgentRuntimeOptions::client` from, with its TLS settings added: connections try
/// IPv4 first (`network.rs`).
pub fn runtime_client_builder() -> reqwest::ClientBuilder {
    super::network::ipv4_first_client()
}

pub struct AgentRuntimeOptions {
    /// A folder inside `.misty`. Runs live in `<data_dir>/runs/`.
    pub data_dir: PathBuf,
    /// For the control plane, tool service and model providers.
    pub client: reqwest::Client,
    pub logger: Logger,
    /// What a start with no callback URL goes to. There's no built-in server address.
    pub internal_api_base: Option<String>,
    /// Lets a test make a tool misbehave. Nothing else sets it.
    #[doc(hidden)]
    pub before_tool: Option<ToolHook>,
}
