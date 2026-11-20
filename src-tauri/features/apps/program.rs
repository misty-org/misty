//! An app's MCP server as a program its maker ships (`mcp: binary`), such as SoundCraft's `soundcraft-cli mcp`.
//!
//! Which program, from which release and with which checksum, comes only from the catalog Misty carries
//! (`src/features/spaces/apps/catalog.json`, a copy of misty-apps'), never from a page: the page only says which
//! installed app and version a Space has. The maker's archive for this platform is downloaded, checked against that
//! checksum, and only the one program file is taken out of it.
//!
//! Its tools are listed once and offered to engines like any app's (`mcp.rs`), through the same gate. The first call
//! from a chat starts a server for that chat's folder, over stdio, and later calls and turns of the chat reuse it, so
//! the session the agent is building stays open. Each server is confined by the OS (Seatbelt on macOS, Landlock on
//! Linux): it reads and writes only that folder, reads its own files and the system's libraries, and has no network.
//! It is also handed the maker's own root flags, so a path outside the folder comes back as an error the agent can
//! read. Where Misty can't confine it (Windows, for now), nothing is offered. A server idle for a while is stopped;
//! what it made is in the folder.

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

/// The catalog Misty carries with its release: the only place a program's pin comes from.
const CATALOG: &str = include_str!("../../../src/features/spaces/apps/catalog.json");
#[cfg(target_os = "macos")]
const PROFILE: &str = include_str!("../../tauri-permissions/permissions/app-mcp-program.sb");

/// The most an archive may be, and the most the program in it may be.
pub const MAX_ARCHIVE_BYTES: u64 = 256 << 20;
const MAX_PROGRAM_BYTES: u64 = 256 << 20;
/// The most one message from the program may be: a screenshot or a session report is large.
const MAX_LINE_BYTES: u64 = 32 << 20;
/// Long enough for a bounce of a long session.
const CALL_LIMIT: Duration = Duration::from_secs(10 * 60);
const START_LIMIT: Duration = Duration::from_secs(30);
/// A chat's server that hasn't been called for this long is stopped.
const IDLE_LIMIT: Duration = Duration::from_secs(20 * 60);
const MAX_PAGES: usize = 20;
const PROTOCOL_VERSION: &str = "2025-06-18";

/// One platform's release archive that holds the program, as the catalog pins it.
#[derive(Debug, Clone, Deserialize)]
pub struct Build {
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

/// How an app's program runs: its file name, its arguments, the maker's own flags that keep it to a folder, and
/// the archive per platform.
#[derive(Debug, Clone, Deserialize)]
pub struct McpProgram {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub read_root_flag: String,
    pub write_root_flag: String,
    /// Variables the maker documents for running headless (SoundCraft's `SOUNDCRAFT_NO_PREFS`).
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub builds: HashMap<String, Build>,
}

#[derive(Deserialize)]
struct CatalogApp {
    id: String,
    /// The maker's repository, `owner/name`: the program must be one of its own release assets.
    upstream: String,
    version: String,
    #[serde(default)]
    mcp_program: Option<McpProgram>,
}

#[derive(Deserialize)]
struct Catalog {
    apps: Vec<CatalogApp>,
}

/// The platform's name in the catalog, where Misty can confine a program. `None` offers nothing.
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
                && rest.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        })
}

