use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Arc},
    time::Duration,
};

use serde_json::Value;

use crate::api::{Change, NewItem};
use crate::cache::BlobPin;
use crate::copy_source::{CopyFlow, CopyFolder, CopyKind, CopySource};
use crate::ignore::{never_synced_name, DriveRules, GIT_IGNORE_FILE, IGNORE_FILE};
use crate::in_use::{self, ANSWER_HOLD, STALE_CHECK, USED_LATELY};
use crate::model::*;
use crate::names;
use crate::planner::{self, Down, Trees, Up};
use crate::rules::{self, CreateOutcome, TrashOutcome, UpdateOutcome};
use crate::store::{ChildKey, NodeRow};
use crate::transfer::{self, EMPTY_SHA256};
use crate::{lock, ApiError, DriveError, Inner, Key, Mounted, NewNode};

const QUIET: Duration = Duration::from_millis(500);
const MARKS_QUIET: Duration = Duration::from_millis(500);
const MARKS_FRESH: Duration = Duration::from_secs(45);
const MAX_IGNORE_TEXT: u64 = 256 * 1024;
const RETRY_FIRST: Duration = Duration::from_secs(2);
const RETRY_MOST: Duration = Duration::from_secs(300);
const MAX_COPY_ITEMS: u64 = 50_000;

#[derive(Default)]
struct Touched {
    changed: HashSet<ItemId>,
    removed: HashMap<ItemId, DriveEntry>,
    server: Vec<Item>,
    problem: Option<String>,
}

pub(crate) async fn run(inner: Arc<Inner>, space: SpaceId) {
    if inner.person().is_empty() {
        if let Some(name) = inner.api.my_name().await {
            *inner
                .person
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(name);
        }
    }
    read_marks(&inner, &space).await;
    let mut retry = RETRY_FIRST;
    loop {
        let Ok(mounted) = inner.mounted(&space) else {
            return;
        };
        if mounted.stop.load(Ordering::SeqCst) {
            return;
        }
        keep_marks(&inner, &space).await;
        let failed = if inner.paused.load(Ordering::SeqCst) {
            false
        } else {
            match round(&inner, &space).await {
                Ok(()) => false,
                Err(DriveError::Offline | DriveError::Api(ApiError::Server { .. })) => true,
                Err(_) => false,
            }
        };
        if failed {
            tokio::select! {
                _ = mounted.kick.notified() => tokio::time::sleep(QUIET).await,
                _ = tokio::time::sleep(retry) => {}
            }
            retry = (retry * 2).min(RETRY_MOST);
        } else {
            retry = RETRY_FIRST;
            mounted.kick.notified().await;
            tokio::time::sleep(QUIET).await;
        }
    }
}

fn retry_error(message: &str) -> DriveError {
    if message == ApiError::SignedOut.to_string() {
        DriveError::Api(ApiError::SignedOut)
    } else {
        DriveError::Offline
    }
}

pub(crate) fn is_root_ignore(node: &NodeRow) -> bool {
    node.parent.is_none() && node.kind == Kind::File && node.name.eq_ignore_ascii_case(IGNORE_FILE)
}

fn waits_large(inner: &Inner, space: &SpaceId, id: &ItemId) -> bool {
    inner
        .store
        .node(space, id)
        .ok()
        .flatten()
        .is_some_and(|node| inner.waits_large(&node))
}

fn set_status(inner: &Inner, mounted: &Mounted, status: StatusKind, message: Option<String>) {
    let space = &mounted.mount.space;
    let waiting = inner
        .store
        .dirty_nodes(space)
        .iter()
        .filter(|node| inner.waits_large(node))
        .count() as u64;
    let pending_uploads = inner.store.dirty_count(space).saturating_sub(waiting);
    let pending_downloads = lock(&inner.downloading)
        .iter()
        .filter(|(at, _)| at == space)
        .count() as u64;
    let next = DriveStatus {
        space_id: space.clone(),
        status,
        message,
        pending_uploads,
        pending_downloads,
    };
    let mut current = lock(&mounted.status);
    if *current != next {
        *current = next.clone();
        drop(current);
        inner.events.status(&next);
    }
}

pub(crate) async fn round(inner: &Arc<Inner>, space: &SpaceId) -> Result<(), DriveError> {
    let mounted = inner.mounted(space)?;
    let _guard = mounted.round.lock().await;
    set_status(inner, &mounted, StatusKind::Syncing, None);
    let mut touched = Touched::default();
    let result = async {
        let complete = pull(inner, space, &mut touched).await?;
        up(inner, &mounted, space, &mut touched).await?;
        down(inner, space, complete, &mut touched)?;
        settle_holds(inner, &mounted, space).await;
        fetch_wanted(inner, space).await;
        evict(inner, &mut touched);
        Ok::<(), DriveError>(())
    }
    .await;
    emit(inner, &mounted, space, &touched);
    match &result {
        Ok(()) => match touched.problem.take() {
            Some(problem) => set_status(inner, &mounted, StatusKind::Failed, Some(problem)),
            None => set_status(inner, &mounted, StatusKind::Idle, None),
        },
        Err(DriveError::Offline) => set_status(
            inner,
            &mounted,
            StatusKind::Offline,
            Some(DriveError::Offline.to_string()),
        ),
        Err(error) => set_status(inner, &mounted, StatusKind::Failed, Some(error.to_string())),
    }
    result
}

fn emit(inner: &Inner, mounted: &Mounted, space: &SpaceId, touched: &Touched) {
    let mut entries = Vec::new();
    for id in &touched.changed {
        if touched.removed.contains_key(id) {
            continue;
        }
        if let Ok(Some(node)) = inner.store.node(space, id) {
            entries.push(ChangedEntry {
                entry: inner.entry(&node),
                removed: node.trash_pending,
            });
        }
    }
    for entry in touched.removed.values() {
        entries.push(ChangedEntry {
            entry: entry.clone(),
            removed: true,
        });
    }
    if !entries.is_empty() {
        inner.events.changed(space, &entries);
    }
    if !entries.is_empty() || !touched.server.is_empty() {
        mounted.face.changed(space, &touched.server);
    }
}

async fn pull(inner: &Inner, space: &SpaceId, touched: &mut Touched) -> Result<bool, DriveError> {
    let mut since = inner.store.cursor(space)?;
    let mut complete = since.0 == 0;
    let mut resynced = false;
    let me = inner.config.account_id.as_str();
    let mut replaced: Vec<Item> = Vec::new();
    let mut revived: Vec<Item> = Vec::new();
    loop {
        let page = match inner.api.changes(space, since, 500).await {
            Ok(page) => page,
            Err(ApiError::ResyncRequired) if !resynced => {
                resynced = true;
                inner.store.clear_items(space)?;
                inner.store.set_cursor(space, Seq(0))?;
                since = Seq(0);
                complete = true;
                continue;
            }
            Err(error) => return Err(error.into()),
        };
        for item in &page.items {
            if !complete {
                let before = inner.store.item(space, &item.id)?;
                if rules::replaced_save(before.as_ref(), item, me) {
                    replaced.push(item.clone());
                } else if rules::revived(before.as_ref(), item, me) {
                    revived.push(item.clone());
                }
            }
            inner.store.put_item(item)?;
            touched.server.push(item.clone());
        }
        if page.next_since > since {
            since = page.next_since;
            inner.store.set_cursor(space, since)?;
        }
        if !page.more || page.items.is_empty() {
            break;
        }
    }
    for copy in replaced {
        save_replaced(inner, space, &copy);
    }
    for item in revived {
        let shown = inner.store.node(space, &item.id)?;
        inner.events.notice(&Notice {
            count: None,
            burst: None,
            kind: NoticeKind::Revived,
            space_id: space.clone(),
            name: shown
                .as_ref()
                .map_or_else(|| item.name.clone(), |node| node.name.clone()),
            by: Some(item.modified_by_name.clone()),
            item_id: Some(item.id.clone()),
            path: shown.map(|node| node.path),
            device_name: None,
        });
    }
    Ok(complete)
}

fn save_replaced(inner: &Inner, space: &SpaceId, copy: &Item) {
    let Some(original) = copy.replaced_of.as_ref() else {
        return;
    };
    let item = inner.store.item(space, original).ok().flatten();
    let shown = inner.store.node(space, original).ok().flatten();
    let name = shown
        .as_ref()
        .map(|node| node.name.clone())
        .or_else(|| item.as_ref().map(|item| item.name.clone()))
        .unwrap_or_else(|| copy.name.clone());
    let writer = copy
        .trashed_by
        .clone()
        .or_else(|| item.as_ref().map(|item| item.modified_by.clone()))
        .unwrap_or_default();
    let by = item
        .as_ref()
        .filter(|item| item.modified_by == writer)
        .map(|item| item.modified_by_name.clone())
        .or_else(|| {
            inner
                .store
                .item_by_writer(space, &writer)
                .map(|other| other.modified_by_name)
        });
    inner.events.notice(&Notice {
        count: None,
        burst: None,
        kind: NoticeKind::SaveReplaced,
        space_id: space.clone(),
        name,
        by,
        item_id: Some(copy.id.clone()),
        path: shown.map(|node| node.path),
        device_name: None,
    });
}

fn trees(inner: &Inner, space: &SpaceId, complete: bool) -> Result<Trees, DriveError> {
    let (server, base, local) = inner.store.planning(space, complete);
    Ok(Trees {
        server,
        base,
        local,
        complete,
    })
}

async fn up(
    inner: &Arc<Inner>,
    mounted: &Mounted,
    space: &SpaceId,
    touched: &mut Touched,
) -> Result<(), DriveError> {
    let ops = planner::plan_up(&trees(inner, space, false)?);
    let mut trashes = Vec::new();
    for op in ops {
        match op {
            Up::Create(id) if waits_large(inner, space, &id) => {}
            Up::Update {
                id,
                content: true,
                place: false,
            } if waits_large(inner, space, &id) => {}
            Up::Create(id) => create_up(inner, mounted, space, &id, touched).await?,
            Up::Update { id, .. } => update_up(inner, mounted, space, &id, touched).await?,
            Up::Trash(id) => {
                if !lock(&mounted.trashing).contains(&id) {
                    trashes.push(id)
                }
            }
            Up::DropLocal(id) => {
                for node in inner.store.remove_subtree(space, &id)? {
                    inner.bases.remove(&node.id);
                    touched.removed.insert(node.id.clone(), inner.entry(&node));
                }
            }
        }
    }
    if !trashes.is_empty() {
        trash_up(inner, mounted, space, trashes, touched).await?;
    }
    Ok(())
}

pub(crate) async fn trash_one(
    inner: &Arc<Inner>,
    space: &SpaceId,
    id: &ItemId,
) -> Result<(), DriveError> {
    let mounted = inner.mounted(space)?;
    if !lock(&mounted.trashing).insert(id.clone()) {
        return Err(DriveError::Changed);
    }
    let mut touched = Touched::default();
    let result = trash_up(inner, &mounted, space, vec![id.clone()], &mut touched).await;
    lock(&mounted.trashing).remove(id);
    emit(inner, &mounted, space, &touched);
    let mut results = result?;
    match results.remove(id) {
        Some(result) => result,
        None if inner.store.node(space, id)?.is_none() => Ok(()),
        None => Err(DriveError::Offline),
    }
}

