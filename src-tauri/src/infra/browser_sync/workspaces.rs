//! Workspace-protocol projection for the renderer. The renderer keeps its existing
//! workspace contract: the host synthesizes one `WorkspaceView` from the workspace
//! this machine is on plus the shared workspace. Any number of machines may be on
//! (and edit) one workspace; `active_device` only says edits can be captured.
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use misty_browser_sync::{
    document::{entities::Kind, ActiveDevice, ViewRecord, WorkspaceView},
    protocol::Presence,
    workspace::sync::SyncState,
};

/// Monotonic synthetic sequence: bumps whenever the projected content or the
/// workspace this machine is on changes, including a switch to a lower version.
#[derive(Default)]
pub(super) struct WorkspaceProjection {
    sequence: u64,
    last: Option<serde_json::Value>,
    /// The last shown workspace's content, kept on screen while a newly opened
    /// workspace's copy is still being fetched instead of blanking windows.
    held: Vec<ViewRecord>,
}

pub(super) fn workspace_mode(view: &SyncState) -> bool {
    !view.workspaces.is_empty() || !view.contents.is_empty()
}

/// Tags renderer edits with the workspace they were made in, once this machine
/// has a copy to edit. Edits never apply to a different workspace than the one
/// they were captured on; another machine's lease never blocks them.
pub(super) fn writer_epoch(view: &SyncState) -> Option<&str> {
    view.on_workspace.as_deref().filter(|_| view.writable)
}

/// The workspace whose sign-in lease this machine should take now, if any. A
/// device's own machine holds it whenever online; otherwise a machine on the
/// workspace takes it when nobody holds it or the holder is offline. Two active
/// machines therefore never trade it back and forth.
pub(super) fn lease_to_claim(
    view: &SyncState,
    presence: &[Presence],
    device_id: &str,
) -> Option<String> {
    if !view.seat_confirmed {
        return None;
    }
    let workspace = view.on_workspace.as_deref()?;
    if view.driving_workspace.as_deref() == Some(workspace) {
        return None;
    }
    let holder = view
        .workspaces
        .iter()
        .find(|t| t.workspace_id == workspace && !t.shared)?
        .driver_device_id
        .as_deref();
    let online = |device: &str| presence.iter().any(|p| p.device_id == device && p.online);
    match holder {
        Some(holder) if workspace != device_id && online(holder) => None,
        _ => Some(workspace.to_owned()),
    }
}

/// At most one lease claim per workspace every few seconds, while one is in flight.
pub(super) fn claim_due(workspace: &str) -> bool {
    static LAST: Mutex<Option<(String, Instant)>> = Mutex::new(None);
    let Ok(mut last) = LAST.lock() else {
        return false;
    };
    if last
        .as_ref()
        .is_some_and(|(t, at)| t == workspace && at.elapsed() < Duration::from_secs(10))
    {
        return false;
    }
    *last = Some((workspace.to_owned(), Instant::now()));
    true
}

fn orphans(records: &[ViewRecord]) -> (Vec<String>, Vec<String>) {
    let ids = |kind: Kind| -> BTreeSet<&str> {
        records
            .iter()
            .filter(|r| r.kind == kind)
            .map(|r| r.id.as_str())
            .collect()
    };
    let (layouts, groups) = (ids(Kind::Tab), ids(Kind::Folder));
    let tabs = records
        .iter()
        .filter(|r| r.kind == Kind::View)
        .filter(|r| {
            let layout = r
                .fields
                .get("placement")
                .and_then(|p| p.get("layout_id"))
                .and_then(|v| v.as_str());
            !layout.is_some_and(|l| layouts.contains(l))
        })
        .map(|r| r.id.clone())
        .collect();
    let websites = records
        .iter()
        .filter(|r| r.kind == Kind::Bookmark)
        .filter(|r| {
            !r.fields
                .get("group_id")
                .and_then(|v| v.as_str())
                .is_some_and(|g| groups.contains(g))
        })
        .map(|r| r.id.clone())
        .collect();
    (tabs, websites)
}

pub(super) fn synthesize(
    projection: &mut WorkspaceProjection,
    device_id: &str,
    view: &SyncState,
) -> WorkspaceView {
    let shown = view
        .on_workspace
        .as_deref()
        .and_then(|t| view.contents.get(t));
    // Offline start: the cached own workspace until the roster is known.
    let cached = view
        .workspaces
        .is_empty()
        .then(|| view.contents.get(device_id))
        .flatten();
    let own_records = match shown.or(cached) {
        Some(workspace) => {
            projection.held = workspace.records.clone();
            workspace.records.clone()
        }
        None => projection.held.clone(),
    };
    let mut records = own_records;
    // Bookmarks come from the cold collection once this machine has it (it
    // already folds in any the shared workspace alone still holds).
    match view
        .collections
        .get(misty_browser_sync::collections::BOOKMARKS)
    {
        Some(bookmarks) => records.extend(bookmarks.iter().cloned()),
        None => {
            if let Some(shared) = view.contents.get(&view.shared_workspace_id) {
                records.extend(shared.records.iter().cloned());
            }
        }
    }
    // Closed tab groups, kept account-wide to reopen on any device.
    if let Some(saved) = view
        .collections
        .get(misty_browser_sync::collections::TAB_GROUPS)
    {
        records.extend(saved.iter().cloned());
    }
    // Focus is local to each machine and never projected from another.
    let epoch = writer_epoch(view).map(str::to_owned);
    let content = serde_json::json!([&records, &epoch]);
    if projection.last.as_ref() != Some(&content) {
        projection.sequence += 1;
        projection.last = Some(content);
    }
    let sequence = projection.sequence;
    let (orphaned_view_ids, orphaned_bookmark_ids) = orphans(&records);
    WorkspaceView {
        version: 1,
        sequence,
        records,
        orphaned_view_ids,
        orphaned_bookmark_ids,
        resumes: BTreeMap::new(),
        active_device: epoch.map(|epoch| ActiveDevice {
            device_id: Some(device_id.to_owned()),
            epoch,
            sequence,
        }),
    }
}
