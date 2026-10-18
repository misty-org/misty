use std::{
    collections::BTreeMap,
    env, fs,
    net::Ipv4Addr,
    path::Path,
    thread,
    time::{Duration, Instant},
};

use anyhow::{bail, Context, Result};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use ed25519_dalek::{
    pkcs8::{DecodePrivateKey, EncodePrivateKey},
    SigningKey, VerifyingKey,
};
use rand::{rngs::OsRng, RngCore};
use serde_json::json;
use sha2::{Digest, Sha256};
use url::Url;

use crate::{
    artifacts::write_private,
    environment::{self, Target},
    process::CommandSpec,
    workspace::Workspace,
};

mod worker;
pub use worker::*;
mod secrets;
pub(crate) use secrets::*;
mod r2;
pub use r2::*;
#[cfg(test)]
mod tests;

const TICKET_PRIVATE_KEY: &str = "JOURNAL_COLLAB_TICKET_PRIVATE_KEY";
const TICKET_PUBLIC_KEY: &str = "JOURNAL_COLLAB_TICKET_PUBLIC_KEY";
const CONTROL_SECRET: &str = "JOURNAL_COLLAB_CONTROL_SECRET";
const PROJECTION_SECRET: &str = "JOURNAL_COLLAB_PROJECTION_SECRET";
const ROOM_SALT: &str = "JOURNAL_COLLAB_ROOM_SALT";
const DEVICE_TICKET_PRIVATE_KEY: &str = "MISTY_DEVICE_TICKET_PRIVATE_KEY";
const DEVICE_PAIRING_PEPPER: &str = "MISTY_DEVICE_PAIRING_PEPPER";
const DEVICE_TICKET_PREVIOUS_PUBLIC_KEYS: &str = "MISTY_DEVICE_TICKET_PREVIOUS_PUBLIC_KEYS";

pub fn up(workspace: &Workspace, detach: bool, build: bool, verbose: bool) -> Result<()> {
    environment::check(workspace, Target::Dev)?;
    let devices = environment::root(workspace, Target::Dev).join("crypto/devices.env");
    if ensure_connected_devices_development_config(&devices)? {
        println!("Configured Connected Devices for local development.");
    }
    validate_development_secrets(workspace)?;
    ports(workspace)?;
    CommandSpec::new("sh")
        .arg("scripts/docker/consolidate-workflow.sh")
        .run_logged(
            &workspace.server,
            &workspace.server.join(".misty/logs/workflow-migration.log"),
            &diagnostic_secrets(workspace)?,
        )?;
    // The API meters every model turn through billing, so billing comes up first:
    // its database, migrations and a rebuilt API, healthy before the server starts.
    crate::billing::up(workspace, &workspace.server.join(".misty/logs/billing.log"))?;
    println!("Starting server containers…");
    let command = development_up_command(detach, build);
    let log = workspace.server.join(".misty/logs/startup.log");
    let result = command.run_logged(&workspace.server, &log, &diagnostic_secrets(workspace)?);
    if verbose && log.exists() {
        eprintln!("{}", fs::read_to_string(&log)?);
    }
    result?;
    let started = Instant::now();
    while health(workspace).is_err() {
        if started.elapsed() > Duration::from_secs(120) {
            status(workspace)?;
            bail!(
                "server was not ready within 120 seconds; run misty server logs SERVICE --tail 100"
            );
        }
        thread::sleep(Duration::from_secs(2));
    }
    status(workspace)?;
    println!("API: {}", development_api_url());
    println!("Worker deployment: misty server deploy");
    Ok(())
}

