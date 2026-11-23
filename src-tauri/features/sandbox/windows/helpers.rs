use file_access::fs;
use file_access::fs::File;
use std::{
    ffi::OsStr,
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

use super::{
    environment_block, spawn, system_variables, Access, Container, Job, JobLimits, Launch,
};

pub struct Limits {
    pub memory_bytes: usize,
    pub cpu: Duration,
    pub wall: Duration,
    pub output_bytes: u64,
    pub work_bytes: u64,
    pub processes: u32,
}

pub struct Workspace {
    folder: tempfile::TempDir,
    container: Container,
}

impl Workspace {
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

    pub fn run(
        &self,
        helper: &Path,
        request: &[u8],
        limits: &Limits,
        stop: &AtomicBool,
    ) -> Result<Vec<u8>, String> {
        if stop.load(Ordering::Acquire) {
            return Err("The helper was cancelled.".into());
        }
        let executable = self.path().join("helper.exe");
        stage(helper, &executable)?;
        let mut input = File::unnamed_temp().map_err(|_| "Could not stage the request.")?;
        input
            .write_all(request)
            .and_then(|_| input.seek(SeekFrom::Start(0)).map(|_| ()))
            .map_err(|_| "Could not stage the request.")?;
        let mut output = File::unnamed_temp().map_err(|_| "Could not receive the response.")?;
        let errors = fs::null_device().map_err(|_| "Could not start the helper.")?;
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

#[allow(
    clippy::disallowed_methods,
    reason = "copies Misty's own helper from beside its executable, which no grant covers"
)]
fn stage(helper: &Path, executable: &Path) -> Result<(), String> {
    std::fs::copy(helper, executable)
        .map(|_| ())
        .map_err(|_| "Could not stage the helper.".to_owned())
}

fn folder_bytes(folder: &Path) -> u64 {
    fs::read_dir(folder)
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
        let _ = self.container.forget(self.folder.path());
    }
}
