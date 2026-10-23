//! Confined helper processes on Windows, the counterpart of `sandbox-exec`
//! on macOS (see `misty-windows-confine`). A helper runs in an AppContainer
//! with no capabilities, so it has no network and no access to the person's
//! files, registry or other processes. It can read and write only its own
//! working folder. Its job bounds its memory, CPU time and process count and
//! ends it when the job closes.
//!
//! The helper speaks through two files the supervisor opens: a request it
//! reads as standard input and a response it writes as standard output.
use std::{
    ffi::OsStr,
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

use misty_windows_confine::{
    environment_block, spawn, system_variables, Access, Container, Job, JobLimits, Launch,
};

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
