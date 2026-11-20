//! A fake Misty server for the drive's tests, after kuragine's `FakeDrive`: the Space drive routes
//! in memory, with the simple model's semantics as misty-server builds them: versions with an
//! optional `If-Match`, `base_version` judged against the version the content last changed at, a
//! trashed `(replaced …)` copy of content a save replaced unseen, writes that revive trashed
//! items, `replace` for a rename onto a taken name, trash moves with no version, one change
//! sequence per Space, tombstones, trash and restore, and in-use leases with the check before a
//! trash move. It also keeps what a real server wouldn't, for the tests to check: every content
//! any item ever held (`accepted`) and how many trashed items a write brought back.
//!
//! Faults: each computer can be offline, and can lose the reply to its next change after the
//! server applied it.
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
use space_drive::{
    AgentTrash, ChangedEntry, Device, Drive, DriveConfig, DriveStatus, Events, Http, HttpError,
    Item, ItemId, Kind, Notice, Seq, SpaceId, SpaceMount, Version,
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
    /// The version at which each item's content last changed: what a `base_version` is judged by.
    content_version: HashMap<String, i64>,
    accepted: HashSet<String>,
    revived_by_write: u64,
    restores: u64,
    next: u64,
}

/// One computer's view: who it is and its faults.
pub struct Computer {
    pub user: String,
    pub name: String,
    pub device: Device,
    pub offline: AtomicBool,
    pub lose_next_reply: AtomicBool,
    pub drive: Mutex<Option<Drive>>,
    pub notices: Mutex<Vec<Notice>>,
    pub agent_trash: Mutex<Vec<AgentTrash>>,
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

impl State {
    fn next_seq(&mut self) -> i64 {
        self.seq += 1;
        self.seq
    }

    /// Trashed or purged itself, or under a trashed folder.
    fn hidden(&self, id: &str) -> bool {
        let mut current = Some(id.to_owned());
        let mut depth = 0;
        while let Some(at) = current {
            let Some(item) = self.items.get(&at) else {
                return true;
            };
            if item.trashed || item.deleted {
                return true;
            }
            current = item.parent_id.as_ref().map(|parent| parent.0.clone());
            depth += 1;
            if depth > 1000 {
                return true;
            }
        }
        false
    }

    fn within(&self, id: &str, ancestor: &str) -> bool {
        let mut current = Some(id.to_owned());
        while let Some(at) = current {
            if at == ancestor {
                return true;
            }
            current = self
                .items
                .get(&at)
                .and_then(|item| item.parent_id.as_ref().map(|parent| parent.0.clone()));
        }
        false
    }

    fn name_taken(&self, parent: Option<&ItemId>, name: &str, except: Option<&str>) -> Option<Item> {
        self.items
            .values()
            .find(|item| {
                item.parent_id.as_ref() == parent
                    && !item.trashed
                    && !item.deleted
                    && Some(item.id.0.as_str()) != except
                    && item.name.to_lowercase() == name.to_lowercase()
            })
            .cloned()
    }

    fn live_marks(&mut self) {
        let now = Instant::now();
        self.marks.retain(|mark| mark.expires > now);
    }

    /// Someone's live mark on `id` or anything inside it.
    fn open_in(&mut self, id: &str) -> Vec<Value> {
        self.live_marks();
        self.marks
            .iter()
            .filter(|mark| self.within(&mark.item, id))
            .map(|mark| json!({ "user_id": mark.user, "name": mark.user_name,
                "device_name": mark.device_name, "editing": mark.editing }))
            .collect()
    }

    /// Brings `id` and the trashed folders above it back, as `by`'s write to them does. Answers
    /// whether anything came back.
    fn revive(&mut self, id: &str, by: &Computer) -> bool {
        let mut chain = Vec::new();
        let mut current = Some(id.to_owned());
        while let Some(at) = current {
            let Some(item) = self.items.get(&at) else {
                break;
            };
            if item.trashed {
                chain.push(at.clone());
            }
            current = item.parent_id.as_ref().map(|parent| parent.0.clone());
        }
        let any = !chain.is_empty();
        // The topmost first, so a name clash is judged among what is live.
        for at in chain.into_iter().rev() {
            let mut item = self.items[&at].clone();
            item.trashed = false;
            item.trash_hold = false;
            item.trashed_at = None;
            item.trashed_by = None;
            item.modified_by = by.user.clone();
            item.modified_by_name = by.name.clone();
            if self.name_taken(item.parent_id.as_ref(), &item.name, Some(&at)).is_some() {
                item.name = space_drive::names::noted(&item.name, "restored");
            }
            item.version = Version(item.version.0 + 1);
            item.seq = Seq(self.next_seq());
            self.items.insert(at, item);
        }
        if any {
            self.revived_by_write += 1;
        }
        any
    }

