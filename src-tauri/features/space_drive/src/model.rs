//! What the drive is made of: the server's items (`DriveItem` in the build contract), the local
//! state of each, in-use marks and the notices the person sees.
use serde::{Deserialize, Serialize};

/// A Space's id, as the server writes it.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SpaceId(pub String);

/// An item's stable id: `drv_<uuid v4>`. Items made on this computer get theirs here, at once,
/// so an item's identity never changes after it reaches the server.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ItemId(pub String);

/// An item's version on the server. Every change bumps it; a save names the version its copy came
/// from (`base_version`), and a merged save sends it as `If-Match`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Version(pub i64);

/// A place in a Space's one change sequence.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, Default)]
#[serde(transparent)]
pub struct Seq(pub i64);

impl SpaceId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl ItemId {
    /// A new id for an item made on this computer.
    pub fn new() -> Self {
        Self(format!("drv_{}", uuid::Uuid::new_v4()))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// `drv_` and a hyphenated uuid, the only ids Misty sends or accepts.
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

/// An item as the server sends it (`DriveItem`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Item {
    pub id: ItemId,
    pub space_id: SpaceId,
    /// `None` is the drive's root.
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
    pub trashed: bool,
    #[serde(default)]
    pub trashed_at: Option<String>,
    #[serde(default)]
    pub trashed_by: Option<String>,
    #[serde(default)]
    pub trash_hold: bool,
    /// A tombstone: the item was purged and only its place in the sequence is left.
    #[serde(default)]
    pub deleted: bool,
    /// A trashed copy the server kept of content a save replaced unseen: the item whose content
    /// it was (`Report (replaced 2026-11-20 1405).pdf`).
    #[serde(default)]
    pub replaced_of: Option<ItemId>,
}

impl Item {
    /// Neither trashed nor purged. Whether a trashed folder hides it is the tree's question.
    pub fn is_live(&self) -> bool {
        !self.trashed && !self.deleted
    }
}

/// What this computer last agreed on with the server for one item (kuragine's copy record):
/// the version and content it saw, and the name and place it had then.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Base {
    pub id: ItemId,
    pub version: Version,
    pub sha256: Option<String>,
    pub size: u64,
    pub mtime_ms: i64,
    pub parent: Option<ItemId>,
    pub name: String,
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
        }
    }
}

/// How a file stands on this computer, as `DriveEntry.state` names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LocalState {
    /// Only its name is here.
    Online,
    Downloaded,
    Downloading,
    Uploading,
    /// Left out by an ignore rule or a secret's name: it stays on this computer alone.
    NotSynced,
}

/// Someone who has an item open, as the server's `423 in_use` lists them.
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

/// One in-use mark as `DriveEntry.in_use` shows it: someone else's, one of the person's other
/// computers' (`you`), or this computer's own open.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InUse {
    /// Whose it is, for their avatar's tone.
    #[serde(default)]
    pub user_id: String,
    pub name: String,
    pub device_name: String,
    pub editing: bool,
    /// It is the signed-in person's own.
    #[serde(default)]
    pub you: bool,
}

/// The kinds of `misty://drive-notice`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoticeKind {
    /// Someone deleted a file this computer had open or used lately. Its action is Restore.
    DeletedWhileOpen,
    /// A delete was refused because someone has the file open (or, for a rename onto a taken
    /// name, has the file that held the name open).
    DeleteRefusedInUse,
    /// Someone's save replaced the person's, which waits in the trash: `item_id` is that
    /// replaced copy, and its action is Restore.
    SaveReplaced,
    /// Someone's edit brought back an item the person trashed.
    Revived,
}

/// A notice for the person, sent as `misty://drive-notice {kind, space_id, name, by}`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Notice {
    pub kind: NoticeKind,
    pub space_id: SpaceId,
    /// The file's name as the person knows it.
    pub name: String,
    /// Who did it, or who has it open.
    #[serde(default)]
    pub by: Option<String>,
    /// The item the notice is about: the one to restore (for `save_replaced`, the trashed copy of
    /// the person's replaced save).
    #[serde(default)]
    pub item_id: Option<ItemId>,
    /// Its drive path on this computer, for showing it.
    #[serde(default)]
    pub path: Option<String>,
    /// The computer of whoever has it open, for `delete_refused_in_use`.
    #[serde(default)]
    pub device_name: Option<String>,
}

/// Where a Space's sync stands, for `misty://drive-status`.
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

/// One item as the renderer and the SDK host see it (`DriveEntry`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DriveEntry {
    pub id: ItemId,
    pub space_id: SpaceId,
    /// `/`-rooted path in the drive, with this computer's names.
    pub path: String,
    pub name: String,
    pub kind: Kind,
    pub size: u64,
    pub mtime_ms: i64,
    pub modified_by_name: String,
    pub state: LocalState,
    pub keep_downloaded: bool,
    pub in_use: Vec<InUse>,
    /// The server version this computer last agreed on (its base record); absent for an item
    /// not on the server yet. `drive_write`'s `replace` passes it back.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<Version>,
}

/// A page of `drive_list`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EntryPage {
    pub entries: Vec<DriveEntry>,
    /// Pass back as `cursor` for the next page.
    pub next_cursor: Option<String>,
}

/// One item of the Space's trash, as `drive_trash_list` returns it.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TrashEntry {
    #[serde(flatten)]
    pub entry: DriveEntry,
    pub trashed_at: Option<String>,
    pub trashed_by_name: Option<String>,
}

/// One entry of `misty://drive-changed`: an item that changed, or one that left the drive
/// (trashed, purged, or moved out of what this computer shows), marked `removed`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChangedEntry {
    #[serde(flatten)]
    pub entry: DriveEntry,
    pub removed: bool,
}

/// A page of the Space's trash.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TrashPage {
    pub items: Vec<Item>,
    pub next_after: Option<String>,
}

/// Who asked for a delete. An agent's trash is held: it never empties itself, and which agent and
/// chat did it stays on this computer (`files_agent_trash` in `misty.db`), never on the server.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TrashBy {
    Person,
    Agent { agent_id: String, chat_id: String },
}

impl TrashBy {
    pub fn held(&self) -> bool {
        matches!(self, Self::Agent { .. })
    }
}

/// An item an agent trashed, handed to `Events::agent_trashed` for the glue to record in
/// `files_agent_trash`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentTrash {
    pub space_id: SpaceId,
    pub item_id: ItemId,
    /// Its drive path when it was trashed, with this computer's names.
    pub path: String,
    pub agent_id: String,
    pub chat_id: String,
    pub at_ms: i64,
}

/// What `copy_in` did.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CopyReport {
    pub files: u64,
    pub folders: u64,
    pub bytes: u64,
    /// Files left out by `.gitignore`, `.mistyignore`, junk names or secrets' names.
    pub skipped: u64,
}

/// Milliseconds since 1970, from this computer's clock. Used for names, leases' bookkeeping and
/// "used lately", never to decide which change wins.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}
