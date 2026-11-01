//! What the model sign-ins share (Sign in with ChatGPT and OpenRouter's key flow): PKCE values,
//! a one-shot loopback listener for the browser's redirect, and an HTTP client for the token
//! endpoints. Nothing here logs a code, a verifier or a token.
use std::{collections::HashMap, net::SocketAddr, time::Duration};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

/// How long the browser has to come back to Misty.
pub const SIGN_IN_WINDOW: Duration = Duration::from_secs(5 * 60);

/// A random value for `state`, `nonce` or a PKCE verifier: 32 bytes, base64url.
pub fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// The S256 challenge for a PKCE verifier: base64url of its SHA-256, without padding.
pub fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn client() -> reqwest::Client {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap_or_default()
}

/// Waits on `127.0.0.1` (and, for a `localhost` redirect, `[::1]` too) for the browser to
/// open one path, and answers it with a page saying the person can go back to Misty.
pub struct Loopback {
    listeners: Vec<TcpListener>,
    pub port: u16,
}

impl Loopback {
    pub async fn bind(also_ipv6: bool) -> Result<Self, String> {
        let first = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|_| "No local port is free for signing in.".to_string())?;
        let port = first.local_addr().map_err(|e| e.to_string())?.port();
        let mut listeners = vec![first];
        if also_ipv6 {
            let ipv6 = SocketAddr::from((std::net::Ipv6Addr::LOCALHOST, port));
            if let Ok(second) = TcpListener::bind(ipv6).await {
                listeners.push(second);
            }
        }
        Ok(Self { listeners, port })
    }

    /// The query of the first request to `path`, within `window`.
    pub async fn wait(
        self,
        path: &str,
        window: Duration,
    ) -> Result<HashMap<String, String>, String> {
        let accept = async {
            loop {
                let stream = match self.listeners.as_slice() {
                    [one] => one.accept().await.map(|(stream, _)| stream),
                    [one, two, ..] => tokio::select! {
                        a = one.accept() => a.map(|(stream, _)| stream),
                        b = two.accept() => b.map(|(stream, _)| stream),
                    },
                    [] => return Err("Misty stopped waiting for the sign-in.".to_string()),
                };
                let Ok(stream) = stream else { continue };
                if let Some(query) = answer(stream, path).await {
                    return Ok(query);
                }
            }
        };
        tokio::time::timeout(window, accept)
            .await
            .map_err(|_| "The sign-in took too long. Try again.".to_string())?
    }
}

/// Reads one request; for `path` it answers with the done page and returns the query.
async fn answer(mut stream: TcpStream, path: &str) -> Option<HashMap<String, String>> {
    let mut buffer = vec![0u8; 8192];
    let mut read = 0;
    while read < buffer.len() {
        let n = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buffer[read..]))
            .await
            .ok()?
            .ok()?;
        if n == 0 {
            break;
        }
        read += n;
        if buffer[..read].windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    let head = String::from_utf8_lossy(&buffer[..read]);
    let target = head
        .lines()
        .next()?
        .strip_prefix("GET ")?
        .split(' ')
        .next()?;
    let url = url::Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    if url.path() != path {
        let _ = stream
            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await;
        return None;
    }
    let page = "<!doctype html><meta charset=utf-8><title>Misty</title>\
        <body style=\"font:15px -apple-system,system-ui,sans-serif;background:#111;color:#eee;\
        display:grid;place-items:center;height:100vh;margin:0\">\
        <p>You can close this tab and go back to Misty.</p>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\
         Cache-Control: no-store\r\nConnection: close\r\n\r\n{page}",
        page.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    Some(url.query_pairs().into_owned().collect())
}

/// Opens the person's browser at a sign-in page.
pub fn open_browser(url: &str) -> Result<(), String> {
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(|_| "Misty couldn't open your browser to sign in.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn challenge_is_rfc7636_s256() {
        // RFC 7636 appendix B.
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let token = random_token();
        assert_eq!(token.len(), 43);
        assert_ne!(token, random_token());
    }

    #[tokio::test]
    async fn loopback_returns_the_callback_query() {
        let loopback = Loopback::bind(false).await.unwrap();
        let port = loopback.port;
        let waiting = tokio::spawn(loopback.wait("/auth/callback", Duration::from_secs(5)));
        let _ = rustls::crypto::ring::default_provider().install_default();
        let http = reqwest::Client::builder().no_proxy().build().unwrap();
        let miss = http
            .get(format!("http://127.0.0.1:{port}/favicon.ico"))
            .send()
            .await
            .unwrap();
        assert_eq!(miss.status(), 404);
        let page = http
            .get(format!(
                "http://127.0.0.1:{port}/auth/callback?code=abc&state=xyz"
            ))
            .send()
            .await
            .unwrap();
        assert!(page.text().await.unwrap().contains("go back to Misty"));
        let query = waiting.await.unwrap().unwrap();
        assert_eq!(query.get("code").map(String::as_str), Some("abc"));
        assert_eq!(query.get("state").map(String::as_str), Some("xyz"));
    }
}
