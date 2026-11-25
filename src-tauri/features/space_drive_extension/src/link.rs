use std::{
    io::{Read, Write},
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

use serde::Deserialize;
use serde_json::{json, Map, Value};

const MAX_FRAME: usize = 16 * 1024 * 1024;
const SLOW: Duration = Duration::from_secs(60 * 60);
const QUICK: Duration = Duration::from_secs(60);
const PAGE: u32 = 500;

#[derive(Debug)]
pub enum LinkError {
    Unreachable,
    Refused { code: String, message: String },
}

impl LinkError {
    pub fn code(&self) -> &str {
        match self {
            Self::Unreachable => "server_unreachable",
            Self::Refused { code, .. } => code,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
struct WireItem {
    id: String,
    parent_id: Option<String>,
    name: String,
    kind: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    mtime_ms: i64,
    #[serde(default)]
    sha256: Option<String>,
    #[serde(default)]
    version: Option<i64>,
    #[serde(default)]
    last_used_ms: Option<i64>,
    #[serde(default)]
    trashed: bool,
    #[serde(default)]
    deleted: bool,
}

#[derive(Debug, Clone)]
pub struct ItemInfo {
    pub id: String,
    pub parent: String,
    pub name: String,
    pub kind: String,
    pub size: u64,
    pub mtime_ms: i64,
    pub last_used_ms: Option<i64>,
    pub content_version: String,
    pub meta_version: String,
}

impl ItemInfo {
    pub fn is_folder(&self) -> bool {
        self.kind == "folder"
    }

    pub fn is_space(&self) -> bool {
        is_space(&self.id)
    }

    fn from_wire(item: WireItem) -> Self {
        let content_version = match (&item.sha256, item.kind.as_str()) {
            (_, "folder") => "folder".to_owned(),
            (Some(sha), _) => sha.clone(),
            (None, _) => format!("local-{}-{}", item.size, item.mtime_ms),
        };
        let meta_version = if is_space(&item.id) {
            format!("name:{}", item.name)
        } else {
            item.version.unwrap_or(0).to_string()
        };
        Self {
            id: item.id,
            parent: item.parent_id.unwrap_or_else(|| "root".to_owned()),
            name: item.name,
            kind: item.kind,
            size: item.size,
            mtime_ms: item.mtime_ms,
            last_used_ms: item.last_used_ms.filter(|ms| *ms > 0),
            content_version,
            meta_version,
        }
    }

    pub fn base_version(meta_version: &str) -> Option<i64> {
        meta_version.parse::<i64>().ok().filter(|version| *version > 0)
    }
}

pub struct Page {
    pub items: Vec<ItemInfo>,
    pub next_page: Option<String>,
}

pub struct Changes {
    pub updated: Vec<ItemInfo>,
    pub deleted: Vec<String>,
    pub anchor: String,
    pub more: bool,
}

pub struct Fetched {
    pub path: PathBuf,
    pub item: ItemInfo,
}

pub struct Changed {
    pub item: ItemInfo,
    pub refetch: bool,
}

pub fn is_space(id: &str) -> bool {
    id.starts_with("space:")
}

fn parent_value(parent: &str) -> Value {
    if parent == "root" {
        Value::Null
    } else {
        Value::String(parent.to_owned())
    }
}

pub struct Link {
    socket: Option<PathBuf>,
    staging: Option<PathBuf>,
    next: AtomicU64,
}

impl Link {
    pub fn new() -> Self {
        let container = crate::group::container();
        Self {
            socket: container.as_deref().and_then(socket_path),
            staging: container.map(|c| c.join("staging")),
            next: AtomicU64::new(1),
        }
    }

    fn call(&self, op: &str, fields: Value, slow: bool) -> Result<Map<String, Value>, LinkError> {
        let socket = self.socket.as_deref().ok_or(LinkError::Unreachable)?;
        let mut stream = UnixStream::connect(socket).map_err(|_| LinkError::Unreachable)?;
        let _ = stream.set_read_timeout(Some(if slow { SLOW } else { QUICK }));
        let _ = stream.set_write_timeout(Some(QUICK));
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let mut request = match fields {
            Value::Object(map) => map,
            _ => Map::new(),
        };
        request.insert("id".into(), id.into());
        request.insert("op".into(), op.into());
        let body = serde_json::to_vec(&Value::Object(request)).map_err(|error| refused("invalid", error))?;
        write_frame(&mut stream, &body).map_err(|_| LinkError::Unreachable)?;
        let reply = read_frame(&mut stream).map_err(|_| LinkError::Unreachable)?;
        let mut reply: Map<String, Value> =
            serde_json::from_slice(&reply).map_err(|error| refused("invalid", error))?;
        if reply.get("id").and_then(Value::as_u64) != Some(id) {
            return Err(refused("invalid", "the reply answers another request"));
        }
        if reply.get("ok").and_then(Value::as_bool) != Some(true) {
            let error = reply.remove("error").unwrap_or(Value::Null);
            return Err(LinkError::Refused {
                code: error["code"].as_str().unwrap_or("server").to_owned(),
                message: error["message"].as_str().unwrap_or_default().to_owned(),
            });
        }
        Ok(reply)
    }

    fn item_of(reply: &mut Map<String, Value>) -> Result<ItemInfo, LinkError> {
        let item = reply.remove("item").ok_or_else(|| refused("invalid", "no item"))?;
        let item: WireItem = serde_json::from_value(item).map_err(|error| refused("invalid", error))?;
        Ok(ItemInfo::from_wire(item))
    }

    pub fn item(&self, item: &str) -> Result<ItemInfo, LinkError> {
        let mut reply = self.call("item", json!({ "item_id": item }), false)?;
        Self::item_of(&mut reply)
    }

    pub fn list(&self, parent: &str, page: Option<&str>) -> Result<Page, LinkError> {
        if parent == "working_set" || parent == "trash" {
            return Ok(Page {
                items: Vec::new(),
                next_page: None,
            });
        }
        let reply = self.call(
            "list",
            json!({ "parent": parent_value(parent), "cursor": page, "limit": PAGE }),
            false,
        )?;
        let items: Vec<WireItem> = serde_json::from_value(reply.get("items").cloned().unwrap_or_else(|| Value::Array(Vec::new())))
            .map_err(|error| refused("invalid", error))?;
        Ok(Page {
            items: items.into_iter().map(ItemInfo::from_wire).collect(),
            next_page: reply.get("next_cursor").and_then(Value::as_str).map(str::to_owned),
        })
    }

    pub fn changes(&self, since: &str) -> Result<Changes, LinkError> {
        let reply = self.call("changes_since", json!({ "since": since, "limit": PAGE }), false)?;
        let items: Vec<WireItem> = serde_json::from_value(
            reply.get("items").cloned().unwrap_or_else(|| Value::Array(Vec::new())),
        )
        .map_err(|error| refused("invalid", error))?;
        let mut updated = Vec::new();
        let mut deleted = Vec::new();
        for item in items {
            if item.trashed || item.deleted {
                deleted.push(item.id);
            } else {
                updated.push(ItemInfo::from_wire(item));
            }
        }
        let next = reply
            .get("next_anchor")
            .and_then(Value::as_str)
            .filter(|anchor| !anchor.is_empty())
            .ok_or_else(|| refused("invalid", "no next_anchor"))?;
        Ok(Changes {
            updated,
            deleted,
            anchor: next.to_owned(),
            more: reply.get("more").and_then(Value::as_bool).unwrap_or(false),
        })
    }

    pub fn anchor(&self) -> Result<String, LinkError> {
        let reply = self.call("current_seq", json!({}), false)?;
        reply
            .get("anchor")
            .and_then(Value::as_str)
            .filter(|anchor| !anchor.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| refused("invalid", "no anchor"))
    }

    pub fn fetch(&self, item: &str) -> Result<Fetched, LinkError> {
        let mut reply = self.call("fetch", json!({ "item_id": item }), true)?;
        let path = reply
            .get("path")
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .ok_or_else(|| refused("invalid", "no path"))?;
        Ok(Fetched {
            item: Self::item_of(&mut reply)?,
            path,
        })
    }

    pub fn stage(&self, contents: &Path) -> Result<PathBuf, LinkError> {
        let staging = self.staging.as_deref().ok_or(LinkError::Unreachable)?;
        std::fs::create_dir_all(staging).map_err(|error| refused("io", error))?;
        let staged = staging.join(uuid::Uuid::new_v4().to_string());
        std::fs::copy(contents, &staged).map_err(|error| refused("io", error))?;
        Ok(staged)
    }

    pub fn sweep_staging(&self) {
        let Some(staging) = self.staging.as_deref() else {
            return;
        };
        let Ok(entries) = std::fs::read_dir(staging) else {
            return;
        };
        let stale = Duration::from_secs(24 * 60 * 60);
        for entry in entries.flatten() {
            let old = entry
                .metadata()
                .ok()
                .filter(|meta| meta.is_file())
                .and_then(|meta| meta.modified().ok())
                .and_then(|modified| modified.elapsed().ok())
                .is_some_and(|age| age > stale);
            if old {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    pub fn unstage(staged: Option<&Path>) {
        if let Some(staged) = staged {
            let _ = std::fs::remove_file(staged);
        }
    }

    pub fn create(
        &self,
        parent: &str,
        name: &str,
        folder: bool,
        staged: Option<&Path>,
        mtime_ms: Option<i64>,
        may_exist: bool,
    ) -> Result<Changed, LinkError> {
        let mut fields = json!({
            "parent": parent_value(parent),
            "name": name,
            "kind": if folder { "folder" } else { "file" },
            "may_exist": may_exist,
        });
        if let Some(staged) = staged {
            fields["staged"] = json!(staged);
        }
        if let Some(mtime_ms) = mtime_ms {
            fields["mtime_ms"] = json!(mtime_ms);
        }
        let mut reply = self.call("create", fields, true)?;
        Ok(Changed {
            item: Self::item_of(&mut reply)?,
            refetch: false,
        })
    }

    pub fn modify(
        &self,
        item: &str,
        base_version: Option<i64>,
        name: Option<&str>,
        parent: Option<&str>,
        staged: Option<&Path>,
        mtime_ms: Option<i64>,
    ) -> Result<Changed, LinkError> {
        let mut fields = Map::new();
        fields.insert("item_id".into(), item.into());
        if let Some(base_version) = base_version {
            fields.insert("base_version".into(), base_version.into());
        }
        if let Some(name) = name {
            fields.insert("name".into(), name.into());
        }
        if let Some(parent) = parent {
            fields.insert("parent".into(), parent_value(parent));
        }
        if let Some(staged) = staged {
            fields.insert("staged".into(), json!(staged));
        }
        if let Some(mtime_ms) = mtime_ms {
            fields.insert("mtime_ms".into(), mtime_ms.into());
        }
        let mut reply = self.call("modify", Value::Object(fields), true)?;
        Ok(Changed {
            refetch: reply.get("refetch").and_then(Value::as_bool).unwrap_or(false),
            item: Self::item_of(&mut reply)?,
        })
    }

    pub fn trash(&self, item: &str) -> Result<Option<ItemInfo>, LinkError> {
        let mut reply = self.call("trash", json!({ "item_id": item }), true)?;
        if !reply.contains_key("item") {
            return Ok(None);
        }
        Self::item_of(&mut reply).map(Some)
    }

    pub fn used(&self, item: &str, at_ms: i64) -> Result<(), LinkError> {
        self.call("used", json!({ "item_id": item, "at_ms": at_ms }), false)
            .map(|_| ())
    }
}

fn socket_path(container: &Path) -> Option<PathBuf> {
    ["drive.sock", "d.sock"]
        .into_iter()
        .map(|name| container.join(name))
        .find(|path| path.as_os_str().len() <= 103)
}

fn refused(code: &str, error: impl std::fmt::Display) -> LinkError {
    LinkError::Refused {
        code: code.to_owned(),
        message: error.to_string(),
    }
}

fn write_frame(stream: &mut UnixStream, body: &[u8]) -> std::io::Result<()> {
    let length = u32::try_from(body.len())
        .ok()
        .filter(|length| (*length as usize) <= MAX_FRAME)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "frame too large"))?;
    stream.write_all(&length.to_be_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

fn read_frame(stream: &mut UnixStream) -> std::io::Result<Vec<u8>> {
    let mut length = [0u8; 4];
    stream.read_exact(&mut length)?;
    let length = u32::from_be_bytes(length) as usize;
    if length > MAX_FRAME {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "frame too large"));
    }
    let mut body = vec![0u8; length];
    stream.read_exact(&mut body)?;
    Ok(body)
}
