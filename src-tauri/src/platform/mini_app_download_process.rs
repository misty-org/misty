//! Fixed yt-dlp operations in a filesystem and process sandbox, with network
//! access to public hosts only. An App supplies only a validated URL, an
//! enumerated format and a playlist choice.
//!
//! On macOS the worker reaches the network only through Misty's proxy, which
//! refuses local and private addresses. On Windows it runs in an AppContainer
//! holding only `internetClient`: Windows itself keeps it off loopback and the
//! local network, and it can read nothing outside its folder and its tools.
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    ffi::OsString,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
#[cfg(target_os = "macos")]
#[path = "mini_app_download_process_macos.rs"]
mod macos;
#[cfg(target_os = "macos")]
use macos::{command, run, run_with_output};

#[cfg(windows)]
const CONTAINER: &str = "Misty.MediaDownloads";
/// The largest single download, and the most a job's outputs may total.
const MAX_FILE: u64 = 4_294_967_296;
const MAX_TOTAL: u64 = 10 * 1024 * 1024 * 1024;

pub struct DownloadedFile {
    pub file: File,
    pub name: String,
    pub bytes: u64,
}

/// The installed programs a download runs.
pub struct Tools<'a> {
    pub ytdlp: &'a Path,
    pub ffmpeg: &'a Path,
    pub ffprobe: &'a Path,
}

pub fn inspect(
    tools: &Tools,
    url: &str,
    playlist: bool,
    cancel: Arc<AtomicBool>,
) -> Result<Value, String> {
    let worker = Worker::new("misty-media-review-")?;
    let mut arguments = strings(&["--dump-single-json", "--no-warnings", "--skip-download"]);
    if playlist {
        arguments.extend(strings(&["--flat-playlist", "--playlist-end", "100"]));
    } else {
        arguments.push("--no-playlist".into());
    }
    arguments.push(url.into());
    let output = worker
        .run(
            tools,
            arguments,
            Some(8 * 1024 * 1024),
            &cancel,
            Duration::from_secs(30),
        )
        .map_err(|error| error.unwrap_or("The restricted media worker could not read that URL."))?;
    redact_info(&output)
}

pub fn download(
    tools: &Tools,
    url: &str,
    format: &str,
    playlist: bool,
    cancel: Arc<AtomicBool>,
) -> Result<Vec<DownloadedFile>, String> {
    let worker = Worker::new("misty-media-download-")?;
    let output = worker.path().join("output");
    let temporary = worker.path().join("temporary");
    std::fs::create_dir(&output).map_err(|_| "Could not prepare media output.")?;
    std::fs::create_dir(&temporary).map_err(|_| "Could not prepare media output.")?;
    let completed = worker.path().join("completed.txt");
    let mut arguments = strings(&[
        "--newline",
        "--restrict-filenames",
        "--no-overwrites",
        "--no-part",
    ]);
    arguments.push("--paths".into());
    arguments.push(format!("home:{}", output.display()).into());
    arguments.push("--paths".into());
    arguments.push(format!("temp:{}", temporary.display()).into());
    arguments.extend(strings(&[
        "--output",
        "%(title).160B [%(id).64B].%(ext)s",
        "--print-to-file",
        "after_move:filepath",
    ]));
    arguments.push(completed.clone().into_os_string());
    arguments.extend(strings(&["--max-filesize", "4294967296"]));
    if playlist {
        arguments.extend(strings(&["--yes-playlist", "--playlist-end", "100"]));
    } else {
        arguments.push("--no-playlist".into());
    }
    arguments.extend(strings(match format {
        "mp3" => &["-x", "--audio-format", "mp3", "--audio-quality", "0"],
        "m4a" => &["-x", "--audio-format", "m4a", "--audio-quality", "0"],
        "mp4" => &["-f", "bv*+ba/b", "--merge-output-format", "mp4"],
        "webm" => &[
            "-f",
            "bv*[ext=webm]+ba[ext=webm]/b[ext=webm]/bv*+ba/b",
            "--merge-output-format",
            "webm",
        ],
        _ => return Err("Unsupported media download format.".into()),
    }));
    arguments.push(url.into());
    worker
        .run(tools, arguments, None, &cancel, Duration::from_secs(86_400))
        .map_err(|error| {
            error.unwrap_or("The restricted media worker could not download that URL.")
        })?;
    if cancel.load(Ordering::Acquire) {
        return Err("Media download cancelled.".into());
    }
    open_completed(&completed, &output)
}