pub fn initialize_development_secrets(workspace: &Workspace) -> Result<()> {
    let devices = environment::root(workspace, Target::Dev).join("crypto/devices.env");
    if ensure_connected_devices_development_config(&devices)? {
        println!("Configured Connected Devices for local development.");
    }
    let worker = workspace.server.join("apps/journal-collab");
    let dev_vars = worker.join(".dev.vars");
    let server_env = worker.join(".secrets/server.env");
    match (dev_vars.is_file(), server_env.is_file()) {
        (false, false) => generate_worker_secrets(workspace),
        (false, true) => restore_development_worker_secrets(&server_env, &dev_vars),
        (true, true) => Ok(()),
        (true, false) => bail!(
            "development Worker secrets are partially configured; restore {} from backup before continuing (existing Worker keys were preserved)",
            server_env.display()
        ),
    }
}

pub(crate) fn ensure_connected_devices_development_config(path: &Path) -> Result<bool> {
    let mut contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(error).with_context(|| format!("could not read {}", path.display()))
        }
    };
    let (without_legacy_toggle, removed_legacy_toggle) =
        remove_environment_name(&contents, "MISTY_CONNECTED_DEVICES_ENABLED");
    contents = without_legacy_toggle;

    let private_keys = environment_values(&contents, DEVICE_TICKET_PRIVATE_KEY);
    let peppers = environment_values(&contents, DEVICE_PAIRING_PEPPER);
    if private_keys.len() > 1 || peppers.len() > 1 {
        bail!(
            "Connected Devices secrets are defined more than once in {}",
            path.display()
        );
    }
    if let Some(encoded) = private_keys.first() {
        let raw = STANDARD.decode(encoded).with_context(|| {
            format!(
                "{DEVICE_TICKET_PRIVATE_KEY} in {} is not valid base64",
                path.display()
            )
        })?;
        SigningKey::from_pkcs8_der(&raw).with_context(|| {
            format!(
                "{DEVICE_TICKET_PRIVATE_KEY} in {} is not Ed25519 PKCS#8",
                path.display()
            )
        })?;
    }
    if let Some(encoded) = peppers.first() {
        let raw = STANDARD.decode(encoded).with_context(|| {
            format!(
                "{DEVICE_PAIRING_PEPPER} in {} is not valid base64",
                path.display()
            )
        })?;
        if raw.len() < 32 {
            bail!(
                "{DEVICE_PAIRING_PEPPER} in {} must contain at least 32 bytes",
                path.display()
            );
        }
    }

    let mut additions = Vec::new();
    let mut random = OsRng;
    if private_keys.is_empty() {
        let signing = SigningKey::generate(&mut random);
        verify_pair(&signing)?;
        additions.push(format!(
            "{DEVICE_TICKET_PRIVATE_KEY}={}",
            STANDARD.encode(signing.to_pkcs8_der()?.as_bytes())
        ));
    }
    if peppers.is_empty() {
        additions.push(format!(
            "{DEVICE_PAIRING_PEPPER}={}",
            random_secret(&mut random)
        ));
    }
    if additions.is_empty() && !removed_legacy_toggle {
        return Ok(false);
    }

    let mut updated = contents;
    if !updated.is_empty() && !updated.ends_with('\n') {
        updated.push('\n');
    }
    if !additions.is_empty() {
        updated.push_str("\n# Generated by `misty server up` for local Connected Devices.\n");
        updated.push_str(&additions.join("\n"));
        updated.push('\n');
    }
    write_private(path, updated.as_bytes())?;
    Ok(true)
}

fn remove_environment_name(contents: &str, name: &str) -> (String, bool) {
    let ended_with_newline = contents.ends_with('\n');
    let mut removed = false;
    let lines = contents
        .lines()
        .filter(|line| {
            let key = line
                .split_once('=')
                .map(|(key, _)| key.trim())
                .unwrap_or_default();
            if key == name {
                removed = true;
                false
            } else {
                true
            }
        })
        .collect::<Vec<_>>();
    let mut updated = lines.join("\n");
    if ended_with_newline && !updated.is_empty() {
        updated.push('\n');
    }
    (updated, removed)
}

pub fn down(workspace: &Workspace, volumes: bool) -> Result<()> {
    development_down_command(volumes).run(&workspace.server)?;
    // --volumes clears only the server's data; billing's database is kept.
    crate::billing::down(workspace)
}

