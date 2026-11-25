#![allow(dead_code, clippy::disallowed_methods, clippy::disallowed_types)]

use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use bytes::Bytes;
use futures_util::{future::BoxFuture, StreamExt};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use space_drive::api::{ByteStream, Method, Request, Response};
use space_drive::ignore::{IGNORE_FILE, TRASH_FOLDER};
use space_drive::names::{fold, split_extension};
use space_drive::{
    ChangedEntry, Device, Drive, DriveConfig, DriveStatus, Events, Http, HttpError, Item, ItemId,
    Kind, Notice, Seq, SpaceId, SpaceMount, Version,
};

pub const SPACE: &str = "space-1";

#[derive(Clone)]
struct Mark {
    item: String,
    user: String,
    user_name: String,
    device_id: String,
    device_name: String,
    editing: bool,
    expires: Instant,
}

#[derive(Default)]
struct State {
    items: HashMap<String, Item>,
    seq: i64,
    blobs: HashMap<String, Vec<u8>>,
    uploads: HashMap<String, (String, u64)>,
    marks: Vec<Mark>,
    content_version: HashMap<String, i64>,
    accepted: HashSet<String>,
    origins: HashMap<String, (Option<ItemId>, String)>,
    next: u64,
}

pub struct Computer {
    pub user: String,
    pub name: String,
    pub device: Device,
    pub offline: AtomicBool,
    pub lose_next_reply: AtomicBool,
    pub drive: Mutex<Option<Drive>>,
    pub notices: Mutex<Vec<Notice>>,
}

pub struct FakeServer {
    state: Mutex<State>,
    pub computers: Mutex<Vec<Arc<Computer>>>,
    counter: AtomicU64,
}

fn now_text() -> String {
    "2026-11-20T12:00:00Z".to_owned()
}

fn sha_of(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn reply(status: u16, body: Value) -> Response {
    Response {
        status,
        headers: vec![("content-type".into(), "application/json".into())],
        body: body.to_string().into_bytes(),
    }
}

fn no_content() -> Response {
    Response {
        status: 204,
        headers: Vec::new(),
        body: Vec::new(),
    }
}

fn decode(segment: &str) -> String {
    percent_encoding::percent_decode_str(segment)
        .decode_utf8_lossy()
        .into_owned()
}

fn header<'a>(request: &'a Request, name: &str) -> Option<&'a str> {
    request
        .headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

fn stem_and_extension(name: &str, kind: Kind) -> (&str, String) {
    match (kind, split_extension(name)) {
        (Kind::File, (stem, Some(extension))) => (stem, format!(".{extension}")),
        _ => (name, String::new()),
    }
}

fn spaced(name: &str, kind: Kind, n: usize) -> String {
    if n < 2 {
        return name.to_owned();
    }
    let (stem, extension) = stem_and_extension(name, kind);
    format!("{stem} {n}{extension}")
}

fn labeled(name: &str, kind: Kind, label: &str, n: usize) -> String {
    let (stem, extension) = stem_and_extension(name, kind);
    if n > 1 {
        format!("{stem} ({label} {n}){extension}")
    } else {
        format!("{stem} ({label}){extension}")
    }
}

fn is_root_ignore(parent: Option<&ItemId>, kind: Kind, name: &str) -> bool {
    parent.is_none() && kind == Kind::File && name.eq_ignore_ascii_case(IGNORE_FILE)
}

fn is_root_trash_name(parent: Option<&ItemId>, name: &str) -> bool {
    parent.is_none() && fold(name) == fold(TRASH_FOLDER)
}

fn mark_json(mark: &Mark) -> Value {
    json!({ "user_id": mark.user, "name": mark.user_name,
    "device_name": mark.device_name, "editing": mark.editing })
}

impl State {
    fn next_seq(&mut self) -> i64 {
        self.seq += 1;
        self.seq
    }

    fn next_id(&mut self) -> ItemId {
        self.next += 1;
        ItemId(format!("drv_00000000-0000-4000-9000-{:012}", self.next))
    }

    fn within(&self, id: &str, ancestor: &str) -> bool {
        let mut current = Some(id.to_owned());
        let mut depth = 0;
        while let Some(at) = current {
            if at == ancestor {
                return true;
            }
            depth += 1;
            if depth > 1000 {
                return false;
            }
            current = self
                .items
                .get(&at)
                .and_then(|item| item.parent_id.as_ref().map(|parent| parent.0.clone()));
        }
        false
    }

    fn trash_folder(&self) -> Option<String> {
        self.items
            .values()
            .find(|item| {
                !item.deleted
                    && item.kind == Kind::Folder
                    && is_root_trash_name(item.parent_id.as_ref(), &item.name)
            })
            .map(|item| item.id.0.clone())
    }

    fn top(&self, id: &str) -> Option<String> {
        let mut current = id.to_owned();
        for _ in 0..1000 {
            let item = self.items.get(&current)?;
            match &item.parent_id {
                Some(parent) => current = parent.0.clone(),
                None => return Some(current),
            }
        }
        None
    }

