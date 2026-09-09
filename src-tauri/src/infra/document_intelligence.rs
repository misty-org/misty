// macOS parsers live in signed app packages. Other platforms retain their existing path until a confined service launcher is available.
#[cfg(not(target_os = "macos"))]
#[path = "document_intelligence_platform.rs"]
mod bundled;
#[cfg(not(target_os = "macos"))]
pub use bundled::*;
#[cfg(target_os = "macos")]
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
pub(crate) use crate::platform::mini_app::permissions::document_processing::ServiceLease;
#[cfg(target_os = "macos")]
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

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedDocumentSection {
    pub kind: String,
    pub locator: String,
    pub text: String,
}
