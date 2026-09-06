//! Grant-owned public media review/download jobs.
use super::{download_process, download_proxy::PublicProxy, PermissionSet};
use cap_std::fs::{Dir, OpenOptions};
use serde_json::{json, Value};
use std::{
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};

pub struct DownloadJob {
    state: Arc<Mutex<Value>>,
    cancel: Arc<AtomicBool>,
    folder: Option<String>,
}
impl DownloadJob {
    pub(super) fn uses_handle(&self, handle: &str) -> bool {
        self.folder.as_deref() == Some(handle)
    }
}
impl Drop for DownloadJob {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
    }
}

struct Tools {
    ytdlp: PathBuf,
    ffmpeg: PathBuf,
    ffprobe: PathBuf,
}

fn tools() -> Result<Tools, String> {
    if !cfg!(target_os = "macos") {
        return Err("Isolated media downloads are not implemented on this platform yet.".into());
    }
    if !Path::new("/usr/bin/sandbox-exec").is_file() {
        return Err("The native media sandbox is unavailable.".into());
    }
    let resolve = |name| {
        crate::infra::system_dependencies::resolve_executable(name, None)
            .ok_or_else(|| format!("Install {name} on this device to use media downloads."))?
            .canonicalize()
            .map_err(|_| format!("Host {name} is unavailable."))
    };
    let result = Tools {
        ytdlp: resolve("yt-dlp")?,
        ffmpeg: resolve("ffmpeg")?,
        ffprobe: resolve("ffprobe")?,
    };
    if let Some(home) = dirs::home_dir() {
        let packages = home.join(".misty/plugins");
        if [&result.ytdlp, &result.ffmpeg, &result.ffprobe]
            .iter()
            .any(|path| path.starts_with(&packages))
        {
            return Err("Media downloads require Host-managed tools, not App executables.".into());
        }
    }
    Ok(result)
}

pub fn availability() -> Value {
    match tools() {
        Ok(_) => json!({"available":true,"formats":["mp3","m4a","mp4","webm"]}),
        Err(message) => json!({"available":false,"formats":[],"message":message}),
    }
}

fn text<'a>(params: &'a Value, key: &str, max: usize) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= max)
        .ok_or_else(|| format!("Missing or invalid {key}."))
}

fn url(params: &Value) -> Result<String, String> {
    let value = text(params, "url", 4096)?;
    let url = url::Url::parse(value).map_err(|_| "Enter a valid HTTPS media URL.")?;
    let host = url
        .host_str()
        .filter(|host| host.contains('.') && !host.ends_with(".local"))
        .ok_or("Enter a public HTTPS media URL.")?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
        || host.eq_ignore_ascii_case("localhost")
    {
        return Err("Enter a public HTTPS media URL without credentials or a custom port.".into());
    }
    if host
        .parse()
        .is_ok_and(|ip| !super::download_proxy::public_ip(ip))
    {
        return Err("Local and private media addresses are not allowed.".into());
    }
    Ok(url.into())
}

fn worker() -> Result<tokio::sync::OwnedSemaphorePermit, String> {
    static WORKERS: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();
    WORKERS
        .get_or_init(|| Arc::new(tokio::sync::Semaphore::new(2)))
        .clone()
        .try_acquire_owned()
        .map_err(|_| "Two media downloads are already running. Try again shortly.".into())
}

