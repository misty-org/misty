//! The local socket between Misty and its macOS File Provider extension.
//!
//! The extension is thin and holds no sign-in: every question about a drive comes here, and
//! Misty answers from `drive.db`, fetching and uploading with its own session. When Misty isn't
//! running there is no socket, and the extension answers the system "server unreachable"
//! (`NSFileProviderError.serverUnreachable`); macOS keeps local edits pending until it is back.
//!
//! # Where
//!
//! A Unix socket at `<app group container>/drive.sock`, where the container is
//! `~/Library/Group Containers/<group id>/` and the group id is `<Team ID>.com.misty.desktop`
//! (release) or `<Team ID>.com.misty.desktop.dev` (debug). Misty makes it with mode `0600`
//! after removing a stale one, and refuses a peer that isn't the same user. File content moves
//! through `<container>/staging/<uuid>` files, never through the socket.
//!
//! A socket's path fits in `sun_path`: at most 103 bytes (`MAX_SOCKET_PATH`; 104 with its NUL).
//! The rule, which the extension follows to find it (`socket_path`):
//!
//! 1. `<container>/drive.sock` when its UTF-8 path is at most 103 bytes;
//! 2. else `<container>/d.sock` when that is at most 103 bytes;
//! 3. else there is no socket: Misty says so in the drive's status ("This Mac's folder for Misty
//!    is too deep for its drive to start"), and the extension answers "server unreachable".
//!
//! # Framing
//!
//! Each request and each reply is one JSON object (UTF-8), prefixed by its length in bytes as a
//! 4-byte big-endian unsigned integer. At most 16 MiB a message. A connection carries any number
//! of requests; Misty answers them in order, one reply per request. The extension may open several
//! connections to ask in parallel.
//!
//! # Requests and replies
//!
//! Request: `{"id": <u64>, "op": "<op>", "domain": "<account id>.<space id>", …op fields}`.
//! `id` is the extension's own and comes back unchanged. `domain` is the File Provider domain's
//! identifier, as Misty registered it.
//!
//! Reply: `{"id": <u64>, "ok": true, …fields}`, or `{"id": <u64>, "ok": false, "error":
//! {"code": "<code>", "message": "<a sentence a person can read>"}}`.
//!
//! Error codes: `not_found` (no such item: `noSuchItem`), `exists` (an item id already used:
//! `create` with an `item_id` Misty already has for another item), `not_empty`,
//! `in_use` (a delete refused because someone has it open; the message says who), `not_mounted` (no such domain
//! now), `server_unreachable` (Misty is offline: `serverUnreachable`), `signed_out`
//! (`notAuthenticated`), `forbidden` (the person may not change this Space's drive),
//! `invalid` (a bad request or name), `corrupt` (a download didn't match its hash; try again),
//! `unsupported`, `io`, `store`, `server`, `face`.
//!
//! An item, wherever one appears (`Item` below):
//!
//! ```json
//! { "id": "drv_…",            // the item identifier to give the system
//!   "parent_id": "drv_…" | null,   // null: the domain's root container
//!   "name": "Report.pdf", "kind": "file" | "folder",
//!   "size": 0, "mtime_ms": 0, "sha256": "<64 hex>" | null,
//!   "version": 7 | null,      // the server version Misty agreed on; null until the server has it
//!   "seq": 42,                // the change that last touched it (0 for local-only items)
//!   "modified_by_name": "Ana",
//!   "downloaded": true,       // Misty has its content (not whether the extension has)
//!   "state": "online" | "downloaded" | "downloading" | "uploading" | "not_synced",
//!   "last_used_ms": 1763600000000 | null,  // used on this computer: an open that lasted, or the
//!                             // last-used date the extension reported; null when never
//!   "trashed": false,         // only in `changes_since`: delete the item from the system
//!   "deleted": false }        // only in `changes_since`: purged, delete it too
//! ```
//!
//! Ops (fields beyond `id`, `op` and `domain`):
//!
//! - `hello` `{}` → `{"protocol": 1, "account_id", "domains": [{"domain", "space_id", "name"}]}`.
//! - `list` `{"parent": "drv_…" | null, "cursor"?: string, "limit"?: u32}` → `{"items": [Item],
//!   "next_cursor": string | null}`. A folder's children, without what waits to be trashed. Pages
//!   of `limit` (default 500, at most 5000); pass `next_cursor` back as `cursor`.
//! - `item` `{"item_id"}` → `{"item": Item}`.
//! - `fetch` `{"item_id"}` → `{"item": Item, "path": "<container>/staging/<uuid>"}`. Misty
//!   fetches the content if it hasn't it, checks its SHA-256, and writes it to a new staging
//!   file. The extension owns that file from then on: it hands it to the system (which moves it)
//!   or deletes it.
//! - `create` `{"parent": "drv_…" | null, "name", "kind", "item_id"?: "drv_<uuid v4>",
//!   "staged"?: "<container>/staging/…", "mtime_ms"?: i64, "may_exist"?: bool}` →
//!   `{"item": Item}`. Makes an item on this computer at once, offline too; it uploads later.
//!   `item_id` is the id the extension already gave the system, if it gave one; otherwise Misty
//!   makes one and answers it in `item.id`, which never changes after. A file's content is in
//!   `staged`, a file the extension wrote in the staging folder; Misty takes it over (moves it)
//!   when the reply is `ok`. With no `staged`, a file is empty. A name already taken is never a
//!   failure: a new file whose name a file has is written into that file (a text save merges,
//!   anything else is the last save, the replaced content kept in the Space's trash) and that
//!   file is answered, its own `id`; a new folder whose name a folder has is that folder;
//!   taken by the other kind, the new item takes a numbered name, and `item.name` says so.
//!   `"may_exist": true` (the system's "may already exist" after a reset) changes nothing: an
//!   item already there is answered either way. An
//!   item that an ignore rule, a junk name or a secret's name leaves out answers `"state":
//!   "not_synced"`: it stays on this Mac alone.
//! - `modify` `{"item_id", "base_version"?: i64, "name"?, "parent"?: "drv_…" | null,
//!   "staged"?: path, "mtime_ms"?: i64}` → `{"item": Item, "refetch": bool}`. A rename or move
//!   when `name` or the `parent` key is present (`"parent": null` is the root), new content
//!   when `staged` is. `base_version` is the `version` the system's copy came from. It never
//!   fails for being out of date (macOS would only send it again): a rename or move is the
//!   latest, and onto a name another item holds it trashes that item (both come back, with a
//!   notice, if someone has that item open); new content goes up saying it came from
//!   `base_version`, so a text save merges with what came since and anything else is the last
//!   save, the content it replaced unseen kept in the Space's trash. New content is sent before
//!   the reply when Misty can reach the server in a few seconds. `item` is the item as it now is;
//!   `refetch` is true when its content is no longer what this Mac sent (it was merged), so the
//!   system fetches it again.
//! - `trash` `{"item_id"}` → `{}`. Every delete is a trash move on the server that can be undone,
//!   and it trashes the item as it is by then. Misty asks every online computer whether the item
//!   is in use, waits for them, then moves it; the answer comes when the server has decided:
//!   `in_use` means it stays (and comes back if the system removed it).
//! - `changes_since` `{"since": "<anchor>", "limit"?: u32}` → `{"items": [Item],
//!   "next_anchor": "<anchor>", "next_seq": i64, "more": bool}`. The extension's sync anchor is
//!   the text `"<server seq>.<local seq>"`, two decimal integers of at least 0 joined by one `.`,
//!   such as `"42.7"` (`"0.0"` is everything; a bare `"42"` is read as `"42.0"`). The server seq
//!   counts the server's changes Misty has applied, trashed and purged items included; the local
//!   seq counts changes only this computer makes to what the extension shows: `last_used_ms`.
//!   Listed are
//!   the items the server changed after the first number and those changed locally after the
//!   second, each once, as they are now; up to `limit` of each (default 500, at most 5000), so a
//!   page holds at most twice `limit`. Store `next_anchor` and ask again while `more`.
//!   The old form `{"seq": i64}` still works: only the server's changes, with `next_seq` and no
//!   `next_anchor`. An item made on this Mac and not on the server yet comes only through its
//!   local changes; `create` answered it.
//! - `current_seq` `{}` → `{"seq": i64, "anchor": "<anchor>"}`: the anchor to start from.
//! - `used` `{"item_id", "at_ms": i64}` → `{}`: the item's last-used date
//!   (`NSFileProviderItemLastUsedDate`), which macOS sets when a person opens it in an app.
//!   Misty counts an item used in the last five minutes as in use when someone asks.
//! - `open` `{"item_id", "editing": bool}` → `{}`, and `close` `{"item_id", "editing": bool}` →
//!   `{}`: for an extension that learns of opens (none on macOS today; Misty's own previews use
//!   these through `Drive`). Every item is writable: nothing is ever made read-only.
//!
//! When changes land, Misty signals the working set
//! (`signalEnumeratorForContainerItemIdentifier(NSFileProviderWorkingSetContainerItemIdentifier)`)
//! and the extension asks `changes_since` with its anchor.
use std::{
    collections::HashSet,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

use serde_json::{json, Map, Value};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{UnixListener, UnixStream},
};

