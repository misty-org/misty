//! Tunnel ingress rules: the hostname and the local service they route to.

use super::*;

pub(super) fn merge_ingress(
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

pub(super) fn selected_hostname(
    options: &Options,
    values: &BTreeMap<String, String>,
) -> Result<String> {
    if let Some(host) = &options.hostname {
        return Ok(host.to_ascii_lowercase());
    }
    std::env::var("MISTY_DEV_API_TUNNEL_HOSTNAME")
        .ok()
        .filter(|host| !host.is_empty())
        .or_else(|| values.get("MISTY_DEV_API_TUNNEL_HOSTNAME").cloned())
        .filter(|host| !host.is_empty())
        .map(|host| host.to_ascii_lowercase())
        .context("supply --hostname for the development API hostname")
}

/// The development tunnel routes to the API container on the dev network.
pub(super) fn service() -> String {
    "http://misty-api:8080".to_owned()
}
