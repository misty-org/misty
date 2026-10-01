mod provisioning;
pub use provisioning::{setup, Options};

use crate::{
    environment::{self, Target},
    workspace::Workspace,
};
use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    io::Write,
    process::{Command, Stdio},
};

// Credentials are passed on stdin, never in command arguments or diagnostics.
fn request(token: &str, method: &str, path: &str, body: Option<Value>) -> Result<Value> {
    request_url(
        token,
        method,
        &format!("https://api.cloudflare.com/client/v4/{path}"),
        body,
    )
}
fn request_url(token: &str, method: &str, path: &str, body: Option<Value>) -> Result<Value> {
    if token.contains(['\n', '\r', '"', '\\']) {
        bail!("invalid Cloudflare token format");
    }
    let mut command = Command::new("curl");
    command.args([
        "--silent",
        "--show-error",
        "--max-time",
        "30",
        "--config",
        "-",
        "--request",
        method,
        "--url",
        path,
    ]);
    let mut config = format!(
        "header = \"Authorization: Bearer {token}\"\nheader = \"Content-Type: application/json\"\n"
    );
    if let Some(body) = body {
        config.push_str(&format!(
            "data = {}\n",
            serde_json::to_string(&body.to_string())?
        ));
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .context("install curl to use Cloudflare setup")?;
    child
        .stdin
        .take()
        .context("could not open curl stdin")?
        .write_all(config.as_bytes())?;
    let output = child.wait_with_output()?;
    if !output.status.success() {
        bail!("Cloudflare request failed or timed out; check connectivity");
    }
    let response: Value =
        serde_json::from_slice(&output.stdout).context("invalid Cloudflare response")?;
    if response["success"] != true {
        let codes: Vec<i64> = response["errors"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|e| e["code"].as_i64())
            .collect();
        bail!("Cloudflare rejected {method} {path} (codes {codes:?}); verify token permissions and account/zone access");
    }
    Ok(response["result"].clone())
}
fn value(values: &BTreeMap<String, String>, name: &str) -> Result<String> {
    std::env::var(name)
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| values.get(name).filter(|v| !v.is_empty()).cloned())
        .with_context(|| format!("{name} is missing; set it in your environment or save it using misty env set dev {name} (value from stdin)"))
}
fn id(value: &str) -> Result<()> {
    if value.len() != 32 || !value.chars().all(|c| c.is_ascii_hexdigit()) {
        bail!("account and zone IDs must contain 32 hexadecimal characters");
    }
    Ok(())
}
fn hostname(value: &str) -> Result<()> {
    if !value.contains('.')
        || value.len() > 253
        || value.split('.').any(|label| {
            label.is_empty()
                || label.len() > 63
                || label.starts_with('-')
                || label.ends_with('-')
                || !label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
    {
        bail!("use a DNS hostname such as api.example.com, without scheme or path");
    }
    Ok(())
}
pub fn check(workspace: &Workspace) -> Result<()> {
    let values = environment::read(workspace, Target::Dev)?;
    let token = value(&values, "CLOUDFLARE_API_TOKEN")?;
    let account = value(&values, "CLOUDFLARE_ACCOUNT_ID")?;
    id(&account)?;
    request(
        &token,
        "GET",
        &format!("accounts/{account}/cfd_tunnel?is_deleted=false&per_page=1"),
        None,
    )?;
    hostname(&value(&values, "MISTY_DEV_API_TUNNEL_HOSTNAME")?)?;
    value(&values, "CLOUDFLARE_TUNNEL_TOKEN")?;
    Ok(())
}
pub fn worker_health(workspace: &Workspace) -> Result<()> {
    let values = environment::read(workspace, Target::Dev)?;
    let token = value(&values, "CLOUDFLARE_API_TOKEN")?;
    let account = value(&values, "CLOUDFLARE_ACCOUNT_ID")?;
    id(&account)?;
    let name = value(&values, "MISTY_CLOUDFLARE_WORKER_NAME")?;
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        bail!("invalid Worker name");
    }
    request(
        &token,
        "GET",
        &format!("accounts/{account}/workers/scripts/{name}/settings"),
        None,
    )?;
    Ok(())
}

pub fn public_health(workspace: &Workspace) -> Result<()> {
    let values = environment::read(workspace, Target::Dev)?;
    let origin = value(&values, "MISTY_DEV_API_ORIGIN")?;
    let parsed = url::Url::parse(&origin)?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        bail!("public API origin must use HTTPS without credentials");
    }
    let output = crate::process::CommandSpec::new("curl")
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--max-time",
            "15",
            &format!("{}/health", origin.trim_end_matches('/')),
        ])
        .capture(&workspace.server)?;
    let health: Value =
        serde_json::from_str(&output).context("public health endpoint did not return JSON")?;
    if health["status"] != "ok" {
        bail!("public API health is not ready");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn api_errors_do_not_echo_remote_messages_or_tokens() {
        use std::io::Read;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut buffer = [0; 4096];
            let length = stream.read(&mut buffer).unwrap();
            let input = String::from_utf8_lossy(&buffer[..length]);
            assert!(input.contains("Authorization: Bearer fixture-token"));
            let body = r#"{"success":false,"errors":[{"code":10000,"message":"fixture-token"}]}"#;
            write!(
                stream,
                "HTTP/1.1 403 Forbidden\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });
        let error = request_url(
            "fixture-token",
            "GET",
            &format!("http://{address}/test"),
            None,
        )
        .unwrap_err()
        .to_string();
        server.join().unwrap();
        assert!(error.contains("10000"));
        assert!(!error.contains("fixture-token"));
    }
    #[test]
    fn validates_resource_identifiers() {
        assert!(id("bad/path").is_err());
        assert!(hostname("https://api.example.com").is_err());
        assert!(hostname("api.example.com").is_ok());
        assert!(hostname("a..com").is_err());
    }
}