async fn send_blob(
    inner: &Inner,
    space: &SpaceId,
    id: &ItemId,
    sha256: &str,
    size: u64,
) -> Result<(String, u64, Option<String>), DriveError> {
    if sha256 == EMPTY_SHA256 || size == 0 {
        return Ok((EMPTY_SHA256.to_owned(), 0, None));
    }
    if !inner.cache.has(sha256) {
        return Err(DriveError::Corrupt);
    }
    let blob = inner.cache.blob_path(sha256);
    let upload_id =
        transfer::upload(&inner.api, &inner.store, space, id, &blob, sha256, size).await?;
    Ok((sha256.to_owned(), size, Some(upload_id)))
}

async fn send_content(
    inner: &Inner,
    space: &SpaceId,
    node: &NodeRow,
) -> Result<(String, u64, Option<String>), DriveError> {
    let sha256 = node
        .sha256
        .clone()
        .unwrap_or_else(|| EMPTY_SHA256.to_owned());
    send_blob(inner, space, &node.id, &sha256, node.size).await
}

#[derive(Clone, Debug, Default)]
struct SentContent {
    local_sha: Option<String>,
    merged_from: Option<Version>,
}

impl SentContent {
    fn of(node: &NodeRow) -> Option<Self> {
        (node.kind == Kind::File).then(|| Self {
            local_sha: node.sha256.clone(),
            merged_from: None,
        })
    }
}

async fn create_up(
    inner: &Arc<Inner>,
    mounted: &Mounted,
    space: &SpaceId,
    id: &ItemId,
    touched: &mut Touched,
) -> Result<(), DriveError> {
    let Some(node) = inner.store.node(space, id)? else {
        return Ok(());
    };
    if !node.created || node.trash_pending || node.not_synced {
        return Ok(());
    }
    if let Some(parent) = &node.parent {
        if inner
            .store
            .node(space, parent)?
            .is_some_and(|folder| folder.created || folder.not_synced)
        {
            return Ok(());
        }
    }
    let mut new = NewItem {
        id: node.id.clone(),
        parent_id: node.parent.clone(),
        name: node.server_name.clone(),
        kind: node.kind,
        sha256: None,
        size: None,
        mtime_ms: None,
        upload_id: None,
    };
    if node.kind == Kind::File {
        let (sha256, size, upload_id) = match send_content(inner, space, &node).await {
            Ok(sent) => sent,
            Err(DriveError::Corrupt) => {
                touched.problem = Some(format!("{} has no content to upload.", node.name));
                return Ok(());
            }
            Err(error) => return Err(error),
        };
        new.sha256 = Some(sha256);
        new.size = Some(size);
        new.mtime_ms = Some(node.mtime_ms);
        new.upload_id = upload_id;
    }
    let answer = inner.api.create(space, &new).await;
    match rules::after_create(node.kind, answer) {
        CreateOutcome::Accepted(item) => commit(
            inner,
            space,
            &node,
            &item,
            SentContent::of(&node),
            true,
            touched,
        )?,
        CreateOutcome::WriteInto(holder) => {
            write_into(inner, mounted, space, &node, &holder, touched).await?
        }
        CreateOutcome::SameFolder(holder) => {
            same_folder(inner, space, &node, &holder, touched)?;
            mounted.kick.notify_one();
        }
        CreateOutcome::Renumber => {
            let name = server_free_name(
                inner,
                space,
                node.parent.as_ref(),
                &node.server_name,
                &node.id,
            )?;
            rename_for_server(inner, space, &node, &name, touched)?;
            mounted.kick.notify_one();
        }
        CreateOutcome::ToRoot => {
            let name = local_name_for(inner, space, None, &node.server_name, Some(&node.id))?;
            inner.store.move_node(space, &node.id, None, &name)?;
            touched.changed.insert(node.id.clone());
            mounted.kick.notify_one();
        }
        CreateOutcome::Adopt => match inner.api.item(space, &node.id).await {
            Ok(item) => {
                let sent = SentContent::of(&node).map(|_| SentContent {
                    local_sha: item.sha256.clone(),
                    merged_from: (item.version > Version(1)).then_some(Version(1)),
                });
                commit(inner, space, &node, &item, sent, true, touched)?
            }
            Err(error) if error.is_transient() => return Err(DriveError::Offline),
            Err(error) => touched.problem = Some(error.to_string()),
        },
        CreateOutcome::Retry(message) => return Err(retry_error(&message)),
        CreateOutcome::Failed(message) => {
            inner.store.delete_transfer(space, &node.id)?;
            touched.problem = Some(message);
        }
    }
    Ok(())
}

fn trashed_since(node: &NodeRow, item: &Item) -> bool {
    (item.trashed || item.deleted) && !(node.kind == Kind::File && node.sha256 != item.sha256)
}

fn gone_since(
    inner: &Inner,
    space: &SpaceId,
    node: &NodeRow,
    item: &Item,
    touched: &mut Touched,
) -> Result<(), DriveError> {
    inner.store.put_item(item)?;
    inner.store.put_base(space, &Base::of(item))?;
    let Some(mut now) = inner.store.node(space, &node.id)? else {
        return Ok(());
    };
    now.created = false;
    now.dirty_content = false;
    now.dirty_place = false;
    inner.store.update_node(&now)?;
    remove_clean(inner, space, &now, Some(item), touched)
}

async fn write_into(
    inner: &Arc<Inner>,
    mounted: &Mounted,
    space: &SpaceId,
    node: &NodeRow,
    holder: &Item,
    touched: &mut Touched,
) -> Result<(), DriveError> {
    if inner
        .store
        .node(space, &holder.id)?
        .is_some_and(|shown| shown.parent != holder.parent_id || shown.server_name != holder.name)
    {
        mounted.kick.notify_one();
        return Ok(());
    }
    let (sha256, size, upload_id) = match send_content(inner, space, node).await {
        Ok(sent) => sent,
        Err(DriveError::Corrupt) => {
            touched.problem = Some(format!("{} has no content to upload.", node.name));
            return Ok(());
        }
        Err(error) => return Err(error),
    };
    let change = Change {
        sha256: Some(sha256),
        size: Some(size),
        mtime_ms: Some(node.mtime_ms),
        upload_id,
        ..Change::default()
    };
    let answer = inner.api.change(space, &holder.id, None, &change).await;
    match rules::after_update(answer, false) {
        UpdateOutcome::Accepted(item) => {
            match inner.store.node(space, &holder.id)? {
                Some(mut shown) => {
                    for gone in inner.store.remove_subtree(space, &node.id)? {
                        inner.bases.remove(&gone.id);
                        touched.removed.insert(gone.id.clone(), inner.entry(&gone));
                    }
                    if !shown.dirty_content {
                        shown.sha256 = node.sha256.clone();
                        shown.size = node.size;
                        shown.mtime_ms = node.mtime_ms;
                        shown.downloaded = true;
                        inner.store.update_node(&shown)?;
                    }
                    let came_from = inner.store.base(space, &shown.id)?.map(|base| base.version);
                    let sent = SentContent {
                        local_sha: node.sha256.clone(),
                        merged_from: came_from,
                    };
                    commit(inner, space, &shown, &item, Some(sent), false, touched)?;
                }
                None => {
                    let before = inner.entry(node);
                    inner.store.rekey(space, &node.id, &holder.id)?;
                    inner.bases.remove(&node.id);
                    touched.removed.insert(node.id.clone(), before);
                    if let Some(mut now) = inner.store.node(space, &holder.id)? {
                        now.created = false;
                        now.server_name = item.name.clone();
                        inner.store.update_node(&now)?;
                        commit(
                            inner,
                            space,
                            &now,
                            &item,
                            SentContent::of(&now),
                            true,
                            touched,
                        )?;
                    }
                }
            }
            mounted.kick.notify_one();
        }
        UpdateOutcome::Gone => mounted.kick.notify_one(),
        UpdateOutcome::Retry(message) => return Err(retry_error(&message)),
        UpdateOutcome::Failed(message) => {
            inner.store.delete_transfer(space, &node.id)?;
            touched.problem = Some(message);
        }
        UpdateOutcome::Stale(_) | UpdateOutcome::PlaceInUse(_) | UpdateOutcome::PlaceRefused(_) => {
            mounted.kick.notify_one()
        }
    }
    Ok(())
}

fn same_folder(
    inner: &Inner,
    space: &SpaceId,
    node: &NodeRow,
    holder: &Item,
    touched: &mut Touched,
) -> Result<(), DriveError> {
    inner.store.put_item(holder)?;
    touched.server.push(holder.clone());
    match inner.store.node(space, &holder.id)? {
        Some(shown) => {
            for child in inner.store.children(space, Some(&node.id))? {
                let name =
                    unique_name(inner, space, Some(&shown.id), &child.name, Some(&child.id))?;
                let mut moved = inner
                    .store
                    .move_node(space, &child.id, Some(&shown.id), &name)?;
                if !moved.created && !moved.not_synced {
                    let base = inner.store.base(space, &moved.id)?;
                    moved.dirty_place = base.is_none_or(|base| {
                        base.parent.as_ref() != Some(&shown.id) || base.name != moved.server_name
                    });
                    inner.store.update_node(&moved)?;
                }
                touched.changed.insert(child.id.clone());
            }
            touched.removed.insert(node.id.clone(), inner.entry(node));
            inner.store.remove_node(space, &node.id)?;
        }
        None => {
            let before = inner.entry(node);
            inner.store.rekey(space, &node.id, &holder.id)?;
            touched.removed.insert(node.id.clone(), before);
            if let Some(mut now) = inner.store.node(space, &holder.id)? {
                now.created = false;
                now.server_name = holder.name.clone();
                inner.store.update_node(&now)?;
            }
            inner.store.put_base(space, &Base::of(holder))?;
            touched.changed.insert(holder.id.clone());
        }
    }
    Ok(())
}

fn server_free_name(
    inner: &Inner,
    space: &SpaceId,
    parent: Option<&ItemId>,
    wanted: &str,
    except: &ItemId,
) -> Result<String, DriveError> {
    let mut taken: HashSet<String> = HashSet::new();
    for child in inner.store.children(space, parent)? {
        if &child.id != except && !child.trash_pending {
            taken.insert(names::fold(&child.name));
            taken.insert(names::fold(&child.server_name));
        }
    }
    for item in inner.store.item_children(space, parent)? {
        if item.is_live() && &item.id != except {
            taken.insert(names::fold(&item.name));
        }
    }
    let mut n = 2;
    loop {
        let candidate = names::numbered(wanted, n);
        if !taken.contains(&names::fold(&candidate)) {
            return Ok(candidate);
        }
        n += 1;
    }
}

