use super::{hostname, id, request};
use crate::{
    environment::{self, Target},
    workspace::Workspace,
};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::collections::BTreeMap;

#[derive(Debug, clap::Args)]
pub struct Options {
    /// Environment to provision. Production uses a host-installed cloudflared connector.
    #[arg(long, value_enum, default_value = "dev")]
    pub target: Target,
    /// Apply the displayed Cloudflare resource plan.
    #[arg(long)]
    apply: bool,
    #[arg(long)]
    account: Option<String>,
    #[arg(long)]
    zone: Option<String>,
    #[arg(long)]
    hostname: Option<String>,
    /// Override the target's saved or generated tunnel name.
    #[arg(long)]
    tunnel_name: Option<String>,
}

pub fn setup(workspace: &Workspace, options: Options) -> Result<()> {
    if options.target == Target::Dev {
        environment::init(workspace, Target::Dev)?;
        crate::server::initialize_development_secrets(workspace)?;
    }
    let values = environment::read(workspace, options.target)?;
    let mut credentials = values.clone();
    // Only credentials inherit the CLI/shell environment. Routing stays target-scoped.
    for key in [
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_ZONE_ID",
    ] {
        if let Ok(value) = std::env::var(key) {
            if !value.is_empty() {
                credentials.insert(key.to_owned(), value);
            }
        }
    }
    let required = |key: &str| {
        credentials
            .get(key)
            .filter(|v| !v.is_empty())
            .cloned()
            .with_context(|| {
                format!(
                    "{key} is missing; use misty env set {} {key} (value from stdin)",
                    options.target.label()
                )
            })
    };
    let token = required("CLOUDFLARE_API_TOKEN")?;
    let account = options
        .account
        .clone()
        .map(Ok)
        .unwrap_or_else(|| required("CLOUDFLARE_ACCOUNT_ID"))?;
    let zone = options
        .zone
        .clone()
        .map(Ok)
        .unwrap_or_else(|| required("CLOUDFLARE_ZONE_ID"))?;
    provision(
        workspace,
        options,
        values,
        token.clone(),
        account,
        zone,
        |method, path, body| request(&token, method, path, body),
    )
}