    fn under_trash(&self, parent: Option<&ItemId>) -> bool {
        match (parent, self.trash_folder()) {
            (Some(parent), Some(trash)) => self.top(&parent.0).as_deref() == Some(trash.as_str()),
            _ => false,
        }
    }

    fn in_trash(&self, id: &str) -> bool {
        self.items
            .get(id)
            .is_some_and(|item| !item.deleted && self.under_trash(item.parent_id.as_ref()))
    }

    fn name_taken(
        &self,
        parent: Option<&ItemId>,
        name: &str,
        except: Option<&str>,
    ) -> Option<Item> {
        self.items
            .values()
            .find(|item| {
                item.parent_id.as_ref() == parent
                    && !item.deleted
                    && Some(item.id.0.as_str()) != except
                    && fold(&item.name) == fold(name)
            })
            .cloned()
    }

    fn free_name(
        &self,
        parent: Option<&ItemId>,
        name: &str,
        kind: Kind,
        except: Option<&str>,
    ) -> String {
        let mut n = 1;
        loop {
            let candidate = spaced(name, kind, n);
            if self.name_taken(parent, &candidate, except).is_none() {
                return candidate;
            }
            n += 1;
        }
    }

    fn live_marks(&mut self) {
        let now = Instant::now();
        self.marks.retain(|mark| mark.expires > now);
    }

    fn open_in(&mut self, id: &str) -> Vec<Value> {
        self.live_marks();
        self.marks
            .iter()
            .filter(|mark| self.within(&mark.item, id))
            .map(mark_json)
            .collect()
    }

    fn open_elsewhere(&mut self, id: &str, device: &str) -> Vec<Value> {
        self.live_marks();
        self.marks
            .iter()
            .filter(|mark| mark.device_id != device && self.within(&mark.item, id))
            .map(mark_json)
            .collect()
    }

    fn ensure_trash(&mut self, space: &str, by: &Computer) -> String {
        if let Some(id) = self.trash_folder() {
            return id;
        }
        if let Some(holder) = self.name_taken(None, TRASH_FOLDER, None) {
            let name = self.free_name(
                None,
                &format!("{TRASH_FOLDER} (renamed)"),
                Kind::Folder,
                Some(&holder.id.0),
            );
            let mut moved = holder.clone();
            moved.name = name;
            moved.version = Version(moved.version.0 + 1);
            moved.seq = Seq(self.next_seq());
            self.items.insert(moved.id.0.clone(), moved);
        }
        let id = self.next_id();
        let folder = Item {
            id: id.clone(),
            space_id: SpaceId(space.to_owned()),
            parent_id: None,
            name: TRASH_FOLDER.to_owned(),
            kind: Kind::Folder,
            sha256: None,
            size: 0,
            mtime_ms: 0,
            version: Version(1),
            seq: Seq(self.next_seq()),
            modified_by: by.user.clone(),
            modified_by_name: by.name.clone(),
            modified_at: now_text(),
            trashed_at: None,
            trashed_by: None,
            deleted: false,
            replaced_of: None,
            content_version: None,
        };
        self.content_version.insert(id.0.clone(), 1);
        self.items.insert(id.0.clone(), folder);
        id.0
    }

    fn keep_replaced(&mut self, space: &str, current: &Item) -> Item {
        let label = "conflicted copy 2026-11-20 1200";
        let mut n = 1;
        let mut name = labeled(&current.name, Kind::File, label, n);
        while self
            .name_taken(current.parent_id.as_ref(), &name, None)
            .is_some()
        {
            n += 1;
            name = labeled(&current.name, Kind::File, label, n);
        }
        let id = self.next_id();
        let copy = Item {
            id,
            space_id: SpaceId(space.to_owned()),
            parent_id: current.parent_id.clone(),
            name,
            kind: Kind::File,
            sha256: current.sha256.clone(),
            size: current.size,
            mtime_ms: current.mtime_ms,
            version: Version(1),
            seq: Seq(self.next_seq()),
            modified_by: current.modified_by.clone(),
            modified_by_name: current.modified_by_name.clone(),
            modified_at: current.modified_at.clone(),
            trashed_at: None,
            trashed_by: None,
            deleted: false,
            replaced_of: Some(current.id.clone()),
            content_version: None,
        };
        self.content_version.insert(copy.id.0.clone(), 1);
        self.items.insert(copy.id.0.clone(), copy.clone());
        copy
    }

    fn move_into_trash(&mut self, id: &str, trash: &str, by: &Computer) -> Item {
        let mut next = self.items[id].clone();
        let into = ItemId(trash.to_owned());
        self.origins
            .insert(id.to_owned(), (next.parent_id.clone(), next.name.clone()));
        next.name = self.free_name(Some(&into), &next.name, next.kind, Some(id));
        next.parent_id = Some(into);
        next.trashed_at = Some(now_text());
        next.trashed_by = Some(by.user.clone());
        next.version = Version(next.version.0 + 1);
        next.seq = Seq(self.next_seq());
        self.items.insert(id.to_owned(), next.clone());
        next
    }