pub fn url(workspace: &Workspace) -> Result<()> {
    println!("{}", ensure_active_development_api_url(workspace)?);
    Ok(())
}

fn development_up_command(detach: bool, build: bool) -> CommandSpec {
    let mut command = development_compose().arg("up");
    if build {
        command = command.arg("--build");
    }
    // Compose already recreates services whose image or configuration changed.
    // Avoid forcing the stable Cloudflare connector down during every API
    // rebuild: doing so leaves the named hostname with no connector and turns
    // one backend restart into a burst of misleading 530/CORS failures.
    command = command.arg("--remove-orphans");
    if detach {
        command = command.arg("--detach");
    }
    command
}

fn development_down_command(volumes: bool) -> CommandSpec {
    let mut command = development_compose().arg("down");
    if volumes {
        command = command.arg("--volumes");
    }
    command.arg("--remove-orphans")
}

pub fn logs(workspace: &Workspace, service: Option<&str>, follow: bool, tail: u32) -> Result<()> {
    let mut command = development_compose().args(["logs", "--tail", &tail.to_string()]);
    if follow {
        command = command.arg("--follow");
    }
    if let Some(service) = service {
        if service.starts_with('-') {
            bail!("invalid service name");
        }
        command = command.arg(if service == "api" {
            "misty-api"
        } else {
            service
        });
    }
    command.run(&workspace.server)
}

pub fn status(workspace: &Workspace) -> Result<()> {
    let rows = container_status(workspace)?;
    println!("{:<27} STATUS", "SERVICE");
    for row in &rows {
        let service = row["Service"].as_str().unwrap_or("unknown");
        let state = row["State"].as_str().unwrap_or("unknown");
        let health = row["Health"].as_str().unwrap_or("");
        // Successful setup/deployment jobs are not ongoing server services.
        // Keep incomplete or failed jobs visible so their logs remain discoverable.
        let is_job = matches!(
            service,
            "setup"
                | "dev-init"
                | "migrate"
                | "database-permissions"
                | "agent-runtime-setup"
                | "cloudflare-deploy"
        );
        if is_job && state == "exited" && row["ExitCode"].as_i64() == Some(0) {
            continue;
        }
        let status = if !health.is_empty() { health } else { state };
        println!("{service:<27} {status}");
    }
    let billing = crate::billing::status(workspace).unwrap_or_default();
    for (service, status) in &billing {
        println!("{service:<27} {status}");
    }
    if rows.is_empty() && billing.is_empty() {
        println!("No containers started. Run misty server up.");
    }
    Ok(())
}

fn container_status(workspace: &Workspace) -> Result<Vec<serde_json::Value>> {
    let output = development_compose()
        .args(["ps", "--all", "--format", "json"])
        .capture(&workspace.server)?;
    if output.trim().starts_with('[') {
        Ok(serde_json::from_str(&output)?)
    } else {
        Ok(output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(serde_json::from_str)
            .collect::<std::result::Result<_, _>>()?)
    }
}

