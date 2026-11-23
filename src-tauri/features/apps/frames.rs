use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{ipc::InvokeBody, AppHandle, Emitter, Manager, Webview};

use crate::project::person_window;

mod page_bridge;
#[cfg(test)]
mod tests;

pub use page_bridge::*;

pub const LABEL_PREFIX: &str = "misty-app-";
pub const BYTES_PATH: &str = "/__misty/bytes/";
pub const TOKEN_HEADER: &str = "x-misty-token";
pub const PAGE_EVENT: &str = "misty://app-page";
pub const ADAPTER_WORLD: &str = "misty-adapter";
pub const ADAPTER_HANDLER: &str = "mistyAdapter";
const MAX_FRAME_BYTES: usize = 300_000;
const MAX_WORLD_BYTES: usize = 64 << 20;
const MAX_HELD_BYTES: usize = 1 << 30;
const RELAY: &str = include_str!("relay.js");
pub const SDK_SCRIPT: &str = include_str!("../../../node_modules/@misty/sdk/dist/misty-sdk.js");

struct Mount {
    app_id: String,
    version: String,
    token: String,
    owner: String,
    doc: Option<String>,
    bytes: HashMap<String, Vec<u8>>,
    held: usize,
    world: bool,
    lowered: bool,
    site: Option<SiteGate>,
    posting: HashMap<u64, Instant>,
    space: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FrameOrigin {
    pub scheme: String,
    pub host: String,
    pub port: Option<u16>,
}

impl FrameOrigin {
    pub fn of(url: &url::Url) -> Option<Self> {
        Some(Self {
            scheme: url.scheme().to_owned(),
            host: url.host_str()?.to_owned(),
            port: url.port(),
        })
    }
}

#[derive(Clone, Debug)]
pub struct SiteGate {
    pub address: FrameOrigin,
    pub adapter: Option<String>,
}

pub enum Heard {
    Nothing,
    Ready(Option<String>),
}

static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn remember_app(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

pub fn app() -> Option<&'static AppHandle> {
    APP.get()
}

fn mounts() -> &'static Mutex<HashMap<String, Mount>> {
    static MOUNTS: OnceLock<Mutex<HashMap<String, Mount>>> = OnceLock::new();
    MOUNTS.get_or_init(Mutex::default)
}

