//! Windows: the command runs in its project's AppContainer, holding the
//! tools capability, inside a Job object. The job caps each process's memory
//! and CPU time and how many run at once, and ending it ends every process
//! the command started, however it was started: [`Tree`] is the job.
use std::{
    ffi::OsStr,
    fs::File,
    io::{self, Read},
    os::windows::process::ExitStatusExt,
    process::ExitStatus,
    sync::{Arc, Mutex},
    time::Duration,
};

use misty_windows_confine::{
    environment_block, pipe, spawn, Capability, Container, Job, JobLimits, Launch, Process,
};

use crate::{
    output::Capped,
    sandbox::{Setup, TOOLS_CAPABILITY},
    CodeError,
};

/// Memory any one process may use: room for large builds, a stop for runaways.
const PROCESS_MEMORY: usize = 8 << 30;
/// CPU time any one process may use: a backstop behind the command timeouts.
const PROCESS_CPU: Duration = Duration::from_secs(30 * 60);
/// Processes a command may run at once: a fork bomb stops here.
const PROCESSES: u32 = 256;

/// A started command.
pub struct Child {
    process: Arc<Process>,
    output: Option<File>,
    job: Arc<Job>,
}

impl Child {
    pub fn id(&self) -> Option<u32> {
        Some(self.process.id())
    }

    /// Waits for the command itself to exit.
    pub async fn wait(&mut self) -> io::Result<ExitStatus> {
        let process = self.process.clone();
        let code = tokio::task::spawn_blocking(move || loop {
            if let Some(code) = process.wait(Duration::from_secs(3600)) {
                break code;
            }
        })
        .await
        .map_err(io::Error::other)?;
        Ok(ExitStatus::from_raw(code))
    }

    /// Ends the command and everything it started.
    pub async fn kill(&mut self) -> io::Result<()> {
        self.job.terminate();
        Ok(())
    }
}

/// Every process a command started: its job. It also keeps the command's
/// drive mapped while anything of it runs.
pub struct Tree {
    job: Arc<Job>,
    _drive: Arc<misty_windows_confine::Drive>,
}

impl Tree {
    pub fn kill_all(&self) {
        self.job.terminate();
    }
}

impl Drop for Tree {
    fn drop(&mut self) {
        self.job.terminate();
    }
}

/// Nothing to do on Windows: the job ([`Tree`]) ends the whole tree.
pub fn kill_group(_pid: Option<u32>) {}

/// Windows ends processes with exit codes, not signals.
pub fn signal(_status: &ExitStatus) -> Option<i32> {
    None
}

/// Starts the command, stdin closed and its output piped, inside its job.
pub fn start(setup: &Setup) -> Result<(Child, Tree), CodeError> {
    let unavailable = |error: String| CodeError::Unavailable(format!("The command could not start: {error}"));
    let container = Container::open(&setup.windows.container).map_err(unavailable)?;
    let tools = Capability::named(TOOLS_CAPABILITY).map_err(unavailable)?;
    let job = Arc::new(
        Job::new(&JobLimits {
            process_memory: PROCESS_MEMORY,
            process_cpu: PROCESS_CPU,
            processes: PROCESSES,
        })
        .map_err(unavailable)?,
    );
    let (output, write) = pipe().map_err(|error| unavailable(error.to_string()))?;
    let process = spawn(&Launch {
        application: &setup.program,
        command_line: OsStr::new(&setup.windows.command_line),
        environment: &environment_block(&setup.env),
        directory: &setup.cwd,
        stdin: None,
        stdout: &write,
        stderr: &write,
        container: &container,
        capabilities: &[&tools],
        job: &job,
    })
    .map_err(unavailable)?;
    // Only the command holds the write end now, so the output ends with it.
    drop(write);
    let child = Child {
        process: Arc::new(process),
        output: Some(output),
        job: job.clone(),
    };
    let tree = Tree {
        job,
        _drive: setup.windows.drive.clone(),
    };
    Ok((child, tree))
}

/// Copies the command's output into one capped buffer.
pub fn collect(child: &mut Child, sink: Arc<Mutex<Capped>>) -> Vec<tokio::task::JoinHandle<()>> {
    child
        .output
        .take()
        .map(|mut output| {
            tokio::task::spawn_blocking(move || {
                let mut buffer = [0u8; 8192];
                while let Ok(read) = output.read(&mut buffer) {
                    if read == 0 {
                        break;
                    }
                    if let Ok(mut sink) = sink.lock() {
                        sink.push(&buffer[..read]);
                    }
                }
            })
        })
        .into_iter()
        .collect()
}
