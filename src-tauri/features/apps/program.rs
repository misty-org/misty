use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex as StdMutex, MutexGuard};
use std::time::{Duration, Instant};

use file_access::fs;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;

use super::manifest::{valid_id, valid_version};
use super::mcp;

mod archive;
mod confine;
mod server;
#[cfg(test)]
mod tests;

use archive::{from_tar_gz, from_zip};
use confine::confined;
use server::{Server, Trouble};

#[cfg(target_os = "macos")]
const PROFILE: &str = r#"
(version 1)
(deny default)
(allow process-exec (literal (param "TOOL")))
(allow file-read* (literal (param "TOOL")) (subpath (param "PROGRAM_DIR")) (subpath (param "WORK"))
  (subpath "/System/Library") (subpath "/usr/lib") (subpath "/usr/share")
  (subpath "/System/Volumes/Preboot/Cryptexes/OS/System/Library")
  (subpath "/System/Volumes/Preboot/Cryptexes/OS/usr/lib")
  (subpath "/private/var/db/timezone") (literal "/private/etc/localtime")
  (literal "/") (literal "/dev/null") (literal "/dev/random") (literal "/dev/urandom"))
(allow file-write* (subpath (param "WORK")) (literal "/dev/null"))
(allow file-ioctl (literal "/dev/null"))
(allow sysctl-read)
(allow file-read-metadata)
(allow mach-lookup (global-name "com.apple.system.logger"))
"#;

pub const MAX_ARCHIVE_BYTES: u64 = 256 << 20;
const MAX_PROGRAM_BYTES: u64 = 256 << 20;
const MAX_LINE_BYTES: u64 = 32 << 20;
const CALL_LIMIT: Duration = Duration::from_secs(10 * 60);
const START_LIMIT: Duration = Duration::from_secs(30);
const IDLE_LIMIT: Duration = Duration::from_secs(20 * 60);
const MAX_PAGES: usize = 20;
const PROTOCOL_VERSION: &str = "2025-06-18";

#[derive(Debug, Clone, Deserialize)]
pub struct Build {
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct McpProgram {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub read_root_flag: String,
    pub write_root_flag: String,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub builds: HashMap<String, Build>,
}

#[derive(Deserialize)]
struct CatalogApp {
    upstream: String,
    version: String,
    #[serde(default)]
    mcp_program: Option<McpProgram>,
}

pub fn platform() -> Option<&'static str> {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("macos-aarch64")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some("macos-x86_64")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("linux-x86_64")
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        Some("linux-aarch64")
    } else {
        None
    }
}

fn flag_ok(flag: &str) -> bool {
    flag.len() <= 64
        && flag.strip_prefix("--").is_some_and(|rest| {
            rest.starts_with(|c: char| c.is_ascii_lowercase())
                && rest
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        })
}

fn env_ok(key: &str, value: &str) -> bool {
    let reserved = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "IFS"];
    !key.is_empty()
        && key.len() <= 64
        && key
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        && !reserved.contains(&key)
        && !key.starts_with("LD_")
        && !key.starts_with("DYLD_")
        && value.len() <= 200
        && !value.contains('\0')
}

impl McpProgram {
    fn validate(&self) -> Result<(), String> {
        let name_ok = !self.program.is_empty()
            && self.program.len() <= 64
            && self
                .program
                .starts_with(|c: char| c.is_ascii_alphanumeric())
            && self
                .program
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
        if !name_ok {
            return Err("The catalog's program name isn't a plain file name.".into());
        }
        if self.args.len() > 16
            || self
                .args
                .iter()
                .any(|arg| arg.len() > 100 || arg.contains('\0'))
        {
            return Err("The catalog gives the program too many or too long arguments.".into());
        }
        if !flag_ok(&self.read_root_flag) || !flag_ok(&self.write_root_flag) {
            return Err("The catalog doesn't say how to keep the program to a folder.".into());
        }
        if self.env.iter().any(|(key, value)| !env_ok(key, value)) {
            return Err("The catalog sets a variable Misty doesn't hand a program.".into());
        }
        Ok(())
    }

    fn build(&self, upstream_prefix: &str) -> Result<&Build, String> {
        let platform = platform()
            .ok_or_else(|| "Misty can't run this app's tools on this computer yet.".to_owned())?;
        let build = self
            .builds
            .get(platform)
            .ok_or_else(|| "The app has no build of its tools for this computer.".to_owned())?;
        let kind_ok = build.url.ends_with(".zip") || build.url.ends_with(".tar.gz");
        if !build.url.starts_with(upstream_prefix)
            || !kind_ok
            || build.sha256.len() != 64
            || build.size > MAX_ARCHIVE_BYTES
        {
            return Err(
                "The catalog's build of the app's tools isn't the maker's own release.".into(),
            );
        }
        Ok(build)
    }
}

