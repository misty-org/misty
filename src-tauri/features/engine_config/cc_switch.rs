// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//
// Read-only import from CC Switch (`~/.cc-switch`).
//
// Sources, probed in this order and never written:
//   1. `~/.cc-switch/cc-switch.db`  (CC Switch 3, SQLite `providers` table)
//   2. `~/.cc-switch/config.json`   (CC Switch 2, JSON)
// plus a file the person picks (`.json` reads as the JSON format, anything else as SQLite).
//
// Settings polls `engine_cc_switch_check`; when the source's fingerprint (modified time and
// length) differs from both the last imported and the dismissed one, it offers to import.
// Imported channels are tagged `source: "cc-switch"`, so a later import may update or remove them
// but never touches a channel the person made. Their keys go to the credential store like any
// other channel's.

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

use super::{channels, support};

/// Our engine id -> cc-switch app key (legacy json `apps` key / db
/// `app_type`). Engines cc-switch doesn't manage (kimi/pi/omp/dsh) have no
/// mapping and are skipped on import.
fn ccs_app_key(engine: &str) -> Option<&'static str> {
    match engine {
        "claude" => Some("claude"),
        "codex" => Some("codex"),
        "grok" => Some("grokbuild"),
        _ => None,
    }
}

const IMPORT_ENGINES: [&str; 3] = ["claude", "codex", "grok"];

fn ccs_dir() -> PathBuf {
    support::home_dir().join(".cc-switch")
}

fn ccs_db_path() -> PathBuf {
    ccs_dir().join("cc-switch.db")
}

fn ccs_config_path() -> PathBuf {
    ccs_dir().join("config.json")
}

/// The file cc-switch currently writes: the v3 db wins over the legacy json.
fn ccs_source_path() -> Option<PathBuf> {
    let db = ccs_db_path();
    if file_access::fs::is_file(&db) {
        return Some(db);
    }
    let json = ccs_config_path();
    file_access::fs::is_file(&json).then_some(json)
}

fn is_json_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("json"))
        .unwrap_or(false)
}

/// Import bookkeeping, kept on this computer in `misty.db`.
const SYNC_STATE_KEY: &str = "cc_switch_sync";

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncState {
    /// Fingerprint of the cc-switch source file we last imported.
    #[serde(default)]
    seen_hash: String,
    /// Fingerprint the person dismissed with "Later"; not offered again until it changes.
    #[serde(default)]
    dismissed_hash: String,
}

/// Cheap change token: mtime + length. cc-switch mutates its store through
/// SQLite writes, so any real change bumps mtime; content-hashing the whole
/// file meant reading tens of MB on every settings-page mount (and, as a
/// sync command, on Tauri's main thread — that was the visible freeze).
fn fingerprint(path: &Path) -> Option<(String, u64)> {
    let meta = file_access::fs::metadata(path).ok()?;
    let mtime_ms = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    Some((format!("{mtime_ms}:{}", meta.len()), mtime_ms))
}

fn read_sync_state() -> SyncState {
    support::load_value(SYNC_STATE_KEY)
        .ok()
        .flatten()
        .unwrap_or_default()
}

fn write_sync_state(state: &SyncState) -> Result<(), String> {
    support::save_value(SYNC_STATE_KEY, state)
}

/// One cc-switch provider, normalized to the legacy JSON entry shape
/// (`{ name, settingsConfig, icon?, iconColor? }`) so `convert_provider`
/// handles both sources unchanged.
type CcsProviders = Vec<(String, Value)>;

/// Per-engine provider lists keyed by our engine id. `None` = cc-switch
/// never managed that app (import skips it, no pruning); `Some([])` = the
/// app exists but has no providers (import may prune).
type EngineProviders = Vec<(String, Option<CcsProviders>)>;

/// Legacy v2 JSON: `apps.<app>.providers` as a map (id → entry) or an array
/// (entries carry their own `id`).
fn json_engine_providers(root: &Value, engine: &str) -> Option<CcsProviders> {
    let app_key = ccs_app_key(engine)?;
    let section = root["apps"].get(app_key)?;
    let list = match &section["providers"] {
        Value::Object(map) => map.iter().map(|(id, p)| (id.clone(), p.clone())).collect(),
        Value::Array(items) => items
            .iter()
            .filter_map(|p| {
                let id = p.get("id")?.as_str()?.to_string();
                Some((id, p.clone()))
            })
            .collect(),
        _ => Vec::new(),
    };
    Some(list)
}

