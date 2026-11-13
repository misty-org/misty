//! The requests and events the browser commands exchange with the renderer.
use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewCreateRequest {
    #[serde(default)]
    pub origin_space_id: Option<String>,
    #[serde(default)]
    pub store_id: Option<String>,
    #[serde(default)]
    pub workspace_tab_id: Option<String>,
    pub id: String,
    pub url: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub scope_id: String,
    #[serde(default = "default_browser_theme")]
    pub theme: String,
    #[serde(default)]
    pub native_live_resize: bool,
    /// A private tab: shared throwaway website data, nothing saved or synced.
    #[serde(default)]
    pub private: bool,
    /// The agent run this tab works for, for an agent's own tab.
    #[serde(default)]
    pub agent_run_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewBoundsRequest {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub native_live_resize: bool,
    /// Top-left, top-right, bottom-right and bottom-left radii where the page
    /// meets a rounded workspace corner.
    #[serde(default)]
    pub corner_radii: Option<[f64; 4]>,
    /// The window chrome around those corners, as `#rrggbb`, which smooths
    /// their edge on Windows.
    #[cfg(windows)]
    #[serde(default)]
    pub corner_color: Option<String>,
    /// Places a hidden page beneath the renderer instead of on top (a tab
    /// loaded in the background on Windows), so it waits there drawn.
    #[serde(default)]
    pub beneath: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewIdRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewHideRequest {
    pub id: String,
    /// Park the page out of sight instead of hiding it, so it keeps rendering: a video
    /// floating in picture in picture keeps a page to return to, and an agent's own tab
    /// keeps drawing the widgets it reads.
    #[serde(default)]
    pub keep_live: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserNavigateRequest {
    pub id: String,
    pub url: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct BrowserFocusEvent {
    pub(super) id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAgentGrantRequest {
    pub id: String,
    pub scope_id: String,
    pub grant_id: String,
    pub agent_id: String,
    pub capabilities: Vec<String>,
    pub expires_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAgentGrantRevokeRequest {
    pub id: String,
    pub grant_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAgentExecuteRequest {
    pub scope_id: String,
    pub grant_id: String,
    pub agent_id: String,
    pub operation: String,
    #[serde(default)]
    pub input: Value,
    /// The tool call this work belongs to, which is how native code finds the run. A request with none
    /// knows no run, and reads as Ask.
    #[serde(default)]
    pub policy_call: Option<String>,
    /// Read natively as the request arrives, never taken from the window.
    #[serde(skip)]
    pub policy: PagePolicy,
}

/// What page work goes by for one request: the run's mode, the sites agents may not act on and what
/// was remembered, all from `misty.db` and the run's saved request.
#[derive(Debug, Clone, Default)]
pub struct PagePolicy {
    pub(crate) call: Option<crate::agents::run_control::tool_gate::ActiveCall>,
    /// Absent means the safe default: sensitive categories blocked.
    pub site_blocks: Option<crate::browser::agent_pages::page_agent::SiteBlocks>,
    /// Absent or empty means the safe default: all of them.
    pub confirm_kinds: Option<Vec<String>>,
    /// Absent means nothing is remembered.
    pub grant_set: Option<crate::browser::agent_pages::action_confirm::GrantSet>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct BrowserPageEvent {
    pub(super) id: String,
    pub(super) url: String,
    pub(super) phase: &'static str,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct BrowserTitleEvent {
    pub(super) id: String,
    pub(super) title: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct BrowserFaviconEvent {
    pub(super) id: String,
    pub(super) url: String,
}

#[derive(Debug, Deserialize)]
pub(super) struct BrowserCompatibilityProbe {
    pub(super) kind: String,
    pub(super) url: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(super) struct BrowserCompatibilityEvent {
    pub(super) id: String,
    pub(super) kind: String,
    pub(super) url: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDownload {
    pub(super) download_id: String,
    pub(super) tab_id: String,
    pub(super) url: String,
    pub(super) path: String,
    pub(super) state: String,
    pub(super) success: bool,
    pub(super) initiator: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) grant_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) file: Option<crate::browser::agent_pages::task_files::DownloadFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RawSnapshot {
    #[serde(default)]
    pub(super) semantic: Value,
    pub(super) title: String,
    pub(super) text: String,
    pub(super) truncated: bool,
    #[serde(default)]
    pub(super) interactive: Vec<RawInteractiveElement>,
    #[serde(default)]
    pub(super) error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RawInteractiveElement {
    pub(super) target: String,
    pub(super) tag: String,
    pub(super) role: String,
    pub(super) name: String,
}
