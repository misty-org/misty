use crate::{
    environment::{self, Target},
    workspace::Workspace,
};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
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

pub fn setup(
    workspace: &Workspace,
    account: Option<String>,
    zone: Option<String>,
    host: Option<String>,
    apply: bool,
) -> Result<()> {
    environment::init(workspace, Target::Dev)?;
    crate::server::initialize_development_secrets(workspace)?;
    let values = environment::read(workspace, Target::Dev)?;
    let token = value(&values, "CLOUDFLARE_API_TOKEN")?;
    let account = account
        .map(Ok)
        .unwrap_or_else(|| value(&values, "CLOUDFLARE_ACCOUNT_ID"))?;
    let zone = zone
        .map(Ok)
        .unwrap_or_else(|| value(&values, "CLOUDFLARE_ZONE_ID"))?;
    let host = host
        .map(Ok)
        .unwrap_or_else(|| value(&values, "MISTY_DEV_API_TUNNEL_HOSTNAME"))?
        .to_ascii_lowercase();
    id(&account)?;
    id(&zone)?;
    hostname(&host)?;
    let zone_info = request(&token, "GET", &format!("zones/{zone}"), None)?;
    let zone_name = zone_info["name"].as_str().context("zone has no name")?;
    if zone_info["account"]["id"] != account
        || !(host == zone_name || host.ends_with(&format!(".{zone_name}")))
    {
        bail!("hostname, zone, and account do not match");
    }
    let name = values
        .get("MISTY_CLOUDFLARE_TUNNEL_NAME")
        .filter(|v| !v.is_empty())
        .cloned()
        .unwrap_or_else(|| format!("misty-{}", host.replace('.', "-")));
    let mut query = url::form_urlencoded::Serializer::new(String::new());
    query
        .append_pair("name", &name)
        .append_pair("is_deleted", "false");
    let tunnels = request(
        &token,
        "GET",
        &format!("accounts/{account}/cfd_tunnel?{}", query.finish()),
        None,
    )?;
    let matches: Vec<&Value> = tunnels
        .as_array()
        .context("invalid tunnel list")?
        .iter()
        .filter(|v| v["name"] == name)
        .collect();
    if matches.len() > 1 {
        bail!("multiple tunnels have this name; choose a unique tunnel name");
    }
    let dns = request(
        &token,
        "GET",
        &format!("zones/{zone}/dns_records?name={host}"),
        None,
    )?;
    let records = dns.as_array().context("invalid DNS response")?;
    if records.len() > 1 {
        bail!("multiple DNS records exist for {host}; resolve the conflict first");
    }
    let existing_id = matches.first().and_then(|v| v["id"].as_str());
    if let Some(record) = records.first() {
        if existing_id.is_none_or(|tid| {
            record["type"] != "CNAME" || record["content"] != format!("{tid}.cfargotunnel.com")
        }) {
            bail!("DNS hostname is already used by another resource; no changes made");
        }
    }
    let subdomain = request(
        &token,
        "GET",
        &format!("accounts/{account}/workers/subdomain"),
        None,
    )?;
    let subdomain = subdomain["subdomain"]
        .as_str()
        .context("Enable a workers.dev subdomain for this Cloudflare account first")?;
    let worker_name = values
        .get("MISTY_CLOUDFLARE_WORKER_NAME")
        .filter(|v| !v.is_empty())
        .cloned()
        .unwrap_or_else(|| format!("misty-{}", host.replace('.', "-")));
    if worker_name.is_empty()
        || worker_name.len() > 63
        || !worker_name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        bail!(
            "set MISTY_CLOUDFLARE_WORKER_NAME to at most 63 lowercase letters, digits, or hyphens"
        );
    }
    let worker_host = format!("{worker_name}.{subdomain}.workers.dev");
    println!("Cloudflare plan: account {account}, zone {zone_name}\nTunnel: {name}\nRoute: https://{host} → http://misty-api:8080\nDNS: proxied CNAME to the tunnel\nWorker: deploy separately with misty server deploy");
    if !apply {
        println!(
            "No remote changes made. Repeat with --apply to provision and save configuration."
        );
        return Ok(());
    }
    let tunnel = if let Some(tid) = existing_id {
        tid.to_owned()
    } else {
        request(
            &token,
            "POST",
            &format!("accounts/{account}/cfd_tunnel"),
            Some(json!({"name":name,"config_src":"cloudflare"})),
        )?["id"]
            .as_str()
            .context("created tunnel has no ID")?
            .to_owned()
    };
    let path = format!("accounts/{account}/cfd_tunnel/{tunnel}/configurations");
    let current = request(&token, "GET", &path, None)?;
    let config = merge_ingress(&current, &host)?;
    request(&token, "PUT", &path, Some(json!({"config":config})))?;
    if records.is_empty() {
        request(
            &token,
            "POST",
            &format!("zones/{zone}/dns_records"),
            Some(
                json!({"type":"CNAME","name":host,"content":format!("{tunnel}.cfargotunnel.com"),"proxied":true}),
            ),
        )?;
    }
    if let Some(record) = records.first().filter(|r| r["proxied"] != true) {
        let record_id = record["id"].as_str().context("DNS record has no ID")?;
        request(
            &token,
            "PATCH",
            &format!("zones/{zone}/dns_records/{record_id}"),
            Some(json!({"proxied":true})),
        )?;
    }
    let tunnel_token = request(
        &token,
        "GET",
        &format!("accounts/{account}/cfd_tunnel/{tunnel}/token"),
        None,
    )?
    .as_str()
    .context("missing tunnel token")?
    .to_owned();
    let origin = format!("https://{host}");
    for (key, val) in [
        ("MISTY_CLOUDFLARE_WORKER_NAME", worker_name),
        ("MISTY_CLOUDFLARE_WORKER_HOST", worker_host),
        ("CLOUDFLARE_ACCOUNT_ID", account),
        ("CLOUDFLARE_ZONE_ID", zone),
        ("CLOUDFLARE_API_TOKEN", token),
        ("CLOUDFLARE_TUNNEL_TOKEN", tunnel_token),
        ("MISTY_CLOUDFLARE_TUNNEL_ID", tunnel),
        ("MISTY_CLOUDFLARE_TUNNEL_NAME", name),
        ("MISTY_DEV_API_TUNNEL_HOSTNAME", host),
        ("MISTY_DEV_API_ORIGIN", origin.clone()),
    ] {
        environment::set(workspace, Target::Dev, key, &val)?;
    }
    println!("Cloudflare configured. Next: misty server up; misty server deploy; misty doctor cloudflare");
    Ok(())
}
fn merge_ingress(current: &Value, host: &str) -> Result<serde_json::Map<String, Value>> {
    let mut config = current["config"].as_object().cloned().unwrap_or_default();
    let ingress = config.entry("ingress").or_insert(json!([]));
    let rules = ingress
        .as_array_mut()
        .context("invalid ingress configuration")?;
    if let Some(rule) = rules.iter().find(|r| r["hostname"] == host) {
        if rule["service"] != "http://misty-api:8080" {
            bail!("existing tunnel route conflicts; other routes were preserved");
        }
    } else {
        let position = rules
            .iter()
            .position(|r| r.get("hostname").is_none())
            .unwrap_or(rules.len());
        rules.insert(
            position,
            json!({"hostname":host,"service":"http://misty-api:8080"}),
        );
        if !rules.iter().any(|r| r.get("hostname").is_none()) {
            rules.push(json!({"service":"http_status:404"}));
        }
    }
    Ok(config)
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
    fn rerunning_setup_preserves_unrelated_routes() {
        let before = json!({"config": {"originRequest": {"connectTimeout": 15}, "ingress": [
            {"hostname":"other.example.com", "service":"http://other:80"},
            {"service":"http_status:404"}
        ]}});
        let first = merge_ingress(&before, "api.example.com").unwrap();
        assert_eq!(first["ingress"].as_array().unwrap().len(), 3);
        assert_eq!(first["ingress"][0], before["config"]["ingress"][0]);
        assert_eq!(first["originRequest"], before["config"]["originRequest"]);
        let second = merge_ingress(&json!({"config":first}), "api.example.com").unwrap();
        assert_eq!(first, second);
        assert!(merge_ingress(&before, "other.example.com").is_err());
    }
    #[test]
    fn validates_resource_identifiers() {
        assert!(id("bad/path").is_err());
        assert!(hostname("https://api.example.com").is_err());
        assert!(hostname("api.example.com").is_ok());
        assert!(hostname("a..com").is_err());
    }
}