pub fn validate_development_secrets(workspace: &Workspace) -> Result<()> {
    let values = environment::read(workspace, Target::Dev)?;
    let key = required_map_value(&values, DEVICE_TICKET_PRIVATE_KEY)?;
    SigningKey::from_pkcs8_der(&STANDARD.decode(key)?).context("invalid device signing key")?;
    let pepper = STANDARD.decode(required_map_value(&values, DEVICE_PAIRING_PEPPER)?)?;
    if pepper.len() < 32 {
        bail!("device pairing pepper must contain at least 32 bytes");
    }
    let server_path = workspace
        .server
        .join("apps/journal-collab/.secrets/server.env");
    let worker_path = workspace.server.join("apps/journal-collab/.dev.vars");
    require_private_file(&server_path)?;
    require_private_file(&worker_path)?;
    let mut server = read_environment(&server_path)?;
    for name in [TICKET_PRIVATE_KEY, CONTROL_SECRET, PROJECTION_SECRET] {
        if let Some(value) = values.get(name).filter(|value| !value.is_empty()) {
            server.insert(name.into(), value.clone());
        }
    }
    let worker = read_environment(&worker_path)?;
    let signing = SigningKey::from_pkcs8_der(
        &STANDARD.decode(required_map_value(&server, TICKET_PRIVATE_KEY)?)?,
    )?;
    if STANDARD.encode(VerifyingKey::from(&signing).to_bytes())
        != required_map_value(&worker, TICKET_PUBLIC_KEY)?
    {
        bail!("server and Worker ticket keys do not match; restore the matching bundle");
    }
    for name in [CONTROL_SECRET, PROJECTION_SECRET] {
        if required_map_value(&server, name)? != required_map_value(&worker, name)? {
            bail!("server and Worker {name} do not match");
        }
    }
    let salt = STANDARD.decode(required_map_value(&values, ROOM_SALT)?)?;
    if salt.len() < 32 {
        bail!("room salt must contain at least 32 bytes");
    }
    Ok(())
}

pub fn ports(workspace: &Workspace) -> Result<()> {
    let values = environment::effective(workspace, Target::Dev)?;
    let rows = container_status(workspace).unwrap_or_default();
    for (key, fallback, service) in [
        ("MISTY_HOST_PORT", "8081", "misty-api"),
        ("DB_PORT", "5435", "postgres"),
    ] {
        let port: u16 = values
            .get(key)
            .map(String::as_str)
            .unwrap_or(fallback)
            .parse()
            .with_context(|| format!("{key} is not a valid port"))?;
        let owned = rows
            .iter()
            .filter(|row| row["Service"] == service && row["State"] == "running")
            .any(|row| {
                row["Publishers"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|p| p["PublishedPort"].as_u64() == Some(port as u64))
            });
        if !owned {
            check_available_port(port)?;
        }
    }
    Ok(())
}
fn check_available_port(port: u16) -> Result<()> {
    if port == 0 {
        bail!("host port must not be zero");
    }
    std::net::TcpListener::bind(("127.0.0.1", port)).with_context(|| format!("port {port} is occupied or unavailable; stop its owner or change the host port with misty env set"))?;
    Ok(())
}

pub fn health(workspace: &Workspace) -> Result<()> {
    let rows = container_status(workspace)?;
    validate_health(&rows)
}
fn validate_health(rows: &[serde_json::Value]) -> Result<()> {
    for service in ["postgres", "agent-runtime", "misty-api", "tunnel"] {
        let row = rows
            .iter()
            .find(|row| row["Service"] == service)
            .with_context(|| format!("{service} has not started"))?;
        if row["State"] != "running" || row["Health"] != "healthy" {
            bail!("{service} is not healthy");
        }
    }
    for row in rows {
        if row["Service"] == "cloudflare-deploy" {
            continue;
        }
        if row["State"] == "exited" && row["ExitCode"].as_i64().unwrap_or(0) != 0 {
            bail!("{} failed; inspect its service logs", row["Service"]);
        }
        if row["State"] == "restarting" || row["Health"] == "unhealthy" {
            bail!("{} is unhealthy", row["Service"]);
        }
    }
    Ok(())
}
fn diagnostic_secrets(workspace: &Workspace) -> Result<Vec<String>> {
    let mut secrets: Vec<String> = environment::effective(workspace, Target::Dev)?
        .into_iter()
        .filter(|(name, _)| {
            ["TOKEN", "SECRET", "KEY", "PASSWORD", "PEPPER", "SALT"]
                .iter()
                .any(|part| name.contains(part))
        })
        .map(|(_, value)| value)
        .collect();
    for relative in [
        "apps/journal-collab/.dev.vars",
        "apps/journal-collab/.secrets/server.env",
    ] {
        let path = workspace.server.join(relative);
        if path.exists() {
            secrets.extend(read_environment(&path)?.into_values());
        }
    }
    Ok(secrets)
}