fn keep_base(inner: &Inner, item: &Item) {
    if item.kind != Kind::File {
        return;
    }
    match item.sha256.as_deref() {
        Some(sha) if inner.cache.has(sha) => {
            inner
                .bases
                .keep_file(&item.id, &inner.cache.blob_path(sha), item.size)
        }
        _ => inner.bases.remove(&item.id),
    }
}

fn commit(
    inner: &Inner,
    space: &SpaceId,
    sent: &NodeRow,
    item: &Item,
    content: Option<SentContent>,
    sent_place: bool,
    touched: &mut Touched,
) -> Result<(), DriveError> {
    if let Some(now) = inner.store.node(space, &sent.id)? {
        if trashed_since(&now, item) {
            return gone_since(inner, space, &now, item, touched);
        }
    }
    let before = inner.store.base(space, &sent.id)?.map(|base| base.version);
    let base = Base::of(item);
    inner.store.put_item(item)?;
    inner.store.put_base(space, &base)?;
    if let Some(mut now) = inner.store.node(space, &sent.id)? {
        now.created = false;
        if let (Some(content), Kind::File) = (&content, now.kind) {
            if now.sha256 == content.local_sha {
                if now.sha256 != item.sha256 {
                    now.sha256 = item.sha256.clone();
                    now.size = item.size;
                    now.mtime_ms = item.mtime_ms;
                    now.downloaded = item
                        .sha256
                        .as_deref()
                        .is_some_and(|sha| inner.cache.has(sha));
                }
                now.dirty_content = false;
                now.content_base = None;
            } else {
                now.dirty_content = now.sha256 != item.sha256 || now.size != item.size;
                if let Some(from) = content.merged_from {
                    now.content_base = Some(now.content_base.map_or(from, |at| at.min(from)));
                }
            }
            keep_base(inner, item);
        }
        if sent_place {
            now.dirty_place = now.parent != item.parent_id || now.server_name != item.name;
        }
        let file = now.kind == Kind::File;
        if content.is_none() && file && now.dirty_content {
            if let Some(from) = before.filter(|from| *from < base.version) {
                now.content_base = Some(now.content_base.map_or(from, |at| at.min(from)));
            }
        }
        inner.store.update_node(&now)?;
        let take_content = content.is_none() && file && !now.dirty_content;
        let take_place = !sent_place && !now.dirty_place;
        if take_content || take_place {
            take_server(inner, space, &now, item, take_content, take_place, touched)?;
            if take_content {
                keep_base(inner, item);
            }
        }
    }
    touched.changed.insert(sent.id.clone());
    touched.server.push(item.clone());
    Ok(())
}

fn rename_for_server(
    inner: &Inner,
    space: &SpaceId,
    node: &NodeRow,
    server_name: &str,
    touched: &mut Touched,
) -> Result<(), DriveError> {
    let local = unique_name(
        inner,
        space,
        node.parent.as_ref(),
        &names::safe_local_name(server_name),
        Some(&node.id),
    )?;
    let mut moved = inner
        .store
        .move_node(space, &node.id, node.parent.as_ref(), &local)?;
    moved.server_name = names::server_name(server_name);
    if !moved.created {
        moved.dirty_place = true;
    }
    inner.store.update_node(&moved)?;
    touched.changed.insert(node.id.clone());
    Ok(())
}

enum Plan {
    Own {
        if_match: Option<Version>,
    },
    Merged {
        sha256: String,
        size: u64,
        if_match: Version,
    },
    Theirs(Item),
}

async fn server_text(
    inner: &Inner,
    space: &SpaceId,
    server: &Item,
) -> Result<Option<String>, DriveError> {
    let sha = server
        .sha256
        .clone()
        .unwrap_or_else(|| EMPTY_SHA256.to_owned());
    if server.size > rules::MAX_TEXT {
        return Ok(None);
    }
    let blob = inner.cache.blob_path(&sha);
    if !inner.cache.has(&sha) {
        let temp = inner.cache.temp_path();
        transfer::download(
            &inner.api,
            space,
            &server.id,
            &sha,
            server.size,
            &temp,
            &blob,
        )
        .await?;
    }
    inner.cache.touch(&inner.store, &sha, server.size)?;
    let bytes = file_access::fs::read(&blob).map_err(DriveError::io)?;
    Ok(rules::is_text(&bytes).then(|| String::from_utf8(bytes).unwrap_or_default()))
}

async fn plan_content(
    inner: &Inner,
    space: &SpaceId,
    node: &NodeRow,
    base: &Base,
    server: Option<&Item>,
) -> Result<Plan, DriveError> {
    let last_save = Plan::Own { if_match: None };
    if node.content_base.is_some() {
        return Ok(last_save);
    }
    let Some(base_text) = inner.bases.text(&node.id, base.sha256.as_deref()) else {
        return Ok(last_save);
    };
    let Some(local_sha) = node.sha256.as_deref() else {
        return Ok(last_save);
    };
    if node.size > rules::MAX_TEXT || !inner.cache.has(local_sha) {
        return Ok(last_save);
    }
    let local = file_access::fs::read(inner.cache.blob_path(local_sha)).map_err(DriveError::io)?;
    if !rules::is_text(&local) {
        return Ok(last_save);
    }
    let ours = String::from_utf8(local).unwrap_or_default();
    let server = match server {
        Some(server) => server.clone(),
        None => match inner.store.item(space, &node.id)? {
            Some(server) => server,
            None => {
                return Ok(Plan::Own {
                    if_match: Some(base.version),
                })
            }
        },
    };
    if server.version == base.version {
        return Ok(Plan::Own {
            if_match: Some(base.version),
        });
    }
    if server.deleted || server.kind != Kind::File {
        return Ok(last_save);
    }
    let theirs = if server.sha256 == base.sha256 {
        base_text.clone()
    } else {
        match server_text(inner, space, &server).await? {
            Some(text) => text,
            None => return Ok(last_save),
        }
    };
    let Some(merged) = rules::merge_text(&base_text, &ours, &theirs) else {
        return Ok(last_save);
    };
    if merged == theirs {
        return Ok(Plan::Theirs(server));
    }
    if merged == ours {
        return Ok(Plan::Own {
            if_match: Some(server.version),
        });
    }
    let (sha256, size) = inner.cache.put_bytes(&inner.store, merged.as_bytes())?;
    Ok(Plan::Merged {
        sha256,
        size,
        if_match: server.version,
    })
}

async fn update_up(
    inner: &Arc<Inner>,
    mounted: &Mounted,
    space: &SpaceId,
    id: &ItemId,
    touched: &mut Touched,
) -> Result<(), DriveError> {
    let mut merging = true;
    let mut merges = 0;
    let mut server: Option<Item> = None;
    for _ in 0..rules::MERGE_TRIES + 3 {
        let Some(node) = inner.store.node(space, id)? else {
            return Ok(());
        };
        if node.created || node.trash_pending || node.not_synced {
            return Ok(());
        }
        let content =
            node.dirty_content && node.kind == Kind::File && !waits_large(inner, space, id);
        let place = node.dirty_place;
        if !content && !place {
            return Ok(());
        }
        let Some(base) = inner.store.base(space, id)? else {
            let mut node = node;
            node.created = true;
            inner.store.update_node(&node)?;
            return Ok(());
        };
        let mut change = Change::default();
        if place {
            change.name = Some(node.server_name.clone());
            change.parent_id = Some(node.parent.clone());
            change.replace = true;
        }
        let came_from = node
            .content_base
            .map_or(base.version, |from| from.min(base.version));
        change.base_version = (came_from.0 >= 1).then_some(came_from.0);
        let mut if_match = None;
        let mut sent = None;
        if content {
            let plan = if merging {
                match plan_content(inner, space, &node, &base, server.as_ref()).await {
                    Ok(plan) => plan,
                    Err(DriveError::Corrupt) => {
                        merges += 1;
                        merging = merges < rules::MERGE_TRIES;
                        server = inner.api.item(space, id).await.ok();
                        continue;
                    }
                    Err(error) => return Err(error),
                }
            } else {
                Plan::Own { if_match: None }
            };
            let mut merged_from = None;
            let uploaded = match plan {
                Plan::Theirs(item) => {
                    take_theirs(inner, space, &node, &item, touched)?;
                    continue;
                }
                Plan::Own { if_match: at } => {
                    if_match = at;
                    send_content(inner, space, &node).await
                }
                Plan::Merged {
                    sha256,
                    size,
                    if_match: at,
                } => {
                    if_match = Some(at);
                    merged_from = Some(base.version);
                    send_blob(inner, space, id, &sha256, size).await
                }
            };
            match uploaded {
                Ok((sha256, size, upload_id)) => {
                    change.sha256 = Some(sha256);
                    change.size = Some(size);
                    change.mtime_ms = Some(node.mtime_ms);
                    change.upload_id = upload_id;
                }
                Err(DriveError::Corrupt) => {
                    touched.problem = Some(format!("{} has no content to upload.", node.name));
                    return Ok(());
                }
                Err(error) => return Err(error),
            }
            if let Some(at) = if_match {
                change.base_version = Some(at.0);
            }
            sent = Some(SentContent {
                local_sha: node.sha256.clone(),
                merged_from,
            });
        }
        let answer = inner.api.change(space, id, if_match, &change).await;
        let forbidden = matches!(answer, Err(ApiError::Forbidden));
        match rules::after_update(answer, place) {
            UpdateOutcome::Accepted(item) => {
                return commit(inner, space, &node, &item, sent, place, touched)
            }
            UpdateOutcome::Stale(newer) => {
                inner.store.put_item(&newer)?;
                server = Some(newer);
                merges += 1;
                merging = merges < rules::MERGE_TRIES;
            }
            UpdateOutcome::PlaceInUse(who) => {
                undo_place(inner, space, &node, touched)?;
                let wanted = node.name.clone();
                inner.events.notice(&Notice {
                    count: None,
                    burst: None,
                    kind: NoticeKind::DeleteRefusedInUse,
                    space_id: space.clone(),
                    name: wanted,
                    by: Some(
                        who.iter()
                            .map(|by| by.name.clone())
                            .collect::<Vec<_>>()
                            .join(", "),
                    ),
                    item_id: Some(id.clone()),
                    path: Some(node.path.clone()),
                    device_name: who.first().map(|by| by.device_name.clone()),
                });
                if !content {
                    return Ok(());
                }
            }
            UpdateOutcome::PlaceRefused(message) => {
                undo_place(inner, space, &node, touched)?;
                touched.problem = Some(message);
                if !content {
                    return Ok(());
                }
            }
            UpdateOutcome::Gone => {
                let keep = node.kind == Kind::Folder
                    || node.dirty_content
                    || node
                        .sha256
                        .as_deref()
                        .is_some_and(|sha| inner.cache.has(sha));
                if keep {
                    let fresh = ItemId::new();
                    inner.store.rekey(space, id, &fresh)?;
                    inner.bases.remove(id);
                    if let Some(mut kept) = inner.store.node(space, &fresh)? {
                        kept.created = true;
                        kept.dirty_content = false;
                        kept.dirty_place = false;
                        kept.content_base = None;
                        inner.store.update_node(&kept)?;
                    }
                    touched.removed.insert(id.clone(), inner.entry(&node));
                    touched.changed.insert(fresh);
                    mounted.kick.notify_one();
                } else {
                    remove_clean(inner, space, &node, None, touched)?;
                }
                return Ok(());
            }
            UpdateOutcome::Retry(message) => return Err(retry_error(&message)),
            UpdateOutcome::Failed(message) => {
                inner.store.delete_transfer(space, id)?;
                if forbidden && is_root_ignore(&node) {
                    if let Some(server) = inner.store.item(space, id)?.filter(Item::is_live) {
                        take_theirs(inner, space, &node, &server, touched)?;
                    }
                    touched.problem = Some(
                        "Only the Space's owner and moderators can change its .mistyignore."
                            .to_owned(),
                    );
                    return Ok(());
                }
                touched.problem = Some(message);
                return Ok(());
            }
        }
    }
    Ok(())
}

