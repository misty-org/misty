//! Fixed yt-dlp operations under a filesystem/process sandbox and Host proxy.
//! An App supplies only a validated URL, enumerated format, and playlist choice.
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    time::{Duration, Instant},
};

#[cfg(target_os = "macos")]
const PROFILE: &str = r#"(version 1)
(deny default)
(allow process-exec
  (literal (param "TOOL")) (literal (param "INTERPRETER"))
  (literal (param "PYTHONAPP"))
  (literal (param "FFMPEG")) (literal (param "FFPROBE")))
(allow file-read*
  (subpath (param "WORK"))
  (subpath (param "TOOLROOT")) (subpath (param "INTERPRETERROOT"))
  (subpath (param "FFMPEGROOT")) (subpath (param "FFPROBEROOT"))
  (subpath "/System/Library") (subpath "/usr/lib")
  (subpath "/System/Volumes/Preboot/Cryptexes/OS/System/Library")
  (subpath "/System/Volumes/Preboot/Cryptexes/OS/usr/lib")
  (literal "/") (literal "/dev/null") (literal "/dev/urandom")
  (literal "/etc/ssl/cert.pem") (literal "/private/etc/ssl/cert.pem")
  (regex #"^/(opt/homebrew|usr/local)/(Cellar|opt)/.*[.]dylib$")
  (regex #"^/(opt/homebrew|usr/local)/(Cellar|opt)/.*/lib$"))
(allow file-write* (subpath (param "WORK")))
(allow network-outbound (remote tcp (param "PROXY")))
(allow sysctl-read)
(allow file-read-metadata)
"#;

pub struct DownloadedFile {
    pub file: File,
    pub name: String,
    pub bytes: u64,
}

struct ChildGuard {
    child: Child,
    active: bool,
}
impl ChildGuard {
    fn stop(&mut self) {
        if self.active {
            #[cfg(unix)]
            unsafe {
                libc::kill(-(self.child.id() as i32), libc::SIGKILL);
            }
            #[cfg(not(unix))]
            let _ = self.child.kill();
            let _ = self.child.wait();
            self.active = false;
        }
    }
}
impl Drop for ChildGuard {
    fn drop(&mut self) {
        self.stop();
    }
}

pub fn inspect(
    tool: &Path,
    ffmpeg: &Path,
    ffprobe: &Path,
    proxy: &str,
    url: &str,
    playlist: bool,
    cancel: Arc<AtomicBool>,
) -> Result<Value, String> {
    let work = tempfile::Builder::new()
        .prefix("misty-media-review-")
        .tempdir()
        .map_err(|_| "Could not prepare media review.")?;
    let mut command = command(tool, ffmpeg, ffprobe, work.path(), proxy)?;
    command.args(["--dump-single-json", "--no-warnings", "--skip-download"]);
    if playlist {
        command.args(["--flat-playlist", "--playlist-end", "100"]);
    } else {
        command.arg("--no-playlist");
    }
    command.arg(url).stdout(Stdio::piped());
    #[cfg(test)]
    command.stderr(Stdio::inherit());
    let output = run_with_output(command, cancel, Duration::from_secs(30), 8 * 1024 * 1024)?;
    redact_info(&output)
}

pub fn download(
    tool: &Path,
    ffmpeg: &Path,
    ffprobe: &Path,
    proxy: &str,
    url: &str,
    format: &str,
    playlist: bool,
    cancel: Arc<AtomicBool>,
) -> Result<Vec<DownloadedFile>, String> {
    let work = tempfile::Builder::new()
        .prefix("misty-media-download-")
        .tempdir()
        .map_err(|_| "Could not prepare media download.")?;
    let output = work.path().join("output");
    let temporary = work.path().join("temporary");
    std::fs::create_dir(&output).map_err(|_| "Could not prepare media output.")?;
    std::fs::create_dir(&temporary).map_err(|_| "Could not prepare media output.")?;
    let completed = work.path().join("completed.txt");
    let mut command = command(tool, ffmpeg, ffprobe, work.path(), proxy)?;
    command
        .args([
            "--newline",
            "--restrict-filenames",
            "--no-overwrites",
            "--no-part",
        ])
        .arg("--paths")
        .arg(format!("home:{}", output.display()))
        .arg("--paths")
        .arg(format!("temp:{}", temporary.display()))
        .args([
            "--output",
            "%(title).160B [%(id).64B].%(ext)s",
            "--print-to-file",
            "after_move:filepath",
        ])
        .arg(&completed)
        .args(["--max-filesize", "4294967296"]);
    if playlist {
        command.args(["--yes-playlist", "--playlist-end", "100"]);
    } else {
        command.arg("--no-playlist");
    }
    match format {
        "mp3" => {
            command.args(["-x", "--audio-format", "mp3", "--audio-quality", "0"]);
        }
        "m4a" => {
            command.args(["-x", "--audio-format", "m4a", "--audio-quality", "0"]);
        }
        "mp4" => {
            command.args(["-f", "bv*+ba/b", "--merge-output-format", "mp4"]);
        }
        "webm" => {
            command.args([
                "-f",
                "bv*[ext=webm]+ba[ext=webm]/b[ext=webm]/bv*+ba/b",
                "--merge-output-format",
                "webm",
            ]);
        }
        _ => return Err("Unsupported media download format.".into()),
    }
    command.arg(url);
    run(command, cancel.clone(), Duration::from_secs(86_400))?;
    if cancel.load(Ordering::Acquire) {
        return Err("Media download cancelled.".into());
    }
    open_completed(&completed, &output)
}

fn command(
    tool: &Path,
    ffmpeg: &Path,
    ffprobe: &Path,
    work: &Path,
    proxy: &str,
) -> Result<Command, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (tool, ffmpeg, ffprobe, work, proxy);
        return Err("Isolated media downloads are not implemented on this platform yet.".into());
    }
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::process::CommandExt;
        let tool = tool
            .canonicalize()
            .map_err(|_| "Host yt-dlp is unavailable.")?;
        let ffmpeg = ffmpeg
            .canonicalize()
            .map_err(|_| "Host FFmpeg is unavailable.")?;
        let ffprobe = ffprobe
            .canonicalize()
            .map_err(|_| "Host FFprobe is unavailable.")?;
        let interpreter = interpreter(&tool)?;
        let python_app = python_app(&interpreter)?;
        let tool_root = managed_root(&tool)?;
        let interpreter_root = managed_root(&interpreter)?;
        let ffmpeg_root = managed_root(&ffmpeg)?;
        let ffprobe_root = managed_root(&ffprobe)?;
        let work = work
            .canonicalize()
            .map_err(|_| "Media work folder unavailable.")?;
        let port = super::download_proxy::proxy_port(proxy)?;
        let mut command = Command::new("/usr/bin/sandbox-exec");
        for (name, path) in [
            ("TOOL", &tool),
            ("INTERPRETER", &interpreter),
            ("PYTHONAPP", &python_app),
            ("FFMPEG", &ffmpeg),
            ("FFPROBE", &ffprobe),
            ("WORK", &work),
            ("TOOLROOT", &tool_root),
            ("INTERPRETERROOT", &interpreter_root),
            ("FFMPEGROOT", &ffmpeg_root),
            ("FFPROBEROOT", &ffprobe_root),
        ] {
            command.arg("-D").arg(format!("{name}={}", path.display()));
        }
        command
            .args(["-p", PROFILE, "-D"])
            .arg(format!("PROXY=localhost:{port}"))
            .arg(&tool)
            .current_dir(&work)
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("HOME", &work)
            .env("TMPDIR", &work)
            .env("LANG", "C")
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .env("SSL_CERT_FILE", "/etc/ssl/cert.pem")
            .args(["--no-config", "--no-cache-dir", "--proxy", proxy])
            .arg("--ffmpeg-location")
            .arg(&ffmpeg)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command.process_group(0);
        unsafe {
            command.pre_exec(|| {
                for (resource, value) in [
                    (libc::RLIMIT_CPU, 3_600),
                    (libc::RLIMIT_FSIZE, 4_294_967_296),
                    (libc::RLIMIT_NOFILE, 128),
                    (libc::RLIMIT_CORE, 0),
                ] {
                    let limit = libc::rlimit {
                        rlim_cur: value,
                        rlim_max: value,
                    };
                    if libc::setrlimit(resource, &limit) != 0 {
                        return Err(std::io::Error::last_os_error());
                    }
                }
                Ok(())
            });
        }
        Ok(command)
    }
}

