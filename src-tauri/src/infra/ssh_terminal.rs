use std::{
    collections::BTreeSet,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use portable_pty::CommandBuilder;
use serde::{Deserialize, Serialize};

const SSH_TIMEOUT_SECONDS: &str = "5";

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshEnvironment {
    pub id: String,
    pub label: String,
    pub host: String,
    pub user: Option<String>,
    pub port: u16,
    pub config_path: String,
    pub device_local: bool,
    pub agent_tools: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SshConnectionRequest {
    Configured {
        id: String,
    },
    Direct {
        host: String,
        user: Option<String>,
        port: u16,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshTrustRequest {
    pub connection: SshConnectionRequest,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SshHostKeyStatus {
    pub state: String,
    pub fingerprints: Vec<String>,
    pub message: String,
}

#[tauri::command]
pub async fn terminal_ssh_environments() -> Result<Vec<SshEnvironment>, String> {
    tauri::async_runtime::spawn_blocking(discover_ssh_environments)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn terminal_ssh_preflight(
    connection: SshConnectionRequest,
) -> Result<SshHostKeyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || ssh_preflight(&connection))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn terminal_ssh_trust_host(request: SshTrustRequest) -> Result<SshHostKeyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || trust_ssh_host(&request))
        .await
        .map_err(|error| error.to_string())?
}

pub fn discover_ssh_environments() -> Result<Vec<SshEnvironment>, String> {
    let config_path = ssh_config_path()?;
    let content = match fs::read_to_string(&config_path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err("Misty could not read ~/.ssh/config.".to_owned()),
    };
    Ok(parse_ssh_config(&content, &config_path))
}

fn parse_ssh_config(content: &str, config_path: &Path) -> Vec<SshEnvironment> {
    #[derive(Default)]
    struct Block {
        aliases: Vec<String>,
        host: Option<String>,
        user: Option<String>,
        port: Option<u16>,
    }

    fn finish(block: &mut Block, config_path: &Path, output: &mut Vec<SshEnvironment>) {
        for alias in block.aliases.drain(..) {
            if !safe_ssh_alias(&alias) {
                continue;
            }
            let host = block.host.clone().unwrap_or_else(|| alias.clone());
            if !safe_ssh_host(&host) {
                continue;
            }
            let user = block.user.clone().filter(|value| safe_ssh_user(value));
            output.push(SshEnvironment {
                id: alias.clone(),
                label: alias,
                host,
                user,
                port: block.port.unwrap_or(22),
                config_path: config_path.to_string_lossy().into_owned(),
                device_local: true,
                agent_tools: "device_local".to_owned(),
            });
        }
        block.host = None;
        block.user = None;
        block.port = None;
    }

    let mut output = Vec::new();
    let mut block = Block::default();
    for raw_line in content.lines() {
        let line = strip_ssh_comment(raw_line).trim();
        if line.is_empty() {
            continue;
        }
        let Some((keyword, value)) = split_ssh_directive(line) else {
            continue;
        };
        if keyword.eq_ignore_ascii_case("host") {
            finish(&mut block, config_path, &mut output);
            block.aliases = value
                .split_whitespace()
                .map(trim_ssh_quotes)
                .filter(|alias| !alias.contains(['*', '?', '!']))
                .map(str::to_owned)
                .collect();
        } else if !block.aliases.is_empty() {
            match keyword.to_ascii_lowercase().as_str() {
                "hostname" if block.host.is_none() => {
                    block.host = Some(trim_ssh_quotes(value).to_owned())
                }
                "user" if block.user.is_none() => {
                    block.user = Some(trim_ssh_quotes(value).to_owned())
                }
                "port" if block.port.is_none() => {
                    block.port = value.trim().parse::<u16>().ok().filter(|port| *port > 0)
                }
                _ => {}
            }
        }
    }
    finish(&mut block, config_path, &mut output);
    output.sort_by(|left, right| left.label.to_lowercase().cmp(&right.label.to_lowercase()));
    output.dedup_by(|left, right| left.id == right.id);
    output
}

pub fn ssh_command_for_connection(
    connection: &SshConnectionRequest,
) -> Result<CommandBuilder, String> {
    let environment = resolve_connection(connection)?;
    require_known_host(&environment)?;
    let known_hosts = known_hosts_path()?;
    let mut command = CommandBuilder::new("ssh");
    for argument in ssh_argv(connection, &environment, &known_hosts) {
        command.arg(argument);
    }
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    Ok(command)
}

fn ssh_argv(
    connection: &SshConnectionRequest,
    environment: &SshEnvironment,
    known_hosts: &Path,
) -> Vec<String> {
    let mut arguments = vec![
        "-o".to_owned(),
        "StrictHostKeyChecking=yes".to_owned(),
        "-o".to_owned(),
        format!("UserKnownHostsFile={}", known_hosts.to_string_lossy()),
        "-o".to_owned(),
        "UpdateHostKeys=no".to_owned(),
        "-tt".to_owned(),
    ];
    match connection {
        SshConnectionRequest::Configured { id } => arguments.push(id.clone()),
        SshConnectionRequest::Direct { .. } => {
            arguments.push("-p".to_owned());
            arguments.push(environment.port.to_string());
            arguments.push(match environment.user.as_deref() {
                Some(user) => format!("{user}@{}", environment.host),
                None => environment.host.clone(),
            });
        }
    }
    arguments
}

fn ssh_preflight(connection: &SshConnectionRequest) -> Result<SshHostKeyStatus, String> {
    let environment = resolve_connection(connection)?;
    let known = known_host_keys(&environment)?;
    let scanned = scan_host_keys(&environment)?;
    let known_fingerprints = fingerprints_for_lines(&known)?;
    let scanned_fingerprints = fingerprints_for_lines(&scanned)?;
    if scanned_fingerprints.is_empty() {
        if !known_fingerprints.is_empty() {
            return Ok(SshHostKeyStatus {
                state: "trusted".to_owned(),
                fingerprints: known_fingerprints,
                message: "Host identity is pinned in your device known_hosts file; OpenSSH will verify it while connecting.".to_owned(),
            });
        }
        return Ok(SshHostKeyStatus {
            state: "unavailable".to_owned(),
            fingerprints: known_fingerprints,
            message: "The host did not provide a key. Check the address, port, and network."
                .to_owned(),
        });
    }
    if known_fingerprints.is_empty() {
        return Ok(SshHostKeyStatus {
            state: "confirmation_required".to_owned(),
            fingerprints: scanned_fingerprints,
            message: "Confirm this host fingerprint before Misty connects.".to_owned(),
        });
    }
    if known_fingerprints
        .iter()
        .any(|fingerprint| scanned_fingerprints.contains(fingerprint))
    {
        return Ok(SshHostKeyStatus {
            state: "trusted".to_owned(),
            fingerprints: scanned_fingerprints,
            message: "Host identity verified with your device known_hosts file.".to_owned(),
        });
    }
    Ok(SshHostKeyStatus {
        state: "mismatch".to_owned(),
        fingerprints: scanned_fingerprints,
        message:
            "The host key changed. Misty will not connect until you inspect known_hosts manually."
                .to_owned(),
    })
}

fn trust_ssh_host(request: &SshTrustRequest) -> Result<SshHostKeyStatus, String> {
    let environment = resolve_connection(&request.connection)?;
    let scanned = scan_host_keys(&environment)?;
    let wanted = request.fingerprint.trim();
    let selected = scanned
        .iter()
        .find(|line| fingerprint_for_line(line).ok().as_deref() == Some(wanted))
        .ok_or_else(|| "The host fingerprint changed before confirmation. Try again.".to_owned())?;
    let path = known_hosts_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| "Misty could not prepare ~/.ssh.".to_owned())?;
        set_private_directory_permissions(parent)?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|_| "Misty could not update ~/.ssh/known_hosts.".to_owned())?;
    writeln!(file, "{selected}")
        .map_err(|_| "Misty could not update ~/.ssh/known_hosts.".to_owned())?;
    set_private_file_permissions(&path)?;
    ssh_preflight(&request.connection)
}

fn resolve_connection(connection: &SshConnectionRequest) -> Result<SshEnvironment, String> {
    match connection {
        SshConnectionRequest::Configured { id } => resolve_environment(id),
        SshConnectionRequest::Direct { host, user, port } => {
            if !safe_ssh_host(host)
                || user.as_deref().is_some_and(|value| !safe_ssh_user(value))
                || *port == 0
            {
                return Err("The SSH connection is invalid.".to_owned());
            }
            let label = match user.as_deref() {
                Some(user) => format!("{user}@{host}"),
                None => host.clone(),
            };
            Ok(SshEnvironment {
                id: format!("direct:{label}:{port}"),
                label,
                host: host.clone(),
                user: user.clone(),
                port: *port,
                config_path: String::new(),
                device_local: true,
                agent_tools: "device_local".to_owned(),
            })
        }
    }
}

fn resolve_environment(environment_id: &str) -> Result<SshEnvironment, String> {
    if !safe_ssh_alias(environment_id) {
        return Err("The SSH environment is invalid.".to_owned());
    }
    discover_ssh_environments()?
        .into_iter()
        .find(|environment| environment.id == environment_id)
        .ok_or_else(|| "The SSH environment is no longer present in ~/.ssh/config.".to_owned())
}

fn require_known_host(environment: &SshEnvironment) -> Result<(), String> {
    if known_host_keys(environment)?.is_empty() {
        return Err("Confirm the SSH host fingerprint before connecting.".to_owned());
    }
    Ok(())
}

fn known_host_keys(environment: &SshEnvironment) -> Result<Vec<String>, String> {
    let path = known_hosts_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let output = Command::new("ssh-keygen")
        .arg("-F")
        .arg(known_host_lookup(environment))
        .arg("-f")
        .arg(&path)
        .output()
        .map_err(|_| "OpenSSH ssh-keygen is required for host verification.".to_owned())?;
    if !output.status.success() && output.status.code() != Some(1) {
        return Err("Misty could not inspect ~/.ssh/known_hosts.".to_owned());
    }
    Ok(public_key_lines(&String::from_utf8_lossy(&output.stdout)))
}

fn scan_host_keys(environment: &SshEnvironment) -> Result<Vec<String>, String> {
    let output = Command::new("ssh-keyscan")
        .arg("-T")
        .arg(SSH_TIMEOUT_SECONDS)
        .arg("-p")
        .arg(environment.port.to_string())
        .arg(&environment.host)
        .output()
        .map_err(|_| "OpenSSH ssh-keyscan is required for fingerprint confirmation.".to_owned())?;
    Ok(public_key_lines(&String::from_utf8_lossy(&output.stdout)))
}

fn public_key_lines(value: &str) -> Vec<String> {
    value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter(|line| {
            let mut fields = line.split_whitespace();
            fields.next().is_some()
                && fields
                    .next()
                    .is_some_and(|kind| kind.starts_with("ssh-") || kind.starts_with("ecdsa-"))
                && fields.next().is_some()
        })
        .map(str::to_owned)
        .collect()
}

fn fingerprints_for_lines(lines: &[String]) -> Result<Vec<String>, String> {
    let mut fingerprints = BTreeSet::new();
    for line in lines {
        fingerprints.insert(fingerprint_for_line(line)?);
    }
    Ok(fingerprints.into_iter().collect())
}

fn fingerprint_for_line(line: &str) -> Result<String, String> {
    let mut child = Command::new("ssh-keygen")
        .arg("-lf")
        .arg("-")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "OpenSSH ssh-keygen is required for host verification.".to_owned())?;
    child
        .stdin
        .take()
        .ok_or_else(|| "Host fingerprint input is unavailable.".to_owned())?
        .write_all(line.as_bytes())
        .map_err(|_| "Host fingerprint input failed.".to_owned())?;
    let output = child
        .wait_with_output()
        .map_err(|_| "Host fingerprint verification failed.".to_owned())?;
    if !output.status.success() {
        return Err("Host fingerprint verification failed.".to_owned());
    }
    String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .nth(1)
        .map(str::to_owned)
        .ok_or_else(|| "Host fingerprint verification failed.".to_owned())
}

