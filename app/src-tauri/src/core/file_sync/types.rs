use serde::{Deserialize, Serialize};

pub type FileSyncEntryId = String;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileSyncPolicy {
    RemoteFirst,
    LocalFirst,
    #[default]
    BiDirectional,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileSyncAction {
    #[default]
    Noop,
    UploadLocal,
    DownloadRemote,
    DeleteLocal,
    DeleteRemote,
    RenameLocal,
    RenameRemote,
    Conflict,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileSyncConflict {
    #[default]
    None,
    LocalTmp,
    RemoteTmp,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub enum FileSyncEntryState {
    #[default]
    LOC,
    REM,
    SYNC,
    CONFLICT,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FsEventEffect {
    Created,
    #[default]
    Modified,
    Deleted,
    Renamed,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub enum FileSyncChange {
    LocalFile,
    LocalFolder,
    LocalDelete,
    LocalRename,
    RemoteFile,
    RemoteFolder,
    RemoteDelete,
    RemoteRename,
    #[default]
    Noop,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct FsEvent {
    pub new_path: String,
    pub old_path: String,
    pub effect: FsEventEffect,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileSyncData {
    pub is_dir: bool,
    pub size: i64,
    pub mtime: String,
    pub content_hash: String,
    pub created: String,
    pub provider_file_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileSyncPendingEvent {
    pub key: String,
    pub old_path: String,
    pub new_path: String,
    pub events: Vec<FsEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileSyncResult {
    pub action: FileSyncAction,
    pub conflict: FileSyncConflict,
    pub update_entry: bool,
}

impl Default for FileSyncResult {
    fn default() -> Self {
        Self {
            action: FileSyncAction::Noop,
            conflict: FileSyncConflict::None,
            update_entry: true,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileSyncFinalEvent {
    pub pending_event: FileSyncPendingEvent,
    pub change: FileSyncChange,
    pub data: FileSyncData,
    pub result: FileSyncResult,
    pub remote_name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileSyncLocalEntry {
    pub entry_id: FileSyncEntryId,
    pub local_path: String,
    pub exists: bool,
    pub is_dir: bool,
    pub size: i64,
    pub mtime: String,
    pub checksum: String,
    pub observed_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileSyncRemoteEntry {
    pub entry_id: FileSyncEntryId,
    pub remote_name: String,
    pub remote_path: String,
    pub provider_file_id: String,
    pub exists: bool,
    pub is_dir: bool,
    pub size: i64,
    pub created: String,
    pub last_modified: String,
    pub checksum: String,
    pub observed_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileSyncEntry {
    pub entry_id: FileSyncEntryId,
    pub state: FileSyncEntryState,
    pub last_local_path: String,
    pub last_local_mtime: String,
    pub last_local_checksum: String,
    pub last_remote_path: String,
    pub last_remote_mtime: String,
    pub last_remote_checksum: String,
    pub local_tmp_path: String,
    pub remote_tmp_path: String,
}

#[derive(Debug)]
pub struct FileSyncContext<'a> {
    pub event: &'a FileSyncFinalEvent,
    pub local_entry: Option<FileSyncLocalEntry>,
    pub remote_entry: Option<FileSyncRemoteEntry>,
    pub sync_entry: Option<FileSyncEntry>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileSyncEndpointKind {
    #[default]
    Local,
    Remote,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileSyncEndpoint {
    pub kind: FileSyncEndpointKind,
    pub local_path: String,
    pub remote_name: String,
    pub remote_path: String,
    pub provider_type: String,
}

impl FileSyncEndpoint {
    pub fn empty(&self) -> bool {
        match self.kind {
            FileSyncEndpointKind::Local => self.local_path.is_empty(),
            FileSyncEndpointKind::Remote => self.remote_name.is_empty(),
        }
    }

    pub fn display_path(&self) -> String {
        match self.kind {
            FileSyncEndpointKind::Local => self.local_path.clone(),
            FileSyncEndpointKind::Remote => format!(
                "{}:{}",
                self.remote_name,
                if self.remote_path.is_empty() {
                    "/"
                } else {
                    &self.remote_path
                }
            ),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileSyncPair {
    pub id: i64,
    pub name: String,
    pub left: FileSyncEndpoint,
    pub right: FileSyncEndpoint,
    pub watch_mode: bool,
    pub stale: bool,
    pub preferred_policy: FileSyncPolicy,
    pub last_compared_at_ms: i64,
    pub last_scan_at_ms: i64,
}

impl Default for FileSyncPair {
    fn default() -> Self {
        Self {
            id: 0,
            name: String::new(),
            left: FileSyncEndpoint::default(),
            right: FileSyncEndpoint::default(),
            watch_mode: false,
            stale: false,
            preferred_policy: FileSyncPolicy::BiDirectional,
            last_compared_at_ms: 0,
            last_scan_at_ms: 0,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileSyncCompareSide {
    pub present: bool,
    pub is_remote: bool,
    pub is_dir: bool,
    pub size: i64,
    pub last_modified: String,
    pub absolute_path: String,
    pub remote_name: String,
    pub remote_path: String,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileSyncCompareKind {
    #[default]
    File,
    Folder,
    Mismatch,
}

impl FileSyncCompareKind {
    pub const fn label(self) -> &'static str {
        match self {
            Self::File => "File",
            Self::Folder => "Folder",
            Self::Mismatch => "Mismatch",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileSyncCompareDisposition {
    LeftOnly,
    RightOnly,
    Different,
    #[default]
    Same,
    Conflict,
}

impl FileSyncCompareDisposition {
    pub const fn label(self) -> &'static str {
        match self {
            Self::LeftOnly => "Left only",
            Self::RightOnly => "Right only",
            Self::Different => "Different",
            Self::Same => "Same",
            Self::Conflict => "Conflict",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileSyncPlannedAction {
    #[default]
    Skip,
    CopyLeftToRight,
    CopyRightToLeft,
    DeleteLeft,
    DeleteRight,
}

impl FileSyncPlannedAction {
    pub const fn label(self) -> &'static str {
        match self {
            Self::Skip => "Skip",
            Self::CopyLeftToRight => "Copy Left -> Right",
            Self::CopyRightToLeft => "Copy Right -> Left",
            Self::DeleteLeft => "Delete Left",
            Self::DeleteRight => "Delete Right",
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileSyncCompareRow {
    pub relative_path: String,
    pub kind: FileSyncCompareKind,
    pub disposition: FileSyncCompareDisposition,
    pub left: FileSyncCompareSide,
    pub right: FileSyncCompareSide,
    pub action: FileSyncPlannedAction,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileSyncCompareResult {
    pub success: bool,
    pub error_message: String,
    pub rows: Vec<FileSyncCompareRow>,
    pub compared_at_ms: i64,
}
