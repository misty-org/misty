use std::{path::PathBuf, sync::Arc};

use thiserror::Error;

use super::{
    local_run::LocalRunHost, local_tools::LocalToolHost, logger::Logger,
    web_fetch::reader::PageReader,
};

#[doc(hidden)]
pub type ToolHook = Arc<dyn Fn(&str) + Send + Sync>;

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

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ResumedRuns {
    pub resumed: Vec<String>,
    pub failed: Vec<String>,
}

pub fn runtime_client_builder() -> reqwest::ClientBuilder {
    super::network::ipv4_first_client()
}

pub struct AgentRuntimeOptions {
    pub data_dir: PathBuf,
    pub client: reqwest::Client,
    pub logger: Logger,
    pub page_reader: Arc<dyn PageReader>,
    pub local_tools: Option<Arc<dyn LocalToolHost>>,
    pub run_host: Arc<dyn LocalRunHost>,
    #[doc(hidden)]
    pub before_tool: Option<ToolHook>,
}
