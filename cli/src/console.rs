//! Operator console launcher behind `misty server up --gui`: start (or reuse)
//! the loopback console and open it; `misty server down` stops it.

use std::{
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use url::Url;

use crate::{process::CommandSpec, server::development_compose, workspace::Workspace};

const PORT: u16 = 7070;

#[derive(Debug, Deserialize)]
struct Handoff {
    pid: u32,
    url: String,
}

fn handoff_path(workspace: &Workspace) -> PathBuf {
    workspace.server.join(".misty/console.json")
}

/// Starts the console unless one is already answering, then opens it.
pub fn open(workspace: &Workspace) -> Result<()> {
    let path = handoff_path(workspace);
    let handoff = match running(&path) {
        Some(handoff) => handoff,
        None => start(workspace, &path, PORT)?,
    };
    println!("Console: {}", handoff.url);
    open_browser(&handoff.url)
}

/// Returns the running console's handoff, discarding a stale file whose
/// process no longer answers.
fn running(path: &Path) -> Option<Handoff> {
    let handoff: Handoff = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    let url = Url::parse(&handoff.url).ok()?;
    let addr = url.socket_addrs(|| None).ok()?.into_iter().next()?;
    if healthz(addr) {
        Some(handoff)
    } else {
        let _ = fs::remove_file(path);
        None
    }
}

fn start(workspace: &Workspace, handoff_path: &Path, port: u16) -> Result<Handoff> {
    let binary = workspace.server.join(".misty/bin/misty-console");
    CommandSpec::new("go")
        .args(["build", "-o"])
        .arg(&binary)
        .arg("./cmd/misty-console")
        .run(&workspace.server)?;

    let schema_path = workspace.server.join(".misty/console-env.json");
    crate::artifacts::write_private(
        &schema_path,
        serde_json::to_string(&crate::environment::schema_json())?.as_bytes(),
    )?;

    let log_path = workspace.server.join(".misty/logs/console.log");
    fs::create_dir_all(log_path.parent().context("log path has no parent")?)?;
    let log = fs::File::create(&log_path)?;
    let mut command = Command::new(&binary);
    command
        .args(["-addr", &format!("127.0.0.1:{port}")])
        .args(["-api", &api_url(workspace)])
        .arg("-handoff")
        .arg(handoff_path)
        .arg("-env-schema")
        .arg(&schema_path)
        .current_dir(&workspace.server)
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    // The dev env file points DB_HOST at the container network; the console
    // runs on the host, so use the port Compose publishes for Postgres.
    if let Some(addr) = published(workspace, "postgres", 5432) {
        command
            .env("DB_HOST", addr.ip().to_string())
            .env("DB_PORT", addr.port().to_string());
    }
    detach(&mut command);
    let mut child = command.spawn().context("could not start misty-console")?;

    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(15) {
        if let Some(handoff) = running(handoff_path) {
            return Ok(handoff);
        }
        if let Some(status) = child.try_wait()? {
            bail!(
                "misty-console exited ({status}); see {}",
                log_path.display()
            );
        }
        thread::sleep(Duration::from_millis(200));
    }
    bail!(
        "misty-console did not start within 15 seconds; see {}",
        log_path.display()
    )
}

/// Stops a running console; a no-op when none is running.
pub fn stop(workspace: &Workspace) -> Result<()> {
    let Some(handoff) = running(&handoff_path(workspace)) else {
        return Ok(());
    };
    let pid = handoff.pid.to_string();
    if cfg!(windows) {
        CommandSpec::new("taskkill")
            .args(["/PID", &pid])
            .capture(Path::new("."))?;
    } else {
        CommandSpec::new("kill")
            .args(["-TERM", &pid])
            .capture(Path::new("."))?;
    }
    println!("Console stopped.");
    Ok(())
}

fn api_url(workspace: &Workspace) -> String {
    match published(workspace, "misty-api", 8080) {
        Some(addr) => format!("http://{addr}"),
        None => {
            let port = std::env::var("MISTY_HOST_PORT").unwrap_or_else(|_| "8081".into());
            format!("http://127.0.0.1:{port}")
        }
    }
}

/// Host address Compose publishes for a service's container port, if running.
fn published(workspace: &Workspace, service: &str, port: u16) -> Option<SocketAddr> {
    development_compose()
        .args(["port", service, &port.to_string()])
        .capture(&workspace.server)
        .ok()?
        .trim()
        .parse()
        .ok()
}

/// Minimal HTTP probe; the CLI has no HTTP client dependency.
fn healthz(addr: SocketAddr) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
    let request = format!("GET /healthz HTTP/1.0\r\nHost: {addr}\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    let _ = stream.take(64).read_to_string(&mut response);
    response.starts_with("HTTP/1.0 200") || response.starts_with("HTTP/1.1 200")
}

fn open_browser(url: &str) -> Result<()> {
    let spec = if cfg!(target_os = "macos") {
        CommandSpec::new("open").arg(url)
    } else if cfg!(windows) {
        CommandSpec::new("cmd").args(["/C", "start", "", url])
    } else {
        CommandSpec::new("xdg-open").arg(url)
    };
    spec.capture(Path::new("."))
        .map(|_| ())
        .context("could not open a browser; use the link above")
}

/// Keep the console running after this CLI exits or receives Ctrl-C.
#[cfg(unix)]
fn detach(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(not(unix))]
fn detach(_command: &mut Command) {}