    fn restore(&mut self, id: &str, by: &Computer) -> Item {
        let trash = self.trash_folder();
        let mut item = self.items[id].clone();
        let (from, mut wanted) = self
            .origins
            .remove(id)
            .unwrap_or((None, item.name.clone()));
        let target = from.filter(|parent| {
            self.items
                .get(&parent.0)
                .is_some_and(|folder| !folder.deleted && folder.kind == Kind::Folder)
                && Some(&parent.0) != trash.as_ref()
                && !self.in_trash(&parent.0)
        });
        if item.kind == Kind::File
            && (is_root_ignore(target.as_ref(), item.kind, &wanted)
                || is_root_trash_name(target.as_ref(), &wanted))
        {
            wanted = labeled(&wanted, item.kind, "restored", 1);
        }
        let mut name = wanted.clone();
        let mut n = 1;
        while self.name_taken(target.as_ref(), &name, Some(id)).is_some() {
            name = labeled(&wanted, item.kind, "restored", n);
            n += 1;
        }
        item.parent_id = target;
        item.name = name;
        item.trashed_at = None;
        item.trashed_by = None;
        item.modified_by = by.user.clone();
        item.modified_by_name = by.name.clone();
        item.modified_at = now_text();
        item.version = Version(item.version.0 + 1);
        item.seq = Seq(self.next_seq());
        self.items.insert(id.to_owned(), item.clone());
        item
    }

    fn purge(&mut self, id: &str) {
        let subtree: Vec<String> = self
            .items
            .values()
            .filter(|item| !item.deleted && self.within(&item.id.0, id))
            .map(|item| item.id.0.clone())
            .collect();
        self.marks
            .retain(|mark| !subtree.iter().any(|gone| gone == &mark.item));
        for gone in subtree {
            self.origins.remove(&gone);
            let seq = self.next_seq();
            let item = self.items.get_mut(&gone).unwrap();
            item.deleted = true;
            item.parent_id = None;
            item.trashed_at = None;
            item.trashed_by = None;
            item.version = Version(item.version.0 + 1);
            item.seq = Seq(seq);
        }
    }

    fn path_of(&self, item: &Item) -> String {
        let mut parts = vec![item.name.clone()];
        let mut current = item.parent_id.clone();
        while let Some(parent) = current {
            let Some(folder) = self.items.get(&parent.0) else {
                break;
            };
            parts.push(folder.name.clone());
            current = folder.parent_id.clone();
        }
        parts.reverse();
        format!("/{}", parts.join("/"))
    }
}

pub struct Session {
    server: Arc<FakeServer>,
    computer: Arc<Computer>,
}