    /// Keeps `current`'s content as a trashed copy beside it, replaced by `writer`'s save.
    fn keep_replaced(&mut self, space: &str, current: &Item, writer: &Computer) -> Item {
        let mut name = space_drive::names::noted(&current.name, "replaced 2026-11-20 1200");
        let mut n = 2;
        while self.items.values().any(|other| {
            other.parent_id == current.parent_id && !other.deleted && other.name.to_lowercase() == name.to_lowercase()
        }) {
            name = space_drive::names::numbered(
                &space_drive::names::noted(&current.name, "replaced 2026-11-20 1200"),
                n,
            );
            n += 1;
        }
        self.next += 1;
        let copy = Item {
            id: ItemId(format!("drv_00000000-0000-4000-9000-{:012}", self.next)),
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
            trashed: true,
            trashed_at: Some(now_text()),
            trashed_by: Some(writer.user.clone()),
            trash_hold: false,
            deleted: false,
            replaced_of: Some(current.id.clone()),
        };
        self.content_version.insert(copy.id.0.clone(), 1);
        self.items.insert(copy.id.0.clone(), copy.clone());
        copy
    }

    /// Trashes `id` for `by`.
    fn trash(&mut self, id: &str, by: &Computer, held: bool) -> Item {
        let mut next = self.items[id].clone();
        next.trashed = true;
        next.trash_hold = held;
        next.trashed_at = Some(now_text());
        next.trashed_by = Some(by.user.clone());
        next.modified_by = by.user.clone();
        next.modified_by_name = by.name.clone();
        next.version = Version(next.version.0 + 1);
        next.seq = Seq(self.next_seq());
        self.items.insert(id.to_owned(), next.clone());
        next
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

    /// Every content any item has held, live, trashed or overwritten since.
    pub fn accepted(&self) -> HashSet<String> {
        self.state().accepted.clone()
    }

    /// How many times a write brought a trashed item back.
    pub fn revived_by_write(&self) -> u64 {
        self.state().revived_by_write
    }

    /// Every trashed item that isn't purged: what people trashed, and the replaced copies.
    pub fn trashed_items(&self) -> Vec<Item> {
        self.state()
            .items
            .values()
            .filter(|item| item.trashed && !item.deleted)
            .cloned()
            .collect()
    }

    /// The content of every item not purged, live or trashed, as text.
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

    /// An item's content on the server, as text.
    pub fn content_of(&self, item: &Item) -> String {
        let state = self.state();
        item.sha256
            .as_ref()
            .and_then(|sha| state.blobs.get(sha))
            .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
            .unwrap_or_default()
    }

    /// The live tree: drive path → (kind, sha256).
    pub fn live_tree(&self) -> HashMap<String, (Kind, Option<String>)> {
        let state = self.state();
        let mut out = HashMap::new();
        for item in state.items.values() {
            if state.hidden(&item.id.0) {
                continue;
            }
            let mut parts = vec![item.name.clone()];
            let mut current = item.parent_id.clone();
            while let Some(parent) = current {
                let Some(folder) = state.items.get(&parent.0) else {
                    break;
                };
                parts.push(folder.name.clone());
                current = folder.parent_id.clone();
            }
            parts.reverse();
            out.insert(format!("/{}", parts.join("/")), (item.kind, item.sha256.clone()));
        }
        out
    }

    pub fn item_named(&self, name: &str) -> Option<Item> {
        self.state()
            .items
            .values()
            .find(|item| item.name == name)
            .cloned()
    }

    pub fn trashed_ids(&self) -> HashSet<String> {
        let state = self.state();
        state
            .items
            .values()
            .filter(|item| state.hidden(&item.id.0))
            .map(|item| item.id.0.clone())
            .collect()
    }

    pub fn head(&self) -> i64 {
        self.state().seq
    }

    /// Makes a computer of `user` (`name` is the person's name), signed in to this server.
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
            agent_trash: Mutex::new(Vec::new()),
        });
        self.computers.lock().unwrap().push(computer.clone());
        computer
    }

    /// Opens the computer's drive in `dir` and mounts the test Space with no OS face.
    pub fn open_drive(self: &Arc<Self>, computer: &Arc<Computer>, dir: PathBuf, runtime: tokio::runtime::Handle) -> Drive {
        let mut config = DriveConfig::new(dir.clone(), computer.user.clone(), computer.device.clone());
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
            .filter(|other| other.device.id != from.device.id && !other.offline.load(Ordering::SeqCst))
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
        let parts: Vec<String> = path.split('/').filter(|p| !p.is_empty()).map(decode).collect();
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
                let limit: usize = query.get("limit").and_then(|v| v.parse().ok()).unwrap_or(500);
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
                reply(200, json!({ "items": items, "next_since": next, "more": more, "head": state.seq }))
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
                reply(200, json!({ "upload_id": upload,
                    "single": { "url": format!("fake://put/{upload}"), "method": "PUT", "headers": {} } }))
            }
            (Method::Post, ["spaces", _, "drive", "uploads", _, "complete"]) => {
                reply(200, json!({ "upload_id": parts[4] }))
            }
            (Method::Post, ["spaces", space, "drive", "items"]) => {
                let id = body["id"].as_str().unwrap_or_default().to_owned();
                let parent = body["parent_id"].as_str().map(|p| ItemId(p.to_owned()));
                let name = body["name"].as_str().unwrap_or_default().to_owned();
                let kind = if body["kind"] == "folder" { Kind::Folder } else { Kind::File };
                let sha = body["sha256"].as_str().map(str::to_owned);
                if let Some(existing) = state.items.get(&id) {
                    let same = existing.parent_id == parent && existing.name == name && existing.kind == kind && existing.sha256 == sha;
                    return if same {
                        reply(200, json!(existing))
                    } else {
                        reply(409, json!({ "code": "id_taken" }))
                    };
                }
                let mut revived = false;
                if let Some(parent) = &parent {
                    match state.items.get(&parent.0) {
                        None => return reply(404, json!({ "code": "parent_missing" })),
                        Some(folder) if folder.deleted => {
                            return reply(404, json!({ "code": "parent_missing" }))
                        }
                        Some(folder) if folder.kind != Kind::Folder => {
                            return reply(409, json!({ "code": "parent_not_folder" }))
                        }
                        // A trashed folder it goes into comes back first.
                        Some(_) if state.hidden(&parent.0) => revived = state.revive(&parent.0, computer),
                        Some(_) => {}
                    }
                }
                if let Some(taken) = state.name_taken(parent.as_ref(), &name, None) {
                    return reply(409, json!({ "code": "name_taken", "item": taken }));
                }
                if kind == Kind::File {
                    let sha = sha.clone().unwrap_or_default();
                    // An empty file has no blob, as on the real server.
                    if sha != space_drive::transfer::EMPTY_SHA256 && !state.blobs.contains_key(&sha) {
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
                    trashed: false,
                    trashed_at: None,
                    trashed_by: None,
                    trash_hold: false,
                    deleted: false,
                    replaced_of: None,
                };
                state.content_version.insert(id.clone(), 1);
                state.items.insert(id, item.clone());
                let mut answer = json!(item);
                answer["revived"] = json!(revived);
                reply(201, answer)
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
                        if state.items.get(&parent.0).is_none_or(|folder| folder.deleted) {
                            return reply(404, json!({ "code": "parent_missing" }));
                        }
                    }
                }
                let moved = next.name != current.name || next.parent_id != current.parent_id;
                // Checked before anything changes.
                let holder = if moved {
                    state.name_taken(next.parent_id.as_ref(), &next.name, Some(id))
                } else {
                    None
                };
                if let Some(holder) = &holder {
                    if !replace {
                        return reply(409, json!({ "code": "name_taken", "item": holder }));
                    }
                    let who = state.open_in(&holder.id.0);
                    if !who.is_empty() {
                        return reply(423, json!({ "code": "in_use", "who": who }));
                    }
                }
                let new_sha = body.get("sha256").and_then(Value::as_str).map(str::to_owned);
                if let Some(sha) = &new_sha {
                    if sha != space_drive::transfer::EMPTY_SHA256 && !state.blobs.contains_key(sha) {
                        return reply(409, json!({ "code": "blob_missing" }));
                    }
                }
                // A write to something trashed (or inside a trashed folder) brings it back, and a
                // move into a trashed folder brings that back.
                let mut revived = state.revive(id, computer);
                if let Some(parent) = &next.parent_id {
                    if state.hidden(&parent.0) {
                        revived |= state.revive(&parent.0, computer);
                    }
                }
                let revived_now = state.items[*id].clone();
                next.version = revived_now.version;
                next.trashed = false;
                next.trash_hold = false;
                next.trashed_at = None;
                next.trashed_by = None;
                if body.get("name").is_none() && body.get("parent_id").is_none() {
                    next.name = revived_now.name.clone();
                }
                if let Some(holder) = holder {
                    state.trash(&holder.id.0, computer, false);
                }
                let mut replaced = Value::Null;
                if let Some(sha) = new_sha {
                    let changes = current.sha256.as_deref() != Some(sha.as_str());
                    let seen = body["base_version"]
                        .as_i64()
                        .or(if_match)
                        .is_some_and(|base| base >= state.content_version.get(*id).copied().unwrap_or(1));
                    if changes && !seen && current.size > 0 {
                        replaced = json!(state.keep_replaced(space, &current, computer));
                    }
                    state.accepted.insert(sha.clone());
                    next.sha256 = Some(sha);
                    next.size = body["size"].as_u64().unwrap_or(0);
                    next.mtime_ms = body["mtime_ms"].as_i64().unwrap_or(0);
                    if changes {
                        state.content_version.insert((*id).to_owned(), next.version.0 + 1);
                    }
                }
                next.version = Version(next.version.0 + 1);
                next.seq = Seq(state.next_seq());
                next.modified_by = computer.user.clone();
                next.modified_by_name = computer.name.clone();
                state.items.insert((*id).to_owned(), next.clone());
                let mut answer = json!(next);
                answer["replaced"] = replaced;
                answer["revived"] = json!(revived);
                reply(200, answer)
            }
            (Method::Post, ["spaces", _, "drive", "items", _, "check-in-use"]) => {
                reply(200, json!({ "wait_ms": 0 }))
            }
            (Method::Post, ["spaces", _, "drive", "items", id, "trash"]) => {
                let Some(current) = state.items.get(*id).cloned() else {
                    return reply(404, json!({ "code": "not_found" }));
                };
                if state.hidden(id) {
                    return reply(409, json!({ "code": "trashed", "item": current }));
                }
                if let Some(if_match) = if_match {
                    if current.version.0 != if_match {
                        return reply(409, json!({ "code": "version_conflict", "item": current }));
                    }
                }
                // A computer's own marks never block its own trash move.
                let device = header(request, "X-Misty-Device").unwrap_or_default().to_owned();
                state.live_marks();
                let who: Vec<Value> = state
                    .marks
                    .iter()
                    .filter(|mark| mark.device_id != device && state.within(&mark.item, id))
                    .map(|mark| json!({ "user_id": mark.user, "name": mark.user_name,
                        "device_name": mark.device_name, "editing": mark.editing }))
                    .collect();
                if !who.is_empty() {
                    return reply(423, json!({ "code": "in_use", "who": who }));
                }
                let next = state.trash(id, computer, body["held"].as_bool().unwrap_or(false));
                reply(200, json!(next))
            }
            (Method::Post, ["spaces", _, "drive", "items", id, "restore"]) => {
                let Some(mut item) = state.items.get(*id).cloned() else {
                    return reply(404, json!({ "code": "not_found" }));
                };
                if !item.trashed {
                    return reply(409, json!({ "code": "not_trashed" }));
                }
                item.trashed = false;
                item.trash_hold = false;
                if state.name_taken(item.parent_id.as_ref(), &item.name, Some(id)).is_some() {
                    item.name = format!("{} (restored)", item.name);
                }
                item.version = Version(item.version.0 + 1);
                item.seq = Seq(state.next_seq());
                state.restores += 1;
                state.items.insert((*id).to_owned(), item.clone());
                reply(200, json!(item))
            }
            (Method::Get, ["spaces", _, "drive", "items", id, "content"]) => match state.items.get(*id) {
                Some(item) if item.size == 0 => reply(200, json!({ "url": "", "expires_at": now_text() })),
                Some(item) => reply(200, json!({ "url": format!("fake://get/{}", item.sha256.clone().unwrap_or_default()),
                    "expires_at": now_text() })),
                None => reply(404, json!({ "code": "not_found" })),
            },
            (Method::Put, ["spaces", _, "drive", "items", id, "in-use"]) => {
                if !state.items.contains_key(*id) {
                    return reply(404, json!({ "code": "not_found" }));
                }
                let device = header(request, "X-Misty-Device").unwrap_or_default().to_owned();
                let editing = body["editing"].as_bool().unwrap_or(false);
                state.marks.retain(|mark| !(mark.item == *id && mark.device_id == device));
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
                let device = header(request, "X-Misty-Device").unwrap_or_default().to_owned();
                state.marks.retain(|mark| !(mark.item == *id && mark.device_id == device));
                Response { status: 204, headers: Vec::new(), body: Vec::new() }
            }
            (Method::Get, ["spaces", _, "drive", "trash"]) => {
                let items: Vec<Item> = state
                    .items
                    .values()
                    .filter(|item| item.trashed && !item.deleted)
                    .cloned()
                    .collect();
                reply(200, json!({ "items": items, "next_after": null }))
            }
            (Method::Delete, ["spaces", _, "drive", "items", id]) => {
                let Some(mut item) = state.items.get(*id).cloned() else {
                    return reply(404, json!({ "code": "not_found" }));
                };
                if !item.trashed {
                    return reply(409, json!({ "code": "not_trashed" }));
                }
                item.deleted = true;
                item.parent_id = None;
                item.seq = Seq(state.next_seq());
                state.items.insert((*id).to_owned(), item);
                Response { status: 204, headers: Vec::new(), body: Vec::new() }
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
                return Ok(Response { status: 403, headers: Vec::new(), body: Vec::new() });
            };
            if sha_of(&bytes) != sha || bytes.len() as u64 != size {
                return Ok(Response { status: 400, headers: Vec::new(), body: Vec::new() });
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
    fn agent_trashed(&self, record: &AgentTrash) {
        self.computer.agent_trash.lock().unwrap().push(record.clone());
    }
}

