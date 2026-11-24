use std::sync::{Arc, LazyLock, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::app::runtime::MistyRuntime;

pub mod files;
pub mod local;

const BUNDLED: &str = include_str!("../../../src/shared/registry/registry.json");
const FEED: &str = "https://registry.mistysys.com/registry.jws.json";
const SCOPE: &str = "registry:feed";
const STALE_AFTER_SECS: u64 = 24 * 60 * 60;
const MAX_FEED_BYTES: usize = 8 << 20;
const SCHEMA: u64 = 1;

pub const REGISTRY_KEYS: &[(&str, &str)] =
    &[("misty-registry", "Nbnp8dQWU7ibTphBreL9xu1zOaBIBQqT2yY6rIcmqkU=")];

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
}

static CURRENT: LazyLock<RwLock<Arc<Registry>>> = LazyLock::new(|| {
    RwLock::new(Arc::new(Registry {
        document: serde_json::from_str(BUNDLED).unwrap_or(Value::Null),
    }))
});

pub fn current() -> Arc<Registry> {
    match CURRENT.read() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
    }
}

fn replace(document: Value) {
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
struct Envelope {
    payload: String,
    signatures: Vec<EnvelopeSignature>,
}

#[derive(Deserialize)]
struct EnvelopeSignature {
    protected: String,
    signature: String,
}

#[derive(Deserialize)]
struct Header {
    alg: String,
    kid: String,
}

fn verified(text: &str, keys: &[(&str, &str)]) -> Result<Value, String> {
    let envelope: Envelope = serde_json::from_str(text)
        .map_err(|_| "The registry file isn't signed JSON.".to_string())?;
    for entry in &envelope.signatures {
        let Ok(header) = URL_SAFE_NO_PAD
            .decode(&entry.protected)
            .map_err(|_| ())
            .and_then(|bytes| serde_json::from_slice::<Header>(&bytes).map_err(|_| ()))
        else {
            continue;
        };
        if header.alg != "EdDSA" {
            continue;
        }
        let Some((_, public)) = keys.iter().find(|(kid, _)| *kid == header.kid) else {
            continue;
        };
        let Some(key) = STANDARD
            .decode(public)
            .ok()
            .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
            .and_then(|bytes| VerifyingKey::from_bytes(&bytes).ok())
        else {
            continue;
        };
        let Some(signature) = URL_SAFE_NO_PAD
            .decode(&entry.signature)
            .ok()
            .and_then(|bytes| Signature::from_slice(&bytes).ok())
        else {
            continue;
        };
        let signed = format!("{}.{}", entry.protected, envelope.payload);
        if key.verify_strict(signed.as_bytes(), &signature).is_err() {
            continue;
        }
        let payload = URL_SAFE_NO_PAD
            .decode(&envelope.payload)
            .map_err(|_| "The registry's payload isn't readable.".to_string())?;
        return serde_json::from_slice(&payload)
            .map_err(|_| "The registry's payload isn't JSON.".to_string());
    }
    Err("The registry file isn't signed by a key Misty knows.".into())
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
    if let Some(document) = cached.document.as_ref().filter(|document| usable(document)) {
        replace(document.clone());
    }
    if now().saturating_sub(cached.checked_at) < STALE_AFTER_SECS {
        return;
    }
    let app = app.clone();
    crate::app::first_draw::after_first_draw(move || {
        tauri::async_runtime::spawn(async move {
            let _ = refresh(&app, cached).await;
        });
    });
}

async fn refresh(app: &AppHandle, mut cached: Cached) -> Result<(), String> {
    let client = crate::engine_config::support::http_client()?;
    let mut request = client.get(FEED);
    if let Some(etag) = cached.etag.as_deref() {
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
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > MAX_FEED_BYTES {
        write_cached(app, &cached)?;
        return Err("the registry file is too large".into());
    }
    let text = String::from_utf8(bytes.to_vec()).map_err(|_| "the registry file isn't text")?;
    let document = verified(&text, REGISTRY_KEYS)?;
    if !usable(&document) {
        write_cached(app, &cached)?;
        return Err("the registry file is a schema this Misty doesn't read".into());
    }
    if !newer_than_current(&document) {
        cached.etag = etag;
        return write_cached(app, &cached);
    }
    cached.etag = etag;
    cached.document = Some(document.clone());
    write_cached(app, &cached)?;
    replace(document);
    let _ = app.emit(CHANGED_EVENT, ());
    Ok(())
}

#[derive(Serialize)]
pub struct RegistryView {
    apps: Value,
    engines: Value,
    ignore: Value,
    published_at: String,
}

#[tauri::command]
pub fn registry_get() -> RegistryView {
    let registry = current();
    RegistryView {
        apps: registry.section("apps"),
        engines: registry.section("engines"),
        ignore: registry.section("ignore"),
        published_at: registry.published_at().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn envelope(signing: &SigningKey, kid: &str, document: &Value) -> String {
        let payload = URL_SAFE_NO_PAD.encode(document.to_string());
        let protected = URL_SAFE_NO_PAD.encode(format!(r#"{{"alg":"EdDSA","kid":"{kid}"}}"#));
        let signature = signing.sign(format!("{protected}.{payload}").as_bytes());
        serde_json::json!({
            "payload": payload,
            "signatures": [{ "protected": protected, "signature": URL_SAFE_NO_PAD.encode(signature.to_bytes()) }],
        })
        .to_string()
    }

    #[test]
    fn takes_only_what_a_pinned_key_signed() {
        let signing = SigningKey::from_bytes(&[7; 32]);
        let public = STANDARD.encode(signing.verifying_key().to_bytes());
        let keys = [("registry-1", public.as_str())];
        let document =
            serde_json::json!({ "schema": 1, "published_at": "2026-11-22T00:00:00Z", "apps": {} });
        let text = envelope(&signing, "registry-1", &document);
        assert_eq!(verified(&text, &keys).unwrap(), document);
        assert!(verified(&envelope(&signing, "other", &document), &keys).is_err());
        let stranger = SigningKey::from_bytes(&[9; 32]);
        assert!(verified(&envelope(&stranger, "registry-1", &document), &keys).is_err());
        let tampered = text.replace(&text[20..24], "AAAA");
        assert!(verified(&tampered, &keys).is_err());
    }

    #[test]
    fn the_bundled_copy_reads() {
        let registry = current();
        assert!(registry.section("apps").get("apps").is_some());
        assert!(registry.speech().get("voices").is_some());
        assert!(registry.section("engines").get("engines").is_some());
        assert!(registry.section("ignore").get("templates").is_some());
    }
}