/// Variables that would change how a program is loaded or where it reads and writes are Misty's to set.
fn env_ok(key: &str, value: &str) -> bool {
    let reserved = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "IFS"];
    !key.is_empty()
        && key.len() <= 64
        && key.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
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
            && self.program.starts_with(|c: char| c.is_ascii_alphanumeric())
            && self.program.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
        if !name_ok {
            return Err("The catalog's program name isn't a plain file name.".into());
        }
        if self.args.len() > 16 || self.args.iter().any(|arg| arg.len() > 100 || arg.contains('\0')) {
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

    /// This platform's archive, which must be the maker's own release asset.
    fn build(&self, upstream_prefix: &str) -> Result<&Build, String> {
        let platform = platform().ok_or_else(|| "Misty can't run this app's tools on this computer yet.".to_owned())?;
        let build = self
            .builds
            .get(platform)
            .ok_or_else(|| "The app has no build of its tools for this computer.".to_owned())?;
        let kind_ok = build.url.ends_with(".zip") || build.url.ends_with(".tar.gz");
        if !build.url.starts_with(upstream_prefix) || !kind_ok || build.sha256.len() != 64 || build.size > MAX_ARCHIVE_BYTES {
            return Err("The catalog's build of the app's tools isn't the maker's own release.".into());
        }
        Ok(build)
    }
}

/// The program the catalog pins for this app and version, with the archive for this platform.
pub fn pinned(app_id: &str, version: &str) -> Result<(McpProgram, Build), String> {
    pinned_in(CATALOG, app_id, version)
}

fn pinned_in(catalog: &str, app_id: &str, version: &str) -> Result<(McpProgram, Build), String> {
    let catalog: Catalog =
        serde_json::from_str(catalog).map_err(|error| format!("Misty's app catalog isn't valid: {error}"))?;
    let app = catalog
        .apps
        .into_iter()
        .find(|app| app.id == app_id)
        .ok_or_else(|| "That app isn't in Misty's catalog.".to_owned())?;
    if app.version != version {
        return Err("This Space has another version of the app than Misty's catalog. Update the app to use its tools.".into());
    }
    let upstream_ok = app.upstream.split('/').count() == 2
        && app.upstream.split('/').all(|part| {
            !part.is_empty() && part != "." && part != ".." && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
        });
    if !upstream_ok {
        return Err("The catalog doesn't name the app's maker.".into());
    }
    let program = app.mcp_program.ok_or_else(|| "The app has no tools of its own to run.".to_owned())?;
    program.validate()?;
    let build = program.build(&format!("https://github.com/{}/releases/download/", app.upstream))?.clone();
    Ok((program, build))
}

/// Misty's folder for apps' programs, apart from their web bundles so reinstalling one leaves the other.
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

/// The program's file once it's on this computer.
fn program_path(dir: &Path, program: &McpProgram) -> PathBuf {
    dir.join("bin").join(&program.program)
}

/// An empty folder the program is kept to while it only lists its tools.
fn listing_dir(dir: &Path) -> PathBuf {
    dir.join("listing")
}

/// Whether this version's program is here already.
pub fn installed(app_id: &str, version: &str, program: &McpProgram) -> Result<Option<PathBuf>, String> {
    let dir = program_dir_in(&programs_root()?, app_id, version)?;
    let path = program_path(&dir, program);
    Ok(fs::is_file(&path).then_some(path))
}

/// Takes the program out of the maker's archive, only if the archive matches the catalog's checksum, and keeps it.
pub fn install(app_id: &str, version: &str, program: &McpProgram, build: &Build, archive: &[u8]) -> Result<PathBuf, String> {
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
    if !build.sha256.eq_ignore_ascii_case(&hex::encode(Sha256::digest(archive))) {
        return Err("The downloaded tools don't match the catalog's checksum, so they weren't installed.".into());
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

/// The one file named `name` anywhere in a zip.
fn from_zip(archive: &[u8], name: &str) -> Result<Vec<u8>, String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(archive)).map_err(|_| "The app's tools aren't a zip file.".to_owned())?;
    let mut found: Option<usize> = None;
    for index in 0..zip.len() {
        let entry = zip.by_index(index).map_err(|_| "The app's tools are damaged.".to_owned())?;
        let last = entry.name().trim_end_matches('/').rsplit('/').next().unwrap_or("");
        if last != name || entry.is_dir() {
            continue;
        }
        if entry.is_symlink() {
            return Err("The app's program is a link, which Misty doesn't run.".into());
        }
        if found.replace(index).is_some() {
            return Err(format!("The app's release holds more than one {name}."));
        }
    }
    let index = found.ok_or_else(|| format!("The app's release has no {name}."))?;
    let entry = zip.by_index(index).map_err(|_| "The app's tools are damaged.".to_owned())?;
    read_capped(entry)
}

