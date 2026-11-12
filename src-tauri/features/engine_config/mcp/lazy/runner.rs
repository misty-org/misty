// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
use super::*;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::mpsc;

enum Event {
    Client(String),
    ClientEof,
    Child(u64, String),
    ChildExit(u64),
}

struct Live {
    gen: u64,
    child: Child,
    stdin: Option<ChildStdin>,
    /// Windows: the server's kill-on-close job. `kill_on_drop` ends only the direct child, so
    /// a server started through `npx` or `cmd /c` would leave its real process behind; the
    /// job ends every member when this drops, or when this proxy process itself dies.
    #[cfg(windows)]
    _job: Option<std::sync::Arc<crate::engine_config::cli_lifecycle::job::KillOnCloseJob>>,
}

pub(super) async fn run<S: CacheStore>(
    mut proxy: Proxy<S>,
    command: Vec<String>,
) -> Result<(), String> {
    let (tx, mut rx) = mpsc::unbounded_channel::<Event>();
    let client_tx = tx.clone();
    // The engine's side of the pipe is read on a thread of its own: Misty builds tokio without
    // its standard-stream support.
    std::thread::spawn(move || {
        let mut reader = std::io::BufReader::new(std::io::stdin());
        while let Some(line) = read_std_line(&mut reader) {
            if client_tx.send(Event::Client(line)).is_err() {
                return;
            }
        }
        let _ = client_tx.send(Event::ClientEof);
    });
    let mut live: Option<Live> = None;
    let mut start_deadline: Option<(u64, tokio::time::Instant)> = None;
    let mut shutdown: Option<tokio::time::Instant> = None;
    loop {
        let deadline = match (start_deadline, shutdown) {
            (Some((_, a)), Some(b)) => Some(a.min(b)),
            (Some((_, a)), None) => Some(a),
            (None, b) => b,
        };
        let event = tokio::select! {
            event = rx.recv() => event,
            _ = sleep_until(deadline) => None,
        };
        let actions = match event {
            Some(Event::Client(line)) => proxy.on_client(&line),
            Some(Event::ClientEof) => {
                if let Some(live) = live.as_mut() {
                    live.stdin = None;
                }
                if live.is_none() || !proxy.has_pending() {
                    break;
                }
                shutdown = Some(tokio::time::Instant::now() + EOF_GRACE);
                Vec::new()
            }
            Some(Event::Child(gen, line)) => proxy.on_child(gen, &line),
            Some(Event::ChildExit(gen)) => {
                if live.as_ref().is_some_and(|live| live.gen == gen) {
                    live = None;
                }
                let actions = proxy.on_child_exit(gen);
                if shutdown.is_some() {
                    break;
                }
                actions
            }
            None => {
                let now = tokio::time::Instant::now();
                if shutdown.is_some_and(|at| at <= now) {
                    break;
                }
                match start_deadline.take() {
                    Some((gen, at)) if at <= now => proxy.on_start_timeout(gen),
                    other => {
                        start_deadline = other;
                        Vec::new()
                    }
                }
            }
        };
        for action in actions {
            match action {
                Action::ToClient(line) => {
                    if write_stdout(&line).is_err() {
                        close_gracefully(&mut live).await;
                        return Ok(());
                    }
                }
                Action::ToChild(line) => {
                    if let Some(stdin) = live.as_mut().and_then(|live| live.stdin.as_mut()) {
                        let _ = write_line(stdin, &line).await;
                    }
                }
                Action::Spawn(gen) => {
                    kill(&mut live).await;
                    match spawn(&command, gen, tx.clone()) {
                        Ok(next) => {
                            live = Some(next);
                            start_deadline =
                                Some((gen, tokio::time::Instant::now() + START_TIMEOUT));
                        }
                        Err(error) => {
                            eprintln!("[mcp-lazy] {error}");
                            let _ = tx.send(Event::ChildExit(gen));
                        }
                    }
                }
                Action::Kill => kill(&mut live).await,
                Action::Exit => {
                    kill(&mut live).await;
                    return Ok(());
                }
            }
        }
        if let Some((gen, _)) = start_deadline {
            if !proxy.is_starting(gen) {
                start_deadline = None;
            }
        }
    }
    close_gracefully(&mut live).await;
    Ok(())
}

async fn sleep_until(deadline: Option<tokio::time::Instant>) {
    match deadline {
        Some(at) => tokio::time::sleep_until(at).await,
        None => std::future::pending().await,
    }
}

