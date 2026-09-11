//! yt-dlp under `sandbox-exec` on macOS: Homebrew-managed tools only, the
//! network through Misty's proxy only, and resource limits set before exec.
use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

use super::Tools;

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

struct ChildGuard {
    child: Child,
    active: bool,
}
impl ChildGuard {
    fn stop(&mut self) {
        if self.active {
            unsafe {
                libc::kill(-(self.child.id() as i32), libc::SIGKILL);
            }
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

pub(super) fn command(tools: &Tools, work: &Path, proxy: &str) -> Result<Command, &'static str> {
    use std::os::unix::process::CommandExt;
    let tool = tools
        .ytdlp
        .canonicalize()
        .map_err(|_| "Host yt-dlp is unavailable.")?;
    let ffmpeg = tools
        .ffmpeg
        .canonicalize()
        .map_err(|_| "Host FFmpeg is unavailable.")?;
    let ffprobe = tools
        .ffprobe
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
    let port = super::super::download_proxy::proxy_port(proxy)
        .map_err(|_| "Private media connection unavailable.")?;
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

fn interpreter(tool: &Path) -> Result<PathBuf, &'static str> {
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
        .map_err(|_| "Host yt-dlp interpreter is unavailable.")
}

fn managed_root(path: &Path) -> Result<PathBuf, &'static str> {
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
    Err("Media downloads require Host tools installed through the managed system toolchain.")
}

fn python_app(interpreter: &Path) -> Result<PathBuf, &'static str> {
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
                    .map_err(|_| "Host Python runtime is unavailable.");
            }
        }
    }
    Ok(interpreter.to_owned())
}

pub(super) fn run_with_output(
    mut command: Command,
    cancel: &AtomicBool,
    limit: Duration,
    max: usize,
) -> Result<Vec<u8>, Option<&'static str>> {
    command.stdout(Stdio::piped());
    #[cfg(test)]
    command.stderr(Stdio::inherit());
    let mut child = ChildGuard {
        child: command
            .spawn()
            .map_err(|_| Some("Could not start the restricted media worker."))?,
        active: true,
    };
    let stdout = child
        .child
        .stdout
        .take()
        .ok_or(Some("Media output unavailable."))?;
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
            return Err(Some("Media operation cancelled or timed out."));
        }
        match child.child.try_wait() {
            Ok(Some(status)) => {
                child.active = false;
                let bytes = receive
                    .recv_timeout(Duration::from_secs(2))
                    .map_err(|_| Some("Media output did not close."))?
                    .map_err(|_| Some("Could not read media output."))?;
                if !status.success() {
                    return Err(None);
                }
                if bytes.len() > max {
                    return Err(Some("Media information exceeded its safety limit."));
                }
                return Ok(bytes);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => return Err(Some("Could not observe the restricted media worker.")),
        }
    }
}

pub(super) fn run(
    mut command: Command,
    cancel: &AtomicBool,
    limit: Duration,
) -> Result<(), Option<&'static str>> {
    let mut child = ChildGuard {
        child: command
            .spawn()
            .map_err(|_| Some("Could not start the restricted media worker."))?,
        active: true,
    };
    let started = Instant::now();
    loop {
        if cancel.load(Ordering::Acquire) || started.elapsed() > limit {
            child.stop();
            return Err(Some("Media download cancelled or timed out."));
        }
        match child.child.try_wait() {
            Ok(Some(status)) => {
                child.active = false;
                return if status.success() { Ok(()) } else { Err(None) };
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => return Err(Some("Could not observe the restricted media worker.")),
        }
    }
}
