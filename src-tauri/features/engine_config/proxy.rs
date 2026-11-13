// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//
// The network proxy from Settings › Network, for the engines Misty starts and its own requests
// for engine config. Kept on this computer in `misty.db`.
//
// desktop-cc-gui applies the proxy to its own process environment, so every child inherits it.
// Misty never changes its process environment (other threads read it while it runs): the engines
// get the variables through `engines::channels::env_for`, and Misty's clients through
// `apply_to_client`.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::support;

const STORE_KEY: &str = "proxy";
const DEFAULT_NO_PROXY: &str = "localhost,127.0.0.1,::1";
/// Schemes Settings offers (HTTP, HTTPS and SOCKS5) and the engine CLIs accept.
const ALLOWED_SCHEMES: [&str; 4] = ["http", "https", "socks5", "socks5h"];

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxySettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub url: Option<String>,
}

fn append_no_proxy_values(values: &mut Vec<String>, raw: &str) {
    for item in raw.split(',') {
        let candidate = item.trim();
        if candidate.is_empty() {
            continue;
        }
        if values
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(candidate))
        {
            continue;
        }
        values.push(candidate.to_string());
    }
}

/// The NO_PROXY Misty was started with plus the loopback defaults: Misty's own local MCP server
/// and any local service must never go through the proxy.
fn merged_no_proxy_value(inherited: &[Option<String>]) -> String {
    let mut values = Vec::new();
    for existing in inherited.iter().flatten() {
        append_no_proxy_values(&mut values, existing);
    }
    append_no_proxy_values(&mut values, DEFAULT_NO_PROXY);
    values.join(",")
}

fn inherited_no_proxy() -> Vec<Option<String>> {
    ["NO_PROXY", "no_proxy"]
        .iter()
        .map(|key| std::env::var(key).ok())
        .collect()
}

