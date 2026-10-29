//! Production secrets live on the operator's computer under server/.env/prod.
//! `push` copies them to your server over SSH and `deploy` then updates and
//! starts the stack there from a clone of this repository.

use std::{
    io::Write,
    path::Path,
    process::{Command, Stdio},
};

use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::{rngs::OsRng, RngCore};

use crate::{
    environment::{self, Target},
    server,
    workspace::Workspace,
};

mod secrets;
pub use secrets::*;

/// An SSH destination and the checkout on it, relative to the SSH user's home.
pub struct Remote {
    host: String,
    dir: String,
}

impl Remote {
    pub fn new(host: &str, dir: &str) -> Result<Self> {
        let host_ok = !host.is_empty()
            && !host.starts_with('-')
            && host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "@._:-".contains(c));
        if !host_ok {
            bail!("invalid SSH destination {host:?}");
        }
        // Interpolated into a remote shell command, so keep it to plain path characters.
        let path_ok = !dir.is_empty()
            && !dir.starts_with('-')
            && !dir.split('/').any(|part| part == "..")
            && dir
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "_./-".contains(c));
        if !path_ok {
            bail!("invalid remote directory {dir:?}");
        }
        Ok(Self {
            host: host.to_owned(),
            dir: dir.to_owned(),
        })
    }

    fn ssh(&self, script: &str) -> Command {
        let mut command = Command::new("ssh");
        command.arg(&self.host).arg(script);
        command
    }

    fn run(&self, script: &str) -> Result<()> {
        let status = self.ssh(script).status().context("could not start ssh")?;
        if !status.success() {
            bail!("remote command on {} exited with {status}", self.host);
        }
        Ok(())
    }
}

/// Copies server/.env/prod to your server. Remote files
/// this computer does not have are kept; replaced files are backed up first.
pub fn push(workspace: &Workspace, remote: &Remote) -> Result<()> {
    environment::check(workspace, Target::Prod)?;
    push_directory(
        &workspace.server.join(".env"),
        remote,
        &format!("{}/server", remote.dir),
    )
}

fn push_directory(env_dir: &Path, remote: &Remote, remote_parent: &str) -> Result<()> {
    println!(
        "Pushing {}/prod to {}:{remote_parent}/.env/prod",
        env_dir.display(),
        remote.host
    );
    let script = format!(
        "set -eu; umask 077; mkdir -p {remote_parent}/.env; cd {remote_parent}/.env; \
if [ -d prod ]; then mkdir -p ../.env-backups; cp -Rp prod ../.env-backups/prod-$(date -u +%Y%m%dT%H%M%SZ); fi; \
tar -xf - --no-same-owner"
    );
    // ustar carries no extended attributes, and COPYFILE_DISABLE stops macOS
    // tar from adding AppleDouble files, so Linux tar extracts it cleanly.
    let mut archive = Command::new("tar")
        .env("COPYFILE_DISABLE", "1")
        .arg("-C")
        .arg(env_dir)
        .args(["--format=ustar", "-cf", "-", "prod"])
        .stdout(Stdio::piped())
        .spawn()
        .context("could not start tar")?;
    let stdout = archive.stdout.take().context("tar has no output")?;
    let status = remote
        .ssh(&script)
        .stdin(stdout)
        .status()
        .context("could not start ssh")?;
    let archived = archive.wait()?;
    if !archived.success() || !status.success() {
        bail!(
            "pushing {} failed (tar {archived}, ssh {status})",
            env_dir.display()
        );
    }
    std::io::stdout().flush()?;
    Ok(())
}

/// Pushes the environment, then pulls and starts the Misty server.
pub fn deploy(workspace: &Workspace, remote: &Remote) -> Result<()> {
    push(workspace, remote)?;
    let path = r#"PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH""#;
    println!("Starting the Misty server on {}", remote.host);
    remote.run(&format!(
        "set -eu; {path}; cd {}; git pull --ff-only; misty server prod up",
        remote.dir
    ))?;
    let api = environment::read(workspace, Target::Prod)?
        .remove("MISTY_PUBLIC_API_URL")
        .unwrap_or_else(|| "your MISTY_PUBLIC_API_URL".to_owned());
    println!("Deployed. Check {api}/health and the API log for SECURITY: lines.");
    Ok(())
}