/// How long a `modify` with new content waits for it to go up, so a merge can come back as
/// `refetch`. Offline it answers sooner, and the content goes up later.
const SEND_WAIT: std::time::Duration = std::time::Duration::from_secs(20);

use crate::{Drive, DriveError, Item, ItemId, Kind, NewNode, Node, Seq, SpaceId, TrashBy};

/// The protocol's version, answered by `hello`.
pub const PROTOCOL: u32 = 1;
const MAX_MESSAGE: u32 = 16 * 1024 * 1024;
/// The longest socket path `sun_path` holds on macOS, less its NUL.
pub const MAX_SOCKET_PATH: usize = 103;
/// Said in the drive's status when no socket path fits.
pub const SOCKET_TOO_LONG: &str = "This Mac's folder for Misty is too deep for its drive to start";

/// Where the socket is in the app group container, by the rule in the module's docs:
/// `drive.sock`, else `d.sock` when that is too long, else none fits.
pub fn socket_path(container: &Path) -> Result<PathBuf, DriveError> {
    ["drive.sock", "d.sock"]
        .iter()
        .map(|name| container.join(name))
        .find(|path| path.as_os_str().len() <= MAX_SOCKET_PATH)
        .ok_or_else(|| DriveError::Unsupported(SOCKET_TOO_LONG.to_owned()))
}