fn take_theirs(
    inner: &Inner,
    space: &SpaceId,
    node: &NodeRow,
    server: &Item,
    touched: &mut Touched,
) -> Result<(), DriveError> {
    if let Some(now) = inner.store.node(space, &node.id)? {
        if trashed_since(&now, server) {
            return gone_since(inner, space, &now, server, touched);
        }
    }
    inner.store.put_item(server)?;
    take_server(inner, space, node, server, true, !node.dirty_place, touched)?;
    inner.store.put_base(space, &Base::of(server))?;
    keep_base(inner, server);
    touched.server.push(server.clone());
    Ok(())
}

fn undo_place(
    inner: &Inner,
    space: &SpaceId,
    node: &NodeRow,
    touched: &mut Touched,
) -> Result<(), DriveError> {
    match inner.store.item(space, &node.id)?.filter(Item::is_live) {
        Some(server) => take_server(inner, space, node, &server, false, true, touched),
        None => {
            let Some(base) = inner.store.base(space, &node.id)? else {
                return Ok(());
            };
            let name = local_name_for(
                inner,
                space,
                base.parent.as_ref(),
                &base.name,
                Some(&node.id),
            )?;
            let mut back = inner
                .store
                .move_node(space, &node.id, base.parent.as_ref(), &name)?;
            back.server_name = base.name.clone();
            back.dirty_place = false;
            inner.store.update_node(&back)?;
            touched.changed.insert(node.id.clone());
            Ok(())
        }
    }
}

fn take_server(
    inner: &Inner,
    space: &SpaceId,
    node: &NodeRow,
    server: &Item,
    content: bool,
    place: bool,
    touched: &mut Touched,
) -> Result<(), DriveError> {
    let Some(mut now) = inner.store.node(space, &node.id)? else {
        return Ok(());
    };
    if place && (now.parent != server.parent_id || now.server_name != server.name) {
        let parent_here = match &server.parent_id {
            None => true,
            Some(parent) => inner.store.node(space, parent)?.is_some(),
        };
        if parent_here {
            let name = local_name_for(
                inner,
                space,
                server.parent_id.as_ref(),
                &server.name,
                Some(&node.id),
            )?;
            let moved = inner
                .store
                .move_node(space, &node.id, server.parent_id.as_ref(), &name)?;
            now.path = moved.path;
            now.server_name = server.name.clone();
        }
    }
    if place {
        now.dirty_place = false;
    }
    if content && now.kind == Kind::File {
        if now.sha256 != server.sha256 || now.size != server.size {
            now.sha256 = server.sha256.clone();
            now.size = server.size;
            now.mtime_ms = server.mtime_ms;
            now.downloaded = inner.cache.holds_files()
                && server
                    .sha256
                    .as_deref()
                    .is_some_and(|sha| inner.cache.has(sha));
        }
        now.dirty_content = false;
        now.content_base = None;
    }
    inner.store.update_node(&now)?;
    touched.changed.insert(node.id.clone());
    Ok(())
}

fn remove_clean(
    inner: &Inner,
    space: &SpaceId,
    node: &NodeRow,
    server: Option<&Item>,
    touched: &mut Touched,
) -> Result<(), DriveError> {
    let subtree = inner.store.descendants(space, &node.id)?;
    let work: Vec<&str> = subtree
        .iter()
        .filter(|row| row.dirty() && !row.trash_pending)
        .map(|row| row.path.as_str())
        .collect();
    let used_lately = now_ms() - USED_LATELY.as_millis() as i64;
    let mut noticed = false;
    for row in subtree.iter().rev() {
        if work.iter().any(|path| names::is_within(path, &row.path)) {
            continue;
        }
        let key = (space.clone(), row.id.clone());
        let was_open = inner.opens.is_open(&key) || row.last_used_ms > used_lately;
        if was_open && !noticed && row.kind == Kind::File {
            if let Some(server) = server {
                noticed = true;
                inner.events.notice(&Notice {
                    count: None,
                    burst: None,
                    kind: NoticeKind::DeletedWhileOpen,
                    space_id: space.clone(),
                    name: row.name.clone(),
                    by: Some(server.modified_by_name.clone()),
                    item_id: Some(server.id.clone()),
                    path: Some(row.path.clone()),
                    device_name: None,
                });
            }
        }
        touched.removed.insert(row.id.clone(), inner.entry(row));
        inner.store.remove_node(space, &row.id)?;
        inner.store.delete_base(space, &row.id)?;
        inner.bases.remove(&row.id);
    }
    Ok(())
}

async fn trash_up(
    inner: &Arc<Inner>,
    mounted: &Mounted,
    space: &SpaceId,
    ids: Vec<ItemId>,
    touched: &mut Touched,
) -> Result<HashMap<ItemId, Result<(), DriveError>>, DriveError> {
    let mut results: HashMap<ItemId, Result<(), DriveError>> = HashMap::new();
    let _ = mounted;
    let mut wait = Duration::ZERO;
    for id in &ids {
        match inner.api.check_in_use(space, id).await {
            Ok(asked) => wait = wait.max(asked),
            Err(error) if error.is_transient() => return Err(DriveError::Offline),
            Err(_) => {}
        }
    }
    let wait = wait.min(inner.config.in_use_wait_cap);
    if !wait.is_zero() {
        tokio::time::sleep(wait).await;
    }
    for id in ids {
        let Some(node) = inner.store.node(space, &id)? else {
            continue;
        };
        if !node.trash_pending {
            continue;
        }
        if inner.store.base(space, &id)?.is_none() {
            for gone in inner.store.remove_subtree(space, &id)? {
                inner.bases.remove(&gone.id);
                touched.removed.insert(gone.id.clone(), inner.entry(&gone));
            }
            continue;
        }
        let answer = inner.api.trash(space, &id, node.trash_held).await;
        match rules::after_trash(answer) {
            TrashOutcome::Accepted(item) => {
                if let Some(item) = &item {
                    inner.store.put_item(item)?;
                    touched.server.push(item.clone());
                }
                if let (Some(agent_id), Some(chat_id)) = (&node.trash_agent, &node.trash_chat) {
                    inner.events.agent_trashed(&AgentTrash {
                        space_id: space.clone(),
                        item_id: id.clone(),
                        path: node.path.clone(),
                        agent_id: agent_id.clone(),
                        chat_id: chat_id.clone(),
                        at_ms: now_ms(),
                    });
                }
                for gone in inner.store.remove_subtree(space, &id)? {
                    inner.bases.remove(&gone.id);
                    touched.removed.insert(gone.id.clone(), inner.entry(&gone));
                }
                results.insert(id.clone(), Ok(()));
            }
            TrashOutcome::RefusedInUse(who) => {
                bring_back(inner, space, &node, touched)?;
                let line = rules::in_use_line(&who, &node.name);
                results.insert(id.clone(), Err(DriveError::InUse(line)));
                let first = who.first();
                inner.events.notice(&Notice {
                    count: None,
                    burst: None,
                    kind: NoticeKind::DeleteRefusedInUse,
                    space_id: space.clone(),
                    name: node.name.clone(),
                    by: Some(
                        who.iter()
                            .map(|by| by.name.clone())
                            .collect::<Vec<_>>()
                            .join(", "),
                    ),
                    item_id: Some(id.clone()),
                    path: Some(node.path.clone()),
                    device_name: first.map(|by| by.device_name.clone()),
                });
            }
            TrashOutcome::Retry(message) => return Err(retry_error(&message)),
            TrashOutcome::Failed(message) => {
                bring_back(inner, space, &node, touched)?;
                results.insert(id.clone(), Err(DriveError::Invalid(message.clone())));
                touched.problem = Some(message);
            }
        }
    }
    Ok(results)
}

fn bring_back(
    inner: &Inner,
    space: &SpaceId,
    node: &NodeRow,
    touched: &mut Touched,
) -> Result<(), DriveError> {
    for mut row in inner.store.descendants(space, &node.id)? {
        if row.trash_pending {
            row.trash_pending = false;
            row.trash_held = false;
            row.trash_agent = None;
            row.trash_chat = None;
            inner.store.update_node(&row)?;
        }
        touched.changed.insert(row.id.clone());
    }
    let clash = taken_by(
        inner,
        space,
        node.parent.as_ref(),
        &node.name,
        Some(&node.id),
    )
    .is_some();
    if clash {
        let name = unique_name(
            inner,
            space,
            node.parent.as_ref(),
            &node.name,
            Some(&node.id),
        )?;
        inner
            .store
            .move_node(space, &node.id, node.parent.as_ref(), &name)?;
    }
    Ok(())
}

fn down(
    inner: &Arc<Inner>,
    space: &SpaceId,
    complete: bool,
    touched: &mut Touched,
) -> Result<(), DriveError> {
    let trees = trees(inner, space, complete)?;
    for op in planner::plan_down(&trees) {
        match op {
            Down::Add(id) => add_down(inner, space, &id, touched)?,
            Down::Apply { id, content, place } => {
                let Some(server) = inner.store.item(space, &id)? else {
                    continue;
                };
                let Some(node) = inner.store.node(space, &id)? else {
                    continue;
                };
                take_server(inner, space, &node, &server, content, place, touched)?;
                inner.store.put_base(space, &Base::of(&server))?;
                if content {
                    keep_base(inner, &server);
                }
            }
            Down::Rebase(id) => {
                if let Some(server) = inner.store.item(space, &id)? {
                    inner.store.put_base(space, &Base::of(&server))?;
                }
            }
            Down::Remove(id) => {
                let Some(node) = inner.store.node(space, &id)? else {
                    continue;
                };
                let server = inner.store.item(space, &id)?;
                remove_clean(inner, space, &node, server.as_ref(), touched)?;
            }
        }
    }
    tidy_names(inner, space, touched)
}

