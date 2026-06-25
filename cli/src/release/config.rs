use std::env;

use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use url::Url;

pub fn build() -> Result<Value> {
    let public_key = normalize_public_key(&required("TAURI_UPDATER_PUBLIC_KEY")?)?;
    let endpoint = validate_https_url(
        "TAURI_UPDATER_ENDPOINT",
        &required("TAURI_UPDATER_ENDPOINT")?,
    )?;
    let connect = csp_origins(
        "TAURI_CSP_CONNECT_SOURCES",
        &required("TAURI_CSP_CONNECT_SOURCES")?,
        &["https", "wss"],
    )?;
    let images = csp_origins(
        "TAURI_CSP_IMAGE_SOURCES",
        &required("TAURI_CSP_IMAGE_SOURCES")?,
        &["https"],
    )?;
    let csp = [
        "default-src 'self' customprotocol: asset:".to_owned(),
        format!(
            "connect-src 'self' ipc: asset: http://asset.localhost http://ipc.localhost {}",
            connect.join(" ")
        ),
        "frame-src 'self' asset: http://asset.localhost customprotocol: misty-extension: http://misty-extension.localhost".to_owned(),
        format!(
            "img-src 'self' asset: http://asset.localhost blob: data: {}",
            images.join(" ")
        ),
        "font-src 'self' data:".to_owned(),
        "style-src 'self' 'unsafe-inline'".to_owned(),
        "script-src 'self'".to_owned(),
        "worker-src 'self' blob:".to_owned(),
    ]
    .join("; ");

    let mut windows = json!({});
    if let Ok(thumbprint) = env::var("WINDOWS_CERTIFICATE_THUMBPRINT") {
        let thumbprint = thumbprint.trim();
        if !thumbprint.is_empty() {
            if !regex::Regex::new(r"(?i)^[a-f0-9]{40}$")?.is_match(thumbprint) {
                bail!("WINDOWS_CERTIFICATE_THUMBPRINT must be 40 hexadecimal characters");
            }
            let timestamp = required("WINDOWS_TIMESTAMP_URL")?;
            let timestamp = validate_https_url("WINDOWS_TIMESTAMP_URL", &timestamp)?;
            windows = json!({
                "certificateThumbprint": thumbprint,
                "digestAlgorithm": "sha256",
                "timestampUrl": timestamp
            });
        }
    }

    Ok(json!({
        "app": { "security": { "csp": csp } },
        "bundle": {
            "createUpdaterArtifacts": true,
            "windows": windows
        },
        "plugins": {
            "updater": {
                "pubkey": public_key,
                "endpoints": [endpoint],
                "windows": { "installMode": "passive" }
            }
        }
    }))
}

fn required(name: &str) -> Result<String> {
    let value = env::var(name).unwrap_or_default();
    let value = value.trim();
    if value.is_empty() {
        bail!("{name} is required for a desktop release");
    }
    Ok(value.to_owned())
}

fn normalize_public_key(raw: &str) -> Result<String> {
    let direct = meaningful_lines(raw);
    let lines = if direct.last().is_some_and(|line| line.starts_with("RW")) {
        direct
    } else {
        let compact = raw.split_whitespace().collect::<String>();
        let decoded = STANDARD
            .decode(compact)
            .context("TAURI_UPDATER_PUBLIC_KEY is neither a public key nor canonical base64")?;
        meaningful_lines(std::str::from_utf8(&decoded)?)
    };
    if lines.len() > 2
        || !lines.last().is_some_and(|line| line.starts_with("RW"))
        || lines.last().map_or(0, |line| line.len()) < 48
    {
        bail!("TAURI_UPDATER_PUBLIC_KEY must contain the generated Tauri public key");
    }
    Ok(raw.to_owned())
}

fn meaningful_lines(raw: &str) -> Vec<String> {
    raw.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect()
}

fn validate_https_url(name: &str, raw: &str) -> Result<String> {
    let parsed = Url::parse(raw).with_context(|| format!("{name} is not a valid URL"))?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
    {
        bail!("{name} must be an HTTPS URL without credentials or a fragment");
    }
    Ok(raw.to_owned())
}

fn csp_origins(name: &str, raw: &str, protocols: &[&str]) -> Result<Vec<String>> {
    raw.split(|character: char| character.is_whitespace() || character == ',')
        .filter(|value| !value.is_empty())
        .map(|value| {
            if value.contains('*') {
                bail!("{name} cannot contain wildcard sources");
            }
            let parsed = Url::parse(value).with_context(|| format!("{name} has an invalid URL"))?;
            if !protocols.contains(&parsed.scheme())
                || !parsed.username().is_empty()
                || parsed.password().is_some()
                || !matches!(parsed.path(), "" | "/")
                || parsed.query().is_some()
                || parsed.fragment().is_some()
            {
                bail!("{name} entries must be approved origins without paths or credentials");
            }
            Ok(parsed.origin().ascii_serialization())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csp_sources_reject_paths_and_wildcards() {
        assert!(csp_origins("TEST", "https://api.mistysys.com", &["https"]).is_ok());
        assert!(csp_origins("TEST", "https://api.mistysys.com/path", &["https"]).is_err());
        assert!(csp_origins("TEST", "https://*.mistysys.com", &["https"]).is_err());
    }
}