impl FakeServer {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State::default()),
            computers: Mutex::new(Vec::new()),
            counter: AtomicU64::new(0),
        })
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap()
    }

    pub fn accepted(&self) -> HashSet<String> {
        self.state().accepted.clone()
    }

    pub fn trash_id(&self) -> Option<String> {
        self.state().trash_folder()
    }

    pub fn trashed_items(&self) -> Vec<Item> {
        let state = self.state();
        state
            .items
            .values()
            .filter(|item| state.in_trash(&item.id.0))
            .cloned()
            .collect()
    }

    pub fn replaced_copies(&self) -> Vec<Item> {
        self.state()
            .items
            .values()
            .filter(|item| !item.deleted && item.replaced_of.is_some())
            .cloned()
            .collect()
    }

    pub fn all_contents(&self) -> Vec<String> {
        let state = self.state();
        state
            .items
            .values()
            .filter(|item| !item.deleted && item.kind == Kind::File)
            .map(|item| {
                item.sha256
                    .as_ref()
                    .and_then(|sha| state.blobs.get(sha))
                    .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
                    .unwrap_or_default()
            })
            .collect()
    }

    pub fn content_of(&self, item: &Item) -> String {
        let state = self.state();
        item.sha256
            .as_ref()
            .and_then(|sha| state.blobs.get(sha))
            .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
            .unwrap_or_default()
    }

    pub fn live_tree(&self) -> HashMap<String, (Kind, Option<String>)> {
        let state = self.state();
        let trash = state.trash_folder();
        state
            .items
            .values()
            .filter(|item| {
                !item.deleted
                    && Some(&item.id.0) != trash.as_ref()
                    && !state.in_trash(&item.id.0)
            })
            .map(|item| (state.path_of(item), (item.kind, item.sha256.clone())))
            .collect()
    }

    pub fn whole_tree(&self) -> HashMap<String, (Kind, Option<String>)> {
        let state = self.state();
        state
            .items
            .values()
            .filter(|item| !item.deleted)
            .map(|item| (state.path_of(item), (item.kind, item.sha256.clone())))
            .collect()
    }

    pub fn item_named(&self, name: &str) -> Option<Item> {
        self.state()
            .items
            .values()
            .find(|item| item.name == name)
            .cloned()
    }

    pub fn trashed_ids(&self) -> HashSet<String> {
        self.trashed_items()
            .into_iter()
            .map(|item| item.id.0)
            .collect()
    }

    pub fn head(&self) -> i64 {
        self.state().seq
    }

    pub fn computer(self: &Arc<Self>, user: &str, name: &str, device_name: &str) -> Arc<Computer> {
        let number = self.counter.fetch_add(1, Ordering::SeqCst);
        let computer = Arc::new(Computer {
            user: user.to_owned(),
            name: name.to_owned(),
            device: Device {
                id: format!("dev_00000000-0000-4000-8000-{number:012}"),
                name: device_name.to_owned(),
            },
            offline: AtomicBool::new(false),
            lose_next_reply: AtomicBool::new(false),
            drive: Mutex::new(None),
            notices: Mutex::new(Vec::new()),
        });
        self.computers.lock().unwrap().push(computer.clone());
        computer
    }

    pub fn open_drive(
        self: &Arc<Self>,
        computer: &Arc<Computer>,
        dir: PathBuf,
        runtime: tokio::runtime::Handle,
    ) -> Drive {
        let mut config =
            DriveConfig::new(dir.clone(), computer.user.clone(), computer.device.clone());
        config.person_name = Some(computer.name.clone());
        config.patient = false;
        config.background = false;
        config.content_in_cache = true;
        config.in_use_wait_cap = Duration::ZERO;
        let http = Arc::new(Session {
            server: self.clone(),
            computer: computer.clone(),
        });
        let events = Arc::new(Recorder {
            computer: computer.clone(),
        });
        let drive = Drive::start(config, http, events, runtime).expect("drive opens");
        drive
            .mount(
                SpaceMount {
                    space: SpaceId(SPACE.into()),
                    name: "Space".into(),
                    mount_name: "Space".into(),
                    path: dir.join("mnt"),
                    domain: format!("{}.{SPACE}", computer.user),
                },
                Arc::new(space_drive::face::NoFace),
            )
            .expect("mounts");
        *computer.drive.lock().unwrap() = Some(drive.clone());
        drive
    }

    async fn check_in_use(&self, from: &Computer, item: &str) {
        let others: Vec<Arc<Computer>> = self
            .computers
            .lock()
            .unwrap()
            .iter()
            .filter(|other| {
                other.device.id != from.device.id && !other.offline.load(Ordering::SeqCst)
            })
            .cloned()
            .collect();
        for other in others {
            let drive = other.drive.lock().unwrap().clone();
            if let Some(drive) = drive {
                drive
                    .realtime(
                        &SpaceId(SPACE.into()),
                        "drive.in_use_check",
                        &json!({ "item_id": item }),
                        Some(Duration::ZERO),
                    )
                    .await;
            }
        }
    }

    fn handle(&self, computer: &Computer, request: &Request) -> Response {
        let (path, query) = request
            .path
            .split_once('?')
            .unwrap_or((request.path.as_str(), ""));
        let parts: Vec<String> = path
            .split('/')
            .filter(|p| !p.is_empty())
            .map(decode)
            .collect();
        let parts: Vec<&str> = parts.iter().map(String::as_str).collect();
        let body: Value = request
            .body
            .as_deref()
            .map(|body| serde_json::from_slice(body).unwrap_or(Value::Null))
            .unwrap_or(Value::Null);
        let query: HashMap<String, String> = query
            .split('&')
            .filter_map(|pair| pair.split_once('='))
            .map(|(k, v)| (k.to_owned(), decode(v)))
            .collect();
        if parts == ["me"] {
            return reply(200, json!({ "id": computer.user, "name": computer.name }));
        }
        let writes = request.method != Method::Get;
        if writes && header(request, "X-Misty-Device").is_none() {
            return reply(400, json!({ "code": "device_required" }));
        }
        let if_match = header(request, "If-Match").and_then(|v| v.parse::<i64>().ok());
        let mut state = self.state();
        match (request.method, parts.as_slice()) {
            (Method::Get, ["spaces", _, "drive", "changes"]) => {
                let since: i64 = query.get("since").and_then(|v| v.parse().ok()).unwrap_or(0);
                let limit: usize = query
                    .get("limit")
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(500);
                let mut items: Vec<Item> = state
                    .items
                    .values()
                    .filter(|item| item.seq.0 > since)
                    .cloned()
                    .collect();
                items.sort_by_key(|item| item.seq);
                let more = items.len() > limit;
                items.truncate(limit);
                let next = if more {
                    items.last().map(|item| item.seq.0).unwrap_or(since)
                } else {
                    state.seq.max(since)
                };
                reply(
                    200,
                    json!({ "items": items, "next_since": next, "more": more, "head": state.seq }),
                )
            }
            (Method::Get, ["spaces", _, "drive", "items", id]) => match state.items.get(*id) {
                Some(item) => reply(200, json!(item)),
                None => reply(404, json!({ "code": "not_found" })),
            },
            (Method::Post, ["spaces", _, "drive", "uploads"]) => {
                let sha = body["sha256"].as_str().unwrap_or_default().to_owned();
                let size = body["size"].as_u64().unwrap_or(0);
                state.next += 1;
                let upload = format!("up_{}", state.next);
                if state.blobs.contains_key(&sha) {
                    return reply(200, json!({ "upload_id": upload, "present": true }));
                }
                state.uploads.insert(upload.clone(), (sha, size));
                reply(
                    200,
                    json!({ "upload_id": upload,
                    "single": { "url": format!("fake://put/{upload}"), "method": "PUT", "headers": {} } }),
                )
            }
            (Method::Post, ["spaces", _, "drive", "uploads", _, "complete"]) => {
                reply(200, json!({ "upload_id": parts[4] }))
            }
            (Method::Post, ["spaces", space, "drive", "items"]) => {
                let id = body["id"].as_str().unwrap_or_default().to_owned();
                let parent = body["parent_id"].as_str().map(|p| ItemId(p.to_owned()));
                let name = body["name"].as_str().unwrap_or_default().to_owned();
                let kind = if body["kind"] == "folder" {
                    Kind::Folder
                } else {
                    Kind::File
                };
                let sha = body["sha256"].as_str().map(str::to_owned);
                if let Some(existing) = state.items.get(&id) {
                    let same = existing.parent_id == parent
                        && existing.name == name
                        && existing.kind == kind
                        && existing.sha256 == sha;
                    return if same {
                        reply(200, json!(existing))
                    } else {
                        reply(409, json!({ "code": "id_taken" }))
                    };
                }
                if let Some(parent) = &parent {
                    match state.items.get(&parent.0) {
                        None => return reply(404, json!({ "code": "parent_missing" })),
                        Some(folder) if folder.deleted => {
                            return reply(404, json!({ "code": "parent_missing" }))
                        }
                        Some(folder) if folder.kind != Kind::Folder => {
                            return reply(409, json!({ "code": "parent_not_folder" }))
                        }
                        Some(_) => {}
                    }
                }
                if let Some(taken) = state.name_taken(parent.as_ref(), &name, None) {
                    return reply(409, json!({ "code": "name_taken", "item": taken }));
                }
                if kind == Kind::File {
                    let sha = sha.clone().unwrap_or_default();
                    if sha != space_drive::transfer::EMPTY_SHA256 && !state.blobs.contains_key(&sha)
                    {
                        return reply(409, json!({ "code": "blob_missing" }));
                    }
                    state.accepted.insert(sha);
                }
                let seq = state.next_seq();
                let item = Item {
                    id: ItemId(id.clone()),
                    space_id: SpaceId((*space).to_owned()),
                    parent_id: parent,
                    name,
                    kind,
                    sha256: if kind == Kind::File { sha } else { None },
                    size: body["size"].as_u64().unwrap_or(0),
                    mtime_ms: body["mtime_ms"].as_i64().unwrap_or(0),
                    version: Version(1),
                    seq: Seq(seq),
                    modified_by: computer.user.clone(),
                    modified_by_name: computer.name.clone(),
                    modified_at: now_text(),
                    trashed_at: None,
                    trashed_by: None,
                    deleted: false,
                    replaced_of: None,
                    content_version: None,
                };
                state.content_version.insert(id.clone(), 1);
                state.items.insert(id, item.clone());
                reply(201, json!(item))
            }
            (Method::Patch, ["spaces", space, "drive", "items", id]) => {
                let Some(current) = state.items.get(*id).cloned() else {
                    return reply(404, json!({ "code": "not_found" }));
                };
                if current.deleted {
                    return reply(404, json!({ "code": "not_found" }));
                }
                if let Some(if_match) = if_match {
                    if current.version.0 != if_match {
                        return reply(409, json!({ "code": "version_conflict", "item": current }));
                    }
                }
                let device = header(request, "X-Misty-Device")
                    .unwrap_or_default()
                    .to_owned();
                let mut next = current.clone();
                if let Some(name) = body.get("name").and_then(Value::as_str) {
                    next.name = name.to_owned();
                }
                let replace = body["replace"].as_bool().unwrap_or(false);
                if body.get("parent_id").is_some() {
                    next.parent_id = body["parent_id"].as_str().map(|p| ItemId(p.to_owned()));
                    if let Some(parent) = &next.parent_id {
                        if state.within(&parent.0, id) {
                            return reply(409, json!({ "code": "invalid_move" }));
                        }
                        if state
                            .items
                            .get(&parent.0)
                            .is_none_or(|folder| folder.deleted)
                        {
                            return reply(404, json!({ "code": "parent_missing" }));
                        }
                    }
                }
                let trash = state.trash_folder();
                let was_ignore =
                    is_root_ignore(current.parent_id.as_ref(), current.kind, &current.name);
                let becomes_ignore =
                    is_root_ignore(next.parent_id.as_ref(), next.kind, &next.name);
                let is_trash = Some(&current.id.0) == trash.as_ref();
                let place_changes =
                    next.name != current.name || next.parent_id != current.parent_id;
                if (was_ignore && !becomes_ignore)
                    || (is_trash && place_changes)
                    || (!is_trash
                        && is_root_trash_name(next.parent_id.as_ref(), &next.name)
                        && !is_root_trash_name(current.parent_id.as_ref(), &current.name))
                {
                    return reply(409, json!({ "code": "protected" }));
                }
                let moves = next.parent_id != current.parent_id;
                let was_in = state.under_trash(current.parent_id.as_ref());
                let now_in = state.under_trash(next.parent_id.as_ref());
                if moves && !was_in && now_in {
                    let who = state.open_elsewhere(id, &device);
                    if !who.is_empty() {
                        return reply(423, json!({ "code": "in_use", "who": who }));
                    }
                }
                let into_trash = moves
                    && trash.is_some()
                    && next.parent_id.as_ref().map(|parent| &parent.0) == trash.as_ref();
                if into_trash && !replace {
                    next.name = state.free_name(
                        next.parent_id.as_ref(),
                        &next.name,
                        next.kind,
                        Some(id),
                    );
                }
                let moved = next.name != current.name || next.parent_id != current.parent_id;
                let holder = if moved {
                    state.name_taken(next.parent_id.as_ref(), &next.name, Some(id))
                } else {
                    None
                };
                if let Some(holder) = &holder {
                    if replace
                        && (Some(&holder.id.0) == trash.as_ref()
                            || is_root_ignore(holder.parent_id.as_ref(), holder.kind, &holder.name))
                    {
                        return reply(409, json!({ "code": "protected" }));
                    }
                    if !replace {
                        return reply(409, json!({ "code": "name_taken", "item": holder }));
                    }
                    if state.in_trash(&holder.id.0) {
                        return reply(409, json!({ "code": "trashed", "item": holder }));
                    }
                    let who = state.open_in(&holder.id.0);
                    if !who.is_empty() {
                        return reply(423, json!({ "code": "in_use", "who": who }));
                    }
                }
                let new_sha = body
                    .get("sha256")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                if let Some(sha) = &new_sha {
                    if sha != space_drive::transfer::EMPTY_SHA256 && !state.blobs.contains_key(sha)
                    {
                        return reply(409, json!({ "code": "blob_missing" }));
                    }
                }
                if let Some(holder) = holder {
                    let bin = state.ensure_trash(space, computer);
                    state.move_into_trash(&holder.id.0, &bin, computer);
                }
                if moves && (was_in || now_in) {
                    let directly_in = into_trash;
                    let was_directly = current.parent_id.as_ref().map(|parent| &parent.0)
                        == trash.as_ref()
                        && trash.is_some();
                    if directly_in {
                        if !was_directly {
                            let origin = if was_in {
                                None
                            } else {
                                current.parent_id.clone()
                            };
                            state
                                .origins
                                .insert((*id).to_owned(), (origin, current.name.clone()));
                            next.trashed_at = Some(now_text());
                            next.trashed_by = Some(computer.user.clone());
                        }
                    } else {
                        state.origins.remove(*id);
                        next.trashed_at = None;
                        next.trashed_by = None;
                    }
                }
                let mut replaced = Value::Null;
                if let Some(sha) = new_sha {
                    let changes = current.sha256.as_deref() != Some(sha.as_str());
                    let seen = body["base_version"]
                        .as_i64()
                        .or(if_match)
                        .is_some_and(|base| {
                            base >= state.content_version.get(*id).copied().unwrap_or(1)
                        });
                    if changes && !seen && current.size > 0 {
                        replaced = json!(state.keep_replaced(space, &current));
                    }
                    state.accepted.insert(sha.clone());
                    next.sha256 = Some(sha);
                    next.size = body["size"].as_u64().unwrap_or(0);
                    next.mtime_ms = body["mtime_ms"].as_i64().unwrap_or(0);
                    if changes {
                        state
                            .content_version
                            .insert((*id).to_owned(), next.version.0 + 1);
                    }
                }
                next.version = Version(next.version.0 + 1);
                next.seq = Seq(state.next_seq());
                next.modified_by = computer.user.clone();
                next.modified_by_name = computer.name.clone();
                state.items.insert((*id).to_owned(), next.clone());
                let mut answer = json!(next);
                answer["replaced"] = replaced;
                reply(200, answer)
            }
            (Method::Post, ["spaces", _, "drive", "items", _, "check-in-use"]) => {
                reply(200, json!({ "wait_ms": 0 }))
            }
            (Method::Post, ["spaces", space, "drive", "items", id, "trash"]) => {
                let Some(current) = state.items.get(*id).cloned().filter(|item| !item.deleted)
                else {
                    return reply(404, json!({ "code": "not_found" }));
                };
                if let Some(if_match) = if_match {
                    if current.version.0 != if_match {
                        return reply(409, json!({ "code": "version_conflict", "item": current }));
                    }
                }
                if is_root_ignore(current.parent_id.as_ref(), current.kind, &current.name)
                    || state.trash_folder().as_deref() == Some(*id)
                {
                    return reply(409, json!({ "code": "protected" }));
                }
                if state.in_trash(id) {
                    return reply(409, json!({ "code": "trashed", "item": current }));
                }
                let device = header(request, "X-Misty-Device")
                    .unwrap_or_default()
                    .to_owned();
                let who = state.open_elsewhere(id, &device);
                if !who.is_empty() {
                    return reply(423, json!({ "code": "in_use", "who": who }));
                }
                let bin = state.ensure_trash(space, computer);
                let next = state.move_into_trash(id, &bin, computer);
                reply(200, json!(next))
            }
            (Method::Post, ["spaces", _, "drive", "items", id, "restore"]) => {
                let Some(item) = state.items.get(*id).cloned().filter(|item| !item.deleted) else {
                    return reply(404, json!({ "code": "not_found" }));
                };
                if let Some(if_match) = if_match {
                    if item.version.0 != if_match {
                        return reply(409, json!({ "code": "version_conflict", "item": item }));
                    }
                }
                let trash = state.trash_folder();
                if trash.is_none() || item.parent_id.as_ref().map(|parent| &parent.0) != trash.as_ref()
                {
                    return reply(409, json!({ "code": "not_trashed" }));
                }
                let item = state.restore(id, computer);
                reply(200, json!(item))
            }
            (Method::Get, ["spaces", _, "drive", "items", id, "content"]) => {
                match state.items.get(*id) {
                    Some(item) if item.size == 0 => {
                        reply(200, json!({ "url": "", "expires_at": now_text() }))
                    }
                    Some(item) => reply(
                        200,
                        json!({ "url": format!("fake://get/{}", item.sha256.clone().unwrap_or_default()),
                    "expires_at": now_text() }),
                    ),
                    None => reply(404, json!({ "code": "not_found" })),
                }
            }
            (Method::Put, ["spaces", _, "drive", "items", id, "in-use"]) => {
                if !state.items.contains_key(*id) {
                    return reply(404, json!({ "code": "not_found" }));
                }
                let device = header(request, "X-Misty-Device")
                    .unwrap_or_default()
                    .to_owned();
                let editing = body["editing"].as_bool().unwrap_or(false);
                state
                    .marks
                    .retain(|mark| !(mark.item == *id && mark.device_id == device));
                state.marks.push(Mark {
                    item: (*id).to_owned(),
                    user: computer.user.clone(),
                    user_name: computer.name.clone(),
                    device_id: device,
                    device_name: computer.device.name.clone(),
                    editing,
                    expires: Instant::now() + Duration::from_secs(120),
                });
                reply(200, json!({ "expires_at": now_text() }))
            }
            (Method::Get, ["spaces", _, "drive", "in-use"]) => {
                let now = Instant::now();
                let marks: Vec<Value> = state
                    .marks
                    .iter()
                    .filter(|mark| mark.expires > now)
                    .map(|mark| {
                        let left = chrono::Duration::from_std(mark.expires - now).unwrap_or_default();
                        json!({ "item_id": mark.item, "user_id": mark.user, "name": mark.user_name,
                            "device_id": mark.device_id, "device_name": mark.device_name,
                            "editing": mark.editing, "expires_at": (chrono::Utc::now() + left).to_rfc3339() })
                    })
                    .collect();
                reply(200, json!({ "marks": marks }))
            }
            (Method::Delete, ["spaces", _, "drive", "items", id, "in-use"]) => {
                let device = header(request, "X-Misty-Device")
                    .unwrap_or_default()
                    .to_owned();
                state
                    .marks
                    .retain(|mark| !(mark.item == *id && mark.device_id == device));
                no_content()
            }
            (Method::Delete, ["spaces", _, "drive", "items", id]) => {
                if !state.items.get(*id).is_some_and(|item| !item.deleted) {
                    return reply(404, json!({ "code": "not_found" }));
                }
                if !state.in_trash(id) {
                    return reply(409, json!({ "code": "not_trashed" }));
                }
                state.purge(id);
                no_content()
            }
            _ => reply(404, json!({ "code": "not_found" })),
        }
    }
}