/// The one regular file named `name` anywhere in a gzipped tar.
fn from_tar_gz(archive: &[u8], name: &str) -> Result<Vec<u8>, String> {
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(Cursor::new(archive)));
    let mut found: Option<Vec<u8>> = None;
    let entries = tar.entries().map_err(|_| "The app's tools are damaged.".to_owned())?;
    for entry in entries {
        let entry = entry.map_err(|_| "The app's tools are damaged.".to_owned())?;
        let path = entry.path().map_err(|_| "The app's tools are damaged.".to_owned())?.into_owned();
        if path.file_name().and_then(|file| file.to_str()) != Some(name) {
            continue;
        }
        let kind = entry.header().entry_type();
        if kind.is_symlink() || kind.is_hard_link() {
            return Err("The app's program is a link, which Misty doesn't run.".into());
        }
        if !kind.is_file() {
            continue;
        }
        if found.is_some() {
            return Err(format!("The app's release holds more than one {name}."));
        }
        found = Some(read_capped(entry)?);
    }
    found.ok_or_else(|| format!("The app's release has no {name}."))
}

fn read_capped(reader: impl Read) -> Result<Vec<u8>, String> {
    let mut data = Vec::new();
    reader
        .take(MAX_PROGRAM_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|_| "The app's tools are damaged.".to_owned())?;
    if data.len() as u64 > MAX_PROGRAM_BYTES {
        return Err("The app's program is larger than Misty runs.".into());
    }
    Ok(data)
}

/// The confined command that runs `program` kept to `work`, before its own arguments. What has to stay alive
/// until the program has started comes with it.
#[cfg(target_os = "macos")]
fn confined(program: &Path, work: &Path) -> Result<(tokio::process::Command, ()), String> {
    let failed = |_| "Misty couldn't confine the app's tools, so they weren't started.".to_owned();
    let program = fs::canonicalize(program).map_err(failed)?;
    let work = fs::canonicalize(work).map_err(failed)?;
    let program_dir = program.parent().map(Path::to_path_buf).ok_or_else(|| failed(std::io::Error::other("")))?;
    let mut command = tokio::process::Command::new(sandbox::macos::SANDBOX_EXEC);
    command
        .args(sandbox::macos::arguments(
            PROFILE,
            &[("TOOL", &program), ("PROGRAM_DIR", &program_dir), ("WORK", &work)],
        ))
        .arg(&program);
    command.process_group(0);
    // Only async-signal-safe resource-limit calls run between fork and exec.
    unsafe {
        command.pre_exec(|| {
            sandbox::macos::set_limits(&[
                (libc::RLIMIT_CPU, 3_600),
                (libc::RLIMIT_FSIZE, 2 << 30),
                (libc::RLIMIT_NOFILE, 256),
                (libc::RLIMIT_CORE, 0),
            ])
        });
    }
    Ok((command, ()))
}

