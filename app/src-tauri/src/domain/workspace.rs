use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{ApiError, ApiResult};

pub const WORKSPACE_SCHEMA_VERSION: i32 = 1;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkspaceTabSnapshot {
    #[serde(default)]
    pub context_key: String,
    #[serde(default)]
    pub state_key: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub restore_state: String,
    #[serde(default = "negative_one_i16")]
    pub idx: i16,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkspacePaneSnapshot {
    #[serde(default)]
    pub pane_id: String,
    #[serde(default)]
    pub tabs: Vec<WorkspaceTabSnapshot>,
    #[serde(default)]
    pub closed_tabs: Vec<WorkspaceTabSnapshot>,
    #[serde(default = "negative_one_i16")]
    pub active_tab_idx: i16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceClosedPaneSnapshot {
    #[serde(default)]
    pub pane_id: String,
    #[serde(default)]
    pub tabs: Vec<WorkspaceTabSnapshot>,
    #[serde(default)]
    pub closed_tabs: Vec<WorkspaceTabSnapshot>,
    #[serde(default = "negative_one_i16")]
    pub active_tab_idx: i16,
    #[serde(default = "default_restore_mode")]
    pub restore_mode: String,
    #[serde(default = "negative_one_i32")]
    pub lane_index: i32,
    #[serde(default = "negative_one_i32")]
    pub row_index: i32,
}

impl Default for WorkspaceClosedPaneSnapshot {
    fn default() -> Self {
        Self {
            pane_id: String::new(),
            tabs: Vec::new(),
            closed_tabs: Vec::new(),
            active_tab_idx: -1,
            restore_mode: default_restore_mode(),
            lane_index: -1,
            row_index: -1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceExplorerSnapshot {
    #[serde(default)]
    pub active_pane_id: String,
    #[serde(default = "one_i16")]
    pub next_tab_idx: i16,
    #[serde(default = "one_i16")]
    pub next_pane_idx: i16,
    #[serde(default)]
    pub grid_pane_ids: Vec<Vec<String>>,
    #[serde(default = "half")]
    pub grid_split_ratio: f32,
    #[serde(default = "default_lane_ratios")]
    pub lane_split_ratios: Vec<f32>,
    #[serde(default)]
    pub panes: Vec<WorkspacePaneSnapshot>,
    #[serde(default)]
    pub closed_panes: Vec<WorkspaceClosedPaneSnapshot>,
}

impl Default for WorkspaceExplorerSnapshot {
    fn default() -> Self {
        Self {
            active_pane_id: String::new(),
            next_tab_idx: 1,
            next_pane_idx: 1,
            grid_pane_ids: Vec::new(),
            grid_split_ratio: 0.5,
            lane_split_ratios: default_lane_ratios(),
            panes: Vec::new(),
            closed_panes: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkspaceFileTabSnapshot {
    #[serde(default = "negative_one_i16")]
    pub idx: i16,
    #[serde(default)]
    pub title: String,
    #[serde(default = "default_true")]
    pub sidebar_visible: bool,
    #[serde(default = "default_true")]
    pub inspector_visible: bool,
    #[serde(default)]
    pub explorer: WorkspaceExplorerSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: f32,
    #[serde(default = "default_true")]
    pub sidebar_visible: bool,
    #[serde(default = "default_inspector_width")]
    pub inspector_width: f32,
    #[serde(default = "default_true")]
    pub inspector_visible: bool,
    #[serde(default = "negative_one_i16")]
    pub active_tab_idx: i16,
    #[serde(default)]
    pub next_tab_idx: i16,
    #[serde(default)]
    pub tabs: Vec<WorkspaceFileTabSnapshot>,
    #[serde(default)]
    pub explorer: WorkspaceExplorerSnapshot,
}

impl Default for Workspace {
    fn default() -> Self {
        Self {
            id: String::new(),
            title: String::new(),
            sidebar_width: default_sidebar_width(),
            sidebar_visible: true,
            inspector_width: default_inspector_width(),
            inspector_visible: true,
            active_tab_idx: -1,
            next_tab_idx: 0,
            tabs: Vec::new(),
            explorer: WorkspaceExplorerSnapshot::default(),
        }
    }
}

impl Workspace {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            ..Self::default()
        }
    }

    pub fn load_from_document(&mut self, document: &WorkspaceDocument) {
        if let Some(saved) = document
            .workspaces
            .iter()
            .find(|workspace| workspace.id == self.id)
        {
            *self = saved.clone();
        }
    }

    pub fn save_into_document(&self, document: &mut WorkspaceDocument) {
        if self.id.is_empty() {
            return;
        }
        match document
            .workspaces
            .iter_mut()
            .find(|workspace| workspace.id == self.id)
        {
            Some(saved) => *saved = self.clone(),
            None => document.workspaces.push(self.clone()),
        }
        if document.active_workspace_id.is_empty() {
            document.active_workspace_id = self.id.clone();
        }
        if let Some(index) = self
            .id
            .strip_prefix("workspace_")
            .and_then(|value| value.parse::<i16>().ok())
        {
            document.next_workspace_idx = document.next_workspace_idx.max(index.saturating_add(1));
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceDocument {
    #[serde(default = "schema_version")]
    pub schema_version: i32,
    #[serde(default)]
    pub active_workspace_id: String,
    #[serde(default)]
    pub next_workspace_idx: i16,
    #[serde(default)]
    pub workspaces: Vec<Workspace>,
}

impl Default for WorkspaceDocument {
    fn default() -> Self {
        Self {
            schema_version: WORKSPACE_SCHEMA_VERSION,
            active_workspace_id: String::new(),
            next_workspace_idx: 0,
            workspaces: Vec::new(),
        }
    }
}

pub async fn load_workspace_document(path: &Path) -> ApiResult<WorkspaceDocument> {
    let body = match tokio::fs::read(path).await {
        Ok(body) => body,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(WorkspaceDocument::default())
        }
        Err(error) => return Err(io_error("read workspaces", path, error)),
    };
    serde_json::from_slice(&body)
        .map_err(|error| ApiError::Message(format!("Failed to parse {}: {error}", path.display())))
}

pub async fn save_workspace_document(path: &Path, document: &WorkspaceDocument) -> ApiResult<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| io_error("create workspace directory", parent, error))?;
    }
    let body = serde_json::to_vec_pretty(document)?;
    let temporary = temporary_path(path);
    tokio::fs::write(&temporary, body)
        .await
        .map_err(|error| io_error("write workspaces", &temporary, error))?;
    if let Err(error) = tokio::fs::rename(&temporary, path).await {
        let _ = tokio::fs::remove_file(path).await;
        tokio::fs::rename(&temporary, path)
            .await
            .map_err(|_| io_error("replace workspaces", path, error))?;
    }
    Ok(())
}

fn temporary_path(path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.tmp", path.display()))
}

fn io_error(operation: &str, path: &Path, error: std::io::Error) -> ApiError {
    ApiError::Message(format!("Failed to {operation} {}: {error}", path.display()))
}

const fn schema_version() -> i32 {
    WORKSPACE_SCHEMA_VERSION
}
const fn negative_one_i16() -> i16 {
    -1
}
const fn negative_one_i32() -> i32 {
    -1
}
const fn one_i16() -> i16 {
    1
}
const fn half() -> f32 {
    0.5
}
const fn default_true() -> bool {
    true
}
const fn default_sidebar_width() -> f32 {
    260.0
}
const fn default_inspector_width() -> f32 {
    300.0
}
fn default_restore_mode() -> String {
    "same_lane".to_string()
}
fn default_lane_ratios() -> Vec<f32> {
    vec![0.5, 0.5]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_native_workspace_schema() {
        let raw = serde_json::json!({
            "schema_version": 1,
            "active_workspace_id": "workspace_2",
            "next_workspace_idx": 3,
            "workspaces": [{
                "id": "workspace_2",
                "title": "Workspace 3",
                "explorer": {
                    "active_pane_id": "pane-1",
                    "grid_pane_ids": [["pane-1", "pane-2"]],
                    "panes": []
                }
            }]
        });
        let document: WorkspaceDocument = serde_json::from_value(raw).unwrap();
        assert_eq!(document.active_workspace_id, "workspace_2");
        assert_eq!(document.workspaces[0].explorer.grid_pane_ids[0].len(), 2);
        assert!(document.workspaces[0].sidebar_visible);
    }

    #[test]
    fn updates_workspace_indices_on_save() {
        let mut document = WorkspaceDocument::default();
        Workspace::new("workspace_7").save_into_document(&mut document);
        assert_eq!(document.next_workspace_idx, 8);
        assert_eq!(document.active_workspace_id, "workspace_7");
    }
}