impl Http for Session {
    fn api(&self, request: Request) -> BoxFuture<'_, Result<Response, HttpError>> {
        Box::pin(async move {
            if self.computer.offline.load(Ordering::SeqCst) {
                return Err(HttpError::Offline);
            }
            let check = request.method == Method::Post && request.path.ends_with("/check-in-use");
            if check {
                let item = request
                    .path
                    .trim_end_matches("/check-in-use")
                    .rsplit('/')
                    .next()
                    .map(decode)
                    .unwrap_or_default();
                self.server.check_in_use(&self.computer, &item).await;
            }
            let response = self.server.handle(&self.computer, &request);
            let changes = request.method != Method::Get
                && !request.path.contains("/in-use")
                && !request.path.contains("/uploads")
                && !request.path.ends_with("/check-in-use");
            if changes && self.computer.lose_next_reply.swap(false, Ordering::SeqCst) {
                return Err(HttpError::Offline);
            }
            Ok(response)
        })
    }

    fn put_blob(
        &self,
        url: String,
        _method: String,
        _headers: Vec<(String, String)>,
        _length: u64,
        mut body: ByteStream,
    ) -> BoxFuture<'_, Result<Response, HttpError>> {
        Box::pin(async move {
            if self.computer.offline.load(Ordering::SeqCst) {
                return Err(HttpError::Offline);
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = body.next().await {
                bytes.extend_from_slice(&chunk.map_err(|_| HttpError::Offline)?);
            }
            let upload = url.trim_start_matches("fake://put/").to_owned();
            let mut state = self.server.state();
            let Some((sha, size)) = state.uploads.get(&upload).cloned() else {
                return Ok(Response {
                    status: 403,
                    headers: Vec::new(),
                    body: Vec::new(),
                });
            };
            if sha_of(&bytes) != sha || bytes.len() as u64 != size {
                return Ok(Response {
                    status: 400,
                    headers: Vec::new(),
                    body: Vec::new(),
                });
            }
            state.blobs.insert(sha, bytes);
            Ok(Response {
                status: 200,
                headers: vec![("etag".into(), "\"e\"".into())],
                body: Vec::new(),
            })
        })
    }

    fn get_blob(&self, url: String) -> BoxFuture<'_, Result<(u16, ByteStream), HttpError>> {
        Box::pin(async move {
            if self.computer.offline.load(Ordering::SeqCst) {
                return Err(HttpError::Offline);
            }
            let sha = url.trim_start_matches("fake://get/").to_owned();
            let bytes = self.server.state().blobs.get(&sha).cloned();
            match bytes {
                Some(bytes) => {
                    let stream: ByteStream =
                        Box::pin(futures_util::stream::iter(vec![Ok(Bytes::from(bytes))]));
                    Ok((200, stream))
                }
                None => Ok((404, Box::pin(futures_util::stream::empty()) as ByteStream)),
            }
        })
    }
}