#[cfg(target_os = "linux")]
fn confined(program: &Path, work: &Path) -> Result<(tokio::process::Command, sandbox::linux::Confinement), String> {
    use sandbox::linux::{Access, Confinement, Policy};
    let failed = |_| "Misty couldn't confine the app's tools, so they weren't started.".to_owned();
    let program = fs::canonicalize(program).map_err(failed)?;
    let work = fs::canonicalize(work).map_err(failed)?;
    let program_dir = program.parent().map(Path::to_path_buf).ok_or_else(|| failed(std::io::Error::other("")))?;
    let confinement = Confinement::new(&Policy {
        program: program.clone(),
        required: vec![(work, Access::Private), (program_dir, Access::Read)],
        optional: vec![(PathBuf::from("/usr/share"), Access::Read), (PathBuf::from("/etc/localtime"), Access::Read)],
        forks: false,
        limits: vec![
            (libc::RLIMIT_CPU, 3_600),
            (libc::RLIMIT_FSIZE, 2 << 30),
            (libc::RLIMIT_NOFILE, 256),
            (libc::RLIMIT_CORE, 0),
        ],
    })?;
    let mut command = tokio::process::Command::new(&program);
    // The hook starts the program's own session, which is its process group too.
    unsafe {
        command.pre_exec(confinement.hook());
    }
    Ok((command, confinement))
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn confined(_: &Path, _: &Path) -> Result<(tokio::process::Command, ()), String> {
    Err("Misty can't confine the app's tools on this computer yet, so they don't run here.".into())
}

/// A running server, spoken to over its stdio, one message per line.
struct Server {
    _child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
    last_used: Instant,
}

/// What went wrong talking to a server: `Refused` before it did anything, `Lost` once it may have.
enum Trouble {
    Refused(String),
    Lost(String),
}

impl Server {
    async fn start(program: &Path, spec: &McpProgram, work: &Path) -> Result<Self, String> {
        let (mut command, keep) = confined(program, work)?;
        let real_work = fs::canonicalize(work).map_err(|error| format!("Couldn't open the chat's folder: {error}"))?;
        command
            .args(&spec.args)
            .arg(&spec.read_root_flag)
            .arg(&real_work)
            .arg(&spec.write_root_flag)
            .arg(&real_work)
            .current_dir(&real_work)
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("HOME", &real_work)
            .env("TMPDIR", &real_work)
            .env("LANG", "C.UTF-8")
            .envs(&spec.env)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|error| format!("Couldn't start the app's tools: {error}"))?;
        drop(keep);
        let stdin = child.stdin.take().ok_or_else(|| "Couldn't talk to the app's tools.".to_owned())?;
        let stdout = child.stdout.take().ok_or_else(|| "Couldn't talk to the app's tools.".to_owned())?;
        let mut server = Self { _child: child, stdin, stdout: BufReader::new(stdout), next_id: 1, last_used: Instant::now() };
        let hello = json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "misty", "version": env!("CARGO_PKG_VERSION") },
        });
        match tokio::time::timeout(START_LIMIT, server.request("initialize", hello)).await {
            Ok(Ok(_)) => {}
            Ok(Err(Trouble::Refused(message) | Trouble::Lost(message))) => {
                return Err(format!("The app's tools didn't start: {message}"))
            }
            Err(_) => return Err("The app's tools took too long to start.".into()),
        }
        server
            .send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
            .await
            .map_err(|_| "The app's tools stopped as they started.".to_owned())?;
        Ok(server)
    }

    async fn send(&mut self, message: &Value) -> std::io::Result<()> {
        let mut line = message.to_string().into_bytes();
        line.push(b'\n');
        self.stdin.write_all(&line).await?;
        self.stdin.flush().await
    }

    /// One request and its answer. Requests the server makes of Misty are answered on the way: a ping, and no
    /// roots or sampling (Misty has no model of its own).
    async fn request(&mut self, method: &str, params: Value) -> Result<Value, Trouble> {
        let id = self.next_id;
        self.next_id += 1;
        let message = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        self.send(&message)
            .await
            .map_err(|_| Trouble::Refused("The app's tools have stopped.".into()))?;
        loop {
            let mut line = Vec::new();
            let read = (&mut self.stdout)
                .take(MAX_LINE_BYTES)
                .read_until(b'\n', &mut line)
                .await
                .map_err(|_| Trouble::Lost("The app's tools stopped while working.".into()))?;
            if read == 0 {
                return Err(Trouble::Lost("The app's tools stopped while working.".into()));
            }
            if line.last() != Some(&b'\n') && read as u64 >= MAX_LINE_BYTES {
                return Err(Trouble::Lost("The app's tools answered with more than Misty reads.".into()));
            }
            let Ok(answer) = serde_json::from_slice::<Value>(&line) else {
                continue;
            };
            if answer.get("method").is_some() {
                if let Some(asked) = answer.get("id").filter(|asked| !asked.is_null()) {
                    let reply = match answer["method"].as_str() {
                        Some("ping") => json!({ "jsonrpc": "2.0", "id": asked, "result": {} }),
                        Some("roots/list") => json!({ "jsonrpc": "2.0", "id": asked, "result": { "roots": [] } }),
                        _ => json!({
                            "jsonrpc": "2.0", "id": asked,
                            "error": { "code": -32601, "message": "Misty doesn't offer that." },
                        }),
                    };
                    self.send(&reply)
                        .await
                        .map_err(|_| Trouble::Lost("The app's tools stopped while working.".into()))?;
                }
                continue;
            }
            if answer["id"].as_u64() != Some(id) {
                continue;
            }
            if let Some(error) = answer.get("error") {
                let text = error["message"].as_str().unwrap_or("The app's tools refused the call.");
                return Err(Trouble::Refused(text.chars().take(2_000).collect()));
            }
            return Ok(answer.get("result").cloned().unwrap_or(Value::Null));
        }
    }

    async fn list_tools(&mut self) -> Result<Vec<Value>, String> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let params = match &cursor {
                Some(cursor) => json!({ "cursor": cursor }),
                None => json!({}),
            };
            let page = match tokio::time::timeout(START_LIMIT, self.request("tools/list", params)).await {
                Ok(Ok(page)) => page,
                Ok(Err(Trouble::Refused(message) | Trouble::Lost(message))) => return Err(message),
                Err(_) => return Err("The app's tools took too long to list themselves.".into()),
            };
            tools.extend(page["tools"].as_array().cloned().unwrap_or_default());
            cursor = page["nextCursor"].as_str().filter(|next| !next.is_empty()).map(str::to_owned);
            if cursor.is_none() {
                return Ok(tools);
            }
        }
        Ok(tools)
    }
}