/// The listening socket. Dropping it stops listening and removes the socket file.
pub struct Server {
    task: tokio::task::JoinHandle<()>,
    path: PathBuf,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
        let _ = file_access::fs::remove_file(&self.path);
    }
}

impl Server {
    /// Listens at `socket` (`<container>/drive.sock`) for the extension. `staging` is
    /// `<container>/staging`, the only folder content may come from or go to.
    pub fn start(drive: Drive, socket: PathBuf, staging: PathBuf) -> Result<Self, DriveError> {
        if socket.as_os_str().len() > MAX_SOCKET_PATH {
            return Err(DriveError::Unsupported(SOCKET_TOO_LONG.to_owned()));
        }
        match file_access::fs::remove_file(&socket) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                return Err(DriveError::io(error))
            }
            _ => {}
        }
        file_access::fs::create_dir_all(&staging).map_err(DriveError::io)?;
        let listener = {
            let _entered = drive.runtime().enter();
            UnixListener::bind(&socket).map_err(DriveError::io)?
        };
        file_access::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600))
            .map_err(DriveError::io)?;
        let staging = file_access::fs::canonicalize(&staging).unwrap_or(staging);
        let accept_drive = drive.clone();
        let task = drive.runtime().spawn(async move {
            // SAFETY: getuid has no preconditions.
            let me = unsafe { libc::getuid() };
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    continue;
                };
                if !stream.peer_cred().is_ok_and(|peer| peer.uid() == me) {
                    continue;
                }
                let drive = accept_drive.clone();
                let staging = staging.clone();
                tokio::spawn(async move {
                    let _ = serve(drive, stream, staging).await;
                });
            }
        });
        Ok(Self { task, path: socket })
    }
}

