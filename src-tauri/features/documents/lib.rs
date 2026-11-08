//! Documents prepared for agents. Untrusted files are parsed only by the
//! bundled document worker, confined by the operating system: `sandbox-exec`
//! on macOS and an AppContainer on Windows.

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(windows)]
pub mod windows;

use serde::{Deserialize, Serialize};

/// Where the app keeps the bundled worker program: its name and protocol in, its bytes out.
pub type WorkerBytes = fn(&str, u32) -> Result<&'static [u8], String>;

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
    worker: WorkerBytes,
) -> Result<PreparedAgentDocument, String> {
    tokio::task::spawn_blocking(move || {
        let stop = std::sync::atomic::AtomicBool::new(false);
        let value = windows::process(&path, &stop, worker)?;
        serde_json::from_value(value["document"].clone())
            .map_err(|_| "The document worker returned no document.".to_owned())
    })
    .await
    .map_err(|_| "Document preparation stopped.".to_owned())?
}

/// Parses the document at `path` in the confined worker.
#[cfg(target_os = "macos")]
pub async fn prepare_document(
    path: std::path::PathBuf,
    worker: WorkerBytes,
) -> Result<PreparedAgentDocument, String> {
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
        .map_err(|_| "Finish an earlier document before opening another.".to_owned())?;
    let stop = Arc::new(AtomicBool::new(false));
    let _cancel = CancelOnDrop(stop.clone());
    tokio::task::spawn_blocking(move || {
        let _slot = slot;
        let value = macos::process(&path, &stop, worker)?;
        serde_json::from_value(value["document"].clone())
            .map_err(|_| "The document worker returned no document.".to_owned())
    })
    .await
    .map_err(|_| "Document preparation stopped.".to_owned())?
}