fn provision(
    workspace: &Workspace,
    options: Options,
    values: BTreeMap<String, String>,
    token: String,
    account: String,
    zone: String,
    mut request: impl FnMut(&str, &str, Option<Value>) -> Result<Value>,
) -> Result<()> {
    let target = options.target;
    let host = selected_hostname(&options, &values)?;
    let service = service(target, &values)?;
    id(&account)?;
    id(&zone)?;
    hostname(&host)?;
    let zone_info = request("GET", &format!("zones/{zone}"), None)?;
    let zone_name = zone_info["name"].as_str().context("zone has no name")?;
    if zone_info["account"]["id"] != account
        || !(host == zone_name || host.ends_with(&format!(".{zone_name}")))
    {
        bail!("hostname, zone, and account do not match");
    }
    let name = options
        .tunnel_name
        .clone()
        .or_else(|| {
            values
                .get("MISTY_CLOUDFLARE_TUNNEL_NAME")
                .filter(|v| !v.is_empty())
                .cloned()
        })
        .unwrap_or_else(|| match target {
            Target::Dev => format!("misty-{}", host.replace('.', "-")),
            Target::Prod => format!("misty-prod-{}", host.replace('.', "-")),
        });
    if name.trim().is_empty() || name.contains(['\n', '\r', '\0', '\'']) {
        bail!("invalid tunnel name");
    }
    let mut query = url::form_urlencoded::Serializer::new(String::new());
    query
        .append_pair("name", &name)
        .append_pair("is_deleted", "false");
    let tunnels = request(
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
    let current = if let Some(tid) = existing_id {
        if matches[0]["config_src"] == "local" {
            bail!("existing tunnel is locally managed; choose another tunnel name");
        }
        request(
            "GET",
            &format!("accounts/{account}/cfd_tunnel/{tid}/configurations"),
            None,
        )?
    } else {
        json!({})
    };
    if target == Target::Prod
        && current["config"]["ingress"]
            .as_array()
            .is_some_and(|rules| {
                rules
                    .iter()
                    .any(|rule| rule["service"] == "http://misty-api:8080")
            })
    {
        bail!("this tunnel serves development; choose a separate production tunnel name");
    }
    let config = merge_ingress(&current, &host, &service)?;
    let worker = if target == Target::Dev {
        let subdomain = request(
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
        Some((worker_name, worker_host))
    } else {
        None
    };
    println!("Cloudflare {} plan: account {account}, zone {zone_name}\nTunnel: {name}\nRoute: https://{host} → {service}\nDNS: proxied CNAME to the tunnel", target.label());
    if worker.is_some() {
        println!("Worker: deploy separately with misty server deploy");
    }
    if !options.apply {
        println!(
            "No remote changes made. Repeat with --apply to provision and save configuration."
        );
        return Ok(());
    }
    let tunnel = if let Some(tid) = existing_id {
        tid.to_owned()
    } else {
        request(
            "POST",
            &format!("accounts/{account}/cfd_tunnel"),
            Some(json!({"name":name,"config_src":"cloudflare"})),
        )?["id"]
            .as_str()
            .context("created tunnel has no ID")?
            .to_owned()
    };
    let path = format!("accounts/{account}/cfd_tunnel/{tunnel}/configurations");
    request("PUT", &path, Some(json!({"config":config})))?;
    if records.is_empty() {
        request(
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
            "PATCH",
            &format!("zones/{zone}/dns_records/{record_id}"),
            Some(json!({"proxied":true})),
        )?;
    }
    let tunnel_token = request(
        "GET",
        &format!("accounts/{account}/cfd_tunnel/{tunnel}/token"),
        None,
    )?
    .as_str()
    .context("missing tunnel token")?
    .to_owned();
    let mut settings = vec![
        ("CLOUDFLARE_ACCOUNT_ID", account),
        ("CLOUDFLARE_ZONE_ID", zone),
        ("CLOUDFLARE_API_TOKEN", token),
        ("CLOUDFLARE_TUNNEL_TOKEN", tunnel_token),
        ("MISTY_CLOUDFLARE_TUNNEL_NAME", name),
    ];
    if let Some((worker_name, worker_host)) = worker {
        settings.extend([
            ("MISTY_CLOUDFLARE_WORKER_NAME", worker_name),
            ("MISTY_CLOUDFLARE_WORKER_HOST", worker_host),
            ("MISTY_DEV_API_ORIGIN", format!("https://{host}")),
            ("MISTY_DEV_API_TUNNEL_HOSTNAME", host),
        ]);
    } else {
        settings.push(("MISTY_PUBLIC_API_URL", format!("https://{host}/v1")));
    }
    for (key, val) in settings {
        environment::set(workspace, target, key, &val)?;
    }
    match target {
        Target::Dev => println!("Cloudflare configured. Next: misty server up; misty server deploy; misty doctor cloudflare"),
        Target::Prod => println!("Production tunnel configured. Configuration saved under server/.env/prod/.\nNext: misty server prod up; start cloudflared on the VPS host using the saved CLOUDFLARE_TUNNEL_TOKEN.\nSee cli/README.md#production-cloudflare-tunnel for connector setup."),
    }
    Ok(())
}
fn merge_ingress(
    current: &Value,
    host: &str,
    service: &str,
) -> Result<serde_json::Map<String, Value>> {
    let mut config = current["config"].as_object().cloned().unwrap_or_default();
    let ingress = config.entry("ingress").or_insert(json!([]));
    let rules = ingress
        .as_array_mut()
        .context("invalid ingress configuration")?;
    if let Some(rule) = rules.iter().find(|r| r["hostname"] == host) {
        if rule["service"] != service {
            bail!("existing tunnel route conflicts; other routes were preserved");
        }
    } else {
        let position = rules
            .iter()
            .position(|r| r.get("hostname").is_none())
            .unwrap_or(rules.len());
        rules.insert(position, json!({"hostname":host,"service":service}));
        if !rules.iter().any(|r| r.get("hostname").is_none()) {
            rules.push(json!({"service":"http_status:404"}));
        }
    }
    Ok(config)
}

fn selected_hostname(options: &Options, values: &BTreeMap<String, String>) -> Result<String> {
    if let Some(host) = &options.hostname {
        return Ok(host.to_ascii_lowercase());
    }
    let host = match options.target {
        Target::Dev => std::env::var("MISTY_DEV_API_TUNNEL_HOSTNAME")
            .ok()
            .filter(|host| !host.is_empty())
            .or_else(|| values.get("MISTY_DEV_API_TUNNEL_HOSTNAME").cloned()),
        Target::Prod => values
            .get("MISTY_PUBLIC_API_URL")
            .and_then(|value| url::Url::parse(value).ok())
            .filter(|url| {
                url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
            })
            .and_then(|url| url.host_str().map(str::to_owned)),
    };
    host.filter(|host| !host.is_empty())
        .map(|host| host.to_ascii_lowercase())
        .context("supply --hostname for this target's public API hostname")
}

fn service(target: Target, values: &BTreeMap<String, String>) -> Result<String> {
    if target == Target::Dev {
        return Ok("http://misty-api:8080".to_owned());
    }
    let port: u16 = values
        .get("MISTY_HOST_PORT")
        .map(String::as_str)
        .unwrap_or("8081")
        .parse()
        .context("production MISTY_HOST_PORT must be a port from 1 to 65535")?;
    if port == 0 {
        bail!("production MISTY_HOST_PORT must be a port from 1 to 65535");
    }
    Ok(format!("http://127.0.0.1:{port}"))
}

#[cfg(test)]
mod tests;
