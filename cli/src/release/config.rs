use std::collections::BTreeMap;
use std::env;

use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use url::Url;

/// What a release compiles into the app. There is no built-in server: the person picks one in
/// the setup wizard, so only the website's address is fixed at build time.
pub(super) fn public_environment() -> Result<BTreeMap<String, String>> {
    let web = validate_https_url("MISTY_RELEASE_WEB_URL", &required("MISTY_RELEASE_WEB_URL")?)?;
    Ok(BTreeMap::from([("MISTY_PUBLIC_URL".into(), web)]))
}

/// The release Content Security Policy. The server is chosen in the app, never at build time,
/// and the renderer reaches it, its storage and its collaboration Worker directly (the Spaces
/// socket, note collaboration, signed downloads), so any `https:` and `wss:` origin may be
/// reached, as in development. Plain `http:` and `ws:` stay closed except the agent runtime's
/// live relay on this computer. Account cookies live in Rust, never in the WebView, and only the
/// app's own scripts run (`script-src 'self'`).
pub(super) fn csp() -> String {
    [
        "default-src 'self' customprotocol: asset:",
        // ws://127.0.0.1 is the live transcription relay of the agent runtime on this computer.
        "connect-src 'self' ipc: asset: http://asset.localhost http://ipc.localhost ws://127.0.0.1:* https: wss:",
        "frame-src 'self' asset: http://asset.localhost customprotocol: misty-extension: http://misty-extension.localhost",
        "img-src 'self' asset: http://asset.localhost blob: data: https:",
        "media-src 'self' blob: asset: http://asset.localhost",
        "font-src 'self' data:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "worker-src 'self' blob:",
    ]
    .join("; ")
}

pub fn build() -> Result<Value> {
    let public_key = normalize_public_key(&required("TAURI_UPDATER_PUBLIC_KEY")?)?;
    // The feed always lives on the public repository's latest release.
    let endpoint = super::model::updater_endpoint();
    let csp = csp();

    let mut windows = json!({});
    if let Ok(thumbprint) = env::var("WINDOWS_CERTIFICATE_THUMBPRINT") {
        let thumbprint = thumbprint.trim();
        if !thumbprint.is_empty() {
            if thumbprint.len() != 40 || !thumbprint.bytes().all(|byte| byte.is_ascii_hexdigit()) {
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
            "windows": windows,
            "resources": super::runtime::bundle_settings()["resources"],
            "externalBin": super::runtime::bundle_settings()["externalBin"]
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

/// A build to try before releasing: the same policy, without signing or updater artifacts.
pub(super) fn test_build(agents: bool) -> Value {
    let mut bundle = json!({ "createUpdaterArtifacts": false });
    if agents {
        let runtime = super::runtime::bundle_settings();
        bundle["resources"] = runtime["resources"].clone();
        bundle["externalBin"] = runtime["externalBin"].clone();
    }
    json!({
        "app": { "security": { "csp": csp() } },
        "bundle": bundle
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    fn directive<'a>(csp: &'a str, name: &str) -> Vec<&'a str> {
        csp.split(';')
            .map(str::trim)
            .find(|part| part.split_whitespace().next() == Some(name))
            .map(|part| part.split_whitespace().skip(1).collect())
            .unwrap_or_default()
    }

    #[test]
    fn a_release_reaches_any_https_server_and_the_local_relay() {
        let csp = csp();
        let connect = directive(&csp, "connect-src");
        for source in ["https:", "wss:", "ws://127.0.0.1:*", "ipc:"] {
            assert!(connect.contains(&source), "connect-src lacks {source}");
        }
        assert!(directive(&csp, "img-src").contains(&"https:"));
    }

    #[test]
    fn a_release_keeps_plain_http_and_outside_scripts_closed() {
        let csp = csp();
        let connect = directive(&csp, "connect-src");
        assert!(!connect
            .iter()
            .any(|source| matches!(*source, "http:" | "ws:" | "*")));
        assert!(!connect
            .iter()
            .any(|source| source.starts_with("http://localhost")
                || source.starts_with("ws://localhost")));
        assert_eq!(directive(&csp, "script-src"), vec!["'self'"]);
        assert!(!csp.contains("unsafe-eval"));
    }

    #[test]
    fn a_release_has_no_built_in_server() {
        std::env::set_var("MISTY_RELEASE_WEB_URL", "https://mistysys.com");
        std::env::remove_var("MISTY_RELEASE_API_URL");
        let environment = public_environment().unwrap();
        assert_eq!(
            environment.keys().collect::<Vec<_>>(),
            vec!["MISTY_PUBLIC_URL"]
        );
    }
}
