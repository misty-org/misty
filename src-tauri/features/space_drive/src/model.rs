use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SpaceId(pub String);

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ItemId(pub String);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Version(pub i64);

#[derive(
    Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, Default,
)]
#[serde(transparent)]
pub struct Seq(pub i64);

impl SpaceId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl ItemId {
    pub fn new() -> Self {
        Self(format!("drv_{}", uuid::Uuid::new_v4()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn is_valid(text: &str) -> bool {
        text.strip_prefix("drv_")
            .is_some_and(|rest| uuid::Uuid::parse_str(rest).is_ok() && rest.len() == 36)
    }
}

impl Default for ItemId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for SpaceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::fmt::Display for ItemId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    File,
    Folder,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Folder => "folder",
        }
    }

    pub fn parse(text: &str) -> Self {
        if text == "folder" {
            Self::Folder
        } else {
            Self::File
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Item {
    pub id: ItemId,
    pub space_id: SpaceId,
    #[serde(default)]
    pub parent_id: Option<ItemId>,
    pub name: String,
    pub kind: Kind,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub mtime_ms: i64,
    pub version: Version,
    pub seq: Seq,
    #[serde(default)]
    pub modified_by: String,
    #[serde(default)]
    pub modified_by_name: String,
    #[serde(default)]
    pub modified_at: String,
    #[serde(default)]
    pub trashed_at: Option<String>,
    #[serde(default)]
    pub trashed_by: Option<String>,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub replaced_of: Option<ItemId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_version: Option<Version>,
}

impl Item {
    pub fn is_live(&self) -> bool {
        !self.deleted
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Base {
    pub id: ItemId,
    pub version: Version,
    pub sha256: Option<String>,
    pub size: u64,
    pub mtime_ms: i64,
    pub parent: Option<ItemId>,
    pub name: String,
    pub content_version: Option<Version>,
}

impl Base {
    pub fn of(item: &Item) -> Self {
        Self {
            id: item.id.clone(),
            version: item.version,
            sha256: item.sha256.clone(),
            size: item.size,
            mtime_ms: item.mtime_ms,
            parent: item.parent_id.clone(),
            name: item.name.clone(),
            content_version: item.content_version,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalState {
    Online,
    Downloaded,
    Downloading,
    Uploading,
    NotSynced,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InUseBy {
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub device_name: String,
    #[serde(default)]
    pub editing: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InUse {
    #[serde(default)]
    pub user_id: String,
    pub name: String,
    pub device_name: String,
    pub editing: bool,
    #[serde(default)]
    pub you: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoticeKind {
    DeletedWhileOpen,
    DeleteRefusedInUse,
    SaveReplaced,
    Revived,
    DeletesHeld,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Notice {
    pub kind: NoticeKind,
    pub space_id: SpaceId,
    pub name: String,
    #[serde(default)]
    pub by: Option<String>,
    #[serde(default)]
    pub item_id: Option<ItemId>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub device_name: Option<String>,
    #[serde(default)]
    pub count: Option<u64>,
    #[serde(default)]
    pub burst: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StatusKind {
    Idle,
    Syncing,
    Offline,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DriveStatus {
    pub space_id: SpaceId,
    pub status: StatusKind,
    #[serde(default)]
    pub message: Option<String>,
    pub pending_uploads: u64,
    pub pending_downloads: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DriveEntry {
    pub id: ItemId,
    pub space_id: SpaceId,
    pub path: String,
    pub name: String,
    pub kind: Kind,
    pub size: u64,
    pub mtime_ms: i64,
    pub modified_by_name: String,
    pub state: LocalState,
    pub keep_downloaded: bool,
    pub in_use: Vec<InUse>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<Version>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_version: Option<Version>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,
    #[serde(default)]
    pub waits_large: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EntryPage {
    pub entries: Vec<DriveEntry>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChangedEntry {
    #[serde(flatten)]
    pub entry: DriveEntry,
    pub removed: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CopyReport {
    pub files: u64,
    pub folders: u64,
    pub bytes: u64,
    pub skipped: u64,
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}