fn strings(values: &[&str]) -> Vec<OsString> {
    values.iter().map(OsString::from).collect()
}

/// A private work folder and the sandbox yt-dlp runs in.
struct Worker {
    #[cfg(target_os = "macos")]
    work: tempfile::TempDir,
    #[cfg(windows)]
    workspace: crate::platform::windows::sandbox::Workspace,
    /// The workspace as the root of its own drive letter. yt-dlp creates
    /// folders by walking up their path, and an AppContainer can't see the
    /// drives above its workspace, so the walk must end at a root it owns.
    #[cfg(windows)]
    drive: std::sync::Arc<misty_windows_confine::Drive>,
    #[cfg(windows)]
    root: PathBuf,
}

impl Worker {
    fn new(prefix: &str) -> Result<Self, String> {
        #[cfg(target_os = "macos")]
        return Ok(Self {
            work: tempfile::Builder::new()
                .prefix(prefix)
                .tempdir()
                .map_err(|_| "Could not prepare the media work folder.")?,
        });
        #[cfg(windows)]
        let _ = prefix;
        #[cfg(windows)]
        return Self::confined();
        #[cfg(not(any(target_os = "macos", windows)))]
        {
            let _ = prefix;
            Err("Isolated media downloads are not implemented on this platform yet.".into())
        }
    }

    /// A workspace for the AppContainer, reached through its own drive.
    #[cfg(windows)]
    fn confined() -> Result<Self, String> {
        let workspace = crate::platform::windows::sandbox::Workspace::new(CONTAINER)?;
        let drive = misty_windows_confine::drive_for(workspace.path())?;
        let root = drive.root();
        Ok(Self {
            workspace,
            drive,
            root,
        })
    }

    fn path(&self) -> &Path {
        #[cfg(target_os = "macos")]
        return self.work.path();
        #[cfg(windows)]
        return &self.root;
        #[cfg(not(any(target_os = "macos", windows)))]
        Path::new("")
    }

    /// Runs yt-dlp with `arguments` for at most `limit`. With `capture`, its
    /// standard output, up to that many bytes, comes back. A failure carries
    /// a message when the sandbox itself failed, and `None` when yt-dlp did.
    fn run(
        &self,
        tools: &Tools,
        arguments: Vec<OsString>,
        capture: Option<usize>,
        cancel: &Arc<AtomicBool>,
        limit: Duration,
    ) -> Result<Vec<u8>, Option<&'static str>> {
        #[cfg(target_os = "macos")]
        {
            let proxy = super::download_proxy::PublicProxy::start(cancel.clone())
                .map_err(|_| Some("Could not start the private media connection."))?;
            let mut command = command(tools, self.path(), proxy.endpoint()).map_err(Some)?;
            command.args(arguments);
            match capture {
                Some(max) => run_with_output(command, cancel, limit, max),
                None => run(command, cancel, limit).map(|()| Vec::new()),
            }
        }
        #[cfg(windows)]
        {
            use crate::platform::windows::sandbox::{HostTool, Limits};
            let share = |path: &Path| {
                HostTool::share(path).map_err(|_| Some("Host tools are unavailable."))
            };
            let ytdlp = share(tools.ytdlp)?;
            // yt-dlp starts FFmpeg itself; sharing grants it to the same capability.
            share(tools.ffmpeg)?;
            share(tools.ffprobe)?;
            let mut all = strings(&["--no-config", "--no-cache-dir", "--ffmpeg-location"]);
            all.push(tools.ffmpeg.as_os_str().to_owned());
            all.extend(arguments);
            let output = tempfile::tempfile().map_err(|_| Some("Media output unavailable."))?;
            let limits = Limits {
                memory_bytes: 2 * 1024 * 1024 * 1024,
                cpu: Duration::from_secs(3_600),
                wall: limit,
                output_bytes: capture.unwrap_or(1024 * 1024) as u64,
                work_bytes: MAX_TOTAL + MAX_FILE,
                // yt-dlp's launcher, Python, FFmpeg and FFprobe.
                processes: 8,
            };
            let code = self
                .workspace
                .run_tool(&ytdlp, &all, Some(&output), true, &limits, cancel)
                .map_err(|_| Some("Media operation cancelled or timed out."))?;
            if code != 0 {
                return Err(None);
            }
            let Some(max) = capture else {
                return Ok(Vec::new());
            };
            let mut bytes = Vec::new();
            use std::io::{Seek, SeekFrom};
            (&output)
                .seek(SeekFrom::Start(0))
                .and_then(|_| (&output).take(max as u64 + 1).read_to_end(&mut bytes))
                .map_err(|_| Some("Could not read media output."))?;
            if bytes.len() > max {
                return Err(Some("Media information exceeded its safety limit."));
            }
            Ok(bytes)
        }
        #[cfg(not(any(target_os = "macos", windows)))]
        {
            let _ = (tools, arguments, capture, cancel, limit);
            Err(Some(
                "Isolated media downloads are not implemented on this platform yet.",
            ))
        }
    }
}

