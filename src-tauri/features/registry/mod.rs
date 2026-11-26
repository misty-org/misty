use futures_util::StreamExt;
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::app::runtime::MistyRuntime;

pub mod bundles;
pub mod files;
pub mod installs;
pub mod local;

const BUNDLED: &str = include_str!("../../../src/shared/registry/index.min.json");
const BUNDLED_SHARDS: &str = include_str!("../../../src/shared/registry/shards.json");
const SITE: &str = "https://registry.mistysys.com/";
const ROOT: &str = "index.min.json";
const SIGNATURE: &str = "index.min.json.sig";
const SCOPE: &str = "registry:feed";
const STALE_AFTER_SECS: u64 = 24 * 60 * 60;
const MAX_ROOT_BYTES: usize = 1 << 20;
const MAX_SHARD_BYTES: u64 = 6 << 20;
const MAX_SIGNATURE_BYTES: usize = 4 << 10;
const SCHEMA: u64 = 3;
const LISTINGS: &[&str] = &["plugins", "skills", "templates", "mcps"];
const SECTIONS: &[&str] = &["categories", "apps", "engines", "speech", "ignore"];

pub const REGISTRY_KEYS: &[(&str, &str)] =
    &[("misty-registry-2", "VJ+xEM4XzgU5TO8sQNvKp6uAr082gCWUFksnpZ4zH2M=")];

pub const CHANGED_EVENT: &str = "misty://registry-changed";

pub struct Registry {
    document: Value,
}

impl Registry {
    fn section(&self, key: &str) -> Value {
        let value = self.document.get(key).cloned().unwrap_or(Value::Null);
        if key == "apps" {
            local::with_local_apps(value)
        } else {
            value
        }
    }

    fn published_at(&self) -> &str {
        self.document
            .get("published_at")
            .and_then(Value::as_str)
            .unwrap_or("")
    }

    pub fn apps_json(&self) -> String {
        self.section("apps").to_string()
    }

    pub fn speech(&self) -> Value {
        self.section("speech")
    }

    fn shard_ref(&self, kind: &str, category: Option<&str>) -> Option<ShardRef> {
        let listing = self.document.get("listings")?.get(kind)?;
        let entry = match category {
            Some(category) => listing.get("categories")?.get(category)?,
            None => listing.get("top")?,
        };
        serde_json::from_value(entry.clone()).ok()
    }
}

static CURRENT: LazyLock<RwLock<Arc<Registry>>> = LazyLock::new(|| {
    let root: Value = serde_json::from_str(BUNDLED).unwrap_or(Value::Null);
    let document = assembled(&root, |shard| {
        BUNDLED_SHARD_TEXT
            .get(&shard.path)
            .filter(|text| fits(shard, text))
            .cloned()
            .ok_or_else(|| "The bundled registry is missing a section.".to_string())
    })
    .unwrap_or(root);
    RwLock::new(Arc::new(Registry { document }))
});

static BUNDLED_SHARD_TEXT: LazyLock<HashMap<String, String>> =
    LazyLock::new(|| serde_json::from_str(BUNDLED_SHARDS).unwrap_or_default());