#[cfg(target_os = "macos")]
fn interpreter(tool: &Path) -> Result<PathBuf, String> {
    let mut bytes = [0u8; 512];
    let size = File::open(tool)
        .and_then(|mut file| file.read(&mut bytes))
        .map_err(|_| "Could not inspect Host yt-dlp.")?;
    if !bytes[..size].starts_with(b"#!") {
        return Ok(tool.to_owned());
    }
    let line = bytes[2..size]
        .split(|byte| *byte == b'\n')
        .next()
        .ok_or("Invalid Host yt-dlp interpreter.")?;
    let path = std::str::from_utf8(line)
        .map_err(|_| "Invalid Host yt-dlp interpreter.")?
        .split_whitespace()
        .next()
        .filter(|value| value.starts_with('/'))
        .ok_or("Host yt-dlp must use a fixed interpreter.")?;
    Path::new(path)
        .canonicalize()
        .map_err(|_| "Host yt-dlp interpreter is unavailable.".into())
}

#[cfg(target_os = "macos")]
fn managed_root(path: &Path) -> Result<PathBuf, String> {
    for ancestor in path.ancestors() {
        if ancestor
            .parent()
            .and_then(Path::parent)
            .and_then(Path::file_name)
            .is_some_and(|name| name == "Cellar")
        {
            return Ok(ancestor.to_owned());
        }
    }
    Err("Media downloads require Host tools installed through the managed system toolchain.".into())
}

