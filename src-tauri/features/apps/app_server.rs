use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex as StdMutex};
use std::time::Duration;

use file_access::fs;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Child;
use tokio::sync::{oneshot, Mutex};

use super::manifest::{valid_id, valid_version};
use super::program::{platform, Build};

#[cfg(target_os = "macos")]
const PROFILE: &str = r#"
(version 1)
(allow default)
(deny file-write*)
(allow file-write* (subpath (param "DATA")) (subpath "/private/var/folders")
  (literal "/dev/null") (literal "/dev/tty") (literal "/dev/dtracehelper"))
(deny file-read* (subpath (param "HOME")))
(allow file-read-metadata (subpath (param "HOME")))
(allow file-read* (subpath (param "DATA")) (subpath (param "PROGRAM_DIR")))
(deny network-bind)
(allow network-bind (local ip "localhost:*"))
(deny network-inbound)
(allow network-inbound (local ip "localhost:*"))
"#;

pub const MAX_SERVER_ARCHIVE_BYTES: u64 = 1 << 30;
const MAX_SERVER_PROGRAM_BYTES: u64 = 3 << 29;
const START_LIMIT: Duration = Duration::from_secs(180);
const DOWNLOAD_STALL: Duration = Duration::from_secs(60);
const DOWNLOAD_RESUMES: u32 = 5;
const PROGRESS_STEP: Duration = Duration::from_millis(250);
const LOG_LINES: usize = 40;
pub const INSTALL_EVENT: &str = "misty://app-server-install";

#[derive(Debug, Clone, Deserialize)]
pub struct ServerProgram {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub ready: String,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub builds: HashMap<String, Build>,
}

#[derive(Deserialize)]
struct CatalogApp {
    id: String,
    upstream: String,
    version: String,
    #[serde(default)]
    server_program: Option<ServerProgram>,
}

#[derive(Clone)]
pub struct Pinned {
    pub app_id: String,
    pub version: String,
    pub spec: ServerProgram,
    pub build: Build,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    app_id: String,
    received: u64,
    total: u64,
}

fn plain_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.starts_with(|c: char| c.is_ascii_alphanumeric())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
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

impl ServerProgram {
    fn validate(&self) -> Result<(), String> {
        if !plain_name(&self.program) {
            return Err("The catalog's server name isn't a plain file name.".into());
        }
        let placeholder = |arg: &String| !arg.contains('{') || matches!(arg.as_str(), "{port}" | "{data}" | "{parent}");
        if self.args.len() > 24
            || self
                .args
                .iter()
                .any(|arg| arg.len() > 100 || arg.contains('\0') || !placeholder(arg))
            || !self.args.iter().any(|arg| arg == "{port}")
        {
            return Err("The catalog gives the app's server arguments Misty doesn't run.".into());
        }
        if self.ready.is_empty() || self.ready.len() > 100 {
            return Err("The catalog doesn't say how the app's server shows it's ready.".into());
        }
        if self.env.iter().any(|(key, value)| !env_ok(key, value)) {
            return Err("The catalog sets a variable Misty doesn't hand a server.".into());
        }
        Ok(())
    }

    fn build(&self, upstream_prefix: &str) -> Result<&Build, String> {
        let platform =
            platform().ok_or_else(|| "This app's server doesn't run on this computer.".to_owned())?;
        let build = self
            .builds
            .get(platform)
            .ok_or_else(|| "This app's server doesn't run on this computer.".to_owned())?;
        let kind_ok = build.url.ends_with(".zip") || build.url.ends_with(".tar.gz");
        if !build.url.starts_with(upstream_prefix)
            || !kind_ok
            || build.sha256.len() != 64
            || build.size > MAX_SERVER_ARCHIVE_BYTES
        {
            return Err("The catalog's build of the app's server isn't the maker's own release.".into());
        }
        Ok(build)
    }
}

pub fn pinned(app_id: &str) -> Result<Pinned, String> {
    pinned_in(&crate::registry::current().apps_json(), app_id)
}

