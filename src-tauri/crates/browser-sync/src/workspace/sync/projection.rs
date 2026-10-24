//! Renderer-safe projections of workspace sync state.
use super::*;

/// Renderer-safe projection of one workspace. Records never include credentials.
#[derive(Clone, Serialize, PartialEq)]
pub struct WorkspaceContent {
    pub version: u64,
    pub records: Vec<ViewRecord>,
    pub resume: Option<Resume>,
    /// Device that wrote the current version, if any.
    pub author: Option<String>,
}

#[derive(Clone, Default, Serialize, PartialEq)]
pub struct SyncState {
    pub device_id: String,
    pub shared_workspace_id: String,
    /// The workspace whose sign-in lease this device holds; `None` while another
    /// machine holds it. Not a lock: editing follows `on_workspace`.
    pub driving_workspace: Option<String>,
    pub workspaces: Vec<Workspace>,
    /// Verified content of the workspace this machine is on and the shared workspace.
    pub contents: BTreeMap<String, WorkspaceContent>,
    /// Workspaces with local edits not yet accepted by the server.
    pub pending: BTreeSet<String>,
    /// Set when this device lost its seat while holding unpublished edits;
    /// they stay in local storage and the choose screen says so.
    pub displaced_with_edits: bool,
    /// The server confirmed `driving_workspace` on the current connection. A
    /// cached seat is not proof: another device may have taken it meanwhile.
    pub seat_confirmed: bool,
    /// The workspace kept current while this session drives none (the one it drove
    /// last), so taking it back starts from the server's latest copy.
    pub following: Option<String>,
    /// Edits from this machine can be queued for `on_workspace`.
    pub writable: bool,
    /// The workspace this machine shows and edits (see `WorkspaceSync::on_workspace`).
    pub on_workspace: Option<String>,
    /// Collections as shown (pending writes on top), by name. Set by the
    /// worker; bookmarks here replace the shared workspace's folders/bookmarks.
    pub collections: BTreeMap<String, Vec<ViewRecord>>,
    /// Every active device understands tab groups and collections.
    /// Set by the worker; tab groups sync only then.
    pub all_upgraded: bool,
    /// Every active device understands nested bookmark folders. Set by the
    /// worker; bookmark tree fields sync only then.
    pub nested_bookmarks: bool,
    /// Every active device understands pinned tabs. Set by the worker; the
    /// pinned fields of tab records sync only then.
    pub pinned_tabs: bool,
    /// Records with changes the server has not confirmed yet (queued or in
    /// flight), one entry per record, so the renderer can name them per tab.
    pub unsynced: Vec<UnsyncedRecord>,
    /// Edits an older version set aside unsent: kept for recovery, never replayed.
    pub retired_edits: usize,
    /// Per natively applied collection (`collections::NATIVE_APPLIED`), a
    /// count that moves when another device's change arrives, so native code
    /// knows to re-read it. Never sent to a renderer.
    #[serde(skip)]
    pub revisions: BTreeMap<String, u64>,
}

/// One record waiting to sync. Crosses to the renderer as `{kind, id}`, so it
/// gets renderer kind names like every other record.
#[derive(Clone, Serialize, PartialEq)]
pub struct UnsyncedRecord {
    pub workspace_id: String,
    pub kind: crate::document::entities::Kind,
    pub id: String,
    /// The newest waiting change removes the record (a closed tab).
    pub deleted: bool,
    /// The newest title a waiting change gave it, for records already gone here.
    pub title: Option<String>,
}
