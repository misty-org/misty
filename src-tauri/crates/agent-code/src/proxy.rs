//! The package proxy: the only way a sandboxed command reaches the internet.
//!
//! It listens on loopback and accepts HTTPS `CONNECT` tunnels to package
//! registries only. Addresses are resolved here, and private, loopback and
//! link-local addresses are refused, so DNS tricks can't point a tunnel at the
//! person's network. TLS stays end to end; Misty never sees package traffic.
use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::Arc,
    time::Duration,
};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::Semaphore,
};

/// Hosts package managers need. A leading `*.` allows subdomains.
pub const ALLOWED_HOSTS: &[&str] = &[
    "registry.npmjs.org",
    "registry.yarnpkg.com",
    "repo.yarnpkg.com",
    "nodejs.org",
    "pypi.org",
    "files.pythonhosted.org",
    "github.com",
    "codeload.github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "raw.githubusercontent.com",
    "crates.io",
    "index.crates.io",
    "static.crates.io",
    "rubygems.org",
    "index.rubygems.org",
    "jsr.io",
    "deno.land",
    "esm.sh",
    "cdn.jsdelivr.net",
    "unpkg.com",
];

const MAX_TUNNELS: usize = 64;
const MAX_TUNNEL_LIFETIME: Duration = Duration::from_secs(15 * 60);

pub fn host_allowed(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    ALLOWED_HOSTS.iter().any(|allowed| match allowed.strip_prefix("*.") {
        Some(suffix) => host.ends_with(&format!(".{suffix}")),
        None => host == *allowed,
    })
}

/// Addresses a tunnel may never reach.
pub fn public_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => public_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return public_v4(v4);
            }
            let first = v6.segments()[0];
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80
                || v6 == Ipv6Addr::LOCALHOST)
        }
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
        || (a == 100 && (64..128).contains(&b))
        || (a == 198 && (b == 18 || b == 19))
        || a >= 240)
}

pub struct Proxy {
    pub port: u16,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Proxy {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub async fn start() -> std::io::Result<Proxy> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
    let port = listener.local_addr()?.port();
    let slots = Arc::new(Semaphore::new(MAX_TUNNELS));
    let task = tokio::spawn(async move {
        loop {
            let Ok((stream, peer)) = listener.accept().await else {
                continue;
            };
            if !peer.ip().is_loopback() {
                continue;
            }
            let Ok(permit) = slots.clone().try_acquire_owned() else {
                drop(stream);
                continue;
            };
            tokio::spawn(async move {
                let _ = tokio::time::timeout(MAX_TUNNEL_LIFETIME, tunnel(stream)).await;
                drop(permit);
            });
        }
    });
    Ok(Proxy { port, task })
}

async fn refuse(mut stream: TcpStream, status: &str, reason: &str) {
    let body = format!("Misty's package proxy refused this request: {reason}\n");
    let _ = stream
        .write_all(
            format!(
                "HTTP/1.1 {status}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .as_bytes(),
        )
        .await;
}

/// Parses `CONNECT host:443 HTTP/1.1` from a request head.
pub fn connect_target(head: &str) -> Result<String, &'static str> {
    let line = head.lines().next().unwrap_or_default();
    let mut parts = line.split_whitespace();
    let (Some(method), Some(target), Some(version)) = (parts.next(), parts.next(), parts.next()) else {
        return Err("malformed request");
    };
    if !version.starts_with("HTTP/1.") {
        return Err("malformed request");
    }
    if method != "CONNECT" {
        return Err("only HTTPS package downloads are allowed");
    }
    let (host, port) = target.rsplit_once(':').ok_or("malformed request")?;
    if port != "443" {
        return Err("only port 443 is allowed");
    }
    let host = host.trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    if host.parse::<IpAddr>().is_ok() {
        return Err("connect by host name, not address");
    }
    if !host_allowed(&host) {
        return Err("that host isn't a package registry Misty allows");
    }
    Ok(host)
}

async fn tunnel(mut client: TcpStream) {
    let mut head = Vec::with_capacity(1024);
    let mut buffer = [0u8; 1024];
    let read = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let count = client.read(&mut buffer).await?;
            if count == 0 {
                return Err(std::io::Error::from(std::io::ErrorKind::UnexpectedEof));
            }
            head.extend_from_slice(&buffer[..count]);
            if head.windows(4).any(|window| window == b"\r\n\r\n") {
                return Ok(());
            }
            if head.len() > 8192 {
                return Err(std::io::Error::from(std::io::ErrorKind::InvalidData));
            }
        }
    })
    .await;
    if !matches!(read, Ok(Ok(()))) {
        return;
    }
    let text = String::from_utf8_lossy(&head).into_owned();
    let host = match connect_target(&text) {
        Ok(host) => host,
        Err(reason) => return refuse(client, "403 Forbidden", reason).await,
    };
    let addresses: Vec<SocketAddr> = match tokio::time::timeout(
        Duration::from_secs(10),
        tokio::net::lookup_host((host.as_str(), 443)),
    )
    .await
    {
        Ok(Ok(found)) => found.filter(|address| public_address(address.ip())).collect(),
        _ => Vec::new(),
    };
    let Some(address) = addresses.first().copied() else {
        return refuse(client, "502 Bad Gateway", "the host has no public address").await;
    };
    let Ok(Ok(mut upstream)) =
        tokio::time::timeout(Duration::from_secs(10), TcpStream::connect(address)).await
    else {
        return refuse(client, "502 Bad Gateway", "the host didn't answer").await;
    };
    if client
        .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        .await
        .is_err()
    {
        return;
    }
    // Bytes the client sent after the CONNECT head belong to the tunnel.
    if let Some(end) = head.windows(4).position(|window| window == b"\r\n\r\n") {
        let early = &head[end + 4..];
        if !early.is_empty() && upstream.write_all(early).await.is_err() {
            return;
        }
    }
    let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_registries_over_https() {
        assert_eq!(
            connect_target("CONNECT registry.npmjs.org:443 HTTP/1.1\r\n\r\n"),
            Ok("registry.npmjs.org".into())
        );
        assert!(connect_target("CONNECT evil.example:443 HTTP/1.1\r\n\r\n").is_err());
        assert!(connect_target("CONNECT registry.npmjs.org:80 HTTP/1.1\r\n\r\n").is_err());
        assert!(connect_target("GET http://registry.npmjs.org/ HTTP/1.1\r\n\r\n").is_err());
        assert!(connect_target("CONNECT 10.0.0.1:443 HTTP/1.1\r\n\r\n").is_err());
        assert!(connect_target("CONNECT registry.npmjs.org.evil.example:443 HTTP/1.1\r\n\r\n").is_err());
    }

    #[test]
    fn refuses_private_addresses() {
        for private in ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:192.168.1.1", "0.0.0.0"] {
            assert!(!public_address(private.parse().unwrap()), "{private}");
        }
        assert!(public_address("104.16.0.1".parse().unwrap()));
    }
}