fn pinned_in(catalog: &str, app_id: &str) -> Result<Pinned, String> {
    let apps: Vec<serde_json::Value> = serde_json::from_str(catalog)
        .map_err(|error| format!("Misty's app registry isn't valid: {error}"))?;
    let entry = apps
        .into_iter()
        .find(|app| app.get("id").and_then(serde_json::Value::as_str) == Some(app_id))
        .ok_or_else(|| "That app isn't in Misty's catalog.".to_owned())?;
    let app: CatalogApp = serde_json::from_value(entry)
        .map_err(|error| format!("Misty's catalog entry for this app isn't valid: {error}"))?;
    if !valid_id(&app.id) || !valid_version(&app.version) {
        return Err("That isn't an app id and version.".into());
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
    let spec = app
        .server_program
        .ok_or_else(|| "The app has no server of its own.".to_owned())?;
    spec.validate()?;
    let build = spec
        .build(&format!("https://github.com/{}/releases/download/", app.upstream))?
        .clone();
    Ok(Pinned {
        app_id: app.id,
        version: app.version,
        spec,
        build,
    })
}

pub fn declared(app_id: &str, version: &str) -> bool {
    super::bundle::installed_manifest(app_id, version)
        .ok()
        .flatten()
        .is_some_and(|manifest| manifest.server)
}

pub fn runs_here(app_id: &str) -> bool {
    pinned(app_id).is_ok()
}

fn home() -> Result<PathBuf, String> {
    file_access::paths::misty_home_dir()
        .ok_or_else(|| "Misty has no data folder to keep apps in.".to_owned())
}

fn program_path(pinned: &Pinned) -> Result<PathBuf, String> {
    Ok(home()?
        .join("app-servers")
        .join(&pinned.app_id)
        .join(&pinned.version)
        .join(&pinned.spec.program))
}

fn data_dir(app_id: &str) -> Result<PathBuf, String> {
    if !valid_id(app_id) {
        return Err("That isn't an app id.".into());
    }
    Ok(home()?.join("app-data").join(app_id))
}

pub fn installed(app_id: &str) -> bool {
    pinned(app_id)
        .and_then(|pinned| program_path(&pinned))
        .is_ok_and(|path| fs::is_file(&path))
}

static INSTALLS: LazyLock<StdMutex<HashMap<String, Arc<Mutex<()>>>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

fn install_lock(app_id: &str) -> Arc<Mutex<()>> {
    INSTALLS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .entry(app_id.to_owned())
        .or_default()
        .clone()
}

pub async fn install(app: &AppHandle, app_id: &str) -> Result<PathBuf, String> {
    let pinned = pinned(app_id)?;
    let path = program_path(&pinned)?;
    let lock = install_lock(app_id);
    let _held = lock.lock().await;
    if fs::is_file(&path) {
        return Ok(path);
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Misty has no folder for the app's server.".to_owned())?
        .to_path_buf();
    let root = home()?.join("app-servers");
    fs::create_dir_all(&root).map_err(|error| format!("Couldn't make a folder for the app's server: {error}"))?;
    let archive = root.join(format!(".download-{}", uuid::Uuid::new_v4()));
    let result = async {
        download_to(app, &pinned, &archive).await?;
        let staged = root.join(format!(".staging-{}", uuid::Uuid::new_v4()));
        let (archive_path, staged_path, program, tar) = (
            archive.clone(),
            staged.clone(),
            pinned.spec.program.clone(),
            pinned.build.url.ends_with(".tar.gz"),
        );
        let extracted = tokio::task::spawn_blocking(move || extract(&archive_path, &staged_path, &program, tar))
            .await
            .map_err(|error| error.to_string())
            .and_then(|done| done);
        if let Err(error) = extracted {
            let _ = fs::remove_file(&staged);
            return Err(error);
        }
        let placed = (|| -> std::io::Result<()> {
            if fs::exists(&parent) {
                fs::remove_dir_all(&parent)?;
            }
            fs::create_dir_all(&parent)?;
            fs::rename(&staged, &path)
        })();
        if let Err(error) = placed {
            let _ = fs::remove_file(&staged);
            return Err(format!("Couldn't save the app's server: {error}"));
        }
        Ok(path.clone())
    }
    .await;
    let _ = fs::remove_file(&archive);
    result
}

async fn download_to(app: &AppHandle, pinned: &Pinned, target: &Path) -> Result<(), String> {
    let parsed = url::Url::parse(&pinned.build.url).map_err(|_| "That isn't an address.".to_owned())?;
    if parsed.scheme() != "https" {
        return Err("Apps download only over https.".into());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(DOWNLOAD_STALL)
        .build()
        .map_err(|error| error.to_string())?;
    let failed = || "Couldn't download the app's server. Check your connection and try again.".to_owned();
    let mut response = request_from(&client, &parsed, 0).await.ok_or_else(failed)?;
    let total = pinned.build.size;
    if response.content_length().is_some_and(|length| length > MAX_SERVER_ARCHIVE_BYTES) {
        return Err("The app's server is larger than Misty downloads.".into());
    }
    let mut file = std::fs::File::create(target)
        .map_err(|error| format!("Couldn't save the app's server: {error}"))?;
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    let mut told = std::time::Instant::now();
    let mut resumed = 0;
    loop {
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) if total == 0 || received >= total => break,
            Ok(None) | Err(_) if resumed < DOWNLOAD_RESUMES && received > 0 => {
                resumed += 1;
                response = request_from(&client, &parsed, received).await.ok_or_else(failed)?;
                continue;
            }
            Ok(None) | Err(_) => return Err(failed()),
        };
        received += chunk.len() as u64;
        if received > MAX_SERVER_ARCHIVE_BYTES {
            return Err("The app's server is larger than Misty downloads.".into());
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .map_err(|error| format!("Couldn't save the app's server: {error}"))?;
        if told.elapsed() >= PROGRESS_STEP || received == total {
            told = std::time::Instant::now();
            let _ = app.emit(
                INSTALL_EVENT,
                Progress {
                    app_id: pinned.app_id.clone(),
                    received,
                    total,
                },
            );
        }
    }
    file.flush()
        .map_err(|error| format!("Couldn't save the app's server: {error}"))?;
    if !pinned
        .build
        .sha256
        .eq_ignore_ascii_case(&hex::encode(hasher.finalize()))
    {
        return Err("The downloaded server doesn't match the catalog's checksum, so it wasn't installed.".into());
    }
    Ok(())
}

async fn request_from(client: &reqwest::Client, url: &url::Url, from: u64) -> Option<reqwest::Response> {
    let mut request = client.get(url.clone());
    if from > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={from}-"));
    }
    let response = request.send().await.ok()?.error_for_status().ok()?;
    if response.url().scheme() != "https" {
        return None;
    }
    let starts_here = response
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|range| range.to_str().ok())
        .is_some_and(|range| range.starts_with(&format!("bytes {from}-")));
    if from > 0 && (response.status() != reqwest::StatusCode::PARTIAL_CONTENT || !starts_here) {
        return None;
    }
    Some(response)
}