/// One line to the engine, written straight to this process's stdout and flushed.
fn write_stdout(line: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut stdout = std::io::stdout().lock();
    stdout.write_all(line.as_bytes())?;
    stdout.write_all(b"\n")?;
    stdout.flush()
}

/// [`read_line`] for the blocking stdin thread: the same limits and the same skipping.
fn read_std_line(reader: &mut std::io::BufReader<std::io::Stdin>) -> Option<String> {
    use std::io::BufRead;
    loop {
        let mut bytes = Vec::new();
        let read = reader.read_until(b'\n', &mut bytes).ok()?;
        if read == 0 {
            return None;
        }
        while matches!(bytes.last(), Some(b'\n' | b'\r')) {
            bytes.pop();
        }
        if bytes.is_empty() || bytes.len() > MAX_LINE_BYTES {
            continue;
        }
        match String::from_utf8(bytes) {
            Ok(line) => return Some(line),
            Err(_) => eprintln!("[mcp-lazy] dropped a non-UTF-8 line"),
        }
    }
}

async fn read_line<R: tokio::io::AsyncRead + Unpin>(
    reader: &mut BufReader<R>,
) -> Option<String> {
    loop {
        let mut bytes = Vec::new();
        let read = reader.read_until(b'\n', &mut bytes).await.ok()?;
        if read == 0 {
            return None;
        }
        while matches!(bytes.last(), Some(b'\n' | b'\r')) {
            bytes.pop();
        }
        if bytes.is_empty() || bytes.len() > MAX_LINE_BYTES {
            continue;
        }
        match String::from_utf8(bytes) {
            Ok(line) => return Some(line),
            Err(_) => eprintln!("[mcp-lazy] dropped a non-UTF-8 line"),
        }
    }
}

async fn write_line<W: tokio::io::AsyncWrite + Unpin>(
    writer: &mut W,
    line: &str,
) -> std::io::Result<()> {
    writer.write_all(line.as_bytes()).await?;
    writer.write_all(b"\n").await?;
    writer.flush().await
}

fn spawn(
    command: &[String],
    gen: u64,
    tx: mpsc::UnboundedSender<Event>,
) -> Result<Live, String> {
    let (program, args) = command.split_first().ok_or("empty command")?;
    let mut cmd = launch_command(program);
    cmd.args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .kill_on_drop(true);
    #[cfg(windows)]
    crate::engine_config::support::hide_console_tokio(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("start {program}: {e}"))?;
    #[cfg(windows)]
    let job = crate::engine_config::cli_lifecycle::job::assign_kill_on_close(&child);
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or("child stdout missing")?;
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        while let Some(line) = read_line(&mut reader).await {
            if tx.send(Event::Child(gen, line)).is_err() {
                return;
            }
        }
        let _ = tx.send(Event::ChildExit(gen));
    });
    Ok(Live {
        gen,
        child,
        stdin,
        #[cfg(windows)]
        _job: job,
    })
}

/// `npx` and friends ship as `.cmd` shims that CreateProcess cannot run
/// by bare name; resolve through PATH/PATHEXT and wrap like the engines do.
fn launch_command(program: &str) -> tokio::process::Command {
    crate::engine_config::mcp::probe::launch_command(program)
}

/// The session ended: in MCP's stdio shutdown order, close stdin first and let the server
/// exit on its own, then SIGTERM on Unix, and only then kill it ([`kill`]). A server that
/// failed to start or timed out needs no shutdown and goes straight to [`kill`].
async fn close_gracefully(live: &mut Option<Live>) {
    if let Some(current) = live.as_mut() {
        current.stdin = None;
        let exited = tokio::time::timeout(EOF_GRACE, current.child.wait())
            .await
            .is_ok();
        #[cfg(unix)]
        if !exited {
            // wait() hasn't returned, so the process isn't reaped and the pid is still its own.
            if let Some(pid) = current.child.id() {
                unsafe {
                    libc::kill(pid as libc::pid_t, libc::SIGTERM);
                }
                let _ =
                    tokio::time::timeout(Duration::from_secs(1), current.child.wait()).await;
            }
        }
        #[cfg(not(unix))]
        let _ = exited;
    }
    kill(live).await;
}

async fn kill(live: &mut Option<Live>) {
    if let Some(mut live) = live.take() {
        live.stdin = None;
        let _ = live.child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(3), live.child.wait()).await;
    }
}
