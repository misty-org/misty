//! Confined helper processes on Windows, the counterpart of `sandbox-exec`
//! on macOS (see `misty-windows-confine`). A helper runs in an AppContainer
//! with no capabilities, so it has no network and no access to the person's
//! files, registry or other processes. It can read and write only its own
//! working folder. Its job bounds its memory, CPU time and process count and
//! ends it when the job closes.
//!
//! The helper speaks through two files the supervisor opens: a request it
//! reads as standard input and a response it writes as standard output.
//!
//! A helper can also be a program installed on this computer, such as
//! FFmpeg ([`HostTool`]): only that program and the libraries beside it are
//! shared with the container, never the folder around them.
use std::{
    ffi::{OsStr, OsString},
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

use misty_windows_confine::{
    command_line, environment_block, spawn, system_variables, Access, Capability, Container, Job,
    JobLimits, Launch,
};

/// Containers that run programs installed on this computer hold this
/// capability; each program's files are granted to it.
const HOST_TOOLS: &str = "mistyHostTools";
/// A folder with more libraries than this is a shared system folder, not a
/// program's own.
const MAX_LIBRARIES: usize = 64;

/// What a confined helper may use, and for how long.
pub struct Limits {
    pub memory_bytes: usize,
    pub cpu: Duration,
    pub wall: Duration,
    /// The most it may write to its standard output.
    pub output_bytes: u64,
    /// The most its working folder may hold.
    pub work_bytes: u64,
    /// The most processes it may run at once, itself included.
    pub processes: u32,
}

/// A program installed on this computer that confined helpers may run.
pub struct HostTool {
    executable: PathBuf,
    capability: Capability,
}

impl HostTool {
    /// Shares the program, and the libraries in its folder, with confined
    /// helpers: read and run only. A Scoop shim is followed to the program it
    /// starts. Programs in Windows' own folders and Program Files are open to
    /// every container already, and Misty can't add rules there.
    pub fn share(executable: &Path) -> Result<Self, String> {
        let unavailable = || "The program is unavailable.".to_owned();
        let executable = plain(&executable.canonicalize().map_err(|_| unavailable())?);
        let executable = shim_target(&executable).unwrap_or(executable);
        let folder = executable.parent().ok_or_else(unavailable)?.to_path_buf();
        let capability = Capability::named(HOST_TOOLS)?;
        let mut files = vec![executable.clone()];
        let libraries: Vec<PathBuf> = std::fs::read_dir(&folder)
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("dll"))
            })
            .take(MAX_LIBRARIES + 1)
            .collect();
        if libraries.len() <= MAX_LIBRARIES {
            files.extend(libraries);
        }
        for file in files {
            let _ = capability.grant(&file, Access::ReadExecute);
        }
        Ok(Self {
            executable,
            capability,
        })
    }

    pub fn name(&self) -> String {
        self.executable
            .file_stem()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default()
    }
}

/// The program a Scoop shim starts, from the `.shim` file beside it.
fn shim_target(executable: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(executable.with_extension("shim")).ok()?;
    let line = text
        .lines()
        .find_map(|line| line.trim().strip_prefix("path"))?;
    let target = line
        .trim_start()
        .strip_prefix('=')?
        .trim()
        .trim_matches('"');
    Some(plain(&PathBuf::from(target).canonicalize().ok()?))
}

/// A path without the `\\?\` prefix `canonicalize` adds.
fn plain(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => path.to_path_buf(),
    }
}

/// A helper's private working folder, granted to its AppContainer.
pub struct Workspace {
    folder: tempfile::TempDir,
    container: Container,
}

impl Workspace {
    /// Creates an empty folder that only this account, SYSTEM and the named
    /// AppContainer may use. Files written into it afterwards inherit that.
    pub fn new(container_name: &str) -> Result<Self, String> {
        let container = Container::open(container_name)?;
        let folder = tempfile::Builder::new()
            .prefix("misty-confined-")
            .tempdir()
            .map_err(|_| "Could not create a private folder for the helper.")?;
        container.grant(folder.path(), Access::Full)?;
        Ok(Self { folder, container })
    }

    pub fn path(&self) -> &Path {
        self.folder.path()
    }