fn valid_name(value: &str, most: usize) -> bool {
    !value.is_empty()
        && value.len() <= most
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

pub fn valid_mount(mount: &str) -> bool {
    valid_name(mount, 96)
}

pub fn label_of(mount: &str) -> Result<String, String> {
    valid_mount(mount)
        .then(|| format!("{LABEL_PREFIX}{mount}"))
        .ok_or_else(|| "That app page isn't valid.".to_owned())
}

pub fn is_app_page(label: &str) -> bool {
    label.strip_prefix(LABEL_PREFIX).is_some_and(valid_mount)
}

pub fn mount_of(label: &str) -> Option<&str> {
    label
        .strip_prefix(LABEL_PREFIX)
        .filter(|mount| valid_mount(mount))
}

fn new_reference() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

pub fn register(
    mount: &str,
    app_id: &str,
    version: &str,
    owner: &str,
    world: bool,
    site: Option<SiteGate>,
) -> Result<String, String> {
    let token = new_reference();
    mounts()
        .lock()
        .map_err(|_| "App pages are unavailable.")?
        .insert(
            mount.to_owned(),
            Mount {
                app_id: app_id.to_owned(),
                version: version.to_owned(),
                token: token.clone(),
                owner: owner.to_owned(),
                doc: None,
                bytes: HashMap::new(),
                held: 0,
                world,
                lowered: false,
                site,
                posting: HashMap::new(),
                space: None,
            },
        );
    Ok(token)
}

pub fn forget(mount: &str) {
    if let Ok(mut mounts) = mounts().lock() {
        mounts.remove(mount);
    }
}

pub fn runs(mount: &str, app_id: &str, version: &str) -> bool {
    mounts()
        .lock()
        .ok()
        .and_then(|mounts| {
            mounts
                .get(mount)
                .map(|entry| entry.app_id == app_id && entry.version == version)
        })
        .unwrap_or(false)
}

fn with_mount<T>(mount: &str, read: impl FnOnce(&mut Mount) -> T) -> Option<T> {
    mounts().lock().ok()?.get_mut(mount).map(read)
}

pub fn app_of(mount: &str) -> Option<String> {
    with_mount(mount, |entry| entry.app_id.clone())
}

pub fn is_site(mount: &str) -> bool {
    with_mount(mount, |entry| entry.site.is_some()).unwrap_or(false)
}

pub fn site_address(mount: &str) -> Option<FrameOrigin> {
    with_mount(mount, |entry| {
        entry.site.as_ref().map(|site| site.address.clone())
    })
    .flatten()
}

pub fn document_left(app: &AppHandle, mount: &str) {
    if with_mount(mount, |entry| {
        entry.posting.clear();
        entry.doc.take()
    })
        .flatten()
        .is_some()
    {
        emit_page(app, mount, "opened", None);
    }
}

pub fn set_space(mount: &str, space: Option<String>) {
    with_mount(mount, |entry| entry.space = space);
}

pub fn space_of(mount: &str) -> Option<String> {
    with_mount(mount, |entry| entry.space.clone()).flatten()
}

pub fn current_doc(mount: &str) -> Option<String> {
    with_mount(mount, |entry| entry.doc.clone()).flatten()
}

pub fn on_doc(mount: &str, doc: &str) -> bool {
    with_mount(mount, |entry| entry.doc.as_deref() == Some(doc)).unwrap_or(false)
}

static POSTS: AtomicU64 = AtomicU64::new(0);

pub fn begin_post(mount: &str, most: usize, bound: Duration) -> Option<u64> {
    let now = Instant::now();
    with_mount(mount, |entry| {
        entry
            .posting
            .retain(|_, began| now.duration_since(*began) < bound);
        if entry.posting.len() >= most {
            return None;
        }
        let post = POSTS.fetch_add(1, Ordering::Relaxed);
        entry.posting.insert(post, now);
        Some(post)
    })
    .flatten()
}

pub fn end_post(mount: &str, post: u64) {
    with_mount(mount, |entry| entry.posting.remove(&post));
}

pub fn is_world(mount: &str) -> bool {
    with_mount(mount, |entry| entry.world).unwrap_or(false)
}

pub fn lowered(label: &str) -> bool {
    mount_of(label)
        .and_then(|mount| with_mount(mount, |entry| entry.lowered))
        .unwrap_or(false)
}

pub fn set_lowered(mount: &str, lowered: bool) -> bool {
    with_mount(mount, |entry| {
        std::mem::replace(&mut entry.lowered, lowered) != lowered
    })
    .unwrap_or(false)
}

pub fn emit_page(app: &AppHandle, mount: &str, kind: &'static str, body: Option<String>) {
    let Some(owner) = owner_of(mount) else {
        return;
    };
    let _ = app.emit_to(
        owner.as_str(),
        PAGE_EVENT,
        PageEvent {
            mount: mount.to_owned(),
            kind,
            body,
        },
    );
}

pub fn owner_of(mount: &str) -> Option<String> {
    mounts()
        .lock()
        .ok()
        .and_then(|mounts| mounts.get(mount).map(|entry| entry.owner.clone()))
}

pub fn serves(label: &str, app_id: Option<&str>) -> bool {
    let Some(mount) = mount_of(label) else {
        return false;
    };
    mounts()
        .lock()
        .ok()
        .and_then(|mounts| {
            mounts
                .get(mount)
                .map(|entry| app_id.is_none_or(|id| entry.app_id == id))
        })
        .unwrap_or(false)
}

fn token_matches(entry: &Mount, token: &str) -> bool {
    !token.is_empty() && entry.token == token
}

pub fn put_bytes(
    mount: &str,
    token: Option<&str>,
    reference: &str,
    bytes: Vec<u8>,
) -> Result<(), String> {
    if !valid_name(reference, 64) {
        return Err("That isn't a transfer.".into());
    }
    let mut mounts = mounts().lock().map_err(|_| "App pages are unavailable.")?;
    let entry = mounts.get_mut(mount).ok_or("The app has closed.")?;
    if token.is_some_and(|token| !token_matches(entry, token)) {
        return Err("That transfer isn't this page's.".into());
    }
    if entry.held + bytes.len() > MAX_HELD_BYTES {
        return Err("Too much is waiting to reach the app.".into());
    }
    entry.held += bytes.len();
    if let Some(replaced) = entry.bytes.insert(reference.to_owned(), bytes) {
        entry.held -= replaced.len();
    }
    Ok(())
}

pub fn take_bytes(mount: &str, token: Option<&str>, reference: &str) -> Option<Vec<u8>> {
    let mut mounts = mounts().lock().ok()?;
    let entry = mounts.get_mut(mount)?;
    if token.is_some_and(|token| !token_matches(entry, token)) {
        return None;
    }
    let bytes = entry.bytes.remove(reference)?;
    entry.held -= bytes.len();
    Some(bytes)
}

pub fn page_token(mount: &str, token: &str) -> bool {
    mounts()
        .lock()
        .ok()
        .and_then(|mounts| mounts.get(mount).map(|entry| token_matches(entry, token)))
        .unwrap_or(false)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PageMessage {
    token: String,
    doc: String,
    #[serde(default)]
    open: bool,
    #[serde(default)]
    ready: bool,
    #[serde(default)]
    frames: Option<Value>,
    #[serde(default)]
    json: Option<String>,
    #[serde(default)]
    shortcut: Option<Shortcut>,
    #[serde(default)]
    focus: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Shortcut {
    key: String,
    code: String,
    alt: bool,
    ctrl: bool,
    meta: bool,
    shift: bool,
    repeat: bool,
    editable: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ShortcutEvent {
    id: String,
    key: String,
    code: String,
    alt_key: bool,
    ctrl_key: bool,
    meta_key: bool,
    shift_key: bool,
    repeat: bool,
    editable: bool,
}

#[derive(Serialize, Clone)]
struct FocusEvent {
    id: String,
}

#[derive(Serialize, Clone)]
struct PageEvent {
    mount: String,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
}

enum Accepted {
    Opened,
    Ready,
    Current,
}

fn accept(
    mount: &str,
    origin: Option<&FrameOrigin>,
    message: &PageMessage,
) -> Option<(Accepted, String, Option<String>)> {
    let mut mounts = mounts().lock().ok()?;
    let entry = mounts.get_mut(mount)?;
    if !token_matches(entry, &message.token) || !valid_name(&message.doc, 64) {
        return None;
    }
    if let Some(site) = &entry.site {
        if origin != Some(&site.address) {
            return None;
        }
    }
    let adapter = entry.site.as_ref().and_then(|site| site.adapter.clone());
    let owner = entry.owner.clone();
    let fresh = entry.doc.as_deref() != Some(message.doc.as_str());
    if message.open || message.ready {
        entry.doc = Some(message.doc.clone());
        return Some((
            if message.ready {
                Accepted::Ready
            } else {
                Accepted::Opened
            },
            owner,
            adapter,
        ));
    }
    (!fresh).then_some((Accepted::Current, owner, None))
}

pub fn receive(
    app: &AppHandle,
    label: &str,
    main_frame: bool,
    origin: Option<&FrameOrigin>,
    body: &str,
) -> Heard {
    let Some(mount) = mount_of(label) else {
        return Heard::Nothing;
    };
    if !main_frame || body.len() > MAX_WORLD_BYTES {
        return Heard::Nothing;
    }
    let Ok(message) = serde_json::from_str::<PageMessage>(body) else {
        return Heard::Nothing;
    };
    let Some((accepted, owner, adapter)) = accept(mount, origin, &message) else {
        return Heard::Nothing;
    };
    let emit = |kind: &'static str, body: Option<String>| {
        let _ = app.emit_to(
            owner.as_str(),
            PAGE_EVENT,
            PageEvent {
                mount: mount.to_owned(),
                kind,
                body,
            },
        );
    };
    match accepted {
        Accepted::Opened => {
            emit("opened", None);
            return Heard::Nothing;
        }
        Accepted::Ready if is_world(mount) => return Heard::Ready(adapter),
        Accepted::Ready => {
            emit("ready", Some(message.doc.clone()));
            return Heard::Nothing;
        }
        Accepted::Current => {}
    }
    if message.focus {
        let _ = app.emit_to(
            owner.as_str(),
            "misty://browser-focus",
            FocusEvent {
                id: mount.to_owned(),
            },
        );
    }
    if let Some(shortcut) = message.shortcut {
        let _ = app.emit_to(
            owner.as_str(),
            "misty://browser-focus",
            FocusEvent {
                id: mount.to_owned(),
            },
        );
        let _ = app.emit_to(
            owner.as_str(),
            "misty://browser-shortcut",
            ShortcutEvent {
                id: mount.to_owned(),
                key: shortcut.key,
                code: shortcut.code,
                alt_key: shortcut.alt,
                ctrl_key: shortcut.ctrl,
                meta_key: shortcut.meta,
                shift_key: shortcut.shift,
                repeat: shortcut.repeat,
                editable: shortcut.editable,
            },
        );
    }
    if let Some(frames) = message.frames {
        emit("frames", Some(frames.to_string()));
    }
    if let Some(reference) = message.json {
        let text =
            take_bytes(mount, None, &reference).and_then(|bytes| String::from_utf8(bytes).ok());
        let frames = text
            .as_deref()
            .and_then(|text| serde_json::from_str::<Value>(text).ok())
            .and_then(|mut value| value.get_mut("frames").map(Value::take));
        match frames {
            Some(frames) => emit("frames", Some(frames.to_string())),
            None => emit("lost", None),
        }
    }
    Heard::Nothing
}