fn tidy_names(inner: &Inner, space: &SpaceId, touched: &mut Touched) -> Result<(), DriveError> {
    for node in inner.store.untidy_nodes(space) {
        if node.created || node.dirty_place || node.trash_pending || node.not_synced {
            continue;
        }
        let wanted = names::safe_local_name(&node.server_name);
        if node.name == wanted {
            continue;
        }
        let free = taken_by(inner, space, node.parent.as_ref(), &wanted, Some(&node.id)).is_none();
        if free {
            inner
                .store
                .move_node(space, &node.id, node.parent.as_ref(), &wanted)?;
            touched.changed.insert(node.id.clone());
        }
    }
    Ok(())
}

fn add_down(
    inner: &Inner,
    space: &SpaceId,
    id: &ItemId,
    touched: &mut Touched,
) -> Result<(), DriveError> {
    let Some(item) = inner.store.item(space, id)? else {
        return Ok(());
    };
    if inner.store.node(space, id)?.is_some() {
        return Ok(());
    }
    if let Some(parent) = &item.parent_id {
        if inner.store.node(space, parent)?.is_none() {
            return Ok(());
        }
    }
    let name = local_name_for(inner, space, item.parent_id.as_ref(), &item.name, None)?;
    let downloaded = inner.cache.holds_files()
        && item.kind == Kind::File
        && item
            .sha256
            .as_deref()
            .is_some_and(|sha| inner.cache.has(sha));
    inner.store.insert_node(&NodeRow {
        ino: 0,
        space: space.clone(),
        id: item.id.clone(),
        parent: item.parent_id.clone(),
        name,
        server_name: item.name.clone(),
        kind: item.kind,
        sha256: item.sha256.clone(),
        size: item.size,
        mtime_ms: item.mtime_ms,
        path: String::new(),
        created: false,
        dirty_content: false,
        dirty_place: false,
        trash_pending: false,
        trash_held: false,
        trash_agent: None,
        trash_chat: None,
        not_synced: false,
        downloaded,
        content_base: None,
        last_used_ms: 0,
    })?;
    inner.store.put_base(space, &Base::of(&item))?;
    if downloaded {
        keep_base(inner, &item);
    }
    touched.changed.insert(item.id.clone());
    Ok(())
}

pub(crate) fn taken_by(
    inner: &Inner,
    space: &SpaceId,
    parent: Option<&ItemId>,
    name: &str,
    except: Option<&ItemId>,
) -> Option<NodeRow> {
    inner
        .store
        .children_folded(space, parent, name)
        .into_iter()
        .find(|child| Some(&child.id) != except && !child.trash_pending)
}

pub(crate) fn unique_name(
    inner: &Inner,
    space: &SpaceId,
    parent: Option<&ItemId>,
    wanted: &str,
    except: Option<&ItemId>,
) -> Result<String, DriveError> {
    if taken_by(inner, space, parent, wanted, except).is_none() {
        return Ok(wanted.to_owned());
    }
    let mut n = 2;
    loop {
        let candidate = names::numbered(wanted, n);
        if taken_by(inner, space, parent, &candidate, except).is_none() {
            return Ok(candidate);
        }
        n += 1;
    }
}

fn local_name_for(
    inner: &Inner,
    space: &SpaceId,
    parent: Option<&ItemId>,
    server_name: &str,
    self_id: Option<&ItemId>,
) -> Result<String, DriveError> {
    unique_name(
        inner,
        space,
        parent,
        &names::safe_local_name(server_name),
        self_id,
    )
}

fn hold_wanted(inner: &Inner, space: &SpaceId, node: &NodeRow) -> Option<bool> {
    if node.created || node.not_synced || node.trash_pending {
        return None;
    }
    let key: Key = (space.clone(), node.id.clone());
    if inner.opens.reportable(&key) {
        return Some(inner.opens.is_writing(&key) || node.dirty_content);
    }
    if node.dirty_content {
        return Some(true);
    }
    inner.opens.is_answered(&key).then_some(false)
}

pub(crate) async fn hold(
    inner: &Inner,
    mounted: &Mounted,
    space: &SpaceId,
    id: &ItemId,
    editing: bool,
) {
    if lock(&mounted.held).get(id) == Some(&editing) {
        return;
    }
    let sent = inner.link_send(serde_json::json!({
        "type": "drive.hold",
        "active": true,
        "space_id": space.as_str(),
        "item_id": id.as_str(),
        "editing": editing,
        "device_id": inner.config.device.id,
        "device_name": inner.config.device.name,
    }));
    if sent || inner.api.mark_in_use(space, id, editing).await.is_ok() {
        lock(&mounted.held).insert(id.clone(), editing);
    }
}

pub(crate) async fn release(inner: &Inner, mounted: &Mounted, space: &SpaceId, id: &ItemId) {
    if lock(&mounted.held).remove(id).is_none() {
        return;
    }
    let sent = inner.link_send(serde_json::json!({
        "type": "drive.hold",
        "active": false,
        "space_id": space.as_str(),
        "item_id": id.as_str(),
        "device_id": inner.config.device.id,
        "device_name": inner.config.device.name,
    }));
    if !sent {
        let _ = inner.api.clear_in_use(space, id).await;
    }
}

pub(crate) async fn settle_hold(inner: &Inner, mounted: &Mounted, space: &SpaceId, id: &ItemId) {
    let wanted = inner
        .store
        .node(space, id)
        .ok()
        .flatten()
        .and_then(|node| hold_wanted(inner, space, &node));
    match wanted {
        Some(editing) => hold(inner, mounted, space, id, editing).await,
        None => release(inner, mounted, space, id).await,
    }
}

async fn settle_holds(inner: &Arc<Inner>, mounted: &Mounted, space: &SpaceId) {
    let mut ids: HashSet<ItemId> = lock(&mounted.held).keys().cloned().collect();
    for node in inner.store.dirty_nodes(space) {
        if node.dirty_content {
            ids.insert(node.id);
        }
    }
    for (key, _) in inner.opens.reportable_keys() {
        if &key.0 == space {
            ids.insert(key.1);
        }
    }
    for id in ids {
        settle_hold(inner, mounted, space, &id).await;
    }
}

pub(crate) fn resend_holds(inner: &Inner) {
    let spaces: Vec<Arc<Mounted>> = inner
        .spaces
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .values()
        .cloned()
        .collect();
    for mounted in spaces {
        let held: Vec<(ItemId, bool)> = lock(&mounted.held)
            .iter()
            .map(|(id, editing)| (id.clone(), *editing))
            .collect();
        for (id, editing) in held {
            inner.link_send(serde_json::json!({
                "type": "drive.hold",
                "active": true,
                "space_id": mounted.mount.space.as_str(),
                "item_id": id.as_str(),
                "editing": editing,
                "device_id": inner.config.device.id,
                "device_name": inner.config.device.name,
            }));
        }
    }
}

async fn fetch_wanted(inner: &Arc<Inner>, space: &SpaceId) {
    if !inner.cache.holds_files() {
        return;
    }
    let mut wanted: Vec<ItemId> = inner
        .opens
        .open_keys()
        .into_iter()
        .filter(|(at, _)| at == space)
        .map(|(_, id)| id)
        .collect();
    for pin in inner.store.pins(space) {
        for node in inner.store.descendants(space, &pin).unwrap_or_default() {
            if node.kind == Kind::File && !node.downloaded {
                wanted.push(node.id);
            }
        }
    }
    for id in wanted {
        let Ok(Some(node)) = inner.store.node(space, &id) else {
            continue;
        };
        if node.kind != Kind::File || node.downloaded || node.dirty() || node.not_synced {
            continue;
        }
        let _ = content(inner, space, &node.id).await;
    }
}

fn evict(inner: &Inner, touched: &mut Touched) {
    let open = inner.opens.open_keys();
    if let Ok(gone) = inner.cache.evict(
        &inner.store,
        inner.cache_limit.load(Ordering::SeqCst),
        &open,
    ) {
        for (_, id) in gone {
            touched.changed.insert(id);
        }
    }
}

pub(crate) async fn content(
    inner: &Inner,
    space: &SpaceId,
    id: &ItemId,
) -> Result<PathBuf, DriveError> {
    content_pinned(inner, space, id)
        .await
        .map(|(path, _, _)| path)
}

pub(crate) async fn content_pinned(
    inner: &Inner,
    space: &SpaceId,
    id: &ItemId,
) -> Result<(PathBuf, BlobPin, u64), DriveError> {
    let node = inner.store.node(space, id)?.ok_or(DriveError::NotFound)?;
    if node.kind != Kind::File {
        return Err(DriveError::Invalid("That's a folder.".to_owned()));
    }
    let sha256 = node
        .sha256
        .clone()
        .unwrap_or_else(|| EMPTY_SHA256.to_owned());
    let blob = inner.cache.blob_path(&sha256);
    let pin = inner.cache.pin(&sha256);
    let size = node.size;
    let finish = |inner: &Inner, pin: BlobPin| -> Result<(PathBuf, BlobPin, u64), DriveError> {
        inner.cache.touch(&inner.store, &sha256, node.size)?;
        if let Some(mut now) = inner.store.node(space, id)? {
            if inner.cache.holds_files()
                && now.sha256.as_deref() == Some(sha256.as_str())
                && !now.downloaded
            {
                now.downloaded = true;
                inner.store.update_node(&now)?;
            }
        }
        Ok((blob.clone(), pin, size))
    };
    if inner.cache.has(&sha256) {
        return finish(inner, pin);
    }
    if sha256 == EMPTY_SHA256 {
        inner.cache.put_bytes(&inner.store, &[])?;
        return finish(inner, pin);
    }
    if node.created || node.dirty_content || node.not_synced {
        return Err(DriveError::Corrupt);
    }
    let gate = lock(&inner.fetching)
        .entry(sha256.clone())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone();
    let _held = gate.lock().await;
    if inner.cache.has(&sha256) {
        return finish(inner, pin);
    }
    let key: Key = (space.clone(), id.clone());
    lock(&inner.downloading).insert(key.clone());
    let temp = inner.cache.temp_path();
    let fetched = transfer::download(&inner.api, space, id, &sha256, node.size, &temp, &blob).await;
    lock(&inner.downloading).remove(&key);
    lock(&inner.fetching).remove(&sha256);
    fetched?;
    if let Ok(Some(base)) = inner.store.base(space, id) {
        if base.sha256.as_deref() == Some(sha256.as_str()) {
            inner.bases.keep_file(id, &blob, node.size);
        }
    }
    finish(inner, pin)
}

fn folder_at(inner: &Inner, space: &SpaceId, path: &str) -> Result<Option<ItemId>, DriveError> {
    let path = names::drive_path(path).map_err(DriveError::Invalid)?;
    if path == names::ROOT {
        return Ok(None);
    }
    let node = inner
        .store
        .node_at(space, &path)?
        .filter(|node| !node.trash_pending)
        .ok_or(DriveError::NotFound)?;
    if node.kind != Kind::Folder {
        return Err(DriveError::Invalid("That isn't a folder.".to_owned()));
    }
    Ok(Some(node.id))
}

