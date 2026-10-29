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