async fn read_message(stream: &mut UnixStream) -> std::io::Result<Option<Value>> {
    let mut length = [0u8; 4];
    match stream.read_exact(&mut length).await {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error),
    }
    let length = u32::from_be_bytes(length);
    if length > MAX_MESSAGE {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "message too long",
        ));
    }
    let mut body = vec![0u8; length as usize];
    stream.read_exact(&mut body).await?;
    Ok(Some(serde_json::from_slice(&body).unwrap_or(Value::Null)))
}

async fn write_message(stream: &mut UnixStream, value: &Value) -> std::io::Result<()> {
    let body = value.to_string().into_bytes();
    stream.write_all(&(body.len() as u32).to_be_bytes()).await?;
    stream.write_all(&body).await?;
    stream.flush().await
}

async fn serve(drive: Drive, mut stream: UnixStream, staging: PathBuf) -> std::io::Result<()> {
    while let Some(request) = read_message(&mut stream).await? {
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let reply = match answer(&drive, &staging, &request).await {
            Ok(Value::Object(mut fields)) => {
                fields.insert("id".into(), id);
                fields.insert("ok".into(), Value::Bool(true));
                Value::Object(fields)
            }
            Ok(_) => json!({ "id": id, "ok": true }),
            Err(error) => json!({
                "id": id,
                "ok": false,
                "error": { "code": error.code(), "message": error.to_string() },
            }),
        };
        write_message(&mut stream, &reply).await?;
    }
    Ok(())
}

fn text<'a>(request: &'a Value, field: &str) -> Result<&'a str, DriveError> {
    request
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| DriveError::Invalid(format!("The request has no {field}.")))
}

fn item_id(request: &Value, field: &str) -> Result<ItemId, DriveError> {
    let id = text(request, field)?;
    if !ItemId::is_valid(id) {
        return Err(DriveError::Invalid("That isn't an item's id.".to_owned()));
    }
    Ok(ItemId(id.to_owned()))
}

/// `"parent": null` or absent is the root; a string is a folder's id.
fn parent_of(request: &Value) -> Result<Option<ItemId>, DriveError> {
    match request.get("parent") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(id)) if ItemId::is_valid(id) => Ok(Some(ItemId(id.clone()))),
        Some(_) => Err(DriveError::Invalid("That isn't a folder's id.".to_owned())),
    }
}

/// A staged file the extension named, which has to be in the staging folder.
fn staged(request: &Value, staging: &Path) -> Result<Option<PathBuf>, DriveError> {
    let Some(path) = request.get("staged").and_then(Value::as_str) else {
        return Ok(None);
    };
    let real = file_access::fs::canonicalize(path).map_err(|_| DriveError::NotFound)?;
    if !real.starts_with(staging) || real == staging {
        return Err(DriveError::Invalid(
            "Staged content has to be in the staging folder.".to_owned(),
        ));
    }
    if !file_access::fs::is_file(&real) {
        return Err(DriveError::Invalid("Staged content has to be a file.".to_owned()));
    }
    Ok(Some(real))
}

fn node_json(node: &Node, seq: i64, modified_by_name: &str) -> Value {
    json!({
        "id": node.id,
        "parent_id": node.parent,
        "name": node.name,
        "kind": node.kind,
        "size": node.size,
        "mtime_ms": node.mtime_ms,
        "sha256": node.sha256,
        "version": node.version,
        "seq": seq,
        "modified_by_name": modified_by_name,
        "downloaded": node.downloaded,
        "state": node.state,
        "last_used_ms": (node.last_used_ms > 0).then_some(node.last_used_ms),
    })
}

/// An item that changed only here, as `changes_since` lists it.
fn local_change_value(drive: &Drive, space: &SpaceId, node: &Node) -> Value {
    match drive.server_item(space, &node.id).ok().flatten() {
        Some(item) => change_value(drive, space, &item),
        None => {
            let mut value = node_json(node, 0, "");
            if let Value::Object(fields) = &mut value {
                fields.insert("trashed".into(), Value::Bool(false));
                fields.insert("deleted".into(), Value::Bool(false));
            }
            value
        }
    }
}

