//! Tree-protocol projection for the renderer. The renderer keeps its existing
//! workspace contract: the host synthesizes one `WorkspaceView` from the tree
//! this device drives plus the shared tree, and derives `active_device` from
//! the driver seat, so projection and edit capture work unchanged.
use std::collections::{BTreeMap, BTreeSet};

use misty_browser_sync::{
    document::{entities::Kind, ActiveDevice, Resume, ResumeRecord, ViewRecord, WorkspaceView},
    tree::sync::TreeView,
};

/// Monotonic synthetic sequence: bumps whenever the projected content,
/// resume or seat changes, including when switching to a lower-versioned tree.
#[derive(Default)]
pub(super) struct TreeProjection {
    sequence: u64,
    last: Option<serde_json::Value>,
    /// The last driven tree's content, kept on screen (under the choose
    /// screen) after this device loses its seat instead of blanking windows.
    held: Vec<ViewRecord>,
}

pub(super) fn tree_mode(view: &TreeView) -> bool {
    !view.trees.is_empty() || !view.workspaces.is_empty()
}

pub(super) fn driver_epoch(view: &TreeView) -> Option<&str> {
    let tree = view.driving_tree.as_deref()?;
    view.trees.iter().find(|t| t.tree_id == tree)?.driver_epoch.as_deref()
}

fn orphans(records: &[ViewRecord]) -> (Vec<String>, Vec<String>) {
    let ids = |kind: Kind| -> BTreeSet<&str> { records.iter().filter(|r| r.kind == kind).map(|r| r.id.as_str()).collect() };
    let (layouts, groups) = (ids(Kind::Layout), ids(Kind::Group));
    let tabs = records
        .iter()
        .filter(|r| r.kind == Kind::Tab)
        .filter(|r| {
            let layout = r.fields.get("placement").and_then(|p| p.get("layout_id")).and_then(|v| v.as_str());
            !layout.is_some_and(|l| layouts.contains(l))
        })
        .map(|r| r.id.clone())
        .collect();
    let websites = records
        .iter()
        .filter(|r| r.kind == Kind::Website)
        .filter(|r| !r.fields.get("group_id").and_then(|v| v.as_str()).is_some_and(|g| groups.contains(g)))
        .map(|r| r.id.clone())
        .collect();
    (tabs, websites)
}

pub(super) fn synthesize(projection: &mut TreeProjection, device_id: &str, view: &TreeView) -> WorkspaceView {
    let driven = view.driving_tree.as_deref().and_then(|t| view.workspaces.get(t));
    // Offline start: the cached own tree, read-only until the seat is known.
    let cached = view.trees.is_empty().then(|| view.workspaces.get(device_id)).flatten();
    let own_records = match driven.or(cached) {
        Some(tree) => {
            projection.held = tree.records.clone();
            tree.records.clone()
        }
        None => projection.held.clone(),
    };
    let mut records = own_records;
    if let Some(shared) = view.workspaces.get(&view.shared_tree_id) {
        records.extend(shared.records.iter().cloned());
    }
    // Keyed by the tree's last author: the renderer ignores its own resume
    // and follows another author's once, right after switching to their tree.
    let resume: Option<(String, Resume)> = driven.and_then(|t| Some((t.author.clone().unwrap_or_else(|| device_id.to_owned()), t.resume.clone()?)));
    let epoch = driver_epoch(view).map(str::to_owned);
    let content = serde_json::json!([&records, resume.as_ref().map(|(a, r)| (a, serde_json::to_value(r).ok())), &epoch]);
    if projection.last.as_ref() != Some(&content) {
        projection.sequence += 1;
        projection.last = Some(content);
    }
    let sequence = projection.sequence;
    let (orphaned_tab_ids, orphaned_website_ids) = orphans(&records);
    WorkspaceView {
        version: 1,
        sequence,
        records,
        orphaned_tab_ids,
        orphaned_website_ids,
        resumes: resume.into_iter().map(|(author, resume)| (author, ResumeRecord { sequence, resume })).collect::<BTreeMap<_, _>>(),
        active_device: epoch.map(|epoch| ActiveDevice { device_id: Some(device_id.to_owned()), epoch, sequence }),
    }
}