fn extract(archive: &Path, target: &Path, name: &str, tar: bool) -> Result<(), String> {
    let damaged = || "The app's server download is damaged.".to_owned();
    let file = std::fs::File::open(archive).map_err(|_| damaged())?;
    let mut found = false;
    if tar {
        let mut entries = tar::Archive::new(flate2::read::GzDecoder::new(std::io::BufReader::new(file)));
        for entry in entries.entries().map_err(|_| damaged())? {
            let entry = entry.map_err(|_| damaged())?;
            let path = entry.path().map_err(|_| damaged())?.into_owned();
            if path.file_name().and_then(|file| file.to_str()) != Some(name) {
                continue;
            }
            let kind = entry.header().entry_type();
            if kind.is_symlink() || kind.is_hard_link() {
                return Err("The app's server is a link, which Misty doesn't run.".into());
            }
            if !kind.is_file() {
                continue;
            }
            if found {
                return Err(format!("The app's release holds more than one {name}."));
            }
            write_capped(entry, target)?;
            found = true;
        }
    } else {
        let mut zip = zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|_| damaged())?;
        let mut index = None;
        for at in 0..zip.len() {
            let entry = zip.by_index(at).map_err(|_| damaged())?;
            let last = entry.name().trim_end_matches('/').rsplit('/').next().unwrap_or("");
            if last != name || entry.is_dir() {
                continue;
            }
            if entry.is_symlink() {
                return Err("The app's server is a link, which Misty doesn't run.".into());
            }
            if index.replace(at).is_some() {
                return Err(format!("The app's release holds more than one {name}."));
            }
        }
        let at = index.ok_or_else(|| format!("The app's release has no {name}."))?;
        write_capped(zip.by_index(at).map_err(|_| damaged())?, target)?;
        found = true;
    }
    if !found {
        return Err(format!("The app's release has no {name}."));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(target, std::fs::Permissions::from_mode(0o755))
            .map_err(|error| format!("Couldn't save the app's server: {error}"))?;
    }
    Ok(())
}

fn write_capped(reader: impl Read, target: &Path) -> Result<(), String> {
    let mut out = std::fs::File::create(target)
        .map_err(|error| format!("Couldn't save the app's server: {error}"))?;
    let copied = std::io::copy(&mut reader.take(MAX_SERVER_PROGRAM_BYTES + 1), &mut out)
        .map_err(|_| "The app's server download is damaged.".to_owned())?;
    if copied > MAX_SERVER_PROGRAM_BYTES {
        let _ = fs::remove_file(target);
        return Err("The app's server is larger than Misty runs.".into());
    }
    Ok(())
}

