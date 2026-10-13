//! Installed tools (FFmpeg, archive readers) run confined to a private
//! working folder: under `sandbox-exec` on macOS, in an AppContainer and a
//! job on Windows. No permissive fallback.
#[cfg(target_os = "macos")]
use std::process::{Command, Stdio};
use std::{
    ffi::OsString,
    fs::File,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

#[cfg(target_os = "macos")]
const PROFILE: &str = r#"(version 1)
(deny default)
(allow process-exec (literal (param "TOOL")))
(allow file-read* (literal (param "TOOL")) (subpath (param "WORK"))
  (subpath "/System/Library") (subpath "/usr/lib")
  (subpath "/System/Volumes/Preboot/Cryptexes/OS/System/Library")
  (subpath "/System/Volumes/Preboot/Cryptexes/OS/usr/lib")
  (literal "/") (literal "/dev/null") (literal "/dev/urandom")
  (regex #"^/(opt/homebrew|usr/local)/(Cellar|opt)/.*[.]dylib$")
  (regex #"^/(opt/homebrew|usr/local)/(Cellar|opt)/.*/lib$"))
(allow file-write* (subpath (param "WORK")))
(allow sysctl-read)
(allow file-read-metadata)
"#;

#[cfg(target_os = "macos")]
pub(crate) fn command(executable: &Path, work: &Path) -> std::io::Result<Command> {
    use std::os::unix::process::CommandExt;
    let executable = executable.canonicalize()?;
    let work = work.canonicalize()?;
    let mut command = Command::new("/usr/bin/sandbox-exec");
    command
        .args(["-p", PROFILE, "-D"])
        .arg(format!("TOOL={}", executable.display()))
        .arg("-D")
        .arg(format!("WORK={}", work.display()))
        .arg(executable);
    command
        .current_dir(&work)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", &work)
        .env("TMPDIR", &work)
        .env("LANG", "C");
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command.process_group(0);
    // Only async-signal-safe resource-limit calls run between fork and exec.
    unsafe {
        command.pre_exec(|| {
            for (resource, value) in [
                (libc::RLIMIT_CPU, 300),
                (libc::RLIMIT_FSIZE, 268_435_456),
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
#[cfg(target_os = "macos")]
struct ChildGuard {
    child: std::process::Child,
    active: bool,
}
#[cfg(target_os = "macos")]
impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.active {
            unsafe {
                libc::kill(-(self.child.id() as i32), libc::SIGKILL);
            }
            let _ = self.child.wait();
        }
    }
}

/// The longest a tool may run, from staging its input to its output.
pub(crate) const TIME_LIMIT: Duration = Duration::from_secs(300);
/// The most a tool's folder may hold: its input, its output and scratch.
#[cfg(windows)]
const WORK_LIMIT: u64 = 3 * 512 * 1024 * 1024;
#[cfg(windows)]
const CONTAINER: &str = "Misty.Tools";

/// Why a confined tool did not finish.
pub(crate) enum Stopped {
    Cancelled,
    /// [`TIME_LIMIT`] passed.
    TimedOut,
    /// The sandbox failed; the message is for the person.
    Failed(String),
}

/// A private working folder, and the means to run an installed tool confined
/// to it: `sandbox-exec` on macOS, an AppContainer and a job on Windows.
pub(crate) struct Sandbox {
    #[cfg(target_os = "macos")]
    work: tempfile::TempDir,
    #[cfg(windows)]
    workspace: crate::platform::windows::sandbox::Workspace,
}

impl Sandbox {
    pub(crate) fn new() -> Result<Self, String> {
        #[cfg(target_os = "macos")]
        return Ok(Self {
            work: tempfile::Builder::new()
                .prefix("misty-media-")
                .tempdir()
                .map_err(|_| "Could not prepare a private folder.")?,
        });
        #[cfg(windows)]
        return Ok(Self {
            workspace: crate::platform::windows::sandbox::Workspace::new(CONTAINER)?,
        });
        #[cfg(not(any(target_os = "macos", windows)))]
        Err("Isolated tools are not available on this platform yet.".into())
    }

    pub(crate) fn path(&self) -> &Path {
        #[cfg(target_os = "macos")]
        return self.work.path();
        #[cfg(windows)]
        return self.workspace.path();
        #[cfg(not(any(target_os = "macos", windows)))]
        Path::new("")
    }

    /// Runs `executable` with `arguments` until it exits, `cancel` is set or
    /// [`TIME_LIMIT`] has passed since `started`. Whether it succeeded.
    pub(crate) fn run(
        &self,
        executable: &Path,
        arguments: &[OsString],
        stdout: Option<&File>,
        cancel: &AtomicBool,
        started: Instant,
    ) -> Result<bool, Stopped> {
        let failed = |message: &str| Stopped::Failed(message.to_owned());
        #[cfg(target_os = "macos")]
        {
            let mut command = command(executable, self.path())
                .map_err(|_| failed("The native sandbox is unavailable."))?;
            command.args(arguments);
            if let Some(file) = stdout {
                command.stdout(Stdio::from(
                    file.try_clone()
                        .map_err(|_| failed("Could not prepare the tool's output."))?,
                ));
            }
            #[cfg(test)]
            command.stderr(Stdio::inherit());
            let mut running = ChildGuard {
                child: command
                    .spawn()
                    .map_err(|_| failed("Could not start the isolated tool."))?,
                active: true,
            };
            loop {
                if cancel.load(Ordering::Acquire) {
                    return Err(Stopped::Cancelled);
                }
                if started.elapsed() > TIME_LIMIT {
                    return Err(Stopped::TimedOut);
                }
                match running
                    .child
                    .try_wait()
                    .map_err(|_| failed("The tool's status is unavailable."))?
                {
                    Some(status) => {
                        running.active = false;
                        return Ok(status.success());
                    }
                    None => std::thread::sleep(Duration::from_millis(50)),
                }
            }
        }
        #[cfg(windows)]
        {
            use crate::platform::windows::sandbox::{HostTool, Limits};
            let tool = HostTool::share(executable).map_err(Stopped::Failed)?;
            let limits = Limits {
                memory_bytes: 2 * 1024 * 1024 * 1024,
                cpu: TIME_LIMIT,
                wall: TIME_LIMIT.saturating_sub(started.elapsed()),
                output_bytes: 8 * 1024 * 1024,
                work_bytes: WORK_LIMIT,
                processes: 1,
            };
            let code = self
                .workspace
                .run_tool(&tool, arguments, stdout, false, &limits, cancel)
                .map_err(|error| {
                    if cancel.load(Ordering::Acquire) {
                        Stopped::Cancelled
                    } else if started.elapsed() >= TIME_LIMIT {
                        Stopped::TimedOut
                    } else {
                        Stopped::Failed(error)
                    }
                })?;
            let _ = failed;
            Ok(code == 0)
        }
        #[cfg(not(any(target_os = "macos", windows)))]
        {
            let _ = (executable, arguments, stdout, cancel, started);
            Err(failed(
                "Isolated tools are not available on this platform yet.",
            ))
        }
    }
}

/// Reads up to `buffer.len()` bytes of `file` at `offset`, leaving any
/// shared cursor alone.
pub(crate) fn read_at(file: &File, buffer: &mut [u8], offset: u64) -> std::io::Result<usize> {
    #[cfg(unix)]
    return std::os::unix::fs::FileExt::read_at(file, buffer, offset);
    #[cfg(windows)]
    return std::os::windows::fs::FileExt::seek_read(file, buffer, offset);
}

#[cfg(test)]
pub(crate) mod fixtures {
    use std::path::Path;

    /// A short silent WAV file.
    pub(crate) fn wav(path: &Path) {
        let samples = vec![0u8; 1600];
        let mut bytes = b"RIFF".to_vec();
        bytes.extend_from_slice(&(36u32 + samples.len() as u32).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&8000u32.to_le_bytes());
        bytes.extend_from_slice(&16000u32.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(samples.len() as u32).to_le_bytes());
        bytes.extend(samples);
        std::fs::write(path, bytes).unwrap();
    }

    #[cfg(windows)]
    /// A private copy of FFmpeg and the libraries beside it: sharing it with
    /// the container must leave the person's installation untouched.
    pub(crate) fn private_ffmpeg() -> Option<(tempfile::TempDir, std::path::PathBuf)> {
        let installed = crate::infra::system_dependencies::resolve_executable("ffmpeg", None)?
            .canonicalize()
            .ok()?;
        let copy = tempfile::tempdir().ok()?;
        for entry in std::fs::read_dir(installed.parent()?).ok()?.flatten() {
            let path = entry.path();
            let library = path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("dll"));
            if path == installed || library {
                std::fs::copy(&path, copy.path().join(entry.file_name())).ok()?;
            }
        }
        let executable = copy.path().join(installed.file_name()?);
        Some((copy, executable))
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::{fixtures::*, *};

    #[test]
    fn the_container_cannot_read_the_persons_files_or_the_network() {
        let Some((_copy, executable)) = private_ffmpeg() else {
            eprintln!("FFmpeg unavailable: confinement probes skipped.");
            return;
        };
        let sandbox = Sandbox::new().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("private.wav");
        wav(&secret);
        let stolen = sandbox.path().join("stolen.mp3");
        let arguments: Vec<OsString> = vec![
            "-hide_banner".into(),
            "-loglevel".into(),
            "error".into(),
            "-i".into(),
            secret.into_os_string(),
            stolen.clone().into_os_string(),
        ];
        let ran = sandbox
            .run(
                &executable,
                &arguments,
                None,
                &AtomicBool::new(false),
                Instant::now(),
            )
            .unwrap_or(false);
        assert!(!ran && !stolen.exists());
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let arguments: Vec<OsString> = vec![
            "-hide_banner".into(),
            "-loglevel".into(),
            "error".into(),
            "-rw_timeout".into(),
            "1000000".into(),
            "-i".into(),
            format!("http://{}/media", listener.local_addr().unwrap()).into(),
            sandbox.path().join("network.mp3").into_os_string(),
        ];
        let ran = sandbox
            .run(
                &executable,
                &arguments,
                None,
                &AtomicBool::new(false),
                Instant::now(),
            )
            .unwrap_or(false);
        assert!(!ran);
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{fixtures::*, *};

    #[test]
    fn sandbox_denies_private_file_reads_writes_and_network_even_without_protocol_flags() {
        let Some(executable) =
            crate::infra::system_dependencies::resolve_executable("ffmpeg", None)
        else {
            eprintln!("FFmpeg unavailable: network/read probes skipped.");
            return;
        };
        let work = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("private.wav");
        wav(&secret);
        let status = command(&executable, work.path())
            .unwrap()
            .args(["-hide_banner", "-loglevel", "error", "-i"])
            .arg(&secret)
            .arg(work.path().join("stolen.mp3"))
            .status()
            .unwrap();
        assert!(!status.success());
        assert!(!work.path().join("stolen.mp3").exists());
        let output = outside.path().join("ungranted");
        let status = command(Path::new("/bin/sh"), work.path())
            .unwrap()
            .args(["-c", "printf forbidden > \"$1\"", "--"])
            .arg(&output)
            .status()
            .unwrap();
        assert!(!status.success());
        assert!(!output.exists());
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let status = command(&executable, work.path())
            .unwrap()
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-rw_timeout",
                "1000000",
                "-i",
            ])
            .arg(format!("http://{}/media", listener.local_addr().unwrap()))
            .arg(work.path().join("network.mp3"))
            .status()
            .unwrap();
        assert!(!status.success());
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }
    #[test]
    fn converter_environment_is_replaced_and_child_execution_is_denied() {
        let work = tempfile::tempdir().unwrap();
        let output = command(Path::new("/usr/bin/env"), work.path())
            .unwrap()
            .stdout(Stdio::piped())
            .output()
            .unwrap();
        assert!(output.status.success());
        let values = String::from_utf8(output.stdout).unwrap();
        let keys: std::collections::BTreeSet<_> = values
            .lines()
            .map(|line| line.split('=').next().unwrap())
            .collect();
        assert_eq!(
            keys,
            ["HOME", "LANG", "PATH", "TMPDIR"].into_iter().collect()
        );
        assert!(values.contains(work.path().canonicalize().unwrap().to_str().unwrap()));
        let status = command(Path::new("/bin/sh"), work.path())
            .unwrap()
            .args(["-c", "exec /usr/bin/true"])
            .status()
            .unwrap();
        assert!(!status.success());
    }
    #[test]
    fn dropping_a_running_child_terminates_and_reaps_it() {
        let work = tempfile::tempdir().unwrap();
        let child = command(Path::new("/bin/sleep"), work.path())
            .unwrap()
            .arg("60")
            .spawn()
            .unwrap();
        let id = child.id() as i32;
        let started = Instant::now();
        drop(ChildGuard {
            child,
            active: true,
        });
        assert!(started.elapsed() < Duration::from_secs(2));
        let mut status = 0;
        assert_eq!(unsafe { libc::waitpid(id, &mut status, libc::WNOHANG) }, -1);
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ECHILD)
        );
    }
}