struct Recorder {
    computer: Arc<Computer>,
}

impl Events for Recorder {
    fn status(&self, _status: &DriveStatus) {}
    fn changed(&self, _space: &SpaceId, _entries: &[ChangedEntry]) {}
    fn notice(&self, notice: &Notice) {
        self.computer.notices.lock().unwrap().push(notice.clone());
    }
}

pub fn space() -> SpaceId {
    SpaceId(SPACE.into())
}

pub fn staged(drive: &Drive, bytes: &[u8]) -> PathBuf {
    let path = drive.temp_path();
    std::fs::write(&path, bytes).unwrap();
    path
}

pub fn folder_id(drive: &Drive, path: &str) -> Option<ItemId> {
    if path == "/" {
        return None;
    }
    drive.node_at(&space(), path).unwrap().map(|node| node.id)
}

pub fn save(drive: &Drive, path: &str, bytes: &[u8]) -> ItemId {
    let mut parent: Option<ItemId> = None;
    let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
    let (name, folders) = parts.split_last().unwrap();
    let mut so_far = String::new();
    for folder in folders {
        so_far = format!("{so_far}/{folder}");
        parent = match drive.node_at(&space(), &so_far).unwrap() {
            Some(node) => Some(node.id),
            None => Some(
                drive
                    .create(
                        &space(),
                        space_drive::NewNode {
                            parent: parent.clone(),
                            name: (*folder).to_owned(),
                            kind: Kind::Folder,
                            content: None,
                            mtime_ms: 1,
                            id: None,
                        },
                    )
                    .unwrap()
                    .id,
            ),
        };
    }
    let content = staged(drive, bytes);
    match drive.node_at(&space(), path).unwrap() {
        Some(node) => drive.write(&space(), &node.id, &content, 2).unwrap().id,
        None => {
            drive
                .create(
                    &space(),
                    space_drive::NewNode {
                        parent,
                        name: (*name).to_owned(),
                        kind: Kind::File,
                        content: Some(content),
                        mtime_ms: 1,
                        id: None,
                    },
                )
                .unwrap()
                .id
        }
    }
}