fn normalized_proxy_url(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

pub(crate) fn validate_proxy_settings(settings: &ProxySettings) -> Result<(), String> {
    if !settings.enabled {
        return Ok(());
    }
    let proxy_url = normalized_proxy_url(settings.url.as_deref())
        .ok_or_else(|| "Enter a proxy URL to turn the proxy on.".to_string())?;
    let parsed =
        reqwest::Url::parse(&proxy_url).map_err(|error| format!("Invalid proxy URL: {error}"))?;
    if !ALLOWED_SCHEMES.contains(&parsed.scheme()) {
        return Err(format!(
            "Invalid proxy URL: \"{}\" isn't supported. Use http, https or socks5.",
            parsed.scheme()
        ));
    }
    if parsed.host_str().unwrap_or_default().is_empty() {
        return Err("Invalid proxy URL: it has no host.".to_string());
    }
    Ok(())
}

pub fn read_settings() -> ProxySettings {
    support::load_value(STORE_KEY)
        .ok()
        .flatten()
        .unwrap_or_default()
}

pub fn save_settings(settings: &ProxySettings) -> Result<(), String> {
    validate_proxy_settings(settings)?;
    let settings = ProxySettings {
        enabled: settings.enabled,
        url: normalized_proxy_url(settings.url.as_deref()),
    };
    support::save_value(STORE_KEY, &settings)
}

/// The variables for `settings`, both spellings, or nothing when the proxy is off.
fn env_for_settings(
    settings: &ProxySettings,
    inherited: &[Option<String>],
) -> HashMap<String, String> {
    let mut env = HashMap::new();
    if validate_proxy_settings(settings).is_err() || !settings.enabled {
        return env;
    }
    let Some(url) = normalized_proxy_url(settings.url.as_deref()) else {
        return env;
    };
    for key in [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ] {
        env.insert(key.to_string(), url.clone());
    }
    let no_proxy = merged_no_proxy_value(inherited);
    env.insert("NO_PROXY".into(), no_proxy.clone());
    env.insert("no_proxy".into(), no_proxy);
    env
}

/// The proxy variables for programs Misty starts: HTTP(S)_PROXY, ALL_PROXY and NO_PROXY in both
/// spellings while the proxy is on, nothing while it is off (they then inherit Misty's own).
pub fn proxy_env() -> HashMap<String, String> {
    env_for_settings(&read_settings(), &inherited_no_proxy())
}

/// `builder` with the proxy from Settings applied: HTTP, HTTPS or SOCKS5 (reqwest's `socks`
/// feature), with the loopback addresses and the inherited NO_PROXY left direct.
pub fn apply_to_client(builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    let settings = read_settings();
    if !settings.enabled || validate_proxy_settings(&settings).is_err() {
        return builder;
    }
    let Some(url) = normalized_proxy_url(settings.url.as_deref()) else {
        return builder;
    };
    match reqwest::Proxy::all(&url) {
        Ok(proxy) => {
            let no_proxy = merged_no_proxy_value(&inherited_no_proxy());
            builder.proxy(proxy.no_proxy(reqwest::NoProxy::from_string(&no_proxy)))
        }
        Err(_) => builder,
    }
}

#[tauri::command]
pub async fn engine_proxy_get() -> Result<ProxySettings, String> {
    tauri::async_runtime::spawn_blocking(read_settings)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn engine_proxy_set(enabled: bool, url: Option<String>) -> Result<ProxySettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_settings(&ProxySettings { enabled, url })?;
        Ok(read_settings())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    #![allow(clippy::disallowed_methods, clippy::disallowed_types)]
    use super::*;

    fn proxy_settings(enabled: bool, url: Option<&str>) -> ProxySettings {
        ProxySettings {
            enabled,
            url: url.map(str::to_string),
        }
    }

    #[test]
    fn validate_rejects_empty_url_when_enabled() {
        assert!(validate_proxy_settings(&proxy_settings(true, None)).is_err());
        assert!(validate_proxy_settings(&proxy_settings(true, Some("  "))).is_err());
        assert!(validate_proxy_settings(&proxy_settings(false, None)).is_ok());
    }

    #[test]
    fn validate_checks_scheme_and_host() {
        assert!(
            validate_proxy_settings(&proxy_settings(true, Some("http://127.0.0.1:7890"))).is_ok()
        );
        assert!(
            validate_proxy_settings(&proxy_settings(true, Some("socks5://127.0.0.1:1080"))).is_ok()
        );
        assert!(
            validate_proxy_settings(&proxy_settings(true, Some("ftp://127.0.0.1:21"))).is_err()
        );
        assert!(validate_proxy_settings(&proxy_settings(true, Some("not a url"))).is_err());
    }

    #[test]
    fn env_sets_every_spelling_and_keeps_inherited_no_proxy() {
        let env = env_for_settings(
            &proxy_settings(true, Some("http://127.0.0.1:7890")),
            &[Some("corp.local,internal.example".into()), None],
        );
        for key in ["HTTP_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"] {
            assert_eq!(
                env.get(key).map(String::as_str),
                Some("http://127.0.0.1:7890")
            );
        }
        let no_proxy = env.get("NO_PROXY").unwrap();
        assert!(no_proxy.contains("corp.local"));
        assert!(no_proxy.contains("127.0.0.1"));
        assert_eq!(env.get("no_proxy"), env.get("NO_PROXY"));
        // Off, or not valid: nothing, so the engine inherits Misty's own environment.
        assert!(env_for_settings(&proxy_settings(false, Some("http://x:1")), &[]).is_empty());
        assert!(env_for_settings(&proxy_settings(true, Some("ftp://x")), &[]).is_empty());
    }

    #[test]
    fn saved_settings_round_trip_and_reject_bad_urls() {
        let dir = std::env::temp_dir().join(format!("misty-proxy-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let _home = support::TestHome::set(&dir);
        assert_eq!(read_settings(), ProxySettings::default());
        save_settings(&proxy_settings(true, Some(" socks5://127.0.0.1:1080 "))).unwrap();
        assert_eq!(
            read_settings(),
            proxy_settings(true, Some("socks5://127.0.0.1:1080"))
        );
        assert_eq!(
            proxy_env().get("ALL_PROXY").map(String::as_str),
            Some("socks5://127.0.0.1:1080")
        );
        assert!(save_settings(&proxy_settings(true, Some("ftp://x"))).is_err());
        assert!(read_settings().enabled);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