struct Running {
    url: String,
    child: Child,
}

type Slot = Arc<Mutex<Option<Running>>>;

static SERVERS: LazyLock<StdMutex<HashMap<String, Slot>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));
static URLS: LazyLock<StdMutex<HashMap<String, String>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

fn slot(app_id: &str) -> Slot {
    SERVERS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .entry(app_id.to_owned())
        .or_default()
        .clone()
}

fn remember_url(app_id: &str, url: Option<&str>) {
    let mut urls = URLS.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    match url {
        Some(url) => urls.insert(app_id.to_owned(), url.to_owned()),
        None => urls.remove(app_id),
    };
}

pub fn current_url(app_id: &str) -> Option<String> {
    URLS.lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(app_id)
        .cloned()
}

pub async fn url(app: &AppHandle, app_id: &str) -> Result<String, String> {
    let slot = slot(app_id);
    let mut running = slot.lock().await;
    if let Some(server) = running.as_mut() {
        if matches!(server.child.try_wait(), Ok(None)) {
            return Ok(server.url.clone());
        }
        *running = None;
        remember_url(app_id, None);
    }
    let pinned = pinned(app_id)?;
    let program = install(app, app_id).await?;
    let server = start(&pinned, &program).await?;
    let url = server.url.clone();
    remember_url(app_id, Some(&url));
    *running = Some(server);
    Ok(url)
}

pub async fn stop(app_id: &str) {
    let slot = slot(app_id);
    let mut running = slot.lock().await;
    if let Some(mut server) = running.take() {
        let _ = server.child.kill().await;
    }
    remember_url(app_id, None);
}

pub async fn remove(app_id: &str) -> Result<(), String> {
    stop(app_id).await;
    if !valid_id(app_id) {
        return Err("That isn't an app id.".into());
    }
    let dir = home()?.join("app-servers").join(app_id);
    if fs::exists(&dir) {
        fs::remove_dir_all(&dir)
            .map_err(|error| format!("Couldn't remove the app's server: {error}"))?;
    }
    Ok(())
}

fn free_port() -> Result<u16, String> {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|_| "Misty couldn't find a free port for the app's server.".to_owned())
}

async fn start(pinned: &Pinned, program: &Path) -> Result<Running, String> {
    let data = data_dir(&pinned.app_id)?;
    let temp = data.join("tmp");
    fs::create_dir_all(&temp)
        .map_err(|error| format!("Couldn't make the app's data folder: {error}"))?;
    let port = free_port()?;
    let parent = std::process::id().to_string();
    let args: Vec<String> = pinned
        .spec
        .args
        .iter()
        .map(|arg| match arg.as_str() {
            "{port}" => port.to_string(),
            "{data}" => data.to_string_lossy().into_owned(),
            "{parent}" => parent.clone(),
            other => other.to_owned(),
        })
        .collect();
    let mut command = confined(program, &data)?;
    command
        .args(&args)
        .current_dir(&data)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", &data)
        .env("TMPDIR", &temp)
        .env("LANG", "en_US.UTF-8")
        .envs(&pinned.spec.env)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Couldn't start the app's server: {error}"))?;
    let log: Arc<StdMutex<VecDeque<String>>> = Arc::default();
    let (ready_tx, ready_rx) = oneshot::channel::<()>();
    let ready_tx = Arc::new(StdMutex::new(Some(ready_tx)));
    for stream in [
        child.stdout.take().map(|out| Box::new(out) as Box<dyn AsyncRead + Send + Unpin>),
        child.stderr.take().map(|err| Box::new(err) as Box<dyn AsyncRead + Send + Unpin>),
    ]
    .into_iter()
    .flatten()
    {
        let (log, ready_tx, ready) = (log.clone(), ready_tx.clone(), pinned.spec.ready.clone());
        tokio::spawn(async move {
            let mut lines = BufReader::new(stream).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.contains(&ready) {
                    if let Some(tx) = ready_tx.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take() {
                        let _ = tx.send(());
                    }
                }
                let mut kept = log.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                if kept.len() == LOG_LINES {
                    kept.pop_front();
                }
                kept.push_back(line);
            }
        });
    }
    let ended = tokio::select! {
        ready = ready_rx => ready.is_err(),
        _ = tokio::time::sleep(START_LIMIT) => {
            let _ = child.kill().await;
            return Err("The app's server took too long to start.".into());
        }
    };
    if ended || !matches!(child.try_wait(), Ok(None)) {
        let _ = child.kill().await;
        let last = log
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .back()
            .cloned()
            .unwrap_or_default();
        return Err(if last.is_empty() {
            "The app's server stopped as it started.".into()
        } else {
            format!("The app's server stopped as it started: {last}")
        });
    }
    Ok(Running {
        url: format!("http://127.0.0.1:{port}"),
        child,
    })
}