fn insert_job(
    permissions: &mut PermissionSet,
    folder: Option<String>,
    message: &str,
) -> Result<(String, Arc<Mutex<Value>>, Arc<AtomicBool>), String> {
    if permissions.downloads.len() >= 4 {
        return Err("Close an earlier media operation before starting another.".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let state = Arc::new(Mutex::new(
        json!({"status":"running","message":message,"result":null}),
    ));
    let cancel = Arc::new(AtomicBool::new(false));
    permissions.downloads.insert(
        id.clone(),
        DownloadJob {
            state: state.clone(),
            cancel: cancel.clone(),
            folder,
        },
    );
    Ok((id, state, cancel))
}

fn finish(state: &Mutex<Value>, cancel: &AtomicBool, result: Result<Value, String>) {
    if let Ok(mut state) = state.lock() {
        *state = if cancel.load(Ordering::Acquire) {
            json!({"status":"cancelled","message":"Media operation cancelled.","result":null})
        } else {
            match result {
                Ok(value) => {
                    json!({"status":"completed","message":"Media operation completed.","result":value})
                }
                Err(message) => json!({"status":"failed","message":message,"result":null}),
            }
        };
    }
}

pub fn execute(
    permissions: &mut PermissionSet,
    method: &str,
    params: &Value,
) -> Result<Value, String> {
    permissions.authorize("media.download")?;
    match method {
        "downloads.inspectStart" => {
            let url = url(params)?;
            let playlist = params.get("playlist") == Some(&Value::Bool(true));
            let tools = tools()?;
            let permit = worker()?;
            let (id, state, cancel) = insert_job(permissions, None, "Reading media details…")?;
            let flag = cancel.clone();
            tokio::task::spawn_blocking(move || {
                let result = PublicProxy::start(flag.clone()).and_then(|proxy| {
                    download_process::inspect(
                        &tools.ytdlp,
                        &tools.ffmpeg,
                        &tools.ffprobe,
                        proxy.endpoint(),
                        &url,
                        playlist,
                        flag.clone(),
                    )
                });
                drop(permit);
                finish(&state, &flag, result);
            });
            Ok(json!({"jobId":id}))
        }
        "downloads.downloadStart" => {
            permissions.authorize("files.write")?;
            let url = url(params)?;
            let format = text(params, "format", 16)?;
            if !["mp3", "m4a", "mp4", "webm"].contains(&format) {
                return Err("Choose a supported media format.".into());
            }
            let playlist = params.get("playlist") == Some(&Value::Bool(true));
            let folder = text(params, "directory", 128)?;
            let directory = permissions
                .folders
                .get(folder)
                .filter(|folder| folder.writable)
                .ok_or("Choose an output folder for writing first.")?
                .directory
                .clone();
            let tools = tools()?;
            let permit = worker()?;
            let (id, state, cancel) = insert_job(
                permissions,
                Some(folder.into()),
                "Downloading media through Misty…",
            )?;
            let flag = cancel.clone();
            let format = format.to_owned();
            tokio::task::spawn_blocking(move || {
                let result = PublicProxy::start(flag.clone())
                    .and_then(|proxy| {
                        download_process::download(
                            &tools.ytdlp,
                            &tools.ffmpeg,
                            &tools.ffprobe,
                            proxy.endpoint(),
                            &url,
                            &format,
                            playlist,
                            flag.clone(),
                        )
                    })
                    .and_then(|files| save(files, &directory, &flag))
                    .map(|outputs| json!({"outputs":outputs}));
                drop(permit);
                finish(&state, &flag, result);
            });
            Ok(json!({"jobId":id}))
        }
        "downloads.jobStatus" | "downloads.jobCancel" | "downloads.jobClose" => {
            let id = text(params, "jobId", 128)?;
            let job = permissions
                .downloads
                .get(id)
                .ok_or("This media operation does not belong to this App instance.")?;
            if method == "downloads.jobStatus" {
                return job
                    .state
                    .lock()
                    .map(|state| state.clone())
                    .map_err(|_| "Media operation unavailable.".into());
            }
            if method == "downloads.jobCancel" {
                job.cancel.store(true, Ordering::Release);
                return Ok(Value::Null);
            }
            permissions.downloads.remove(id);
            Ok(Value::Null)
        }
        _ => Err("Unsupported media download operation.".into()),
    }
}

fn save(
    files: Vec<download_process::DownloadedFile>,
    directory: &Dir,
    cancel: &AtomicBool,
) -> Result<Vec<Value>, String> {
    let mut outputs = Vec::new();
    for item in files {
        match save_one(item, directory, cancel) {
            Ok((name, bytes)) => outputs.push(json!({"name":name,"bytes":bytes})),
            Err(error) if outputs.is_empty() => return Err(error),
            Err(error) => {
                return Err(format!(
                    "{error} {} completed file(s) were already saved.",
                    outputs.len()
                ))
            }
        }
    }
    Ok(outputs)
}

fn save_one(
    item: download_process::DownloadedFile,
    directory: &Dir,
    cancel: &AtomicBool,
) -> Result<(String, u64), String> {
    let temporary = format!(".misty-download-{}", uuid::Uuid::new_v4());
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        let mut output = directory
            .open_with(&temporary, &options)
            .map_err(|_| "Could not prepare the chosen output folder.")?;
        let mut input = item
            .file
            .try_clone()
            .map_err(|_| "Completed media is unavailable.")?;
        input
            .seek(SeekFrom::Start(0))
            .map_err(|_| "Completed media is unavailable.")?;
        let mut copied = 0u64;
        let mut buffer = [0u8; 65_536];
        loop {
            if cancel.load(Ordering::Acquire) {
                return Err("Media download cancelled before saving completed output.".into());
            }
            let size = input
                .read(&mut buffer)
                .map_err(|_| "Could not read completed media.")?;
            if size == 0 {
                break;
            }
            copied = copied
                .checked_add(size as u64)
                .filter(|value| *value <= item.bytes)
                .ok_or("Completed media changed before it could be saved.")?;
            output
                .write_all(&buffer[..size])
                .map_err(|_| "Could not save completed media.")?;
        }
        if copied != item.bytes {
            return Err("Completed media changed before it could be saved.".into());
        }
        output
            .sync_all()
            .map_err(|_| "Could not finish saving completed media.")?;
        for suffix in 0..10_000 {
            let name = collision_name(&item.name, suffix)?;
            match directory.hard_link(&temporary, directory, &name) {
                Ok(()) => return Ok((name, copied)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => return Err("Could not publish completed media safely.".into()),
            }
        }
        Err("Could not choose an unused output filename.".into())
    })();
    let _ = directory.remove_file(&temporary);
    result
}

fn collision_name(name: &str, suffix: usize) -> Result<String, String> {
    if !super::binary_files::safe_name(name) {
        return Err("Completed media has an unsafe filename.".into());
    }
    if suffix == 0 {
        return Ok(name.into());
    }
    let path = Path::new(name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("media");
    let extension = path.extension().and_then(|value| value.to_str());
    let tail = extension
        .map(|extension| format!(" ({suffix}).{extension}"))
        .unwrap_or_else(|| format!(" ({suffix})"));
    let keep = 240usize.saturating_sub(tail.len());
    let stem: String = stem.chars().take(keep).collect();
    let value = format!("{stem}{tail}");
    super::binary_files::safe_name(&value)
        .then_some(value)
        .ok_or("Could not choose a safe output filename.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_and_output_names_are_strictly_bounded() {
        for value in [
            "http://example.com/video",
            "https://localhost/video",
            "https://127.0.0.1/video",
            "https://user:password@example.com/video",
            "https://example.com:8443/video",
        ] {
            assert!(url(&json!({"url":value})).is_err(), "{value}");
        }
        assert!(url(&json!({"url":"https://example.com/video"})).is_ok());
        assert_eq!(collision_name("video.mp4", 2).unwrap(), "video (2).mp4");
        assert!(collision_name("../video.mp4", 0).is_err());
    }

    #[test]
    fn saving_is_exclusive_and_preserves_existing_files() {
        let fixture = tempfile::tempdir().unwrap();
        std::fs::write(fixture.path().join("video.mp4"), b"existing").unwrap();
        let directory =
            Dir::open_ambient_dir(fixture.path(), cap_std::ambient_authority()).unwrap();
        let source = tempfile::tempfile().unwrap();
        (&source).write_all(b"download").unwrap();
        let saved = save_one(
            download_process::DownloadedFile {
                file: source,
                name: "video.mp4".into(),
                bytes: 8,
            },
            &directory,
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(saved.0, "video (1).mp4");
        assert_eq!(
            std::fs::read(fixture.path().join("video.mp4")).unwrap(),
            b"existing"
        );
        assert_eq!(
            std::fs::read(fixture.path().join("video (1).mp4")).unwrap(),
            b"download"
        );
    }

    #[test]
    fn revoking_media_or_folder_access_cancels_owned_downloads() {
        let mut permissions = PermissionSet::from_document(
            "ytdlp",
            &json!({"runtime_capabilities":["files.write","media.download"]}),
            None,
        )
        .unwrap();
        permissions.decide("files.write", true).unwrap();
        permissions.decide("media.download", true).unwrap();
        let cancelled = Arc::new(AtomicBool::new(false));
        permissions.downloads.insert(
            "job".into(),
            DownloadJob {
                state: Arc::new(Mutex::new(json!({"status":"running"}))),
                cancel: cancelled.clone(),
                folder: Some("folder".into()),
            },
        );
        permissions.decide("media.download", false).unwrap();
        assert!(cancelled.load(Ordering::Acquire));
        assert!(permissions.downloads.is_empty());
    }
}