// What the tests do on a computer, through the faces' calls.

pub fn space() -> SpaceId {
    SpaceId(SPACE.into())
}

/// A file with `bytes` in the drive's temp folder, to hand to `create` or `write`.
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

/// Makes the folders of `path` and writes `bytes` there, as a person saving a file would.
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
                    .create(&space(), space_drive::NewNode {
                        parent: parent.clone(),
                        name: (*folder).to_owned(),
                        kind: Kind::Folder,
                        content: None,
                        mtime_ms: 1,
                        id: None,
                    })
                    .unwrap()
                    .id,
            ),
        };
    }
    let content = staged(drive, bytes);
    match drive.node_at(&space(), path).unwrap() {
        Some(node) => drive.write(&space(), &node.id, &content, 2).unwrap().id,
        None => drive
            .create(&space(), space_drive::NewNode {
                parent,
                name: (*name).to_owned(),
                kind: Kind::File,
                content: Some(content),
                mtime_ms: 1,
                id: None,
            })
            .unwrap()
            .id,
    }
}

/// The computer's tree: drive path → (kind, sha256, state).
pub fn local_tree(drive: &Drive) -> HashMap<String, (Kind, Option<String>, space_drive::LocalState)> {
    let mut out = HashMap::new();
    let mut queue: Vec<Option<ItemId>> = vec![None];
    while let Some(folder) = queue.pop() {
        for node in drive.list(&space(), folder.as_ref()).unwrap() {
            if node.kind == Kind::Folder {
                queue.push(Some(node.id.clone()));
            }
            out.insert(node.path.clone(), (node.kind, node.sha256.clone(), node.state));
        }
    }
    out
}

pub fn sha(bytes: &[u8]) -> String {
    sha_of(bytes)
}

/// Syncs every online computer until nothing is left to send and everyone is at the head.
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
            for drive in drives {
                let _ = drive.sync_now(&space()).await;
            }
            return;
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
