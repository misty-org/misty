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

// ---------------------------------------------------------------------------------------------
// Homes

/// The person's home folder. Tests point it at a scratch folder with `MISTY_TEST_ENGINE_HOME`
/// (holding [`HOME_ENV_LOCK`]) so they never touch `HOME`, which the rest of Misty's tests rely on.
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

/// Serializes tests that steer `MISTY_TEST_ENGINE_HOME`, `CLAUDE_CONFIG_DIR` or `CODEX_HOME`.
#[cfg(test)]
pub static HOME_ENV_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

/// Points [`home_dir`] at `home` (and clears the engines' own home variables) until dropped.
#[cfg(test)]
pub struct TestHome {
    _lock: parking_lot::MutexGuard<'static, ()>,
    saved: Vec<(&'static str, Option<std::ffi::OsString>)>,
}

#[cfg(test)]
impl TestHome {
    const KEYS: [&'static str; 4] = [
        "MISTY_TEST_ENGINE_HOME",
        "CLAUDE_CONFIG_DIR",
        "CODEX_HOME",
        "GEMINI_CLI_HOME",
    ];

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

/// `~` and `~/…` expanded against [`home_dir`].
pub fn expand_user_path(text: &str) -> PathBuf {
    if text == "~" {
        return home_dir();
    }
    if let Some(rest) = text.strip_prefix("~/").or_else(|| text.strip_prefix("~\\")) {
        return home_dir().join(rest);
    }
    PathBuf::from(text)
}

/// An engine's home: `$env_key` when set and not empty (with `~` expanded, as the CLIs do), else
/// `~/<default_dir>`.
pub fn engine_home(env_key: Option<&str>, default_dir: &str) -> PathBuf {
    if let Some(key) = env_key {
        if let Some(value) = std::env::var_os(key).filter(|v| !v.is_empty()) {
            return expand_user_path(&value.to_string_lossy());
        }
    }
    home_dir().join(default_dir)
}

/// Codex's config and session home (`$CODEX_HOME`, else `~/.codex`).
pub fn codex_home() -> PathBuf {
    engine_home(Some("CODEX_HOME"), ".codex")
}

/// Claude Code's config folder (`$CLAUDE_CONFIG_DIR`, else `~/.claude`).
pub fn claude_home() -> PathBuf {
    engine_home(Some("CLAUDE_CONFIG_DIR"), ".claude")
}

/// Misty's own folder for this feature's caches and backups: `~/.misty/engine-config`. Tests get
/// one inside their scratch home.
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

/// The engine folders and files Settings › Engines reads and edits, granted to the file gate when
/// the app starts. Everything else stays behind its own grant.
pub fn engine_config_locations() -> (Vec<PathBuf>, Vec<(PathBuf, &'static str)>) {
    let home = home_dir();
    let folders = vec![
        claude_home(),
        codex_home(),
        engine_home(Some("GEMINI_CLI_HOME"), ".gemini"),
        home.join(".agents"),
        home.join(".config").join("opencode"),
        home.join(".local").join("share").join("opencode"),
        home.join(".qwen"),
        home.join(".kimi"),
        home.join(".kimi-code"),
        home.join(".qoder-cn"),
        home.join(".dsh"),
        home.join(".grok"),
        home.join(".minimax"),
        home.join(".mcode"),
        home.join(".qoder"),
        home.join(".codebuddy"),
        home.join(".omp"),
        home.join(".pi"),
        home.join(".cc-switch"),
    ];
    let mut folders = folders;
    if let Some(config) = std::env::var_os("XDG_CONFIG_HOME").filter(|v| !v.is_empty()) {
        folders.push(PathBuf::from(config).join("opencode"));
    }
    let files = vec![
        (home.clone(), ".claude.json"),
        (home.clone(), ".mcp.json"),
        (home, ".npmrc"),
    ];
    (folders, files)
}

/// Grants the gate the locations in [`engine_config_locations`].
pub fn allow_engine_config_locations() {
    let (folders, files) = engine_config_locations();
    for folder in folders {
        file_access::allow_engine_config_folder(&folder);
    }
    for (folder, name) in files {
        file_access::allow_engine_config_file(&folder, name);
    }
}

/// Whether `path` is somewhere Misty may read: a folder the person linked to a Space, an engine's
/// configuration, or Misty's own data. Takes the place of desktop-cc-gui's workspace check.
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

// ---------------------------------------------------------------------------------------------
// Safe writes

/// Writes `content` to `path` through a staged file in the same folder and a rename, owner-only
/// (keeping the owner's execute bit). A link (dotfile managers) is written through, not replaced.
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
    // Named after the file so the gate's rule for the file covers it too.
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

// ---------------------------------------------------------------------------------------------
// Device store in misty.db

/// `misty.db`, this computer's database. Nothing kept here syncs.
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

/// Opens `misty.db` with this feature's own tables in place. They are created here rather than as
/// numbered migrations: they hold only this computer's engine settings and caches, and a missing
/// table is simply made again.
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

/// A value this feature keeps on the device, by key, as JSON.
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

// ---------------------------------------------------------------------------------------------
// Secrets

/// The credential-store service engine channel keys are kept under. Keys stay on this computer
/// (sealed in `misty.db` under the master key in the OS keychain), never sync, and reach only the
/// provider the person chose for the channel.
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

// ---------------------------------------------------------------------------------------------
// Events

static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Keeps the app handle for [`emit`]. Called once from `setup`.
pub fn set_app(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
}

pub fn app() -> Option<&'static tauri::AppHandle> {
    APP.get()
}

/// Sends `payload` to the app's windows as `name`. Does nothing before setup and in tests.
pub fn emit<T: Serialize + Clone>(name: &str, payload: T) {
    if let Some(app) = APP.get() {
        let _ = app.emit(name, payload);
    }
}

/// Where adapted code emits events. The app handle and test doubles both implement it.
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

// ---------------------------------------------------------------------------------------------
// Processes

/// Keeps Windows from opening a console window for a console program Misty starts.
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

/// Kills a child started with `process_group(0)` and everything it started.
#[cfg(unix)]
pub fn kill_process_group(pid: u32) {
    // SAFETY: kill with a negated process group id signals the group; no memory is touched.
    unsafe { libc::kill(-(pid as i32), libc::SIGKILL) };
}

/// Windows has no process groups; `taskkill /T` walks the tree from the wrapper down, and has to
/// finish before the caller ends the direct child.
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

/// Where an engine's program is, found the way Misty finds engines to run.
pub fn find_program(name: &str) -> Option<PathBuf> {
    crate::engines::resolve::find_program(name)
}

/// The PATH Misty starts engines with, so the tools they run (node, npm, git) are found too.
pub fn search_path() -> std::ffi::OsString {
    crate::engines::resolve::search_path()
}

/// The environment a program Misty starts for engine config gets on top of its own: the search
/// PATH and the proxy from Settings.
pub fn child_env() -> HashMap<String, String> {
    let mut env = super::proxy::proxy_env();
    env.insert(
        "PATH".to_string(),
        search_path().to_string_lossy().into_owned(),
    );
    env
}

// ---------------------------------------------------------------------------------------------
// HTTP

/// A client for this feature's own requests (GitHub for skills, npm for versions, a channel's
/// model list, the price table), through the proxy from Settings.
pub fn http_client() -> Result<reqwest::Client, String> {
    // Misty's builds carry rustls without a default provider; the app installs ring at launch,
    // and tests and the MCP proxy process do it here.
    let _ = rustls::crypto::ring::default_provider().install_default();
    super::proxy::apply_to_client(
        reqwest::Client::builder()
            .user_agent(concat!("Misty/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(30)),
    )
    .build()
    .map_err(|e| e.to_string())
}
