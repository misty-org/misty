use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewCreateRequest {
    #[serde(default)]
    pub origin_space_id: Option<String>,
    pub id: String,
    pub url: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub scope_id: String,
    #[serde(default)]
    pub native_live_resize: bool,
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
    #[serde(default)]
    pub corner_radii: Option<[f64; 4]>,
    #[cfg(windows)]
    #[serde(default)]
    pub corner_color: Option<String>,
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
    #[serde(default)]
    pub policy_call: Option<String>,
    #[serde(skip)]
    pub policy: PagePolicy,
}

#[derive(Debug, Clone, Default)]
pub struct PagePolicy {
    pub(crate) call: Option<crate::agents::run_control::tool_gate::ActiveCall>,
    pub site_blocks: Option<crate::browser::agent_pages::page_agent::SiteBlocks>,
    pub confirm_kinds: Option<Vec<String>>,
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