pub fn pinned(app_id: &str, version: &str) -> Result<(McpProgram, Build), String> {
    pinned_in(&crate::registry::current().apps_json(), app_id, version)
}

fn pinned_in(catalog: &str, app_id: &str, version: &str) -> Result<(McpProgram, Build), String> {
    let apps: Vec<serde_json::Value> = serde_json::from_str(catalog)
        .map_err(|error| format!("Misty's app registry isn't valid: {error}"))?;
    let entry = apps
        .into_iter()
        .find(|app| app.get("id").and_then(serde_json::Value::as_str) == Some(app_id))
        .ok_or_else(|| "That app isn't in Misty's catalog.".to_owned())?;
    let app: CatalogApp = serde_json::from_value(entry)
        .map_err(|error| format!("Misty's catalog entry for this app isn't valid: {error}"))?;
    if app.version != version {
        return Err("This computer has another version of the app than Misty's catalog. Update the app to use its tools.".into());
    }
    let upstream_ok = app.upstream.split('/').count() == 2
        && app.upstream.split('/').all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && part
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
        });
    if !upstream_ok {
        return Err("The catalog doesn't name the app's maker.".into());
    }
    let program = app
        .mcp_program
        .ok_or_else(|| "The app has no tools of its own to run.".to_owned())?;
    program.validate()?;
    let build = program
        .build(&format!(
            "https://github.com/{}/releases/download/",
            app.upstream
        ))?
        .clone();
    Ok((program, build))
}

fn programs_root() -> Result<PathBuf, String> {
    file_access::paths::misty_home_dir()
        .map(|home| home.join("app-programs"))
        .ok_or_else(|| "Misty has no data folder to keep apps in.".to_owned())
}

fn program_dir_in(root: &Path, app_id: &str, version: &str) -> Result<PathBuf, String> {
    if !valid_id(app_id) || !valid_version(version) {
        return Err("That isn't an app id and version.".into());
    }
    Ok(root.join(app_id).join(version))
}

fn program_path(dir: &Path, program: &McpProgram) -> PathBuf {
    dir.join("bin").join(&program.program)
}

fn listing_dir(dir: &Path) -> PathBuf {
    dir.join("listing")
}

pub fn installed(
    app_id: &str,
    version: &str,
    program: &McpProgram,
) -> Result<Option<PathBuf>, String> {
    let dir = program_dir_in(&programs_root()?, app_id, version)?;
    let path = program_path(&dir, program);
    Ok(fs::is_file(&path).then_some(path))
}

pub fn remove_all(app_id: &str) -> Result<(), String> {
    if !valid_id(app_id) {
        return Err("That isn't an app id.".into());
    }
    let dir = programs_root()?.join(app_id);
    if fs::exists(&dir) {
        fs::remove_dir_all(&dir).map_err(|error| format!("Couldn't remove the app: {error}"))?;
    }
    Ok(())
}

pub fn install(
    app_id: &str,
    version: &str,
    program: &McpProgram,
    build: &Build,
    archive: &[u8],
) -> Result<PathBuf, String> {
    install_in(&programs_root()?, app_id, version, program, build, archive)
}

fn install_in(
    root: &Path,
    app_id: &str,
    version: &str,
    program: &McpProgram,
    build: &Build,
    archive: &[u8],
) -> Result<PathBuf, String> {
    let final_dir = program_dir_in(root, app_id, version)?;
    if !build
        .sha256
        .eq_ignore_ascii_case(&hex::encode(Sha256::digest(archive)))
    {
        return Err(
            "The downloaded tools don't match the catalog's checksum, so they weren't installed."
                .into(),
        );
    }
    let bytes = if build.url.ends_with(".tar.gz") {
        from_tar_gz(archive, &program.program)?
    } else {
        from_zip(archive, &program.program)?
    };
    let staging = root.join(format!(".staging-{}", uuid::Uuid::new_v4()));
    let saved = (|| -> std::io::Result<()> {
        fs::create_dir_all(staging.join("bin"))?;
        fs::create_dir_all(listing_dir(&staging))?;
        let file = program_path(&staging, program);
        fs::write(&file, &bytes)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755))?;
        }
        if fs::exists(&final_dir) {
            fs::remove_dir_all(&final_dir)?;
        }
        if let Some(parent) = final_dir.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&staging, &final_dir)
    })();
    if let Err(error) = saved {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("Couldn't save the app's tools: {error}"));
    }
    Ok(program_path(&final_dir, program))
}

#[derive(Clone)]
struct Offered {
    version: String,
    path: PathBuf,
    spec: McpProgram,
}

static OFFERED: LazyLock<StdMutex<HashMap<String, Offered>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));
type Slot = Arc<Mutex<Option<Server>>>;
static SERVERS: LazyLock<StdMutex<HashMap<(String, PathBuf), Slot>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

