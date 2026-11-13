//! What the app passes to `AgentRuntime` and what it gets back.
use std::{path::PathBuf, sync::Arc};

use thiserror::Error;

use super::{local_run::LocalRunHost, local_tools::LocalToolHost, logger::Logger, web_fetch::reader::PageReader};

/// Lets a test make a tool misbehave.
#[doc(hidden)]
pub type ToolHook = Arc<dyn Fn(&str) + Send + Sync>;

/// A method's refusal or failure, by its code.
#[derive(Clone, Copy, Debug, Error, PartialEq, Eq)]
pub enum RuntimeApiError {
    #[error("invalid_run_id")]
    InvalidRunId,
    #[error("Misty could not confirm the workflow start.")]
    WorkflowStartFailed,
    #[error("workflow_status_unavailable")]
    WorkflowStatusUnavailable,
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
            Self::WorkflowStartFailed => "workflow_start_failed",
            Self::WorkflowStatusUnavailable => "workflow_status_unavailable",
            Self::InvalidDeviceResume => "invalid_device_resume",
            Self::DeviceResumeFailed => "device_resume_failed",
            Self::InvalidModels => "invalid_models",
        }
    }
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
    /// For model providers and the pages and searches a run reads.
    pub client: reqwest::Client,
    pub logger: Logger,
    /// Who reads pages `web.fetch` gets. There's no default, so the app can't end up reading untrusted
    /// pages in its own process by leaving this out.
    pub page_reader: Arc<dyn PageReader>,
    /// Runs the tools that stay on this computer. With none, every tool in the catalog is unavailable.
    pub local_tools: Option<Arc<dyn LocalToolHost>>,
    /// Takes the events of the runs started here.
    pub run_host: Arc<dyn LocalRunHost>,
    /// Lets a test make a tool misbehave. Nothing else sets it.
    #[doc(hidden)]
    pub before_tool: Option<ToolHook>,
}