/// An app whose program's tools are on offer.
#[derive(Clone)]
struct Offered {
    version: String,
    path: PathBuf,
    spec: McpProgram,
}

static OFFERED: LazyLock<StdMutex<HashMap<String, Offered>>> = LazyLock::new(|| StdMutex::new(HashMap::new()));
/// The running servers, one per app and chat folder.
type Slot = Arc<Mutex<Option<Server>>>;
static SERVERS: LazyLock<StdMutex<HashMap<(String, PathBuf), Slot>>> = LazyLock::new(|| StdMutex::new(HashMap::new()));

fn offered() -> MutexGuard<'static, HashMap<String, Offered>> {
    OFFERED.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn servers() -> MutexGuard<'static, HashMap<(String, PathBuf), Slot>> {
    SERVERS.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Whether any app's program is on offer, so an engine is told how those tools work.
pub fn any_offered() -> bool {
    !offered().is_empty()
}

/// Lists the program's tools, kept to an empty folder, and offers them to engines. Offering the same version again
/// changes nothing.
pub async fn offer(app_id: &str, version: &str, spec: &McpProgram, path: &Path) -> Result<usize, String> {
    if offered().get(app_id).is_some_and(|known| known.version == version && known.path == path) {
        return Ok(0);
    }
    let listing = path
        .parent()
        .and_then(Path::parent)
        .map(listing_dir)
        .ok_or_else(|| "The app's tools aren't where Misty keeps them.".to_owned())?;
    fs::create_dir_all(&listing).map_err(|error| format!("Couldn't prepare the app's tools: {error}"))?;
    let mut lister = Server::start(path, spec, &listing).await?;
    let tools = lister.list_tools().await?;
    drop(lister);
    let count = mcp::register_program(app_id, &tools)?;
    // A new version's servers start afresh.
    servers().retain(|(app, _), _| app != app_id);
    offered().insert(app_id.to_owned(), Offered { version: version.to_owned(), path: path.to_owned(), spec: spec.clone() });
    Ok(count)
}