pub(crate) fn folder_made(
    inner: &Inner,
    space: &SpaceId,
    path: &str,
) -> Result<Option<ItemId>, DriveError> {
    match folder_at(inner, space, path) {
        Err(DriveError::NotFound) => {}
        found => return found,
    }
    let path = names::drive_path(path).map_err(DriveError::Invalid)?;
    let mut parent: Option<ItemId> = None;
    let mut so_far = String::new();
    for part in path.split('/').filter(|part| !part.is_empty()) {
        so_far = format!("{so_far}/{part}");
        let found = inner
            .store
            .node_at(space, &so_far)?
            .filter(|node| !node.trash_pending);
        parent = Some(match found {
            Some(node) if node.kind == Kind::Folder => node.id,
            Some(_) => return Err(DriveError::Invalid("That isn't a folder.".to_owned())),
            None => {
                create_node(
                    inner,
                    space,
                    parent,
                    part,
                    Kind::Folder,
                    None,
                    now_ms(),
                    None,
                    None,
                )?
                .id
            }
        });
    }
    Ok(parent)
}

fn check_name(name: &str) -> Result<String, DriveError> {
    let name = names::nfc(name);
    if name.is_empty()
        || name == "."
        || name == ".."
        || name
            .chars()
            .any(|c| c == '/' || c == '\0' || names::hidden_char(c))
        || name.len() > 255
    {
        return Err(DriveError::Invalid(format!(
            "“{name}” can't be a name here."
        )));
    }
    Ok(name)
}

pub(crate) fn rules_for(inner: &Inner, space: &SpaceId, folder: Option<&ItemId>) -> DriveRules {
    let mut rules = DriveRules::default();
    let mut chain = Vec::new();
    let mut current = folder.cloned();
    while let Some(id) = current {
        let Ok(Some(node)) = inner.store.node(space, &id) else {
            break;
        };
        current = node.parent.clone();
        chain.push((Some(node.id), node.path));
        if chain.len() > 256 {
            break;
        }
    }
    chain.push((None, names::ROOT.to_owned()));
    for (id, path) in chain.into_iter().rev() {
        for file in [GIT_IGNORE_FILE, IGNORE_FILE] {
            let Some(child) = inner
                .store
                .children_folded(space, id.as_ref(), file)
                .into_iter()
                .find(|child| child.name.eq_ignore_ascii_case(file) && !child.trash_pending)
            else {
                continue;
            };
            if child.kind != Kind::File || child.size > MAX_IGNORE_TEXT {
                continue;
            }
            let Some(sha) = child.sha256.as_deref() else {
                continue;
            };
            if let Ok(text) = file_access::fs::read_to_string(inner.cache.blob_path(sha)) {
                rules.add(&path, &text);
            }
        }
    }
    rules
}

#[allow(clippy::too_many_arguments)]
fn create_node(
    inner: &Inner,
    space: &SpaceId,
    parent: Option<ItemId>,
    name: &str,
    kind: Kind,
    content: Option<(String, u64)>,
    mtime_ms: i64,
    id: Option<ItemId>,
    rules: Option<&DriveRules>,
) -> Result<NodeRow, DriveError> {
    let name = check_name(name)?;
    let mut parent_synced = true;
    if let Some(parent) = &parent {
        let folder = inner
            .store
            .node(space, parent)?
            .filter(|folder| !folder.trash_pending)
            .ok_or(DriveError::NotFound)?;
        if folder.kind != Kind::Folder {
            return Err(DriveError::Invalid("That isn't a folder.".to_owned()));
        }
        parent_synced = !folder.not_synced;
    }
    let siblings = inner.store.children_folded(space, parent.as_ref(), &name);
    if let Some(mut revived) = siblings
        .iter()
        .find(|other| other.trash_pending && other.kind == kind)
        .filter(|_| id.is_none())
        .cloned()
    {
        if siblings.iter().all(|other| other.trash_pending) {
            if revived.kind == Kind::Folder {
                for child in inner.store.children(space, Some(&revived.id))? {
                    if child.trash_pending {
                        continue;
                    }
                    if child.created || child.not_synced {
                        inner.store.remove_subtree(space, &child.id)?;
                        continue;
                    }
                    let mut gone = child;
                    gone.trash_pending = true;
                    gone.trash_held = revived.trash_held;
                    gone.trash_agent = revived.trash_agent.clone();
                    gone.trash_chat = revived.trash_chat.clone();
                    inner.store.update_node(&gone)?;
                }
            }
            revived.trash_pending = false;
            revived.trash_held = false;
            revived.trash_agent = None;
            revived.trash_chat = None;
            if let Some((sha256, size)) = content {
                set_content(
                    inner,
                    space,
                    &mut revived,
                    sha256,
                    size,
                    mtime_ms,
                    Some(Version(0)),
                )?;
            }
            inner.store.update_node(&revived)?;
            return inner
                .store
                .node(space, &revived.id)?
                .ok_or(DriveError::NotFound);
        }
    }
    if siblings.iter().any(|other| !other.trash_pending) {
        return Err(DriveError::Exists);
    }
    let id = match id {
        Some(id) if !ItemId::is_valid(id.as_str()) => {
            return Err(DriveError::Invalid(
                "That id isn't one Misty makes.".to_owned(),
            ))
        }
        Some(id) => id,
        None => ItemId::new(),
    };
    if inner.store.node(space, &id)?.is_some() {
        return Err(DriveError::Exists);
    }
    let parent_path = match &parent {
        None => names::ROOT.to_owned(),
        Some(parent) => inner
            .store
            .node(space, parent)?
            .map(|folder| folder.path)
            .unwrap_or_else(|| names::ROOT.to_owned()),
    };
    let path = names::join(&parent_path, &name);
    let not_synced = !parent_synced
        || match rules {
            Some(rules) => rules.ignores(&path, kind == Kind::Folder),
            None => rules_for(inner, space, parent.as_ref()).ignores(&path, kind == Kind::Folder),
        };
    let (sha256, size) = match (kind, content) {
        (Kind::Folder, _) => (None, 0),
        (Kind::File, Some((sha256, size))) => (Some(sha256), size),
        (Kind::File, None) => {
            let (sha256, size) = inner.cache.put_bytes(&inner.store, &[])?;
            (Some(sha256), size)
        }
    };
    inner.store.insert_node(&NodeRow {
        ino: 0,
        space: space.clone(),
        id,
        parent,
        name: name.clone(),
        server_name: names::server_name(&name),
        kind,
        sha256,
        size,
        mtime_ms: if mtime_ms > 0 { mtime_ms } else { now_ms() },
        path,
        created: true,
        dirty_content: false,
        dirty_place: false,
        trash_pending: false,
        trash_held: false,
        trash_agent: None,
        trash_chat: None,
        not_synced,
        downloaded: true,
        content_base: None,
        last_used_ms: now_ms(),
    })
}

