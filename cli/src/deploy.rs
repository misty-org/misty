//! Production secrets live on the operator's computer under server/.env/prod
//! (and misty-billing/.env/prod). `push` copies them to the VPS over SSH and
//! `deploy` then updates and starts both stacks there. The public misty repo is
//! cloned on the VPS; billing's private source is not, only its deploy files.

use std::{
    fs,
    io::Write,
    path::Path,
    process::{Command, Stdio},
};

use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::{rngs::OsRng, RngCore};

use crate::{
    artifacts::write_private,
    environment::{self, Target},
    server,
    workspace::Workspace,
};

/// An SSH destination and the two checkouts on it, relative to the SSH user's home.
pub struct Remote {
    host: String,
    dir: String,
    billing_dir: String,
}

impl Remote {
    pub fn new(host: &str, dir: &str, billing_dir: &str) -> Result<Self> {
        let host_ok = !host.is_empty()
            && !host.starts_with('-')
            && host
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "@._:-".contains(c));
        if !host_ok {
            bail!("invalid SSH destination {host:?}");
        }
        for path in [dir, billing_dir] {
            // Interpolated into a remote shell command, so keep it to plain path characters.
            let path_ok = !path.is_empty()
                && !path.starts_with('-')
                && !path.split('/').any(|part| part == "..")
                && path
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "_./-".contains(c));
            if !path_ok {
                bail!("invalid remote directory {path:?}");
            }
        }
        Ok(Self {
            host: host.to_owned(),
            dir: dir.to_owned(),
            billing_dir: billing_dir.to_owned(),
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

/// Fills in missing production values without changing any existing one.
pub fn initialize_production_secrets(workspace: &Workspace) -> Result<()> {
    environment::init(workspace, Target::Prod)?;
    let existing = environment::read(workspace, Target::Prod)?;
    let missing = |name: &str| {
        existing
            .get(name)
            .is_none_or(|value| value.trim().is_empty())
    };
    let generated: [(&str, String); 15] = [
        ("MISTY_ENVIRONMENT", "production".into()),
        ("TRUST_PROXY_HEADERS", "true".into()),
        ("DB_HOST", "postgres".into()),
        ("DB_NAME", "misty_server".into()),
        ("DB_USER", "misty_app".into()),
        ("DB_MIGRATION_USER", "misty".into()),
        ("DB_PASSWORD", hex_secret()),
        ("DB_MIGRATION_PASSWORD", hex_secret()),
        ("AGENT_RUNTIME_DB_PASSWORD", hex_secret()),
        ("MISTY_AUTH_SIGNING_KEY", base64_secret()),
        ("MISTY_AGENT_RUNTIME_CONTROL_SECRET", base64_secret()),
        ("SPACE_LINK_ENCRYPTION_KEY", base64_secret()),
        ("MISTY_BILLING_ADAPTER", "http".into()),
        ("MISTY_BILLING_SECRET", hex_secret()),
        ("MISTY_HOST_PORT", "8081".into()),
    ];
    let mut added = Vec::new();
    for (name, value) in generated {
        if missing(name) {
            environment::set(workspace, Target::Prod, name, &value)?;
            added.push(name);
        }
    }
    let prod = environment::root(workspace, Target::Prod);
    if server::ensure_connected_devices_development_config(&prod.join("crypto/devices.env"))? {
        added.push("MISTY_DEVICE_TICKET_PRIVATE_KEY, MISTY_DEVICE_PAIRING_PEPPER");
    }
    if missing("JOURNAL_COLLAB_TICKET_PRIVATE_KEY") {
        server::generate_production_worker_secrets(workspace)?;
        added.push("JOURNAL_COLLAB_* keys");
    }
    for name in &added {
        println!("  generated {name}");
    }
    let secret = environment::read(workspace, Target::Prod)?
        .remove("MISTY_BILLING_SECRET")
        .context("MISTY_BILLING_SECRET was not saved")?;
    initialize_billing_environment(workspace, &secret)?;
    println!(
        "Production secrets are in server/.env/prod. Still to fill in: MISTY_API_IMAGE, \
MISTY_AGENT_RUNTIME_IMAGE, MISTY_PUBLIC_API_URL (or run misty setup cloudflare --target prod), \
MISTY_BILLING_URL, R2_*, MISTY_BACKUP_*, and any integrations. Check with: misty env status prod"
    );
    Ok(())
}

/// Writes misty-billing/.env/prod/billing.env beside this checkout, sharing the
/// adapter secret, and adds only values that are missing.
fn initialize_billing_environment(workspace: &Workspace, secret: &str) -> Result<()> {
    let billing = workspace.root.join("misty-billing");
    if !billing.is_dir() {
        println!("misty-billing is not checked out beside misty; create its .env/prod/billing.env by hand.");
        return Ok(());
    }
    let path = billing.join(".env/prod/billing.env");
    let mut contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(error).with_context(|| format!("could not read {}", path.display()))
        }
    };
    let configured = |contents: &str, name: &str| {
        contents
            .lines()
            .any(|line| line.trim_start().starts_with(&format!("{name}=")))
    };
    if configured(&contents, "MISTY_BILLING_SECRET")
        && !contents
            .lines()
            .any(|line| line.trim() == format!("MISTY_BILLING_SECRET={secret}"))
    {
        bail!(
            "{} has a different MISTY_BILLING_SECRET than server/.env/prod; make them match",
            path.display()
        );
    }
    let mut added = Vec::new();
    for (name, value) in [
        ("BILLING_OWNER_PASSWORD", hex_secret()),
        ("BILLING_RUNTIME_PASSWORD", hex_secret()),
        ("MISTY_BILLING_SECRET", secret.to_owned()),
        ("MISTY_BILLING_IMAGE", String::new()),
    ] {
        if !configured(&contents, name) {
            if !contents.is_empty() && !contents.ends_with('\n') {
                contents.push('\n');
            }
            contents.push_str(&format!("{name}={value}\n"));
            added.push(name);
        }
    }
    if added.is_empty() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
        }
    }
    write_private(&path, contents.as_bytes())?;
    println!(
        "  misty-billing/.env/prod/billing.env: added {}",
        added.join(", ")
    );
    Ok(())
}

