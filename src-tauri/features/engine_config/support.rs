// What the code adapted from desktop-cc-gui expects from the app around it: the person's home and
// each engine's own folder, Misty's own folder for this feature's caches, safe writes through the
// file gate, a small store in `misty.db`, events to the windows, and child-process helpers.
//
// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::{de::DeserializeOwned, Serialize};
use tauri::Emitter;

pub fn home_dir() -> PathBuf {
    #[cfg(test)]
    {
        if let Some(home) = std::env::var_os("MISTY_TEST_ENGINE_HOME").filter(|v| !v.is_empty()) {
            return PathBuf::from(home);
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

#[cfg(test)]
pub static HOME_ENV_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

#[cfg(test)]
pub struct TestHome {
    _lock: parking_lot::MutexGuard<'static, ()>,
    saved: Vec<(&'static str, Option<std::ffi::OsString>)>,
}

#[cfg(test)]
impl TestHome {
    const KEYS: [&'static str; 3] = ["MISTY_TEST_ENGINE_HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME"];

    pub fn set(home: &Path) -> Self {
        let lock = HOME_ENV_LOCK.lock();
        let saved = Self::KEYS
            .iter()
            .map(|key| (*key, std::env::var_os(key)))
            .collect();
        std::env::set_var("MISTY_TEST_ENGINE_HOME", home);
        for key in &Self::KEYS[1..] {
            std::env::remove_var(key);
        }
        Self { _lock: lock, saved }
    }
}

#[cfg(test)]
impl Drop for TestHome {
    fn drop(&mut self) {
        for (key, value) in &self.saved {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
    }
}

pub fn expand_user_path(text: &str) -> PathBuf {
    if text == "~" {
        return home_dir();
    }
    if let Some(rest) = text.strip_prefix("~/").or_else(|| text.strip_prefix("~\\")) {
        return home_dir().join(rest);
    }
    PathBuf::from(text)
}

pub fn engine_home(env_key: Option<&str>, default_dir: &str) -> PathBuf {
    if let Some(key) = env_key {
        if let Some(value) = std::env::var_os(key).filter(|v| !v.is_empty()) {
            return expand_user_path(&value.to_string_lossy());
        }
    }
    home_dir().join(default_dir)
}

pub fn codex_home() -> PathBuf {
    engine_home(Some("CODEX_HOME"), ".codex")
}

pub fn claude_home() -> PathBuf {
    engine_home(Some("CLAUDE_CONFIG_DIR"), ".claude")
}

pub fn app_home() -> PathBuf {
    #[cfg(test)]
    {
        if let Some(home) = std::env::var_os("MISTY_TEST_ENGINE_HOME").filter(|v| !v.is_empty()) {
            return PathBuf::from(home).join(".misty").join("engine-config");
        }
    }
    file_access::paths::misty_home_dir()
        .unwrap_or_else(|| home_dir().join(".misty"))
        .join("engine-config")
}

pub fn engine_config_locations() -> (Vec<PathBuf>, Vec<(PathBuf, &'static str)>) {
    let home = home_dir();
    let folders = vec![
        claude_home(),
        codex_home(),
        home.join(".cache").join("codex-runtimes"),
        home.join(".gemini"),
        home.join(".agents"),
        home.join(".cc-switch"),
    ];
    let files = vec![
        (home.clone(), ".claude.json"),
        (home.clone(), ".mcp.json"),
        (home, ".npmrc"),
    ];
    (folders, files)
}

pub fn allow_engine_config_locations() {
    let (folders, files) = engine_config_locations();
    for folder in folders {
        file_access::allow_engine_config_folder(&folder);
    }
    for (folder, name) in files {
        file_access::allow_engine_config_file(&folder, name);
    }
}

pub fn ensure_allowed(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("No folder was given.".to_string());
    }
    let path = PathBuf::from(path);
    file_access::check(&path, file_access::Access::Read).map_err(|_| {
        "Misty doesn't have access to this folder. Link it to a Space first.".to_string()
    })?;
    Ok(file_access::fs::canonicalize(&path).unwrap_or(path))
}

pub fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let target = write_target(path)?;
    let dir = target
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    if !file_access::fs::is_dir(dir) {
        file_access::fs::create_dir_all(dir)
            .map_err(|e| format!("create {}: {e}", dir.display()))?;
    }
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let tmp = dir.join(format!(
        "{name}.misty-{}.tmp",
        uuid::Uuid::new_v4().simple()
    ));
    let result = write_staged(&tmp, &target, content).and_then(|()| {
        file_access::fs::rename(&tmp, &target)
            .map_err(|e| format!("rename {}: {e}", target.display()))
    });
    if result.is_err() {
        let _ = file_access::fs::remove_file(&tmp);
    }
    result
}

fn write_target(path: &Path) -> Result<PathBuf, String> {
    let is_link = file_access::fs::symlink_metadata(path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false);
    if !is_link {
        return Ok(path.to_path_buf());
    }
    if let Ok(resolved) = file_access::fs::canonicalize(path) {
        return Ok(resolved);
    }
    let link = file_access::fs::read_link(path)
        .map_err(|e| format!("read link {}: {e}", path.display()))?;
    Ok(match path.parent() {
        Some(parent) if link.is_relative() => parent.join(link),
        _ => link,
    })
}

fn write_staged(tmp: &Path, target: &Path, content: &str) -> Result<(), String> {
    use std::io::Write;
    let mut file = file_access::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(tmp)
        .map_err(|e| format!("write {}: {e}", tmp.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let owner_exec = file_access::fs::metadata(target)
            .map(|meta| meta.permissions().mode() & 0o100)
            .unwrap_or(0);
        file_access::fs::set_permissions(tmp, std::fs::Permissions::from_mode(0o600 | owner_exec))
            .map_err(|e| format!("chmod {}: {e}", tmp.display()))?;
    }
    #[cfg(not(unix))]
    let _ = target;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("write {}: {e}", tmp.display()))
}

pub fn store() -> database::store::Store {
    #[cfg(test)]
    {
        if let Some(home) = std::env::var_os("MISTY_TEST_ENGINE_HOME").filter(|v| !v.is_empty()) {
            return database::store::Store::at(PathBuf::from(home).join(".misty").join("misty.db"));
        }
    }
    let home = file_access::paths::misty_home_dir().unwrap_or_else(|| home_dir().join(".misty"));
    database::store::Store::in_home(&home)
}

pub fn connect() -> Result<rusqlite::Connection, String> {
    let connection = store().connect().map_err(|e| e.to_string())?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS engine_config_values (
                 key TEXT PRIMARY KEY NOT NULL,
                 value TEXT NOT NULL,
                 updated_at INTEGER NOT NULL
             ) WITHOUT ROWID;",
        )
        .map_err(|e| e.to_string())?;
    Ok(connection)
}

pub fn load_value<T: DeserializeOwned>(key: &str) -> Result<Option<T>, String> {
    use rusqlite::OptionalExtension;
    let connection = connect()?;
    let raw: Option<String> = connection
        .query_row(
            "SELECT value FROM engine_config_values WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match raw {
        Some(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| e.to_string()),
        None => Ok(None),
    }
}

pub fn save_value<T: Serialize + ?Sized>(key: &str, value: &T) -> Result<(), String> {
    let raw = serde_json::to_string(value).map_err(|e| e.to_string())?;
    connect()?
        .execute(
            "INSERT INTO engine_config_values (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            rusqlite::params![key, raw, now_ms()],
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64)
}

pub const CHANNEL_KEY_SERVICE: &str = "com.misty.engine-channels";

pub fn load_secret(account: &str) -> Result<Option<String>, String> {
    crate::account::credential_store::load(CHANNEL_KEY_SERVICE, account)
        .map_err(|_| "The key couldn't be read from the keychain.".to_string())
}

pub fn store_secret(account: &str, value: &str) -> Result<(), String> {
    crate::account::credential_store::store(CHANNEL_KEY_SERVICE, account, value)
        .map_err(|_| "The key couldn't be saved to the keychain.".to_string())
}

pub fn delete_secret(account: &str) -> Result<(), String> {
    crate::account::credential_store::delete(CHANNEL_KEY_SERVICE, account)
        .map_err(|_| "The key couldn't be removed from the keychain.".to_string())
}

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

pub fn set_app(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
}

pub fn app() -> Option<&'static tauri::AppHandle> {
    APP.get()
}

pub fn emit<T: Serialize + Clone>(name: &str, payload: T) {
    if let Some(app) = APP.get() {
        let _ = app.emit(name, payload);
    }
}

pub trait Emit: Send + Sync {
    fn emit_json(&self, name: &str, raw_json: &str);
}

impl<R: tauri::Runtime> Emit for tauri::AppHandle<R> {
    fn emit_json(&self, name: &str, raw_json: &str) {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(raw_json) {
            let _ = self.emit(name, value);
        }
    }
}

#[cfg(windows)]
pub fn hide_console(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(windows)]
pub fn hide_console_tokio(command: &mut tokio::process::Command) {
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(unix)]
pub fn kill_process_group(pid: u32) {
    // SAFETY: kill with a negated process group id signals the group; no memory is touched.
    unsafe { libc::kill(-(pid as i32), libc::SIGKILL) };
}

#[cfg(not(unix))]
pub fn kill_process_group(pid: u32) {
    let mut command = std::process::Command::new("taskkill");
    command
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    hide_console(&mut command);
    if let Ok(mut killer) = command.spawn() {
        let _ = killer.wait();
    }
}

pub fn find_program(name: &str) -> Option<PathBuf> {
    crate::engines::resolve::find_program(name)
}

pub fn search_path() -> std::ffi::OsString {
    crate::engines::resolve::search_path()
}

pub fn child_env() -> HashMap<String, String> {
    let mut env = super::proxy::proxy_env();
    env.insert(
        "PATH".to_string(),
        search_path().to_string_lossy().into_owned(),
    );
    env
}

pub fn http_client() -> Result<reqwest::Client, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    super::proxy::apply_to_client(
        reqwest::Client::builder()
            .user_agent(concat!("Misty/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(30)),
    )
    .build()
    .map_err(|e| e.to_string())
}