#[cfg(target_os = "macos")]
fn confined(program: &Path, data: &Path) -> Result<tokio::process::Command, String> {
    let failed = |_| "Misty couldn't confine the app's server, so it wasn't started.".to_owned();
    let program = fs::canonicalize(program).map_err(failed)?;
    let data = fs::canonicalize(data).map_err(failed)?;
    let program_dir = program
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| failed(std::io::Error::other("")))?;
    let person = std::env::var_os("HOME")
        .map(PathBuf::from)
        .and_then(|home| file_access::resolve_real_path(&home).ok())
        .ok_or_else(|| failed(std::io::Error::other("")))?;
    let mut command = tokio::process::Command::new(sandbox::macos::SANDBOX_EXEC);
    command
        .args(sandbox::macos::arguments(
            PROFILE,
            &[
                ("DATA", &data),
                ("PROGRAM_DIR", &program_dir),
                ("HOME", &person),
            ],
        ))
        .arg(&program);
    command.process_group(0);
    Ok(command)
}

#[cfg(not(target_os = "macos"))]
fn confined(_program: &Path, _data: &Path) -> Result<tokio::process::Command, String> {
    Err("Misty can't confine an app's server on this computer yet.".into())
}

#[tauri::command]
pub async fn app_server_url(
    webview: tauri::Webview,
    app: AppHandle,
    app_id: String,
) -> Result<String, String> {
    crate::project::person_window(&webview)?;
    url(&app, &app_id).await
}

#[tauri::command]
pub async fn app_server_install(
    webview: tauri::Webview,
    app: AppHandle,
    app_id: String,
) -> Result<(), String> {
    crate::project::person_window(&webview)?;
    install(&app, &app_id).await.map(|_| ())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerState {
    runs_here: bool,
    installed: bool,
    running: bool,
}

#[tauri::command]
pub fn app_server_state(webview: tauri::Webview, app_id: String) -> Result<ServerState, String> {
    crate::project::person_window(&webview)?;
    Ok(ServerState {
        runs_here: runs_here(&app_id),
        installed: installed(&app_id),
        running: current_url(&app_id).is_some(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog(server: serde_json::Value) -> String {
        serde_json::json!([{
            "id": "voicebox",
            "upstream": "jamiepine/voicebox",
            "version": "0.6.0",
            "server_program": server,
        }])
        .to_string()
    }

    fn server(args: serde_json::Value) -> serde_json::Value {
        let platform = platform().unwrap_or("macos-aarch64");
        serde_json::json!({
            "program": "voicebox-server",
            "args": args,
            "ready": "Uvicorn running on",
            "builds": { platform: {
                "url": "https://github.com/jamiepine/voicebox/releases/download/v0.6.0/Voicebox_aarch64.app.tar.gz",
                "sha256": "ea7c9096ff03aa0da86b769d554f2f48a7c2dee7625ceb131814886b805d3119",
                "size": 644109016_u64,
            }},
        })
    }

    #[test]
    fn a_server_takes_only_its_placeholders() {
        if platform().is_none() {
            return;
        }
        let good = server(serde_json::json!(["--host", "127.0.0.1", "--port", "{port}", "--data-dir", "{data}", "--parent-pid", "{parent}"]));
        assert!(pinned_in(&catalog(good), "voicebox").is_ok());
        let unknown = server(serde_json::json!(["--port", "{port}", "--home", "{home}"]));
        assert!(pinned_in(&catalog(unknown), "voicebox").is_err());
        let portless = server(serde_json::json!(["--data-dir", "{data}"]));
        assert!(pinned_in(&catalog(portless), "voicebox").is_err());
    }

    #[test]
    fn a_server_comes_only_from_the_makers_releases() {
        if platform().is_none() {
            return;
        }
        let mut elsewhere = server(serde_json::json!(["--port", "{port}"]));
        let platform = platform().unwrap_or("macos-aarch64");
        elsewhere["builds"][platform]["url"] =
            serde_json::json!("https://example.com/Voicebox_aarch64.app.tar.gz");
        assert!(pinned_in(&catalog(elsewhere), "voicebox").is_err());
    }
}
