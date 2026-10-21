//! Documents prepared for agents. Untrusted files are parsed only by the
//! bundled document worker, confined by the operating system: `sandbox-exec`
//! on macOS and an AppContainer on Windows.
use serde::{Deserialize, Serialize};

pub const MAX_AGENT_DOCUMENT_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedAgentDocument {
    pub document_id: String,
    pub display_name: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub sections: Vec<PreparedDocumentSection>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedDocumentSection {
    pub kind: String,
    pub locator: String,
    pub text: String,
}

/// Parses the document at `path` in the confined worker.
#[cfg(windows)]
pub async fn prepare_document(
    path: std::path::PathBuf,
) -> crate::error::ApiResult<PreparedAgentDocument> {
    use crate::error::ApiError;
    tokio::task::spawn_blocking(move || {
        let stop = std::sync::atomic::AtomicBool::new(false);
        let (value, _) = super::document_worker_windows::process(&path, "document", None, &stop)
            .map_err(ApiError::Message)?;
        serde_json::from_value(value["document"].clone())
            .map_err(|_| ApiError::Message("The document worker returned no document.".into()))
    })
    .await
    .map_err(|_| ApiError::Message("Document preparation stopped.".into()))?
}

/// Parses the document at `path` in the confined worker.
#[cfg(target_os = "macos")]
pub async fn prepare_document(
    path: std::path::PathBuf,
) -> crate::error::ApiResult<PreparedAgentDocument> {
    use crate::error::ApiError;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    };

    /// Cancels the worker when the request is dropped before it finishes.
    struct CancelOnDrop(Arc<AtomicBool>);
    impl Drop for CancelOnDrop {
        fn drop(&mut self) {
            self.0.store(true, Ordering::Release);
        }
    }

    static SLOTS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    let slot = SLOTS
        .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
        .clone()
        .try_acquire_owned()
        .map_err(|_| {
            ApiError::Message("Finish an earlier document before opening another.".into())
        })?;
    let stop = Arc::new(AtomicBool::new(false));
    let _cancel = CancelOnDrop(stop.clone());
    tokio::task::spawn_blocking(move || {
        let _slot = slot;
        let value =
            super::document_worker_macos::process(&path, &stop).map_err(ApiError::Message)?;
        serde_json::from_value(value["document"].clone())
            .map_err(|_| ApiError::Message("The document worker returned no document.".into()))
    })
    .await
    .map_err(|_| ApiError::Message("Document preparation stopped.".into()))?
}