pub fn current() -> Arc<Registry> {
    match CURRENT.read() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

fn replace(document: Value) {
    if let Ok(mut held) = PARSED.lock() {
        held.clear();
    }
    let next = Arc::new(Registry { document });
    match CURRENT.write() {
        Ok(mut guard) => *guard = next,
        Err(poisoned) => *poisoned.into_inner() = next,
    }
}

#[derive(Default, Serialize, Deserialize)]
struct Cached {
    #[serde(default)]
    etag: Option<String>,
    #[serde(default)]
    checked_at: u64,
    #[serde(default)]
    document: Option<Value>,
}

#[derive(Clone, Debug, Deserialize)]
struct ShardRef {
    path: String,
    sha256: String,
    size: u64,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

fn store(app: &AppHandle) -> database::store::Store {
    app.state::<MistyRuntime>().environment.store()
}

fn read_cached(app: &AppHandle) -> Cached {
    let read = || -> Result<Option<String>, rusqlite::Error> {
        store(app)
            .connect()?
            .query_row(
                "SELECT document FROM settings_state WHERE scope = ?1",
                [SCOPE],
                |row| row.get(0),
            )
            .optional()
    };
    read()
        .ok()
        .flatten()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_cached(app: &AppHandle, cached: &Cached) -> Result<(), String> {
    let text = serde_json::to_string(cached).map_err(|error| error.to_string())?;
    store(app)
        .connect()
        .and_then(|connection| {
            connection.execute(
                "INSERT INTO settings_state(scope, revision, document) VALUES(?1, 1, ?2)
                 ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, document = excluded.document",
                params![SCOPE, text],
            )
        })
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[derive(Deserialize)]
struct Detached {
    kid: String,
    alg: String,
    signature: String,
}

fn verified(root: &[u8], signature: &str, keys: &[(&str, &str)]) -> Result<Value, String> {
    let detached: Detached = serde_json::from_str(signature)
        .map_err(|_| "The registry's signature isn't readable.".to_string())?;
    if detached.alg != "EdDSA" {
        return Err("The registry is signed in a way Misty doesn't read.".into());
    }
    let Some((_, public)) = keys.iter().find(|(kid, _)| *kid == detached.kid) else {
        return Err("The registry isn't signed by a key Misty knows.".into());
    };
    let key = STANDARD
        .decode(public)
        .ok()
        .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
        .and_then(|bytes| VerifyingKey::from_bytes(&bytes).ok())
        .ok_or_else(|| "A registry key Misty carries isn't readable.".to_string())?;
    let signature = URL_SAFE_NO_PAD
        .decode(detached.signature.trim_end_matches('='))
        .ok()
        .and_then(|bytes| Signature::from_slice(&bytes).ok())
        .ok_or_else(|| "The registry's signature isn't readable.".to_string())?;
    key.verify_strict(root, &signature)
        .map_err(|_| "The registry's signature doesn't match it.".to_string())?;
    serde_json::from_slice(root).map_err(|_| "The registry isn't JSON.".to_string())
}

fn usable(document: &Value) -> bool {
    document.get("schema").and_then(Value::as_u64) == Some(SCHEMA)
        && document
            .get("published_at")
            .and_then(Value::as_str)
            .is_some_and(|at| !at.is_empty())
}

fn newer_than_current(document: &Value) -> bool {
    let at = document
        .get("published_at")
        .and_then(Value::as_str)
        .unwrap_or("");
    at > current().published_at()
}

pub fn start(app: &AppHandle) {
    let cached = read_cached(app);
    let held = cached.document.as_ref().filter(|document| usable(document));
    if let Some(document) = held {
        replace(document.clone());
    }
    if held.is_some() && now().saturating_sub(cached.checked_at) < STALE_AFTER_SECS {
        return;
    }
    let app = app.clone();
    crate::app::first_draw::after_first_draw(move || {
        tauri::async_runtime::spawn(async move {
            let _ = refresh(&app, cached).await;
        });
    });
}

async fn fetch(client: &reqwest::Client, path: &str, most: usize) -> Result<Vec<u8>, String> {
    let response = client
        .get(format!("{SITE}{path}"))
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|error| error.to_string())?;
    if response.content_length().is_some_and(|length| length > most as u64) {
        return Err("a registry file is larger than it may be".into());
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > most {
        return Err("a registry file is larger than it may be".into());
    }
    Ok(bytes.to_vec())
}

async fn refresh(app: &AppHandle, mut cached: Cached) -> Result<(), String> {
    let client = crate::engine_config::support::http_client()?;
    let mut request = client.get(format!("{SITE}{ROOT}"));
    if let Some(etag) = cached
        .etag
        .as_deref()
        .filter(|_| cached.document.as_ref().is_some_and(usable))
    {
        request = request.header(reqwest::header::IF_NONE_MATCH, etag);
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    cached.checked_at = now();
    if response.status() == reqwest::StatusCode::NOT_MODIFIED {
        return write_cached(app, &cached);
    }
    if !response.status().is_success() {
        write_cached(app, &cached)?;
        return Err(format!("the registry answered {}", response.status()));
    }
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let root = response.bytes().await.map_err(|error| error.to_string())?;
    if root.len() > MAX_ROOT_BYTES {
        write_cached(app, &cached)?;
        return Err("the registry's index is too large".into());
    }
    let signature = fetch(&client, SIGNATURE, MAX_SIGNATURE_BYTES).await?;
    let signature =
        String::from_utf8(signature).map_err(|_| "the registry's signature isn't text")?;
    let root = verified(&root, &signature, REGISTRY_KEYS)?;
    if !usable(&root) {
        write_cached(app, &cached)?;
        return Err("the registry is a schema this Misty doesn't read".into());
    }
    if !newer_than_current(&root) {
        cached.etag = etag;
        return write_cached(app, &cached);
    }
    let mut texts = HashMap::new();
    for shard in section_refs(&root)? {
        let text = shard_text(app, &shard).await?;
        texts.insert(shard.path.clone(), text);
    }
    let document = assembled(&root, |shard| {
        texts
            .get(&shard.path)
            .cloned()
            .ok_or_else(|| "A section of the registry didn't arrive.".to_string())
    })?;
    cached.etag = etag;
    cached.document = Some(document.clone());
    write_cached(app, &cached)?;
    let _ = prune_shards(app, &document);
    replace(document);
    let _ = app.emit(CHANGED_EVENT, ());
    Ok(())
}

fn section_refs(root: &Value) -> Result<Vec<ShardRef>, String> {
    SECTIONS
        .iter()
        .map(|name| {
            root.get("sections")
                .and_then(|sections| sections.get(name))
                .and_then(|entry| serde_json::from_value(entry.clone()).ok())
                .ok_or_else(|| format!("The registry's index names no {name} section."))
        })
        .collect()
}

fn assembled(
    root: &Value,
    text_of: impl Fn(&ShardRef) -> Result<String, String>,
) -> Result<Value, String> {
    let mut document = serde_json::Map::new();
    for key in ["schema", "published_at", "sections", "listings"] {
        if let Some(value) = root.get(key) {
            document.insert(key.to_string(), value.clone());
        }
    }
    for (name, shard) in SECTIONS.iter().zip(section_refs(root)?) {
        let body: Value = serde_json::from_str(&text_of(&shard)?)
            .map_err(|_| format!("The registry's {name} section isn't JSON."))?;
        let data = body
            .get("data")
            .cloned()
            .ok_or_else(|| format!("The registry's {name} section is empty."))?;
        document.insert((*name).to_string(), data);
    }
    Ok(Value::Object(document))
}

fn named_shards(document: &Value) -> Vec<String> {
    let mut named: Vec<String> = section_refs(document)
        .unwrap_or_default()
        .into_iter()
        .map(|shard| shard.sha256)
        .collect();
    for kind in LISTINGS {
        let Some(listing) = document.get("listings").and_then(|listings| listings.get(kind)) else {
            continue;
        };
        if let Some(sha) = listing.pointer("/top/sha256").and_then(Value::as_str) {
            named.push(sha.to_string());
        }
        if let Some(categories) = listing.get("categories").and_then(Value::as_object) {
            named.extend(
                categories
                    .values()
                    .filter_map(|entry| entry.get("sha256").and_then(Value::as_str))
                    .map(str::to_string),
            );
        }
    }
    named
}

fn prune_shards(app: &AppHandle, document: &Value) -> Result<(), String> {
    let named = named_shards(document);
    let connection = store(app).connect().map_err(|error| error.to_string())?;
    let held: Vec<String> = connection
        .prepare("SELECT sha256 FROM registry_shards")
        .and_then(|mut statement| {
            statement
                .query_map([], |row| row.get(0))?
                .collect::<Result<Vec<String>, _>>()
        })
        .map_err(|error| error.to_string())?;
    for sha in held.iter().filter(|sha| !named.contains(sha)) {
        connection
            .execute("DELETE FROM registry_shards WHERE sha256 = ?1", [sha])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn fits(shard: &ShardRef, text: &str) -> bool {
    text.len() as u64 == shard.size && hex::encode(Sha256::digest(text.as_bytes())) == shard.sha256
}

fn safe_path(path: &str) -> bool {
    path.starts_with("index/")
        && path.ends_with(".json")
        && !path.contains("..")
        && !path.contains("//")
        && path
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'-' | b'_'))
}

fn cached_shard(app: &AppHandle, shard: &ShardRef) -> Option<String> {
    store(app)
        .connect()
        .ok()?
        .query_row(
            "SELECT body FROM registry_shards WHERE sha256 = ?1",
            [&shard.sha256],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .ok()
        .flatten()
        .filter(|text| fits(shard, text))
}

fn keep_shard(app: &AppHandle, shard: &ShardRef, text: &str) {
    if let Ok(connection) = store(app).connect() {
        let _ = connection.execute(
            "INSERT OR REPLACE INTO registry_shards(sha256, body) VALUES(?1, ?2)",
            params![shard.sha256, text],
        );
    }
}

async fn shard_text(app: &AppHandle, shard: &ShardRef) -> Result<String, String> {
    if !safe_path(&shard.path) || shard.sha256.len() != 64 || shard.size > MAX_SHARD_BYTES {
        return Err("The registry names a listing Misty won't read.".into());
    }
    if let Some(text) = cached_shard(app, shard) {
        return Ok(text);
    }
    if let Some(text) = BUNDLED_SHARD_TEXT
        .get(&shard.path)
        .filter(|text| fits(shard, text))
    {
        return Ok(text.clone());
    }
    let client = crate::engine_config::support::http_client()?;
    let bytes = fetch(&client, &shard.path, MAX_SHARD_BYTES as usize)
        .await
        .map_err(|_| "Couldn't reach Misty's registry. Check your connection and try again.".to_string())?;
    let text = String::from_utf8(bytes).map_err(|_| "A registry listing isn't text.".to_string())?;
    if !fits(shard, &text) {
        return Err("A registry listing doesn't match its checksum.".into());
    }
    keep_shard(app, shard, &text);
    Ok(text)
}

async fn shard_value(app: &AppHandle, kind: &str, category: Option<&str>) -> Result<Value, String> {
    if !LISTINGS.contains(&kind) {
        return Err("The registry lists no such kind.".into());
    }
    let shard = current()
        .shard_ref(kind, category)
        .ok_or_else(|| "The registry has no such listing.".to_string())?;
    let text = shard_text(app, &shard).await?;
    serde_json::from_str(&text).map_err(|_| "A registry listing isn't JSON.".to_string())
}

#[derive(Serialize)]
pub struct RegistryView {
    categories: Value,
    apps: Value,
    engines: Value,
    speech: Value,
    ignore: Value,
    listings: Value,
    published_at: String,
}

#[tauri::command]
pub fn registry_get() -> RegistryView {
    let registry = current();
    RegistryView {
        categories: registry.section("categories"),
        apps: registry.section("apps"),
        engines: registry.section("engines"),
        speech: registry.section("speech"),
        ignore: registry.section("ignore"),
        listings: registry.section("listings"),
        published_at: registry.published_at().to_string(),
    }
}

#[tauri::command]
pub async fn registry_top(app: AppHandle, kind: String) -> Result<Value, String> {
    shard_value(&app, &kind, None).await
}

#[tauri::command]
pub async fn registry_category(
    app: AppHandle,
    kind: String,
    category: String,
) -> Result<Value, String> {
    shard_value(&app, &kind, Some(&category)).await
}

static PARSED: LazyLock<std::sync::Mutex<HashMap<String, Arc<Vec<Value>>>>> =
    LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

type ShardLoad = Result<Arc<Vec<Value>>, String>;

async fn shard_items(app: &AppHandle, shard: &ShardRef) -> Result<Arc<Vec<Value>>, String> {
    if let Some(items) = PARSED.lock().ok().and_then(|held| held.get(&shard.sha256).cloned()) {
        return Ok(items);
    }
    let text = shard_text(app, shard).await?;
    let body: Value = serde_json::from_str(&text).map_err(|_| "A registry listing isn't JSON.".to_string())?;
    let items = Arc::new(
        body.get("items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    );
    if let Ok(mut held) = PARSED.lock() {
        held.insert(shard.sha256.clone(), items.clone());
    }
    Ok(items)
}

fn hit(item: &Value, words: &[String]) -> bool {
    let field = |key: &str| item.get(key).and_then(Value::as_str).unwrap_or("").to_lowercase();
    let text = format!("{} {} {}", field("name"), field("description"), field("maker"));
    words.iter().all(|word| text.contains(word.as_str()))
}

fn rank(item: &Value) -> i64 {
    item.get("rank").and_then(Value::as_i64).unwrap_or(0)
}

#[derive(Serialize)]
pub struct SearchKind {
    count: usize,
    items: Vec<Value>,
}

#[tauri::command]
pub async fn registry_search(
    app: AppHandle,
    query: String,
    kind: Option<String>,
    limit: usize,
) -> Result<HashMap<String, SearchKind>, String> {
    let words: Vec<String> = query
        .to_lowercase()
        .split_whitespace()
        .map(str::to_string)
        .collect();
    let limit = limit.clamp(1, 2000);
    let wanted: Vec<String> = LISTINGS
        .iter()
        .filter(|one| kind.as_deref().is_none_or(|asked| asked == **one))
        .map(|one| (*one).to_string())
        .collect();
    let jobs: Vec<(String, ShardRef)> = {
        let registry = current();
        wanted
            .iter()
            .flat_map(|listing| {
                registry
                    .document
                    .pointer(&format!("/listings/{listing}/categories"))
                    .and_then(Value::as_object)
                    .map(|categories| {
                        categories
                            .values()
                            .filter_map(|entry| serde_json::from_value::<ShardRef>(entry.clone()).ok())
                            .map(|shard| (listing.clone(), shard))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default()
            })
            .collect()
    };
    let loaded: Vec<(String, ShardLoad)> = futures_util::stream::iter(jobs.into_iter().map(|(listing, shard)| {
        let app = app.clone();
        async move { (listing, shard_items(&app, &shard).await) }
    }))
    .buffer_unordered(8)
    .collect()
    .await;
    let mut hits: HashMap<String, Vec<Value>> = wanted.iter().map(|listing| (listing.clone(), Vec::new())).collect();
    for (listing, items) in loaded {
        let items = items?;
        hits.entry(listing).or_default().extend(items.iter().filter(|item| hit(item, &words)).cloned());
    }
    let mut found = HashMap::new();
    for (listing, mut hits) in hits {
        hits.sort_by(|a, b| {
            rank(b).cmp(&rank(a)).then_with(|| {
                let name = |item: &Value| item.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                name(a).cmp(&name(b))
            })
        });
        let count = hits.len();
        hits.truncate(limit);
        found.insert(listing, SearchKind { count, items: hits });
    }
    Ok(found)
}

#[tauri::command]
pub async fn registry_find(app: AppHandle, kind: String, ids: Vec<String>) -> Result<Vec<Value>, String> {
    if !LISTINGS.contains(&kind.as_str()) {
        return Err("The registry lists no such kind.".into());
    }
    let wanted: std::collections::HashSet<String> = ids.into_iter().take(2000).collect();
    let refs: Vec<ShardRef> = current()
        .document
        .pointer(&format!("/listings/{kind}/categories"))
        .and_then(Value::as_object)
        .map(|categories| {
            categories
                .values()
                .filter_map(|entry| serde_json::from_value(entry.clone()).ok())
                .collect()
        })
        .unwrap_or_default();
    let mut found = Vec::new();
    for shard in &refs {
        let items = shard_items(&app, shard).await?;
        found.extend(
            items
                .iter()
                .filter(|item| item.get("id").and_then(Value::as_str).is_some_and(|id| wanted.contains(id)))
                .cloned(),
        );
        if found.len() == wanted.len() {
            break;
        }
    }
    Ok(found)
}

const MAX_SOURCE_BYTES: usize = 512 << 10;

fn pinned_file_url(repo: &str, commit: &str, path: &str) -> Option<String> {
    let mut parts = repo.split('/');
    let (Some(owner), Some(name), None) = (parts.next(), parts.next(), parts.next()) else {
        return None;
    };
    let named = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
            && part != "."
            && part != ".."
    };
    let pinned = commit.len() == 40 && commit.bytes().all(|byte| byte.is_ascii_hexdigit());
    let inside = !path.is_empty()
        && !path.starts_with('/')
        && path.split('/').all(|part| !part.is_empty() && part != "." && part != "..")
        && !path.contains(['\\', '?', '#', '%']);
    (named(owner) && named(name) && pinned && inside)
        .then(|| format!("https://raw.githubusercontent.com/{owner}/{name}/{commit}/{path}"))
}

#[tauri::command]
pub async fn registry_source_file(repo: String, commit: String, path: String) -> Result<String, String> {
    let url = pinned_file_url(&repo, &commit, &path)
        .ok_or_else(|| "The registry names a file Misty won't read.".to_string())?;
    let client = crate::engine_config::support::http_client()?;
    let response = client
        .get(url)
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map_err(|_| "Couldn't reach GitHub. Check your connection and try again.".to_string())?;
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "Couldn't reach GitHub. Check your connection and try again.".to_string())?;
    if bytes.len() > MAX_SOURCE_BYTES {
        return Err("The file is larger than Misty reads.".into());
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| "The file isn't text.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn signature(signing: &SigningKey, kid: &str, root: &[u8]) -> String {
        let signed = signing.sign(root);
        serde_json::json!({ "kid": kid, "alg": "EdDSA", "signature": URL_SAFE_NO_PAD.encode(signed.to_bytes()) })
            .to_string()
    }

    #[test]
    fn takes_only_what_a_pinned_key_signed() {
        let signing = SigningKey::from_bytes(&[7; 32]);
        let public = STANDARD.encode(signing.verifying_key().to_bytes());
        let keys = [("registry-1", public.as_str())];
        let root = br#"{"schema":2,"published_at":"2026-11-24T00:00:00Z","apps":[]}"#;
        let document: Value = serde_json::from_slice(root).unwrap();
        assert_eq!(
            verified(root, &signature(&signing, "registry-1", root), &keys).unwrap(),
            document
        );
        assert!(verified(root, &signature(&signing, "other", root), &keys).is_err());
        let stranger = SigningKey::from_bytes(&[9; 32]);
        assert!(verified(root, &signature(&stranger, "registry-1", root), &keys).is_err());
        let tampered = br#"{"schema":2,"published_at":"2026-11-25T00:00:00Z","apps":[]}"#;
        assert!(verified(tampered, &signature(&signing, "registry-1", root), &keys).is_err());
    }

    #[test]
    fn pinned_files_come_only_from_a_repository_at_a_commit() {
        let commit = "4adeee6732a12d1540f49a4d50a38ce8c97f9a53";
        assert_eq!(
            pinned_file_url("affaan-m/ECC", commit, "agents/a11y-architect.md").as_deref(),
            Some("https://raw.githubusercontent.com/affaan-m/ECC/4adeee6732a12d1540f49a4d50a38ce8c97f9a53/agents/a11y-architect.md")
        );
        assert!(pinned_file_url("affaan-m/ECC", "HEAD", "a.md").is_none());
        assert!(pinned_file_url("affaan-m/ECC", commit, "../a.md").is_none());
        assert!(pinned_file_url("a/b/c", commit, "a.md").is_none());
    }

    #[test]
    fn search_matches_every_word_in_any_field() {
        let item = serde_json::json!({ "name": "PDF tools", "description": "Merge files", "maker": "Ana", "rank": 5 });
        let words = |text: &str| text.split_whitespace().map(str::to_string).collect::<Vec<_>>();
        assert!(hit(&item, &words("pdf merge ana")));
        assert!(!hit(&item, &words("pdf video")));
        assert_eq!(rank(&item), 5);
        assert_eq!(rank(&serde_json::json!({})), 0);
    }

    #[test]
    fn shards_are_read_only_from_the_index_folder() {
        assert!(safe_path("index/skills/top.004adc3dd1e3.json"));
        assert!(!safe_path("index/../keys.json"));
        assert!(!safe_path("https://example.com/index/a.json"));
        assert!(!safe_path("apps/a.zip"));
    }

    #[tokio::test]
    #[ignore = "reads the published registry at registry.mistysys.com"]
    async fn the_published_index_verifies_and_every_shard_it_names_is_there() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::new();
        let root = fetch(&client, ROOT, MAX_ROOT_BYTES).await.expect("the root is published");
        let signature = fetch(&client, SIGNATURE, 4096).await.expect("its signature is published");
        let document = verified(&root, &String::from_utf8(signature).unwrap(), REGISTRY_KEYS).expect("a key Misty carries signed it");
        assert!(usable(&document), "the published root is schema {SCHEMA} with a publish time");
        let mut shards = section_refs(&document).expect("it names every section");
        for kind in LISTINGS {
            let listing = &document["listings"][kind];
            shards.push(serde_json::from_value(listing["top"].clone()).expect("a top shard"));
            for one in listing["categories"].as_object().expect("its categories").values() {
                shards.push(serde_json::from_value(one.clone()).expect("a category shard"));
            }
        }
        for shard in &shards {
            let bytes = fetch(&client, &shard.path, MAX_SHARD_BYTES as usize).await.expect("the shard is there");
            assert!(fits(shard, &String::from_utf8(bytes).unwrap()), "{} matches its checksum", shard.path);
        }
        eprintln!("published {} verified, {} shards match", document["published_at"], shards.len());
    }

    #[test]
    fn the_bundled_copy_reads() {
        let registry = current();
        assert!(registry.section("apps").as_array().is_some());
        assert!(registry.speech().get("voices").is_some());
        assert!(registry.section("engines").as_array().is_some());
        assert!(registry.section("ignore").as_array().is_some());
        for kind in LISTINGS {
            let top = registry.shard_ref(kind, None).unwrap();
            let text = BUNDLED_SHARD_TEXT.get(&top.path).unwrap();
            assert!(fits(&top, text));
        }
    }
}