fn redact_info(bytes: &[u8]) -> Result<Value, String> {
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|_| "The media service returned invalid information.")?;
    let title = bounded(value.get("title"), 500).unwrap_or_else(|| "Untitled media".into());
    let uploader = bounded(value.get("uploader"), 200);
    let duration = value
        .get("duration")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value >= 0.0 && *value <= 31_536_000.0)
        .map(format_duration);
    let playlist_count = value
        .get("entries")
        .and_then(Value::as_array)
        .map(Vec::len)
        .filter(|count| *count <= 100);
    Ok(json!({
        "title": title,
        "uploader": uploader,
        "duration": duration,
        "playlistCount": playlist_count
    }))
}

fn bounded(value: Option<&Value>, max: usize) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.chars().count() <= max)
        .map(str::to_owned)
}

fn format_duration(seconds: f64) -> String {
    let seconds = seconds.round() as u64;
    let hours = seconds / 3600;
    let minutes = seconds % 3600 / 60;
    let seconds = seconds % 60;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes}:{seconds:02}")
    }
}

fn open_completed(log: &Path, output: &Path) -> Result<Vec<DownloadedFile>, String> {
    let log = std::fs::read(log).map_err(|_| "Media download produced no output list.")?;
    if log.len() > 64 * 1024 {
        return Err("Media output list exceeded its safety limit.".into());
    }
    let output = output
        .canonicalize()
        .map_err(|_| "Media output folder unavailable.")?;
    let mut seen = HashSet::new();
    let mut files = Vec::new();
    let mut total = 0u64;
    for line in log.split(|byte| *byte == b'\n') {
        let raw = std::str::from_utf8(line)
            .map_err(|_| "Invalid media output list.")?
            .trim();
        if raw.is_empty() {
            continue;
        }
        let path = PathBuf::from(raw);
        let canonical = path
            .canonicalize()
            .map_err(|_| "A completed media file is unavailable.")?;
        if !canonical.starts_with(&output) || !seen.insert(canonical.clone()) {
            return Err("Media output escaped its private work folder.".into());
        }
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|_| "A completed media file is unavailable.")?;
        if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > MAX_FILE {
            return Err("A completed media file exceeds its safety limit.".into());
        }
        total = total
            .checked_add(metadata.len())
            .filter(|value| *value <= MAX_TOTAL)
            .ok_or("Media outputs exceed 10 GB.")?;
        let name = canonical
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| super::binary_files::safe_name(value))
            .ok_or("Media output has an unsafe filename.")?
            .to_owned();
        let file = retain(&canonical).map_err(|_| "Could not retain media output.")?;
        files.push(DownloadedFile {
            file,
            name,
            bytes: metadata.len(),
        });
        if files.len() > 100 {
            return Err("Media output count exceeds 100 files.".into());
        }
    }
    if files.is_empty() {
        return Err("Media download produced no output.".into());
    }
    Ok(files)
}