pub fn local_tree(
    drive: &Drive,
) -> HashMap<String, (Kind, Option<String>, space_drive::LocalState)> {
    let mut out = HashMap::new();
    let mut queue: Vec<Option<ItemId>> = vec![None];
    while let Some(folder) = queue.pop() {
        for node in drive.list(&space(), folder.as_ref()).unwrap() {
            if node.kind == Kind::Folder {
                queue.push(Some(node.id.clone()));
            }
            out.insert(
                node.path.clone(),
                (node.kind, node.sha256.clone(), node.state),
            );
        }
    }
    out
}

pub fn sha(bytes: &[u8]) -> String {
    sha_of(bytes)
}

pub async fn settle(server: &Arc<FakeServer>, drives: &[Drive]) {
    for _ in 0..12 {
        for drive in drives {
            let _ = drive.sync_now(&space()).await;
        }
        let quiet = drives.iter().all(|drive| {
            local_tree(drive)
                .values()
                .all(|(_, _, state)| *state != space_drive::LocalState::Uploading)
                && drive.current_seq(&space()).unwrap().0 >= server.head()
        });
        if quiet {
            let head = server.head();
            for drive in drives {
                let _ = drive.sync_now(&space()).await;
            }
            if server.head() == head {
                return;
            }
        }
    }
}

pub fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap()
}