/// `"<server seq>.<local seq>"`, or a bare `"<server seq>"`.
fn parse_anchor(text: &str) -> Result<(Seq, i64), DriveError> {
    let bad = || DriveError::Invalid(format!("“{text}” isn't an anchor."));
    let (server, local) = text.split_once('.').unwrap_or((text, "0"));
    let number = |part: &str| {
        if part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(bad());
        }
        part.parse::<i64>().map_err(|_| bad())
    };
    Ok((Seq(number(server)?), number(local)?))
}

fn anchor(seq: Seq, local: i64) -> String {
    format!("{}.{}", seq.0, local)
}

fn node_value(drive: &Drive, space: &SpaceId, node: &Node) -> Value {
    let server = drive.server_item(space, &node.id).ok().flatten();
    node_json(
        node,
        server.as_ref().map_or(0, |item| item.seq.0),
        server
            .as_ref()
            .map_or("", |item| item.modified_by_name.as_str()),
    )
}

/// A server item as `changes_since` lists it, with this computer's view where it has one.
fn change_value(drive: &Drive, space: &SpaceId, item: &Item) -> Value {
    let mut value = match drive.node(space, &item.id).ok().flatten() {
        Some(node) => node_json(&node, item.seq.0, &item.modified_by_name),
        None => json!({
            "id": item.id,
            "parent_id": item.parent_id,
            "name": item.name,
            "kind": item.kind,
            "size": item.size,
            "mtime_ms": item.mtime_ms,
            "sha256": item.sha256,
            "version": item.version,
            "seq": item.seq,
            "modified_by_name": item.modified_by_name,
            "downloaded": false,
            "state": "online",
        }),
    };
    if let Value::Object(fields) = &mut value {
        // Gone from what this computer shows (trashed, purged, or under a trashed folder).
        let gone = item.trashed || item.deleted || drive.node(space, &item.id).ok().flatten().is_none();
        fields.insert("trashed".into(), Value::Bool(item.trashed || (gone && !item.deleted)));
        fields.insert("deleted".into(), Value::Bool(item.deleted));
    }
    value
}