pub(crate) fn create_local(
    inner: &Inner,
    space: &SpaceId,
    new: NewNode,
) -> Result<NodeRow, DriveError> {
    inner.mounted(space)?;
    let content = match (new.kind, &new.content) {
        (Kind::File, Some(path)) => Some(inner.cache.take(&inner.store, path)?),
        _ => None,
    };
    create_node(
        inner,
        space,
        new.parent,
        &new.name,
        new.kind,
        content,
        new.mtime_ms,
        new.id,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
fn set_content(
    inner: &Inner,
    space: &SpaceId,
    node: &mut NodeRow,
    sha256: String,
    size: u64,
    mtime_ms: i64,
    came_from: Option<Version>,
) -> Result<(), DriveError> {
    let base = inner.store.base(space, &node.id)?;
    node.sha256 = Some(sha256);
    node.size = size;
    node.mtime_ms = if mtime_ms > 0 { mtime_ms } else { now_ms() };
    node.downloaded = true;
    node.last_used_ms = now_ms();
    if !node.created && !node.not_synced {
        node.dirty_content = base
            .as_ref()
            .is_none_or(|base| base.sha256 != node.sha256 || base.size != size);
        let older = came_from.filter(|from| base.as_ref().is_some_and(|base| *from < base.version));
        node.content_base = if node.dirty_content {
            match (node.content_base, older) {
                (Some(before), Some(now)) => Some(before.min(now)),
                (before, now) => before.or(now),
            }
        } else {
            None
        };
    }
    Ok(())
}

pub(crate) fn write_local(
    inner: &Inner,
    space: &SpaceId,
    id: &ItemId,
    content: &Path,
    mtime_ms: i64,
    came_from: Option<Version>,
) -> Result<NodeRow, DriveError> {
    let mut node = inner
        .store
        .node(space, id)?
        .filter(|node| !node.trash_pending)
        .ok_or(DriveError::NotFound)?;
    if node.kind != Kind::File {
        return Err(DriveError::Invalid("That's a folder.".to_owned()));
    }
    let (sha256, size) = inner.cache.take(&inner.store, content)?;
    set_content(inner, space, &mut node, sha256, size, mtime_ms, came_from)?;
    inner.store.update_node(&node)?;
    Ok(node)
}

pub(crate) fn rename_local(
    inner: &Inner,
    space: &SpaceId,
    id: &ItemId,
    folder: Option<&ItemId>,
    name: &str,
    replace: bool,
) -> Result<NodeRow, DriveError> {
    let node = inner
        .store
        .node(space, id)?
        .filter(|node| !node.trash_pending)
        .ok_or(DriveError::NotFound)?;
    let name = check_name(name)?;
    if node.parent.as_ref() == folder && node.name == name {
        return Ok(node);
    }
    if is_root_ignore(&node)
        && !node.created
        && !node.not_synced
        && (folder.is_some() || !name.eq_ignore_ascii_case(IGNORE_FILE))
    {
        return Err(DriveError::Fixed(
            "The Space's .mistyignore stays at its top.".to_owned(),
        ));
    }
    if let Some(folder) = folder {
        let target = inner
            .store
            .node(space, folder)?
            .filter(|target| !target.trash_pending)
            .ok_or(DriveError::NotFound)?;
        if target.kind != Kind::Folder {
            return Err(DriveError::Invalid("That isn't a folder.".to_owned()));
        }
    }
    let clash = taken_by(inner, space, folder, &name, Some(&node.id));
    if let Some(mut target) = clash {
        if !replace {
            return Err(DriveError::Exists);
        }
        if target.kind == Kind::File && node.kind == Kind::File {
            let sha256 = node
                .sha256
                .clone()
                .unwrap_or_else(|| EMPTY_SHA256.to_owned());
            let came_from = (!node.created && !node.not_synced).then_some(Version(0));
            set_content(
                inner,
                space,
                &mut target,
                sha256,
                node.size,
                node.mtime_ms,
                came_from,
            )?;
            inner.store.update_node(&target)?;
            if node.created || node.not_synced {
                inner.store.remove_subtree(space, &node.id)?;
            } else {
                trash_local(inner, space, &node.id, &TrashBy::Person)?;
            }
            return inner
                .store
                .node(space, &target.id)?
                .ok_or(DriveError::NotFound);
        }
        return Err(DriveError::Exists);
    }
    let mut moved = inner.store.move_node(space, id, folder, &name)?;
    moved.server_name = names::server_name(&name);
    if !moved.created && !moved.not_synced {
        let base = inner.store.base(space, id)?;
        moved.dirty_place = base
            .is_none_or(|base| base.parent.as_ref() != folder || base.name != moved.server_name);
    }
    inner.store.update_node(&moved)?;
    Ok(moved)
}

pub(crate) fn trash_local(
    inner: &Inner,
    space: &SpaceId,
    id: &ItemId,
    by: &TrashBy,
) -> Result<(), DriveError> {
    let mut node = inner
        .store
        .node(space, id)?
        .filter(|node| !node.trash_pending)
        .ok_or(DriveError::NotFound)?;
    let open_here = inner
        .store
        .descendants(space, id)?
        .into_iter()
        .find(|below| inner.opens.is_open(&(space.clone(), below.id.clone())));
    if let Some(open) = open_here {
        return Err(DriveError::InUse(format!(
            "“{}” is open on this computer.",
            open.name
        )));
    }
    if node.created || node.not_synced {
        inner.store.remove_subtree(space, id)?;
        return Ok(());
    }
    if is_root_ignore(&node) {
        return Err(DriveError::Fixed(
            "The Space's .mistyignore can't be deleted. Change its lines instead.".to_owned(),
        ));
    }
    node.trash_pending = true;
    node.trash_held = by.held();
    if let TrashBy::Agent { agent_id, chat_id } = by {
        node.trash_agent = Some(agent_id.clone());
        node.trash_chat = Some(chat_id.clone());
    }
    inner.store.update_node(&node)?;
    Ok(())
}

pub(crate) async fn open(
    inner: &Arc<Inner>,
    space: &SpaceId,
    id: &ItemId,
    editing: bool,
) -> Result<(), DriveError> {
    inner.mounted(space)?;
    let node = inner.store.node(space, id)?.ok_or(DriveError::NotFound)?;
    let key: Key = (space.clone(), id.clone());
    let was_writing = inner.opens.is_writing(&key);
    let first = inner.opens.open(key.clone(), editing);
    let local_only = node.created || node.not_synced;
    if !local_only && (first || (editing && !was_writing)) {
        let inner = inner.clone();
        let later = key.clone();
        inner.runtime.clone().spawn(async move {
            tokio::time::sleep(in_use::REPORT_AFTER).await;
            report_open(&inner, &later).await;
        });
    }
    Ok(())
}

pub(crate) fn wrote(inner: &Arc<Inner>, space: &SpaceId, id: &ItemId) {
    let key: Key = (space.clone(), id.clone());
    if inner.opens.wrote(&key) {
        let inner = inner.clone();
        inner.runtime.clone().spawn(async move {
            report_open(&inner, &key).await;
        });
    }
}

async fn report_open(inner: &Arc<Inner>, key: &Key) {
    let (space, id) = key;
    if !inner.opens.reportable(key) {
        return;
    }
    let Ok(mounted) = inner.mounted(space) else {
        return;
    };
    let Ok(Some(mut node)) = inner.store.node(space, id) else {
        return;
    };
    if node.created || node.not_synced {
        return;
    }
    node.last_used_ms = now_ms();
    if inner.store.update_node(&node).is_ok() {
        inner.local_changed(space, id);
    }
    let editing = inner.opens.is_writing(key) || node.dirty_content;
    hold(inner, &mounted, space, id, editing).await;
    settle_hold(inner, &mounted, space, id).await;
}

pub(crate) async fn close(inner: &Arc<Inner>, space: &SpaceId, id: &ItemId, editing: bool) {
    let key: Key = (space.clone(), id.clone());
    let reported = inner.opens.reportable(&key);
    if !inner.opens.close(&key, editing) {
        return;
    }
    let Ok(Some(mut node)) = inner.store.node(space, id) else {
        return;
    };
    if reported {
        node.last_used_ms = now_ms();
        if inner.store.update_node(&node).is_ok() {
            inner.local_changed(space, id);
        }
    }
    if node.dirty() {
        return;
    }
    inner.opens.forget_answer(&key);
    if let Ok(mounted) = inner.mounted(space) {
        release(inner, &mounted, space, id).await;
    }
}

pub(crate) async fn realtime(
    inner: &Arc<Inner>,
    space: &SpaceId,
    kind: &str,
    payload: &Value,
    age: Option<Duration>,
) {
    let Ok(mounted) = inner.mounted(space) else {
        return;
    };
    let item = payload
        .get("item_id")
        .and_then(Value::as_str)
        .map(|id| ItemId(id.to_owned()));
    match kind {
        "drive.changed" => {
            let seq = payload
                .get("seq")
                .and_then(Value::as_i64)
                .unwrap_or(i64::MAX);
            if inner
                .store
                .cursor(space)
                .map_or(true, |cursor| seq > cursor.0)
            {
                mounted.kick.notify_one();
            }
        }
        "drive.in_use_check" => {
            if age.is_some_and(|age| age > STALE_CHECK) {
                return;
            }
            if let Some(id) = item {
                answer_check(inner, &mounted, space, &id).await;
            }
        }
        "drive.in_use" => {
            if !mounted.marks_pending.swap(true, Ordering::SeqCst) {
                let runtime = inner.runtime.clone();
                let inner = inner.clone();
                let space = space.clone();
                runtime.spawn(async move {
                    tokio::time::sleep(MARKS_QUIET).await;
                    if let Ok(mounted) = inner.mounted(&space) {
                        mounted.marks_pending.store(false, Ordering::SeqCst);
                        read_marks(&inner, &space).await;
                    }
                });
            }
        }
        _ => {}
    }
}

pub(crate) async fn refresh_marks(inner: &Arc<Inner>, space: &SpaceId) {
    read_marks(inner, space).await;
}

async fn read_marks(inner: &Arc<Inner>, space: &SpaceId) {
    let changed = match inner.api.in_use_marks(space).await {
        Ok(marks) => {
            let now = now_ms();
            let marks = marks
                .into_iter()
                .map(|mark| {
                    let expires_ms = mark
                        .expires_at
                        .as_deref()
                        .and_then(|at| chrono::DateTime::parse_from_rfc3339(at).ok())
                        .map(|at| at.timestamp_millis())
                        .unwrap_or(i64::MAX);
                    let held = in_use::Held {
                        user_id: mark.user_id,
                        name: mark.name,
                        device_id: mark.device_id,
                        device_name: mark.device_name,
                        editing: mark.editing,
                        expires_ms,
                    };
                    (mark.item_id, held)
                })
                .collect();
            inner.marks.replace(space, marks, now)
        }
        Err(_) => inner.marks.expire(space, now_ms()),
    };
    marks_changed(inner, space, &changed);
}

async fn keep_marks(inner: &Arc<Inner>, space: &SpaceId) {
    if inner
        .marks
        .expiring(space, now_ms() + MARKS_FRESH.as_millis() as i64)
    {
        read_marks(inner, space).await;
    } else {
        let changed = inner.marks.expire(space, now_ms());
        marks_changed(inner, space, &changed);
    }
}

fn marks_changed(inner: &Inner, space: &SpaceId, items: &HashSet<ItemId>) {
    let entries: Vec<ChangedEntry> = items
        .iter()
        .filter_map(|id| inner.store.node(space, id).ok().flatten())
        .filter(|node| !node.trash_pending)
        .map(|node| ChangedEntry {
            entry: inner.entry(&node),
            removed: false,
        })
        .collect();
    if !entries.is_empty() {
        inner.events.changed(space, &entries);
    }
}

async fn answer_check(inner: &Arc<Inner>, mounted: &Mounted, space: &SpaceId, id: &ItemId) {
    let Ok(subtree) = inner.store.descendants(space, id) else {
        return;
    };
    if subtree.is_empty() {
        return;
    }
    let root = mounted
        .os_root
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    let paths: Vec<PathBuf> = subtree
        .iter()
        .filter(|node| node.kind == Kind::File && node.downloaded)
        .map(|node| names::local_path(&root, &node.path))
        .collect();
    let held = tokio::task::spawn_blocking(move || in_use::held_open(&paths))
        .await
        .unwrap_or_default();
    let lately = now_ms() - USED_LATELY.as_millis() as i64;
    let mut answered = Vec::new();
    for node in subtree {
        if node.created || node.not_synced || node.trash_pending {
            continue;
        }
        let key: Key = (space.clone(), node.id.clone());
        let path = names::local_path(&root, &node.path);
        let in_use = inner.opens.is_open(&key)
            || node.dirty()
            || node.last_used_ms > lately
            || held.contains(&path);
        if !in_use {
            continue;
        }
        let editing = inner.opens.is_writing(&key) || node.dirty_content;
        inner.opens.answered(key);
        hold(inner, mounted, space, &node.id, editing).await;
        answered.push(node.id.clone());
    }
    if answered.is_empty() {
        return;
    }
    let later = inner.clone();
    let space = space.clone();
    inner.runtime.spawn(async move {
        tokio::time::sleep(ANSWER_HOLD).await;
        let Ok(mounted) = later.mounted(&space) else {
            return;
        };
        for id in answered {
            settle_hold(&later, &mounted, &space, &id).await;
        }
    });
}

pub(crate) fn entries(
    inner: &Inner,
    space: &SpaceId,
    path: &str,
    cursor: Option<&str>,
    limit: Option<usize>,
) -> Result<EntryPage, DriveError> {
    inner.mounted(space)?;
    let folder = folder_at(inner, space, path)?;
    let after = match cursor.filter(|cursor| !cursor.is_empty()) {
        Some(cursor) => Some(ChildKey::from_cursor(cursor).ok_or_else(|| {
            DriveError::Invalid("That list position isn't one Misty gave.".to_owned())
        })?),
        None => None,
    };
    let limit = limit.unwrap_or(500).clamp(1, 5000);
    let (rows, next) = inner
        .store
        .children_page(space, folder.as_ref(), after.as_ref(), limit);
    Ok(EntryPage {
        entries: rows.iter().map(|node| inner.entry(node)).collect(),
        next_cursor: next.map(|key| key.cursor()),
    })
}

pub(crate) fn write_bytes(
    inner: &Inner,
    space: &SpaceId,
    folder: &str,
    name: &str,
    bytes: &[u8],
    replace: Option<(ItemId, Version)>,
) -> Result<DriveEntry, DriveError> {
    inner.mounted(space)?;
    if let Some((id, version)) = replace {
        let mut node = inner
            .store
            .node(space, &id)?
            .filter(|node| !node.trash_pending)
            .ok_or(DriveError::NotFound)?;
        if node.kind != Kind::File {
            return Err(DriveError::Invalid("That's a folder.".to_owned()));
        }
        if version.0 < 1 && !(node.created || node.not_synced) {
            return Err(DriveError::Invalid(
                "Saving over a file needs the version that was opened.".to_owned(),
            ));
        }
        let (sha256, size) = inner.cache.put_bytes(&inner.store, bytes)?;
        set_content(
            inner,
            space,
            &mut node,
            sha256,
            size,
            now_ms(),
            Some(version),
        )?;
        inner.store.update_node(&node)?;
        return Ok(inner.entry(&node));
    }
    let parent = folder_made(inner, space, folder)?;
    let name = check_name(name)?;
    let free = unique_name(inner, space, parent.as_ref(), &name, None)?;
    let (sha256, size) = inner.cache.put_bytes(&inner.store, bytes)?;
    let node = create_node(
        inner,
        space,
        parent,
        &free,
        Kind::File,
        Some((sha256, size)),
        now_ms(),
        None,
        None,
    )?;
    Ok(inner.entry(&node))
}

fn time_ms(at: Option<std::time::SystemTime>) -> i64 {
    at.and_then(|at| at.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_else(now_ms)
}

struct CopiedFile {
    path: String,
    sha256: String,
    size: u64,
    mtime_ms: i64,
}

fn read_rules(dir: &dyn CopyFolder, at: &str, rules: &mut DriveRules) {
    use std::io::Read as _;
    for file in [GIT_IGNORE_FILE, IGNORE_FILE] {
        let Ok(handle) = dir.open(std::ffi::OsStr::new(file)) else {
            continue;
        };
        let mut text = String::new();
        if handle
            .take(MAX_IGNORE_TEXT)
            .read_to_string(&mut text)
            .is_ok()
        {
            rules.add(at, &text);
        }
    }
}

pub(crate) fn copy_in(
    inner: &Inner,
    space: &SpaceId,
    source: &dyn CopySource,
    folder: &str,
) -> Result<(DriveEntry, CopyReport), DriveError> {
    inner.mounted(space)?;
    let parent = folder_at(inner, space, folder)?;
    let top_name = source
        .name()
        .and_then(|name| name.to_str())
        .map(names::safe_local_name)
        .ok_or_else(|| DriveError::Invalid("Choose something with a name.".to_owned()))?;
    let here = rules_for(inner, space, parent.as_ref());
    if source.kind() == CopyKind::File {
        if never_synced_name(&top_name) {
            return Err(DriveError::Invalid(format!(
                "Misty keeps “{top_name}” on this computer only."
            )));
        }
        let mut file = source.open().map_err(DriveError::io)?;
        let (sha256, size) = inner.cache.put_reader(&inner.store, &mut file, |_| true)?;
        let free = unique_name(inner, space, parent.as_ref(), &top_name, None)?;
        let node = create_node(
            inner,
            space,
            parent,
            &free,
            Kind::File,
            Some((sha256, size)),
            time_ms(source.modified()),
            None,
            Some(&here),
        )?;
        return Ok((
            inner.entry(&node),
            CopyReport {
                files: 1,
                bytes: size,
                ..CopyReport::default()
            },
        ));
    }
    if source.kind() != CopyKind::Folder {
        return Err(DriveError::Invalid("Choose a file or a folder.".to_owned()));
    }
    let mut rules = DriveRules::default();
    let mut loaded: HashSet<PathBuf> = HashSet::new();
    let mut folders: Vec<String> = Vec::new();
    let mut files: Vec<CopiedFile> = Vec::new();
    let mut skipped = 0u64;
    let mut failure: Option<DriveError> = None;
    source
        .walk(&mut |step| {
            let relative = step.relative;
            let above = relative.parent().map(Path::to_path_buf).unwrap_or_default();
            if loaded.insert(above.clone()) {
                let at =
                    names::path_from_components(&above).unwrap_or_else(|_| names::ROOT.to_owned());
                read_rules(step.folder, &at, &mut rules);
            }
            let Ok(path) = names::path_from_components(relative) else {
                skipped += 1;
                return match step.kind {
                    CopyKind::Folder => CopyFlow::SkipFolder,
                    _ => CopyFlow::Continue,
                };
            };
            if (folders.len() + files.len()) as u64 >= MAX_COPY_ITEMS {
                failure = Some(DriveError::Invalid(format!(
                    "That has more than {MAX_COPY_ITEMS} items. Leave some out in .mistyignore."
                )));
                return CopyFlow::Stop;
            }
            match step.kind {
                CopyKind::Folder => {
                    if names::file_name(&path).eq_ignore_ascii_case(".git")
                        || rules.ignores(&path, true)
                    {
                        skipped += 1;
                        return CopyFlow::SkipFolder;
                    }
                    folders.push(path);
                }
                CopyKind::File => {
                    if rules.ignores(&path, false) {
                        skipped += 1;
                        return CopyFlow::Continue;
                    }
                    let Ok(mut file) = step.folder.open(step.name) else {
                        skipped += 1;
                        return CopyFlow::Continue;
                    };
                    match inner.cache.put_reader(&inner.store, &mut file, |_| true) {
                        Ok((sha256, size)) => files.push(CopiedFile {
                            path,
                            sha256,
                            size,
                            mtime_ms: time_ms(step.modified),
                        }),
                        Err(error) => {
                            failure = Some(error);
                            return CopyFlow::Stop;
                        }
                    }
                }
                CopyKind::Other => skipped += 1,
            }
            CopyFlow::Continue
        })
        .map_err(DriveError::io)?;
    if let Some(failure) = failure {
        return Err(failure);
    }
    let free = unique_name(inner, space, parent.as_ref(), &top_name, None)?;
    let top = create_node(
        inner,
        space,
        parent,
        &free,
        Kind::Folder,
        None,
        time_ms(source.modified()),
        None,
        Some(&here),
    )?;
    let mut report = CopyReport {
        skipped,
        folders: 1,
        ..CopyReport::default()
    };
    let mut made: HashMap<String, ItemId> = HashMap::new();
    made.insert(names::ROOT.to_owned(), top.id.clone());
    folders.sort_by_key(|path| (path.matches('/').count(), path.clone()));
    for path in folders {
        let Some(above) = made.get(&names::parent(&path)).cloned() else {
            report.skipped += 1;
            continue;
        };
        let name = unique_name(
            inner,
            space,
            Some(&above),
            &names::safe_local_name(names::file_name(&path)),
            None,
        )?;
        let folder = create_node(
            inner,
            space,
            Some(above),
            &name,
            Kind::Folder,
            None,
            now_ms(),
            None,
            Some(&here),
        )?;
        report.folders += 1;
        made.insert(path, folder.id);
    }
    for file in files {
        let Some(above) = made.get(&names::parent(&file.path)).cloned() else {
            report.skipped += 1;
            continue;
        };
        let name = unique_name(
            inner,
            space,
            Some(&above),
            &names::safe_local_name(names::file_name(&file.path)),
            None,
        )?;
        create_node(
            inner,
            space,
            Some(above),
            &name,
            Kind::File,
            Some((file.sha256, file.size)),
            file.mtime_ms,
            None,
            Some(&here),
        )?;
        report.files += 1;
        report.bytes += file.size;
    }
    Ok((inner.entry(&top), report))
}

pub(crate) async fn keep_downloaded(
    inner: &Arc<Inner>,
    space: &SpaceId,
    path: &str,
    keep: bool,
) -> Result<(), DriveError> {
    let path = names::drive_path(path).map_err(DriveError::Invalid)?;
    let node = inner
        .store
        .node_at(space, &path)?
        .ok_or(DriveError::NotFound)?;
    inner.store.set_pin(space, &node.id, keep)?;
    if keep && inner.cache.holds_files() {
        for file in inner.store.descendants(space, &node.id)? {
            if file.kind == Kind::File && !file.downloaded && !file.dirty() {
                content(inner, space, &file.id).await?;
            }
        }
    }
    Ok(())
}

pub(crate) fn remove_download(
    inner: &Inner,
    space: &SpaceId,
    path: &str,
) -> Result<(), DriveError> {
    let mounted = inner.mounted(space)?;
    let path = names::drive_path(path).map_err(DriveError::Invalid)?;
    let node = inner
        .store
        .node_at(space, &path)?
        .ok_or(DriveError::NotFound)?;
    inner.store.set_pin(space, &node.id, false)?;
    for mut file in inner.store.descendants(space, &node.id)? {
        let key: Key = (space.clone(), file.id.clone());
        if file.kind != Kind::File || file.dirty() || file.not_synced || inner.opens.is_open(&key) {
            continue;
        }
        if file
            .sha256
            .as_deref()
            .is_some_and(|sha| inner.cache.pinned(sha))
        {
            continue;
        }
        let _ = mounted.face.evict(space, &file.id);
        file.downloaded = false;
        inner.store.update_node(&file)?;
        if let Some(sha) = file.sha256.clone() {
            let users = inner.store.nodes_with_blob(&sha)?;
            inner.cache.drop_blob(&inner.store, &sha, || {
                users.iter().any(|user| {
                    user.dirty()
                        || user.not_synced
                        || (user.downloaded && user.id != file.id)
                        || inner.opens.is_open(&(user.space.clone(), user.id.clone()))
                })
            })?;
        }
    }
    Ok(())
}

fn server_path(inner: &Inner, space: &SpaceId, item: &Item) -> String {
    let mut parts = vec![item.name.clone()];
    let mut current = item.parent_id.clone();
    for _ in 0..256 {
        let Some(id) = current else {
            break;
        };
        match inner.store.node(space, &id).ok().flatten() {
            Some(node) => {
                return names::join(
                    &node.path,
                    &parts.into_iter().rev().collect::<Vec<_>>().join("/"),
                );
            }
            None => match inner.store.item(space, &id).ok().flatten() {
                Some(parent) => {
                    parts.push(parent.name.clone());
                    current = parent.parent_id.clone();
                }
                None => break,
            },
        }
    }
    format!("/{}", parts.into_iter().rev().collect::<Vec<_>>().join("/"))
}

pub(crate) async fn trash_list(
    inner: &Arc<Inner>,
    space: &SpaceId,
    after: Option<&str>,
    limit: u32,
) -> Result<(Vec<TrashEntry>, Option<String>), DriveError> {
    let page = inner.api.trash_list(space, after, limit).await?;
    let entries = page
        .items
        .into_iter()
        .map(|item| {
            inner.store.put_item(&item).ok();
            TrashEntry {
                entry: DriveEntry {
                    id: item.id.clone(),
                    space_id: space.clone(),
                    path: server_path(inner, space, &item),
                    name: item.name.clone(),
                    kind: item.kind,
                    size: item.size,
                    mtime_ms: item.mtime_ms,
                    modified_by_name: item.modified_by_name.clone(),
                    state: LocalState::Online,
                    keep_downloaded: false,
                    in_use: Vec::new(),
                    version: Some(item.version),
                    content_version: item.content_version,
                    sha: item.sha256.clone(),
                    waits_large: false,
                },
                trashed_at: item.trashed_at.clone(),
                trashed_by_name: Some(item.modified_by_name.clone()),
            }
        })
        .collect();
    Ok((entries, page.next_after))
}