pub fn deploy_development(workspace: &Workspace) -> Result<()> {
    environment::check(workspace, Target::Dev)?;
    println!("Deploying development collaboration Worker…");
    development_compose()
        .args(["run", "--rm", "--no-deps", "--build", "setup", "deploy"])
        .run_logged(
            &workspace.server,
            &workspace.server.join(".misty/logs/deploy.log"),
            &diagnostic_secrets(workspace)?,
        )
}

pub(crate) fn development_compose() -> CommandSpec {
    compose("compose.dev.yml")
}

fn compose(file: &str) -> CommandSpec {
    // load_command_environment already applied the configured files with shell
    // overrides preserved. Do not require placeholders or let Compose load an
    // unrelated default .env file (our .env path is a directory).
    CommandSpec::new("docker")
        .env("COMPOSE_DISABLE_ENV_FILE", "1")
        .env_remove("COMPOSE_ENV_FILES")
        .args(["compose", "--file", file])
}

fn production_compose() -> CommandSpec {
    compose("compose.prod.yml")
}

fn staging_compose(workspace: &Workspace) -> Result<CommandSpec> {
    // Do not let exported production values leak into staging Compose
    // interpolation (for example AI credentials or database passwords).
    let mut command = compose("compose.prod.yml")
        .args(["--project-name", "misty-staging"])
        .env("MISTY_ENV_TARGET", "staging");
    for name in environment::registered_names() {
        command = command.env_remove(name);
    }
    for (name, value) in environment::read(workspace, Target::Staging)? {
        command = command.env(name, value);
    }
    Ok(command)
}

pub fn production_check(workspace: &Workspace) -> Result<()> {
    environment::check(workspace, Target::Prod)?;
    production_compose()
        .args(["config", "--quiet"])
        .run(&workspace.server)
}

pub fn production_up(workspace: &Workspace) -> Result<()> {
    production_check(workspace)?;
    production_compose().arg("pull").run(&workspace.server)?;
    production_compose()
        .args(["up", "--detach"])
        .run(&workspace.server)
}

pub fn production_down(workspace: &Workspace, volumes: bool) -> Result<()> {
    environment::check(workspace, Target::Prod)?;
    let mut command = production_compose().arg("down");
    if volumes {
        command = command.arg("--volumes");
    }
    command.arg("--remove-orphans").run(&workspace.server)
}

pub fn production_backup(workspace: &Workspace) -> Result<()> {
    environment::check(workspace, Target::Prod)?;
    CommandSpec::new("bash")
        .arg("scripts/prod-backup.sh")
        .run(&workspace.server)
}

pub fn production_restore(
    workspace: &Workspace,
    backup: &str,
    identity: &Path,
    confirmed: bool,
) -> Result<()> {
    if !confirmed {
        bail!("restore replaces production data; rerun with --yes");
    }
    environment::check(workspace, Target::Prod)?;
    let identity = identity
        .canonicalize()
        .with_context(|| format!("cannot read age identity {}", identity.display()))?;
    CommandSpec::new("bash")
        .arg("scripts/prod-restore.sh")
        .arg(backup)
        .arg(identity)
        .env("MISTY_RESTORE_CONFIRMED", "yes")
        .run(&workspace.server)
}

pub fn production_logs(workspace: &Workspace) -> Result<()> {
    environment::check(workspace, Target::Prod)?;
    production_compose()
        .args(["logs", "--follow"])
        .run(&workspace.server)
}

pub fn staging_check(workspace: &Workspace) -> Result<()> {
    environment::check(workspace, Target::Staging)?;
    staging_compose(workspace)?
        .args(["config", "--quiet"])
        .run(&workspace.server)
}