/// v3 SQLite: `providers` table filtered by `app_type`. A corrupt
/// `settings_config` row degrades to an empty object instead of failing the
/// whole batch.
fn db_engine_providers(conn: &Connection, engine: &str) -> Result<Option<CcsProviders>, String> {
    let Some(app_key) = ccs_app_key(engine) else {
        return Ok(None);
    };
    let mut stmt = conn
        .prepare(
            "SELECT id, name, settings_config FROM providers \
             WHERE app_type = ?1 ORDER BY sort_index, created_at",
        )
        .map_err(|e| format!("prepare cc-switch db query: {e}"))?;
    let rows = stmt
        .query_map([app_key], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("query cc-switch db: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, name, settings_text) = row.map_err(|e| format!("read cc-switch db row: {e}"))?;
        let settings_config = serde_json::from_str(&settings_text)
            .unwrap_or_else(|_| Value::Object(Default::default()));
        out.push((
            id,
            serde_json::json!({ "name": name, "settingsConfig": settings_config }),
        ));
    }
    Ok(Some(out))
}

fn load_from_json(path: &Path, engines: &[&str]) -> Result<EngineProviders, String> {
    let bytes = file_access::fs::read(path).map_err(|e| format!("read cc-switch config: {e}"))?;
    let root: Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("parse cc-switch config: {e}"))?;
    Ok(engines
        .iter()
        .map(|e| (e.to_string(), json_engine_providers(&root, e)))
        .collect())
}

fn load_from_db(path: &Path, engines: &[&str]) -> Result<EngineProviders, String> {
    let conn = file_access::fs::open_sqlite_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("open cc-switch db: {e}"))?;
    engines
        .iter()
        .map(|e| Ok((e.to_string(), db_engine_providers(&conn, e)?)))
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchStatus {
    pub installed: bool,
    pub changed: bool,
    /// Total providers across the engines we can import.
    pub providers: usize,
    pub hash: String,
    pub modified_ms: u64,
}

fn count_db_providers(conn: &Connection) -> usize {
    IMPORT_ENGINES
        .iter()
        .filter_map(|e| ccs_app_key(e))
        .map(|key| {
            conn.query_row(
                "SELECT COUNT(*) FROM providers WHERE app_type = ?1",
                [key],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0) as usize
        })
        .sum()
}

fn count_json_providers(root: &Value) -> usize {
    IMPORT_ENGINES
        .iter()
        .filter_map(|e| ccs_app_key(e))
        .map(|key| {
            let providers = &root["apps"][key]["providers"];
            match providers {
                Value::Object(map) => map.len(),
                Value::Array(items) => items.len(),
                _ => 0,
            }
        })
        .sum()
}

#[tauri::command]
pub async fn engine_cc_switch_check() -> Result<CcSwitchStatus, String> {
    // Off the main thread: this runs every time the Settings page opens.
    tauri::async_runtime::spawn_blocking(check_cc_switch_blocking)
        .await
        .map_err(|e| e.to_string())?
}

fn check_cc_switch_blocking() -> Result<CcSwitchStatus, String> {
    let empty = || CcSwitchStatus {
        installed: false,
        changed: false,
        providers: 0,
        hash: String::new(),
        modified_ms: 0,
    };
    let Some(path) = ccs_source_path() else {
        return Ok(empty());
    };
    let Some((hash, modified_ms)) = fingerprint(&path) else {
        return Ok(empty());
    };
    let state = read_sync_state();
    let changed = hash != state.seen_hash && hash != state.dismissed_hash;
    // Counting opens the db — only worth the io when the sync banner can
    // actually show.
    let providers = if !changed {
        0
    } else if is_json_file(&path) {
        file_access::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .map(|root| count_json_providers(&root))
            .unwrap_or(0)
    } else {
        file_access::fs::open_sqlite_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map(|conn| count_db_providers(&conn))
            .unwrap_or(0)
    };
    Ok(CcSwitchStatus {
        installed: true,
        changed,
        providers,
        hash,
        modified_ms,
    })
}

