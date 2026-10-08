//! `web.fetch` on the person's device (docs/plans/agent-harness.md, phase 1):
//! one public page, fetched without cookies or saved sign-ins, so an agent can
//! read what a search found without opening a screen. Every hop is checked
//! before connecting: http or https, no credentials in the address, and a host
//! that resolves only to public addresses. The connection is pinned to the
//! checked address so the name can't be re-resolved somewhere private.
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;

const MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const TIMEOUT: Duration = Duration::from_secs(20);
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 MistyFetch/1";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedPage {
    pub final_url: String,
    pub status: u16,
    pub content_type: String,
    pub body: String,
    pub truncated: bool,
}

/// Fails with a short code the agent's tool turns into plain words.
#[tauri::command]
pub async fn agents_web_fetch(webview: tauri::Webview, url: String) -> Result<FetchedPage, String> {
    if !crate::infra::space_windows::is_space_window(webview.label()) {
        return Err("device_grant_invalid".into());
    }
    let _ = rustls::crypto::ring::default_provider().install_default();
    fetch(&url).await
}

pub async fn fetch(address: &str) -> Result<FetchedPage, String> {
    let mut current = url::Url::parse(address.trim()).map_err(|_| "invalid_url".to_string())?;
    for _ in 0..=MAX_REDIRECTS {
        let target = public_target(&current).await?;
        let host = current.host_str().unwrap_or_default().to_string();
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .resolve(&host, target)
            .build()
            .map_err(|_| "fetch_failed".to_string())?;
        let response = client
            .get(current.clone())
            .header("Accept", "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5")
            .send()
            .await
            .map_err(|error| if error.is_timeout() { "fetch_timeout".to_string() } else { "fetch_failed".to_string() })?;
        let status = response.status();
        if status.is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "fetch_failed".to_string())?;
            current = current.join(location).map_err(|_| "invalid_url".to_string())?;
            continue;
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !readable(&content_type) {
            return Err("unsupported_content".into());
        }
        let mut body = Vec::new();
        let mut truncated = false;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "fetch_failed".to_string())?;
            let room = MAX_BYTES - body.len();
            if chunk.len() >= room {
                body.extend_from_slice(&chunk[..room]);
                truncated = true;
                break;
            }
            body.extend_from_slice(&chunk);
        }
        return Ok(FetchedPage {
            final_url: current.to_string(),
            status: status.as_u16(),
            content_type,
            body: String::from_utf8_lossy(&body).into_owned(),
            truncated,
        });
    }
    Err("too_many_redirects".into())
}

fn readable(content_type: &str) -> bool {
    content_type.is_empty()
        || ["text/html", "application/xhtml+xml", "text/plain", "text/markdown", "application/json", "application/xml", "text/xml"]
            .iter()
            .any(|kind| content_type.starts_with(kind))
}

/// The address to connect to, once the URL and every address its host resolves to pass.
async fn public_target(url: &url::Url) -> Result<SocketAddr, String> {
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
        return Err("invalid_url".into());
    }
    let host = url.host_str().ok_or_else(|| "invalid_url".to_string())?;
    let port = url.port_or_known_default().ok_or_else(|| "invalid_url".to_string())?;
    let host = host.trim_start_matches('[').trim_end_matches(']');
    let addresses: Vec<SocketAddr> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| "fetch_failed".to_string())?
        .collect();
    if addresses.is_empty() || addresses.iter().any(|address| !is_public(address.ip())) {
        return Err("private_address".into());
    }
    Ok(addresses[0])
}

pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => public_v4(v4),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => public_v4(v4),
            None => public_v6(v6),
        },
    }
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        || a == 0
        || (a == 100 && (64..128).contains(&b)) // carrier-grade NAT
        || (a == 198 && (18..20).contains(&b)) // benchmarking
        || a >= 240)
}

fn public_v6(ip: Ipv6Addr) -> bool {
    let first = ip.segments()[0];
    !(ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || (first & 0xfe00) == 0xfc00 // unique local
        || (first & 0xffc0) == 0xfe80 // link local
        || first == 0x2001 && ip.segments()[1] == 0x0db8) // documentation
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_and_special_addresses_are_refused() {
        for address in ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"] {
            assert!(!is_public(address.parse().unwrap()), "{address} should be refused");
        }
        for address in ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(is_public(address.parse().unwrap()), "{address} should be allowed");
        }
    }

    #[tokio::test]
    async fn addresses_outside_http_and_local_hosts_never_connect() {
        assert_eq!(fetch("file:///etc/passwd").await.err().as_deref(), Some("invalid_url"));
        assert_eq!(fetch("http://user:pw@example.com/").await.err().as_deref(), Some("invalid_url"));
        assert_eq!(fetch("http://127.0.0.1:8081/health").await.err().as_deref(), Some("private_address"));
        assert_eq!(fetch("http://localhost/").await.err().as_deref(), Some("private_address"));
    }
}