fn known_host_lookup(environment: &SshEnvironment) -> String {
    if environment.port == 22 {
        environment.host.clone()
    } else {
        format!("[{}]:{}", environment.host, environment.port)
    }
}

fn ssh_config_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".ssh").join("config"))
        .ok_or_else(|| "Misty could not locate the device home directory.".to_owned())
}

fn known_hosts_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".ssh").join("known_hosts"))
        .ok_or_else(|| "Misty could not locate the device home directory.".to_owned())
}

fn safe_ssh_alias(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && !value.starts_with('-')
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
}

fn safe_ssh_host(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && !value.starts_with('-')
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || ".:_-".contains(character))
}

fn safe_ssh_user(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && !value.starts_with('-')
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._-".contains(character))
}

fn split_ssh_directive(line: &str) -> Option<(&str, &str)> {
    let split = line.find(|character: char| character.is_ascii_whitespace() || character == '=')?;
    let keyword = line[..split].trim();
    let value = line[split..]
        .trim_start_matches(|character: char| character.is_ascii_whitespace() || character == '=')
        .trim();
    (!keyword.is_empty() && !value.is_empty()).then_some((keyword, value))
}

fn strip_ssh_comment(line: &str) -> &str {
    let mut single = false;
    let mut double = false;
    for (index, character) in line.char_indices() {
        match character {
            '\'' if !double => single = !single,
            '"' if !single => double = !double,
            '#' if !single && !double => return &line[..index],
            _ => {}
        }
    }
    line
}

fn trim_ssh_quotes(value: &str) -> &str {
    value
        .trim()
        .trim_matches(|character| character == '\'' || character == '"')
}

#[cfg(unix)]
fn set_private_directory_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| "Misty could not secure ~/.ssh.".to_owned())
}

#[cfg(not(unix))]
fn set_private_directory_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn set_private_file_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|_| "Misty could not secure ~/.ssh/known_hosts.".to_owned())
}

#[cfg(not(unix))]
fn set_private_file_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests;