async fn answer(drive: &Drive, staging: &Path, request: &Value) -> Result<Value, DriveError> {
    let op = text(request, "op")?;
    if op == "hello" {
        let domains: Vec<Value> = drive
            .mounted()
            .into_iter()
            .map(|mount| json!({ "domain": mount.domain, "space_id": mount.space, "name": mount.name }))
            .collect();
        return Ok(json!({
            "protocol": PROTOCOL,
            "account_id": drive.config().account_id,
            "domains": domains,
        }));
    }
    let domain = text(request, "domain")?;
    let space = drive.space_of_domain(domain).ok_or(DriveError::NotMounted)?;
    match op {
        "list" => {
            let parent = parent_of(request)?;
            let mut children = drive.list(&space, parent.as_ref())?;
            children.sort_by(|a, b| a.name.cmp(&b.name));
            let start: usize = request
                .get("cursor")
                .and_then(Value::as_str)
                .and_then(|cursor| cursor.parse().ok())
                .unwrap_or(0);
            let limit = request
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(500)
                .clamp(1, 5000) as usize;
            let page: Vec<Value> = children
                .iter()
                .skip(start)
                .take(limit)
                .map(|node| node_value(drive, &space, node))
                .collect();
            let next = start + page.len();
            Ok(json!({
                "items": page,
                "next_cursor": (next < children.len()).then(|| next.to_string()),
            }))
        }
        "item" => {
            let id = item_id(request, "item_id")?;
            let node = drive.node(&space, &id)?.ok_or(DriveError::NotFound)?;
            Ok(json!({ "item": node_value(drive, &space, &node) }))
        }
        "fetch" => {
            let id = item_id(request, "item_id")?;
            let to = staging.join(uuid::Uuid::new_v4().to_string());
            let node = drive.fetch_to(&space, &id, &to).await?;
            Ok(json!({ "item": node_value(drive, &space, &node), "path": to }))
        }
        "create" => {
            let kind = match text(request, "kind")? {
                "folder" => Kind::Folder,
                "file" => Kind::File,
                _ => return Err(DriveError::Invalid("An item is a file or a folder.".to_owned())),
            };
            let id = match request.get("item_id") {
                None | Some(Value::Null) => None,
                Some(_) => Some(item_id(request, "item_id")?),
            };
            let may_exist = request.get("may_exist").and_then(Value::as_bool).unwrap_or(false);
            let node = drive.create_resolving(
                &space,
                NewNode {
                    parent: parent_of(request)?,
                    name: text(request, "name")?.to_owned(),
                    kind,
                    content: staged(request, staging)?,
                    // No date given: it was made now.
                    mtime_ms: request
                        .get("mtime_ms")
                        .and_then(Value::as_i64)
                        .unwrap_or_else(crate::now_ms),
                    id,
                },
                may_exist,
            )?;
            Ok(json!({ "item": node_value(drive, &space, &node) }))
        }
        "modify" => {
            let id = item_id(request, "item_id")?;
            let base = request
                .get("base_version")
                .and_then(Value::as_i64)
                .map(crate::Version);
            let parent = if request.get("parent").is_some() {
                Some(parent_of(request)?)
            } else {
                None
            };
            let content = staged(request, staging)?;
            let (mut node, mut refetch) = drive.modify(
                &space,
                &id,
                base,
                request.get("name").and_then(Value::as_str),
                parent,
                content.as_deref(),
                request
                    .get("mtime_ms")
                    .and_then(Value::as_i64)
                    .unwrap_or_else(crate::now_ms),
            )?;
            if content.is_some() {
                // Sent now if the server can be reached, so a merge comes back as a refetch.
                let sent = node.sha256.clone();
                let _ = tokio::time::timeout(SEND_WAIT, drive.sync_now(&space)).await;
                if let Some(now) = drive.node(&space, &id)? {
                    refetch |= now.sha256 != sent;
                    node = now;
                }
            }
            Ok(json!({ "item": node_value(drive, &space, &node), "refetch": refetch }))
        }
        "trash" => {
            let id = item_id(request, "item_id")?;
            drive.trash_now(&space, &id, TrashBy::Person).await?;
            Ok(Value::Object(Map::new()))
        }
        "changes_since" => {
            let limit = request
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(500)
                .clamp(1, 5000) as usize;
            let since = match request.get("since").and_then(Value::as_str) {
                Some(text) => Some(parse_anchor(text)?),
                None => None,
            };
            let seq = match since {
                Some((seq, _)) => seq,
                None => Seq(request.get("seq").and_then(Value::as_i64).unwrap_or(0).max(0)),
            };
            let (items, next, more) = drive.changes_since(&space, seq, limit)?;
            let listed: HashSet<&ItemId> = items.iter().map(|item| &item.id).collect();
            let mut values: Vec<Value> = items
                .iter()
                .map(|item| change_value(drive, &space, item))
                .collect();
            let Some((_, local)) = since else {
                return Ok(json!({ "items": values, "next_seq": next, "more": more }));
            };
            let (nodes, next_local, more_local) = drive.local_changes_since(&space, local, limit)?;
            values.extend(
                nodes
                    .iter()
                    .filter(|node| !listed.contains(&node.id))
                    .map(|node| local_change_value(drive, &space, node)),
            );
            Ok(json!({
                "items": values,
                "next_anchor": anchor(next, next_local),
                "next_seq": next,
                "more": more || more_local,
            }))
        }
        "current_seq" => {
            let seq = drive.current_seq(&space)?;
            let local = drive.current_local_seq(&space)?;
            Ok(json!({ "seq": seq, "anchor": anchor(seq, local) }))
        }
        "used" => {
            let id = item_id(request, "item_id")?;
            let at = request
                .get("at_ms")
                .and_then(Value::as_i64)
                .unwrap_or_else(crate::now_ms);
            drive.used(&space, &id, at)?;
            Ok(Value::Object(Map::new()))
        }
        "open" => {
            let id = item_id(request, "item_id")?;
            let editing = request.get("editing").and_then(Value::as_bool).unwrap_or(false);
            drive.open(&space, &id, editing).await?;
            Ok(Value::Object(Map::new()))
        }
        "close" => {
            let id = item_id(request, "item_id")?;
            let editing = request.get("editing").and_then(Value::as_bool).unwrap_or(false);
            drive.close(&space, &id, editing).await;
            Ok(Value::Object(Map::new()))
        }
        _ => Err(DriveError::Unsupported(format!("Misty doesn't know “{op}”."))),
    }
}