/// Takes an app's program tools down and stops its servers.
pub fn withdraw(app_id: &str) {
    offered().remove(app_id);
    mcp::unregister_program(app_id);
    servers().retain(|(app, _), _| app != app_id);
}

/// Stops servers nobody has called for a while, and those of apps no longer offered.
fn reap() {
    let still: Vec<String> = offered().keys().cloned().collect();
    servers().retain(|(app, _), slot| {
        if !still.contains(app) {
            return false;
        }
        match slot.try_lock() {
            Ok(guard) => guard.as_ref().is_some_and(|server| server.last_used.elapsed() < IDLE_LIMIT),
            // In use right now.
            Err(_) => true,
        }
    });
}

/// What a call came to: done, refused with nothing changed, or cut off when it may have changed something.
pub enum Outcome {
    Done(Value),
    Failed { code: String, message: String },
    Uncertain(String),
}

fn failed(code: &str, message: impl Into<String>) -> Outcome {
    Outcome::Failed { code: code.to_owned(), message: message.into() }
}

fn text_of(result: &Value) -> String {
    result["content"]
        .as_array()
        .map(|parts| parts.iter().filter_map(|part| part["text"].as_str()).collect::<Vec<_>>().join("\n"))
        .unwrap_or_default()
}

/// Calls a tool of an app's program for a run, in the run's own folder. The gate has already let the call through.
pub async fn call(run_id: &str, app_id: &str, tool: &str, input: Value) -> Outcome {
    let Some(folder) = crate::engines::runs::folder_of(run_id) else {
        return failed(
            "app_tool_no_folder",
            "This app's tools work in a chat's folder, and this run has none. Nothing was done.",
        );
    };
    let Ok(folder) = fs::canonicalize(&folder) else {
        return failed("app_tool_no_folder", "Misty can't open this chat's folder. Nothing was done.");
    };
    let Some(app) = offered().get(app_id).cloned() else {
        return failed("app_tool_gone", "That app's tools aren't available any more. Nothing was done.");
    };
    reap();
    let slot = servers().entry((app_id.to_owned(), folder.clone())).or_default().clone();
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
    let params = json!({ "name": tool, "arguments": if input.is_object() { input } else { json!({}) } });
    let outcome = tokio::time::timeout(CALL_LIMIT, server.request("tools/call", params)).await;
    match outcome {
        Ok(Ok(result)) => {
            server.last_used = Instant::now();
            if result["isError"] == true {
                let message = text_of(&result);
                return failed(
                    "app_tool_error",
                    if message.is_empty() { "The app's tool failed.".to_owned() } else { message },
                );
            }
            let mut done = json!({ "content": result.get("content").cloned().unwrap_or_else(|| json!([])) });
            if let Some(structured) = result.get("structuredContent").filter(|value| !value.is_null()) {
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

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    fn spec(url: &str, sha256: &str) -> (McpProgram, Build) {
        let build = Build { url: url.to_owned(), sha256: sha256.to_owned(), size: 10 };
        let program = McpProgram {
            program: "demo-cli".into(),
            args: vec!["mcp".into()],
            read_root_flag: "--read-root".into(),
            write_root_flag: "--write-root".into(),
            env: HashMap::new(),
            builds: HashMap::new(),
        };
        (program, build)
    }

    fn zip_of(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in files {
            writer.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn tar_gz_of(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
        for (name, data) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            builder.append_data(&mut header, name, *data).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("misty-programs-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn only_the_program_is_taken_out_of_a_matching_archive() {
        let root = temp_root("install");
        let archive = zip_of(&[("demo/demo-cli", b"#!program"), ("demo/README", b"r"), ("demo/demo", b"gui")]);
        let sum = hex::encode(Sha256::digest(&archive));
        let (program, build) = spec("https://github.com/maker/demo/releases/download/v1/demo-cli-1.zip", &sum);
        let path = install_in(&root, "demo", "1.0.0", &program, &build, &archive).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"#!program");
        assert!(listing_dir(path.parent().unwrap().parent().unwrap()).is_dir());
        assert!(!path.parent().unwrap().join("README").exists());
        // A wrong checksum installs nothing.
        let (program, bad) = spec(&build.url, &"0".repeat(64));
        assert!(install_in(&root, "other", "1.0.0", &program, &bad, &archive).is_err());
        assert!(!root.join("other").exists());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_tarball_gives_up_its_program_too_and_two_or_none_are_refused() {
        let archive = tar_gz_of(&[("demo-1/bin/demo-cli", b"elf"), ("demo-1/share/x", b"x")]);
        assert_eq!(from_tar_gz(&archive, "demo-cli").unwrap(), b"elf");
        assert!(from_tar_gz(&tar_gz_of(&[("a/demo-cli", b"1"), ("b/demo-cli", b"2")]), "demo-cli").is_err());
        assert!(from_tar_gz(&tar_gz_of(&[("a/other", b"1")]), "demo-cli").is_err());
        assert!(from_zip(&zip_of(&[("a/demo-cli", b"1"), ("b/demo-cli", b"2")]), "demo-cli").is_err());
        assert!(from_zip(&zip_of(&[("a/other", b"1")]), "demo-cli").is_err());
    }

    #[test]
    fn the_pin_comes_from_the_catalog_and_must_be_the_makers_own() {
        let Some(platform) = platform() else { return };
        let catalog = |url: &str, extra: &str| -> String {
            format!(
                r#"{{"apps":[{{"id":"demo","upstream":"maker/demo","version":"1.0.0","mcp_program":{{"program":"demo-cli","args":["mcp"],"read_root_flag":"--read-root","write_root_flag":"--write-root"{extra},"builds":{{"{platform}":{{"url":"{url}","sha256":"{}","size":10}}}}}}}}]}}"#,
                "a".repeat(64)
            )
        };
        let good = catalog("https://github.com/maker/demo/releases/download/v1/demo-cli.zip", "");
        let (program, build) = pinned_in(&good, "demo", "1.0.0").unwrap();
        assert_eq!((program.program.as_str(), build.size), ("demo-cli", 10));
        // Another maker's release, a variable that changes how it loads, or another version are refused.
        assert!(pinned_in(&catalog("https://github.com/someone/else/releases/download/v1/x.zip", ""), "demo", "1.0.0").is_err());
        assert!(pinned_in(&catalog("https://github.com/maker/demo/releases/download/v1/x.dmg", ""), "demo", "1.0.0").is_err());
        let env = catalog(
            "https://github.com/maker/demo/releases/download/v1/demo-cli.zip",
            r#","env":{"DYLD_INSERT_LIBRARIES":"/x"}"#,
        );
        assert!(pinned_in(&env, "demo", "1.0.0").is_err());
        assert!(pinned_in(&good, "demo", "2.0.0").is_err());
        assert!(pinned_in(&good, "nothing", "1.0.0").is_err());
    }

    #[test]
    fn flags_and_variables_are_checked() {
        assert!(flag_ok("--automation-read-root") && !flag_ok("-r") && !flag_ok("--Root") && !flag_ok("--a b"));
        assert!(env_ok("SOUNDCRAFT_NO_PREFS", "1"));
        assert!(!env_ok("PATH", "/x") && !env_ok("LD_PRELOAD", "x") && !env_ok("DYLD_LIBRARY_PATH", "x") && !env_ok("lower", "x"));
    }
}