/// Opens a finished download so it outlives the work folder: on Windows
/// that takes letting the folder delete it while it is open.
fn retain(path: &Path) -> std::io::Result<File> {
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        };
        options.share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE);
    }
    options.open(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_is_bounded_and_does_not_return_urls_or_private_fields() {
        let result = redact_info(
            br#"{"title":"Fixture","uploader":"Creator","duration":65,"webpage_url":"https://secret.example/item","thumbnail":"https://secret.example/image"}"#,
        )
        .unwrap();
        assert_eq!(result["title"], "Fixture");
        assert_eq!(result["duration"], "1:05");
        assert!(result.get("webpage_url").is_none());
        assert!(result.get("thumbnail").is_none());
    }

    /// A worker with internet access still can't reach this computer's own
    /// services: FFmpeg, run like yt-dlp, tries a loopback listener.
    #[cfg(windows)]
    #[test]
    fn networked_workers_cannot_reach_loopback() {
        use crate::platform::windows::sandbox::{HostTool, Limits};
        let Some(installed) = crate::infra::system_dependencies::resolve_executable("ffmpeg", None)
            .and_then(|path| path.canonicalize().ok())
        else {
            eprintln!("FFmpeg unavailable: loopback check skipped.");
            return;
        };
        // A private copy: sharing must leave the installed one untouched.
        let copy = tempfile::tempdir().unwrap();
        let ffmpeg = copy.path().join("ffmpeg.exe");
        std::fs::copy(&installed, &ffmpeg).unwrap();
        let worker = Worker::new("test").unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let arguments = strings(&[
            "-hide_banner",
            "-loglevel",
            "error",
            "-rw_timeout",
            "1000000",
            "-i",
            &format!("http://{}/media", listener.local_addr().unwrap()),
            "out.mp3",
        ]);
        let limits = Limits {
            memory_bytes: 512 * 1024 * 1024,
            cpu: Duration::from_secs(30),
            wall: Duration::from_secs(30),
            output_bytes: 1024,
            work_bytes: 1024 * 1024,
            processes: 1,
        };
        let code = worker
            .workspace
            .run_tool(
                &HostTool::share(&ffmpeg).unwrap(),
                &arguments,
                None,
                true,
                &limits,
                &AtomicBool::new(false),
            )
            .unwrap();
        assert_ne!(code, 0);
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn host_ytdlp_loads_under_the_sandbox_and_cannot_connect_around_the_proxy() {
        use std::process::Stdio;
        let Some(tool) = crate::infra::system_dependencies::resolve_executable("yt-dlp", None)
        else {
            eprintln!("yt-dlp unavailable: restricted worker check skipped.");
            return;
        };
        let Some(ffmpeg) = crate::infra::system_dependencies::resolve_executable("ffmpeg", None)
        else {
            eprintln!("FFmpeg unavailable: restricted worker check skipped.");
            return;
        };
        let Some(ffprobe) = crate::infra::system_dependencies::resolve_executable("ffprobe", None)
        else {
            eprintln!("FFprobe unavailable: restricted worker check skipped.");
            return;
        };
        let cancel = Arc::new(AtomicBool::new(false));
        let proxy = super::super::download_proxy::PublicProxy::start(cancel).unwrap();
        let work = tempfile::tempdir().unwrap();
        let tools = Tools {
            ytdlp: &tool,
            ffmpeg: &ffmpeg,
            ffprobe: &ffprobe,
        };
        let version = command(&tools, work.path(), proxy.endpoint())
            .unwrap()
            .arg("--version")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .unwrap();
        assert!(
            version.status.success(),
            "{}",
            String::from_utf8_lossy(&version.stderr)
        );
        assert!(!version.stdout.is_empty());

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let bypass = command(&tools, work.path(), proxy.endpoint())
            .unwrap()
            .args(["--proxy", "", "--socket-timeout", "1", "--dump-single-json"])
            .arg(format!("https://127.0.0.1:{port}/fixture"))
            .status()
            .unwrap();
        assert!(!bypass.success());
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }

    #[cfg(any(target_os = "macos", windows))]
    #[test]
    fn restricted_worker_can_review_public_media() {
        if std::env::var_os("MISTY_TEST_PUBLIC_MEDIA").is_none() {
            eprintln!("Public media integration check skipped.");
            return;
        }
        let tool = crate::infra::system_dependencies::resolve_executable("yt-dlp", None).unwrap();
        let ffmpeg = crate::infra::system_dependencies::resolve_executable("ffmpeg", None).unwrap();
        let ffprobe =
            crate::infra::system_dependencies::resolve_executable("ffprobe", None).unwrap();
        let tools = Tools {
            ytdlp: &tool,
            ffmpeg: &ffmpeg,
            ffprobe: &ffprobe,
        };
        let cancel = Arc::new(AtomicBool::new(false));
        let info = inspect(
            &tools,
            "https://download.samplelib.com/mp4/sample-5s.mp4",
            false,
            cancel,
        )
        .unwrap();
        assert_eq!(info["title"], "sample-5s");
        assert!(info.get("url").is_none());
        let files = download(
            &tools,
            "https://download.samplelib.com/mp4/sample-5s.mp4",
            "mp4",
            false,
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        assert_eq!(files.len(), 1);
        assert!(files[0].bytes > 1_000);
        assert!(files[0].name.ends_with(".mp4"));
    }
}