    /// Writes the helper, runs it with `request` as its standard input, and
    /// returns its standard output once it exits successfully.
    pub fn run(
        &self,
        helper: &[u8],
        request: &[u8],
        limits: &Limits,
        stop: &AtomicBool,
    ) -> Result<Vec<u8>, String> {
        if stop.load(Ordering::Acquire) {
            return Err("The helper was cancelled.".into());
        }
        let executable = self.path().join("helper.exe");
        std::fs::write(&executable, helper).map_err(|_| "Could not stage the helper.")?;
        // Both files live outside the helper's folder; it reaches them only
        // through the handles it inherits.
        let mut input = tempfile::tempfile().map_err(|_| "Could not stage the request.")?;
        input
            .write_all(request)
            .and_then(|_| input.seek(SeekFrom::Start(0)).map(|_| ()))
            .map_err(|_| "Could not stage the request.")?;
        let mut output = tempfile::tempfile().map_err(|_| "Could not receive the response.")?;
        let errors = File::create("NUL").map_err(|_| "Could not start the helper.")?;
        let job = Job::new(&JobLimits {
            process_memory: limits.memory_bytes,
            process_cpu: limits.cpu,
            processes: limits.processes,
        })?;
        let process = spawn(&Launch {
            application: &executable,
            command_line: OsStr::new("helper.exe"),
            environment: &environment_block(system_variables()),
            directory: self.path(),
            stdin: Some(&input),
            stdout: &output,
            stderr: &errors,
            container: &self.container,
            capabilities: &[],
            job: &job,
        })?;
        drop(input);
        let started = Instant::now();
        let mut round = 0u64;
        let code = loop {
            if let Some(code) = process.wait(Duration::from_millis(20)) {
                break code;
            }
            round += 1;
            let oversized = output
                .metadata()
                .map(|m| m.len() > limits.output_bytes)
                .unwrap_or(true)
                || (round.is_multiple_of(25) && folder_bytes(self.path()) > limits.work_bytes);
            let reason = if stop.load(Ordering::Acquire) {
                Some("The helper was cancelled.")
            } else if started.elapsed() > limits.wall {
                Some("The helper took too long and was stopped.")
            } else if oversized {
                Some("The helper's answer exceeded its limit.")
            } else {
                None
            };
            if let Some(reason) = reason {
                job.terminate();
                return Err(reason.into());
            }
        };
        if code != 0 {
            return Err("The helper failed safely.".into());
        }
        output
            .seek(SeekFrom::Start(0))
            .map_err(|_| "Could not read the helper's answer.")?;
        let mut bytes = Vec::new();
        output
            .take(limits.output_bytes + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Could not read the helper's answer.")?;
        if bytes.len() as u64 > limits.output_bytes {
            return Err("The helper's answer exceeded its limit.".into());
        }
        Ok(bytes)
    }
}

impl Workspace {
    /// Runs an installed program with `arguments` inside this workspace's
    /// container, sending its standard output to `stdout` when given, and
    /// returns its exit code. Paths in `arguments` should be inside
    /// [`Self::path`]: the program can reach nothing else. With `internet`, it may connect to
    /// public hosts; Windows keeps it off loopback and the local network.
    pub fn run_tool(
        &self,
        tool: &HostTool,
        arguments: &[OsString],
        stdout: Option<&File>,
        internet: bool,
        limits: &Limits,
        stop: &AtomicBool,
    ) -> Result<u32, String> {
        if stop.load(Ordering::Acquire) {
            return Err("The helper was cancelled.".into());
        }
        let discard = File::create("NUL").map_err(|_| "Could not start the helper.")?;
        let output = stdout.unwrap_or(&discard);
        let job = Job::new(&JobLimits {
            process_memory: limits.memory_bytes,
            process_cpu: limits.cpu,
            processes: limits.processes,
        })?;
        let mut variables = system_variables();
        for name in ["TEMP", "TMP"] {
            variables.push((name.into(), self.path().as_os_str().to_owned()));
        }
        let internet_client = if internet {
            Some(Capability::named("internetClient")?)
        } else {
            None
        };
        let capabilities: Vec<&Capability> = std::iter::once(&tool.capability)
            .chain(internet_client.as_ref())
            .collect();
        let line = command_line(
            std::iter::once(tool.executable.as_os_str())
                .chain(arguments.iter().map(OsString::as_os_str)),
        );
        let process = spawn(&Launch {
            application: &tool.executable,
            command_line: &line,
            environment: &environment_block(variables),
            directory: self.path(),
            stdin: None,
            stdout: output,
            stderr: &discard,
            container: &self.container,
            capabilities: &capabilities,
            job: &job,
        })
        .map_err(|_| format!("Misty's sandbox could not start {}.", tool.name()))?;
        let started = Instant::now();
        for round in 0u64.. {
            if let Some(code) = process.wait(Duration::from_millis(20)) {
                return Ok(code);
            }
            let oversized = stdout.is_some_and(|file| {
                file.metadata()
                    .map(|m| m.len() > limits.output_bytes)
                    .unwrap_or(true)
            }) || (round.is_multiple_of(25)
                && folder_bytes(self.path()) > limits.work_bytes);
            let reason = if stop.load(Ordering::Acquire) {
                Some("The helper was cancelled.")
            } else if started.elapsed() > limits.wall {
                Some("The helper took too long and was stopped.")
            } else if oversized {
                Some("The helper's answer exceeded its limit.")
            } else {
                None
            };
            if let Some(reason) = reason {
                job.terminate();
                return Err(reason.into());
            }
        }
        unreachable!("the loop returns")
    }
}

/// The bytes held by the files under `folder`, without following links.
fn folder_bytes(folder: &Path) -> u64 {
    std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => folder_bytes(&entry.path()),
            Ok(kind) if kind.is_file() => entry.metadata().map(|m| m.len()).unwrap_or(0),
            _ => 0,
        })
        .sum()
}

impl Drop for Workspace {
    fn drop(&mut self) {
        // The folder goes with its rules; the container's profile stays for
        // the next helper.
        let _ = self.container.forget(self.folder.path());
    }
}