/// Copies server/.env/prod and misty-billing/.env/prod to the VPS. Remote files
/// this computer does not have are kept; replaced files are backed up first.
pub fn push(workspace: &Workspace, remote: &Remote) -> Result<()> {
    environment::check(workspace, Target::Prod)?;
    push_directory(
        &workspace.server.join(".env"),
        remote,
        &format!("{}/server", remote.dir),
    )?;
    let billing = workspace.root.join("misty-billing/.env");
    if billing.join("prod").is_dir() {
        push_directory(&billing, remote, &remote.billing_dir)?;
    } else {
        println!("No misty-billing/.env/prod on this computer; billing environment not pushed.");
    }
    Ok(())
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

/// The private billing source never lives on the VPS. Its stack needs only
/// these committed files; the service itself comes from the GHCR image.
const BILLING_DEPLOY_FILES: [&str; 4] = [
    "compose.prod.yml",
    "deploy/prod.sh",
    "deploy/prod-database-permissions.sh",
    "deploy/runtime-grants.sql",
];

fn push_billing_files(billing: &Path, remote: &Remote) -> Result<()> {
    let dirty = Command::new("git")
        .arg("-C")
        .arg(billing)
        .args(["status", "--porcelain", "--"])
        .args(BILLING_DEPLOY_FILES)
        .output()
        .context("could not run git in misty-billing")?;
    if !dirty.status.success() || !dirty.stdout.is_empty() {
        bail!(
            "commit misty-billing's deploy files before deploying: {}",
            BILLING_DEPLOY_FILES.join(", ")
        );
    }
    println!(
        "Sending billing deploy files to {}:{}",
        remote.host, remote.billing_dir
    );
    let mut archive = Command::new("git")
        .arg("-C")
        .arg(billing)
        .args(["archive", "--format=tar", "HEAD", "--"])
        .args(BILLING_DEPLOY_FILES)
        .stdout(Stdio::piped())
        .spawn()
        .context("could not start git archive")?;
    let stdout = archive.stdout.take().context("git archive has no output")?;
    let status = remote
        .ssh(&format!(
            "set -eu; mkdir -p {dir}; tar -xf - --no-same-owner -C {dir}",
            dir = remote.billing_dir
        ))
        .stdin(stdout)
        .status()
        .context("could not start ssh")?;
    let archived = archive.wait()?;
    if !archived.success() || !status.success() {
        bail!("sending billing deploy files failed (git archive {archived}, ssh {status})");
    }
    Ok(())
}

/// Pushes the environment and billing's deploy files, then starts billing and
/// pulls and starts the Misty server.
pub fn deploy(workspace: &Workspace, remote: &Remote) -> Result<()> {
    push(workspace, remote)?;
    let path = r#"PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH""#;
    let billing = workspace.root.join("misty-billing");
    if billing.join(".env/prod").is_dir() {
        push_billing_files(&billing, remote)?;
        println!("Starting billing on {}", remote.host);
        remote.run(&format!(
            "set -eu; cd {}; deploy/prod.sh up",
            remote.billing_dir
        ))?;
    }
    println!("Starting the Misty server on {}", remote.host);
    remote.run(&format!(
        "set -eu; {path}; cd {}; git pull --ff-only; misty server prod up",
        remote.dir
    ))?;
    println!(
        "Deployed. Check https://api.mistysys.com/v1/health and the API log for SECURITY: lines."
    );
    Ok(())
}

fn hex_secret() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn base64_secret() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    STANDARD.encode(bytes)
}