fn offered() -> MutexGuard<'static, HashMap<String, Offered>> {
    OFFERED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn servers() -> MutexGuard<'static, HashMap<(String, PathBuf), Slot>> {
    SERVERS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn any_offered() -> bool {
    !offered().is_empty()
}

pub async fn offer(
    app_id: &str,
    version: &str,
    spec: &McpProgram,
    path: &Path,
) -> Result<usize, String> {
    if offered()
        .get(app_id)
        .is_some_and(|known| known.version == version && known.path == path)
    {
        return Ok(0);
    }
    let listing = path
        .parent()
        .and_then(Path::parent)
        .map(listing_dir)
        .ok_or_else(|| "The app's tools aren't where Misty keeps them.".to_owned())?;
    fs::create_dir_all(&listing)
        .map_err(|error| format!("Couldn't prepare the app's tools: {error}"))?;
    let mut lister = Server::start(path, spec, &listing).await?;
    let tools = lister.list_tools().await?;
    drop(lister);
    let count = mcp::register_program(app_id, &tools)?;
    servers().retain(|(app, _), _| app != app_id);
    offered().insert(
        app_id.to_owned(),
        Offered {
            version: version.to_owned(),
            path: path.to_owned(),
            spec: spec.clone(),
        },
    );
    Ok(count)
}

pub fn withdraw(app_id: &str) {
    offered().remove(app_id);
    mcp::unregister_program(app_id);
    servers().retain(|(app, _), _| app != app_id);
}

fn reap() {
    let still: Vec<String> = offered().keys().cloned().collect();
    servers().retain(|(app, _), slot| {
        if !still.contains(app) {
            return false;
        }
        match slot.try_lock() {
            Ok(guard) => guard
                .as_ref()
                .is_some_and(|server| server.last_used.elapsed() < IDLE_LIMIT),
            Err(_) => true,
        }
    });
}

pub enum Outcome {
    Done(Value),
    Failed { code: String, message: String },
    Uncertain(String),
}

fn failed(code: &str, message: impl Into<String>) -> Outcome {
    Outcome::Failed {
        code: code.to_owned(),
        message: message.into(),
    }
}

fn text_of(result: &Value) -> String {
    result["content"]
        .as_array()
        .map(|parts| {
            parts
                .iter()
                .filter_map(|part| part["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

pub async fn call(run_id: &str, app_id: &str, tool: &str, input: Value) -> Outcome {
    let Some(folder) = crate::engines::runs::folder_of(run_id) else {
        return failed(
            "app_tool_no_folder",
            "This app's tools work in a chat's folder, and this run has none. Nothing was done.",
        );
    };
    let Ok(folder) = fs::canonicalize(&folder) else {
        return failed(
            "app_tool_no_folder",
            "Misty can't open this chat's folder. Nothing was done.",
        );
    };
    let Some(app) = offered().get(app_id).cloned() else {
        return failed(
            "app_tool_gone",
            "That app's tools aren't available any more. Nothing was done.",
        );
    };
    reap();
    let slot = servers()
        .entry((app_id.to_owned(), folder.clone()))
        .or_default()
        .clone();
    let mut guard = slot.lock().await;
    if guard.is_none() {
        match Server::start(&app.path, &app.spec, &folder).await {
            Ok(server) => *guard = Some(server),
            Err(message) => return failed("app_tool_unavailable", message),
        }
    }
    let Some(server) = guard.as_mut() else {
        return failed("app_tool_unavailable", "The app's tools didn't start.");
    };
    let params =
        json!({ "name": tool, "arguments": if input.is_object() { input } else { json!({}) } });
    let outcome = tokio::time::timeout(CALL_LIMIT, server.request("tools/call", params)).await;
    match outcome {
        Ok(Ok(result)) => {
            server.last_used = Instant::now();
            if result["isError"] == true {
                let message = text_of(&result);
                return failed(
                    "app_tool_error",
                    if message.is_empty() {
                        "The app's tool failed.".to_owned()
                    } else {
                        message
                    },
                );
            }
            let mut done =
                json!({ "content": result.get("content").cloned().unwrap_or_else(|| json!([])) });
            if let Some(structured) = result
                .get("structuredContent")
                .filter(|value| !value.is_null())
            {
                done["structuredContent"] = structured.clone();
            }
            Outcome::Done(done)
        }
        Ok(Err(Trouble::Refused(message))) => {
            server.last_used = Instant::now();
            failed("app_tool_failed", message)
        }
        Ok(Err(Trouble::Lost(message))) => {
            *guard = None;
            Outcome::Uncertain(format!(
                "{message} It may or may not have done this, and the session it had open is gone; what it saved is in your folder."
            ))
        }
        Err(_) => {
            *guard = None;
            Outcome::Uncertain(
                "The app's tool ran past its limit and was stopped. It may or may not have done this, and the session it had open is gone; what it saved is in your folder."
                    .to_owned(),
            )
        }
    }
}