#[cfg(target_os = "macos")]
fn python_app(interpreter: &Path) -> Result<PathBuf, String> {
    for ancestor in interpreter.ancestors() {
        if ancestor
            .parent()
            .and_then(Path::file_name)
            .is_some_and(|name| name == "Versions")
        {
            let candidate = ancestor.join("Resources/Python.app/Contents/MacOS/Python");
            if candidate.is_file() {
                return candidate
                    .canonicalize()
                    .map_err(|_| "Host Python runtime is unavailable.".into());
            }
        }
    }
    Ok(interpreter.to_owned())
}

fn run_with_output(
    mut command: Command,
    cancel: Arc<AtomicBool>,
    limit: Duration,
    max: usize,
) -> Result<Vec<u8>, String> {
    command.stdout(Stdio::piped());
    let mut child = ChildGuard {
        child: command
            .spawn()
            .map_err(|_| "Could not start the restricted media worker.")?,
        active: true,
    };
    let stdout = child
        .child
        .stdout
        .take()
        .ok_or("Media output unavailable.")?;
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = stdout
            .take(max as u64 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes);
        let _ = send.send(result);
    });
    let started = Instant::now();
    loop {
        if cancel.load(Ordering::Acquire) || started.elapsed() > limit {
            child.stop();
            return Err("Media operation cancelled or timed out.".into());
        }
        match child.child.try_wait() {
            Ok(Some(status)) => {
                child.active = false;
                let bytes = receive
                    .recv_timeout(Duration::from_secs(2))
                    .map_err(|_| "Media output did not close.")?
                    .map_err(|_| "Could not read media output.")?;
                if !status.success() {
                    return Err("The restricted media worker could not read that URL.".into());
                }
                if bytes.len() > max {
                    return Err("Media information exceeded its safety limit.".into());
                }
                return Ok(bytes);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => return Err("Could not observe the restricted media worker.".into()),
        }
    }
}

fn run(mut command: Command, cancel: Arc<AtomicBool>, limit: Duration) -> Result<(), String> {
    let mut child = ChildGuard {
        child: command
            .spawn()
            .map_err(|_| "Could not start the restricted media worker.")?,
        active: true,
    };
    let started = Instant::now();
    loop {
        if cancel.load(Ordering::Acquire) || started.elapsed() > limit {
            child.stop();
            return Err("Media download cancelled or timed out.".into());
        }
        match child.child.try_wait() {
            Ok(Some(status)) => {
                child.active = false;
                return if status.success() {
                    Ok(())
                } else {
                    Err("The restricted media worker could not download that URL.".into())
                };
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => return Err("Could not observe the restricted media worker.".into()),
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
        if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > 4_294_967_296
        {
            return Err("A completed media file exceeds its safety limit.".into());
        }
        total = total
            .checked_add(metadata.len())
            .filter(|value| *value <= 10 * 1024 * 1024 * 1024)
            .ok_or("Media outputs exceed 10 GB.")?;
        let name = canonical
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| super::binary_files::safe_name(value))
            .ok_or("Media output has an unsafe filename.")?
            .to_owned();
        let file = File::open(&canonical).map_err(|_| "Could not retain media output.")?;
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

    #[cfg(target_os = "macos")]
    #[test]
    fn host_ytdlp_loads_under_the_sandbox_and_cannot_connect_around_the_proxy() {
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
        let version = command(&tool, &ffmpeg, &ffprobe, work.path(), proxy.endpoint())
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
        let bypass = command(&tool, &ffmpeg, &ffprobe, work.path(), proxy.endpoint())
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

    #[cfg(target_os = "macos")]
    #[test]
    fn restricted_worker_can_review_public_media_only_through_the_host_proxy() {
        if std::env::var_os("MISTY_TEST_PUBLIC_MEDIA").is_none() {
            eprintln!("Public media integration check skipped.");
            return;
        }
        let tool = crate::infra::system_dependencies::resolve_executable("yt-dlp", None).unwrap();
        let ffmpeg = crate::infra::system_dependencies::resolve_executable("ffmpeg", None).unwrap();
        let ffprobe =
            crate::infra::system_dependencies::resolve_executable("ffprobe", None).unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let proxy = super::super::download_proxy::PublicProxy::start(cancel.clone()).unwrap();
        let info = inspect(
            &tool,
            &ffmpeg,
            &ffprobe,
            proxy.endpoint(),
            "https://download.samplelib.com/mp4/sample-5s.mp4",
            false,
            cancel,
        )
        .unwrap();
        assert_eq!(info["title"], "sample-5s");
        assert!(info.get("url").is_none());
        let files = download(
            &tool,
            &ffmpeg,
            &ffprobe,
            proxy.endpoint(),
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