#[tauri::command]
pub async fn engine_cc_switch_dismiss(hash: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut state = read_sync_state();
        state.dismissed_hash = hash;
        write_sync_state(&state)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchImportResult {
    pub added: usize,
    pub updated: usize,
    /// Id collides with a manually created channel — left untouched.
    pub skipped: usize,
    /// cc-switch-sourced channels that disappeared upstream.
    pub removed: usize,
}

fn env_str(env: &Value, key: &str) -> Option<String> {
    env.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// One CC Switch provider as a channel. Keeps its `settingsConfig` as it is: a start applies the
/// raw `env` and `config` first, so extra keys (such as ANTHROPIC_SMALL_FAST_MODEL) survive. Keys
/// in it are moved to the credential store when the channel is saved.
fn convert_provider(engine: &str, id: &str, p: &Value) -> Value {
    let mut out = serde_json::Map::new();
    let name = p["name"].as_str().unwrap_or(id);
    out.insert("name".into(), Value::String(name.to_string()));
    if let Some(sc) = p.get("settingsConfig") {
        out.insert("settingsConfig".into(), sc.clone());
    }
    if let Some(icon) = p.get("icon").and_then(Value::as_str) {
        out.insert("icon".into(), Value::String(icon.to_string()));
    }
    if let Some(color) = p.get("iconColor").and_then(Value::as_str) {
        out.insert("iconColor".into(), Value::String(color.to_string()));
    }

    let sc = &p["settingsConfig"];
    match engine {
        // Claude/Grok: convention fields live in settingsConfig.env.
        "claude" | "grok" => {
            let env = &sc["env"];
            let (base, key, model) = if engine == "claude" {
                (
                    "ANTHROPIC_BASE_URL",
                    "ANTHROPIC_AUTH_TOKEN",
                    "ANTHROPIC_MODEL",
                )
            } else {
                ("GROK_BASE_URL", "GROK_API_KEY", "GROK_MODEL")
            };
            if let Some(v) = env_str(env, base) {
                out.insert("baseUrl".into(), Value::String(v));
            }
            if let Some(v) = env_str(env, key) {
                out.insert("apiKey".into(), Value::String(v));
            }
            if let Some(v) = env_str(env, model) {
                out.insert("model".into(), Value::String(v));
            }
        }
        // Codex: { auth: { OPENAI_API_KEY }, config: <config.toml text> }.
        "codex" => {
            if let Some(v) = env_str(&sc["auth"], "OPENAI_API_KEY") {
                out.insert("apiKey".into(), Value::String(v));
            }
            if let Some(toml_text) = sc["config"].as_str() {
                if let Ok(tbl) = toml::from_str::<Value>(toml_text) {
                    if let Some(m) = tbl["model"].as_str() {
                        out.insert("model".into(), Value::String(m.to_string()));
                    }
                    // First model_providers.*.base_url wins.
                    if let Some(providers) = tbl["model_providers"].as_object() {
                        for mp in providers.values() {
                            if let Some(u) = mp["base_url"].as_str() {
                                out.insert("baseUrl".into(), Value::String(u.to_string()));
                                break;
                            }
                        }
                    }
                }
            }
        }
        _ => {}
    }

    out.insert("source".into(), Value::String("cc-switch".into()));
    out.insert("ccsId".into(), Value::String(id.to_string()));
    Value::Object(out)
}

/// Merges one engine's CC Switch providers into its channels. `prune` removes imported channels
/// that are gone from CC Switch: only for CC Switch's own store, never a picked file, which may be
/// a partial export. Called with [`channels::lock`] held.
fn merge_engine(
    engine: &str,
    providers: &CcsProviders,
    prune: bool,
    result: &mut CcSwitchImportResult,
) -> Result<(), String> {
    let config = channels::read_config()?;
    let section = config
        .section(engine)
        .ok_or_else(|| format!("Unknown engine: {engine}"))?;
    for (id, p) in providers {
        let mut converted = convert_provider(engine, id, p);
        match section.providers.get(id) {
            None => result.added += 1,
            Some(existing)
                if existing.get("source").and_then(Value::as_str) == Some("cc-switch") =>
            {
                result.updated += 1
            }
            Some(_) => {
                result.skipped += 1;
                continue;
            }
        }
        // The imported keys replace whatever an earlier import saved for this channel.
        converted["clearKey"] = Value::Bool(true);
        channels::upsert_provider_unlocked(engine, id, converted)?;
    }
    if prune {
        let stale: Vec<String> = section
            .providers
            .iter()
            .filter(|(id, v)| {
                v.get("source").and_then(Value::as_str) == Some("cc-switch")
                    && !providers.iter().any(|(pid, _)| pid == *id)
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in stale {
            channels::delete_provider_unlocked(engine, &id)?;
            result.removed += 1;
        }
    }
    Ok(())
}

fn import_engines(engine: &str) -> Vec<&str> {
    if engine == "all" {
        IMPORT_ENGINES.to_vec()
    } else {
        vec![engine]
    }
}

fn run_import(
    load: impl FnOnce() -> Result<EngineProviders, String>,
    prune: bool,
) -> Result<CcSwitchImportResult, String> {
    let _guard = channels::lock();
    let loaded = load()?;
    let mut result = CcSwitchImportResult {
        added: 0,
        updated: 0,
        skipped: 0,
        removed: 0,
    };
    for (engine, providers) in &loaded {
        if let Some(list) = providers {
            merge_engine(engine, list, prune, &mut result)?;
        }
    }
    // An import changes only Misty's channel list; the CLIs' own files stay as they are.
    Ok(result)
}

/// Imports CC Switch's providers from its own store (the SQLite database first, the JSON file
/// otherwise). `engine` is an engine id or "all".
fn import_detected(engine: &str) -> Result<CcSwitchImportResult, String> {
    let path = ccs_source_path().ok_or_else(|| {
        "CC Switch wasn't found (~/.cc-switch/cc-switch.db or config.json).".to_string()
    })?;
    let engines = import_engines(engine);
    let is_json = is_json_file(&path);
    let result = run_import(
        || {
            if is_json {
                load_from_json(&path, &engines)
            } else {
                load_from_db(&path, &engines)
            }
        },
        true,
    )?;
    let mut state = read_sync_state();
    if let Some((fp, _)) = fingerprint(&path) {
        state.seen_hash = fp;
        write_sync_state(&state)?;
    }
    Ok(result)
}

#[tauri::command]
pub async fn engine_cc_switch_import(engine: String) -> Result<CcSwitchImportResult, String> {
    tauri::async_runtime::spawn_blocking(move || import_detected(&engine))
        .await
        .map_err(|e| e.to_string())?
}

/// Imports from a file the person picks: `.json` reads as CC Switch 2's JSON, anything else as
/// CC Switch 3's database. Never removes channels: a picked file may be a partial export. A
/// database is read from a private copy, so the picked file is only ever read.
fn import_file(path: &Path, engine: &str) -> Result<CcSwitchImportResult, String> {
    let engines = import_engines(engine);
    if is_json_file(path) {
        return run_import(|| load_from_json(path, &engines), false);
    }
    let copy = std::env::temp_dir().join(format!("misty-cc-switch-{}.db", uuid::Uuid::new_v4()));
    file_access::fs::copy(path, &copy).map_err(|e| format!("read cc-switch db: {e}"))?;
    let result = run_import(|| load_from_db(&copy, &engines), false);
    let _ = file_access::fs::remove_file(&copy);
    result
}

/// Asks for a CC Switch export with the system's dialog, shown from here so a window can't name
/// a path of its own. `None` when the person cancels.
#[tauri::command]
pub async fn engine_cc_switch_import_file(
    app: tauri::AppHandle,
    engine: String,
) -> Result<Option<CcSwitchImportResult>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (send, receive) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Choose a CC Switch export")
        .add_filter("CC Switch data", &["db", "json", "sqlite"])
        .pick_file(move |file| {
            let _ = send.send(file);
        });
    let Some(file) = receive.await.ok().flatten() else {
        return Ok(None);
    };
    let path: PathBuf = file
        .into_path()
        .map_err(|_| "Choose a file on this computer.".to_string())?;
    file_access::allow_picked_file(&path, file_access::Access::Read);
    tauri::async_runtime::spawn_blocking(move || import_file(&path, &engine).map(Some))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    #![allow(clippy::disallowed_methods, clippy::disallowed_types)]
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("misty-ccs-test-{}-{}", std::process::id(), name));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn json_providers_accept_map_and_array_shapes() {
        let dir = temp_path("json");
        let path = dir.join("config.json");
        let json = r#"{
          "apps": {
            "claude": {
              "providers": {
                "p1": { "name": "Map Entry", "settingsConfig": { "env": { "ANTHROPIC_BASE_URL": "https://a.example" } } }
              }
            },
            "codex": {
              "providers": [
                { "id": "p2", "name": "Array Entry", "settingsConfig": { "auth": { "OPENAI_API_KEY": "sk-x" }, "config": "model = \"gpt-x\"\n[model_providers.foo]\nbase_url = \"https://b.example/v1\"" } }
              ]
            }
          }
        }"#;
        std::fs::write(&path, json).unwrap();

        let loaded = load_from_json(&path, &["claude", "codex", "grok"]).unwrap();
        assert_eq!(loaded.len(), 3);
        let claude = loaded[0].1.as_ref().unwrap();
        assert_eq!(claude.len(), 1);
        assert_eq!(claude[0].0, "p1");
        let codex = loaded[1].1.as_ref().unwrap();
        assert_eq!(codex.len(), 1);
        assert_eq!(codex[0].0, "p2");
        // grokbuild section absent → None (no import, no prune).
        assert!(loaded[2].1.is_none());

        // Flat fields extract through convert_provider for both shapes.
        let converted = convert_provider("claude", "p1", &claude[0].1);
        assert_eq!(converted["baseUrl"], "https://a.example");
        assert_eq!(converted["source"], "cc-switch");
        let converted = convert_provider("codex", "p2", &codex[0].1);
        assert_eq!(converted["apiKey"], "sk-x");
        assert_eq!(converted["baseUrl"], "https://b.example/v1");
        assert_eq!(converted["model"], "gpt-x");
    }

    #[test]
    fn db_providers_read_sqlite_and_normalize() {
        let dir = temp_path("db");
        let path = dir.join("cc-switch.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE providers (
               id TEXT, name TEXT, category TEXT, website_url TEXT,
               settings_config TEXT, app_type TEXT,
               sort_index INTEGER, created_at INTEGER
             );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO providers VALUES ('d1', 'Db Entry', NULL, NULL, ?1, 'claude', 0, 0)",
            [r#"{"env": {"ANTHROPIC_BASE_URL": "https://c.example", "ANTHROPIC_AUTH_TOKEN": "sk-y"}}"#],
        )
        .unwrap();
        // A corrupt settings_config row degrades to an empty object.
        conn.execute(
            "INSERT INTO providers VALUES ('d2', 'Broken', NULL, NULL, 'not json', 'claude', 1, 1)",
            [],
        )
        .unwrap();
        drop(conn);

        let loaded = load_from_db(&path, &["claude"]).unwrap();
        let claude = loaded[0].1.as_ref().unwrap();
        assert_eq!(claude.len(), 2);
        assert_eq!(claude[0].0, "d1");
        let converted = convert_provider("claude", "d1", &claude[0].1);
        assert_eq!(converted["name"], "Db Entry");
        assert_eq!(converted["baseUrl"], "https://c.example");
        assert_eq!(converted["apiKey"], "sk-y");
        // Corrupt row still imports, with an empty settingsConfig.
        assert!(claude[1].1["settingsConfig"].is_object());
        // Unmapped engine → None.
        let loaded = load_from_db(&path, &["kimi"]).unwrap();
        assert!(loaded[0].1.is_none());
    }

    #[test]
    fn imports_keys_into_the_credential_store_and_prunes_only_its_own() {
        let dir = temp_path("import");
        let _home = support::TestHome::set(&dir);
        channels::secret_store::clear();
        channels::upsert_provider("claude", "mine", serde_json::json!({ "name": "Mine" })).unwrap();
        let ccs = dir.join(".cc-switch");
        std::fs::create_dir_all(&ccs).unwrap();
        let write = |providers: &str| {
            std::fs::write(
                ccs.join("config.json"),
                format!(r#"{{"apps":{{"claude":{{"providers":{{{providers}}}}}}}}}"#),
            )
            .unwrap()
        };
        write(
            r#""mine":{"name":"Clash"},"relay":{"name":"Relay","settingsConfig":{"env":{"ANTHROPIC_BASE_URL":"https://r.example","ANTHROPIC_AUTH_TOKEN":"sk-imported"}}}"#,
        );
        let result = import_detected("claude").unwrap();
        assert_eq!((result.added, result.skipped), (1, 1));
        let stored = serde_json::to_string(&channels::read_config().unwrap()).unwrap();
        assert!(!stored.contains("sk-imported"));
        let env = channels::resolve_provider_env("claude", Some("relay")).unwrap();
        assert_eq!(
            env.get("ANTHROPIC_AUTH_TOKEN").map(String::as_str),
            Some("sk-imported")
        );
        assert!(!engine_cc_switch_check_blocking_changed());

        write(r#""other":{"name":"Other"}"#);
        let result = import_detected("claude").unwrap();
        assert_eq!((result.added, result.removed), (1, 1));
        let config = channels::read_config().unwrap();
        let ids = config.section("claude").unwrap().ordered_ids();
        assert_eq!(ids, ["mine", "other"]);
        assert!(channels::resolve_provider_env("claude", Some("relay")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn engine_cc_switch_check_blocking_changed() -> bool {
        check_cc_switch_blocking().unwrap().changed
    }
}
