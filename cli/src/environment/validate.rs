//! Validation and status reports for one target's environment.

use super::*;

pub fn validate(workspace: &Workspace, target: Target) -> Result<()> {
    read_cli_files(workspace)?;
    let values = effective(workspace, target)?;
    let missing = required(target)
        .iter()
        .filter(|name| {
            values
                .get(**name)
                .is_none_or(|value| value.trim().is_empty())
        })
        .copied()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        bail!(
            "{} environment is missing required values: {}",
            target.label(),
            missing.join(", ")
        );
    }

    let billing = values
        .get("MISTY_BILLING_ADAPTER")
        .map(|s| s.trim())
        .unwrap_or("none");
    if target == Target::Prod && billing != "http" {
        bail!("Production requires MISTY_BILLING_ADAPTER=http");
    }
    if !matches!(billing, "" | "none" | "null" | "http") {
        bail!("Unknown MISTY_BILLING_ADAPTER mode");
    }
    if billing == "http" {
        let raw = values
            .get("MISTY_BILLING_URL")
            .context("MISTY_BILLING_URL is required")?;
        let url = url::Url::parse(raw).context("Invalid MISTY_BILLING_URL")?;
        let local = target == Target::Dev
            && matches!(
                url.host_str(),
                Some("127.0.0.1" | "localhost" | "[::1]" | "host.docker.internal")
            );
        if (url.scheme() != "https" && !(url.scheme() == "http" && local))
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            bail!("Billing URL requires HTTPS, except for the local development host");
        }
        if values
            .get("MISTY_BILLING_SECRET")
            .is_none_or(|secret| secret.len() < 32)
        {
            bail!("MISTY_BILLING_SECRET must contain at least 32 bytes");
        }
    }
    if target == Target::Dev {
        {
            let name = "MISTY_DEV_API_ORIGIN";
            let value = values.get(name).context("missing API origin")?;
            let url = url::Url::parse(value).context("API origin must be a valid HTTPS origin")?;
            if url.scheme() != "https"
                || url.host_str().is_none()
                || !matches!(url.path(), "" | "/")
                || url.query().is_some()
                || url.fragment().is_some()
                || !url.username().is_empty()
                || url.password().is_some()
            {
                bail!("{name} must be an HTTPS origin without a path or credentials");
            }
            if url.host_str()
                != values
                    .get("MISTY_DEV_API_TUNNEL_HOSTNAME")
                    .map(String::as_str)
            {
                bail!("API origin and tunnel hostname must match");
            }
        }
        if let Some(port) = values.get("MISTY_HOST_PORT") {
            if port.parse::<u16>().ok().is_none_or(|p| p == 0) {
                bail!("MISTY_HOST_PORT must be a port between 1 and 65535");
            }
        }
    }
    if target == Target::Prod {
        let placeholders = values
            .iter()
            .filter(|(_, value)| is_placeholder(value))
            .map(|(name, _)| name.as_str())
            .collect::<Vec<_>>();
        if !placeholders.is_empty() {
            bail!(
                "prod environment contains placeholder values: {}",
                placeholders.join(", ")
            );
        }
    }
    if target == Target::Staging {
        if values.get("MISTY_ENVIRONMENT").map(String::as_str) != Some("staging") {
            bail!("staging environment must set MISTY_ENVIRONMENT=staging");
        }
        if let Some(port) = values.get("MISTY_HOST_PORT") {
            if port.parse::<u16>().ok().is_none_or(|p| p == 0) {
                bail!("MISTY_HOST_PORT must be a port between 1 and 65535");
            }
        }
        let placeholders = values
            .iter()
            .filter(|(_, value)| is_placeholder(value))
            .map(|(name, _)| name.as_str())
            .collect::<Vec<_>>();
        if !placeholders.is_empty() {
            bail!(
                "staging environment contains placeholder values: {}",
                placeholders.join(", ")
            );
        }
    }
    Ok(())
}

pub fn check(workspace: &Workspace, target: Target) -> Result<()> {
    validate(workspace, target)?;
    println!("{} environment is valid.", target.label());
    Ok(())
}

pub fn status(workspace: &Workspace, target: Target) -> Result<()> {
    let values = read(workspace, target)?;
    println!("{} environment", target.label());
    for spec in FILES {
        println!("  {}", spec.path);
        for name in spec.names {
            let state = match values.get(*name) {
                Some(value) if !value.trim().is_empty() => "set",
                Some(_) => "empty",
                None => "unset",
            };
            println!("    {name:<48} {state}");
        }
    }
    let missing = required(target)
        .iter()
        .filter(|name| {
            values
                .get(**name)
                .is_none_or(|value| value.trim().is_empty())
        })
        .copied()
        .collect::<Vec<_>>();
    if missing.is_empty() {
        println!("  required values                    ready");
    } else {
        println!(
            "  missing required                   {}",
            missing.join(", ")
        );
    }
    Ok(())
}

fn is_placeholder(value: &str) -> bool {
    let value = value.trim();
    let lower = value.to_ascii_lowercase();
    !value.is_empty()
        && ((value.starts_with('<') && value.ends_with('>'))
            || lower.contains("replace-me")
            || lower.contains("replace-with")
            || matches!(lower.as_str(), "todo" | "tbd" | "changeme"))
}