pub fn staging_up(workspace: &Workspace) -> Result<()> {
    staging_check(workspace)?;
    staging_compose(workspace)?
        .args(["up", "--build", "--detach", "--remove-orphans"])
        .run(&workspace.server)?;
    let port = environment::effective(workspace, Target::Staging)?
        .get("MISTY_HOST_PORT")
        .cloned()
        .unwrap_or_else(|| "8082".into());
    println!("Staging API: http://127.0.0.1:{port}/v1");
    println!("For remote access, forward this loopback port over SSH.");
    Ok(())
}

pub fn staging_down(workspace: &Workspace, volumes: bool) -> Result<()> {
    environment::check(workspace, Target::Staging)?;
    let mut command = staging_compose(workspace)?.arg("down");
    if volumes {
        command = command.arg("--volumes");
    }
    command.args(["--remove-orphans"]).run(&workspace.server)
}

pub fn staging_status(workspace: &Workspace) -> Result<()> {
    environment::check(workspace, Target::Staging)?;
    staging_compose(workspace)?
        .args(["ps", "--all"])
        .run(&workspace.server)
}

pub fn staging_logs(workspace: &Workspace) -> Result<()> {
    environment::check(workspace, Target::Staging)?;
    staging_compose(workspace)?
        .args(["logs", "--follow"])
        .run(&workspace.server)
}

const DEFAULT_DEVELOPMENT_API_TUNNEL_HOSTNAME: &str = "";

fn development_tunnel_connection_command() -> CommandSpec {
    development_compose().args([
        "exec",
        "--no-TTY",
        "tunnel",
        "sh",
        "-c",
        "wget -q -O - http://127.0.0.1:20241/metrics | grep -Eq '^cloudflared_tunnel_ha_connections [1-9][0-9]*(\\.[0-9]+)?$'",
    ])
}

fn development_tunnel_hostname() -> String {
    env::var("MISTY_DEV_API_TUNNEL_HOSTNAME")
        .or_else(|_| env::var("MISTY_DEV_TUNNEL_HOSTNAME"))
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_DEVELOPMENT_API_TUNNEL_HOSTNAME.to_owned())
}

fn development_api_url() -> String {
    format!("https://{}/v1", development_tunnel_hostname())
}

fn ensure_active_development_api_url(workspace: &Workspace) -> Result<String> {
    if development_tunnel_hostname().is_empty() {
        bail!("configure a hostname with misty setup cloudflare");
    }
    wait_for_development_tunnel(workspace)
}

fn wait_for_development_tunnel(workspace: &Workspace) -> Result<String> {
    let started = Instant::now();
    let timeout = Duration::from_secs(30);
    let mut next_progress = Duration::from_secs(5);
    let url = development_api_url();
    loop {
        if development_tunnel_connection_command()
            .capture(&workspace.server)
            .is_ok()
            && development_tunnel_dns_is_published(workspace, &url).is_ok()
        {
            return Ok(url);
        }
        let elapsed = started.elapsed();
        if elapsed >= timeout {
            bail!("cloudflared did not establish a connection within 30 seconds");
        }
        if elapsed >= next_progress {
            eprintln!("Still waiting for Cloudflare... ({}s)", elapsed.as_secs());
            next_progress += Duration::from_secs(5);
        }
        thread::sleep(Duration::from_millis(500));
    }
}

fn development_tunnel_dns_is_published(workspace: &Workspace, api_url: &str) -> Result<()> {
    let url = Url::parse(api_url).context("development API returned an invalid URL")?;
    let host = url
        .host_str()
        .context("development API URL has no hostname")?;
    let output = CommandSpec::new("dig")
        .args(["+short", "+time=1", "+tries=1", host, "A"])
        .capture(&workspace.server)
        .context("could not query the configured DNS resolver")?;
    if output
        .lines()
        .any(|line| line.trim().parse::<Ipv4Addr>().is_ok())
    {
        return Ok(());
    }
    bail!("Cloudflare DNS has not published the development tunnel yet")
}
