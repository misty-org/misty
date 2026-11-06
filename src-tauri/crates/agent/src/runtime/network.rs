//! Provider calls failed in bursts with ETIMEDOUT about 1.3 s apart (docs/agents/evals/odysseys.md):
//! Node races IPv4 and IPv6 with 250 ms for the first address, so a slow moment on a busy host fell
//! through to IPv6, which containers often cannot route. IPv4 goes first and gets the whole connect.
//!
//! Node set this once for the whole process. reqwest has no such setting, so a client takes it from
//! its resolver: with one address to try, it has nothing to race.
use std::{
    io,
    net::{IpAddr, SocketAddr},
    sync::Arc,
};

use futures_util::future::BoxFuture;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};

/// Node's `dns.setDefaultResultOrder("ipv4first")`: IPv4 addresses first, each family in the order
/// the system gave it.
pub(crate) fn ipv4_first(found: impl IntoIterator<Item = IpAddr>) -> Vec<IpAddr> {
    let (mut ordered, six): (Vec<IpAddr>, Vec<IpAddr>) = found.into_iter().partition(IpAddr::is_ipv4);
    ordered.extend(six);
    ordered
}

/// Finds a host's addresses the way `dns.lookup` does, through the system's resolver.
pub(crate) trait HostLookup: Send + Sync {
    fn lookup<'a>(&'a self, host: &'a str) -> BoxFuture<'a, io::Result<Vec<IpAddr>>>;
}

pub(crate) struct SystemLookup;

impl HostLookup for SystemLookup {
    fn lookup<'a>(&'a self, host: &'a str) -> BoxFuture<'a, io::Result<Vec<IpAddr>>> {
        Box::pin(async move { Ok(tokio::net::lookup_host((host, 0)).await?.map(|found| found.ip()).collect()) })
    }
}

struct Ipv4FirstResolver;

impl Resolve for Ipv4FirstResolver {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let found = SystemLookup.lookup(name.as_str()).await?;
            let first = ipv4_first(found).into_iter().next();
            let addresses: Addrs = Box::new(first.map(|ip| SocketAddr::new(ip, 0)).into_iter());
            Ok(addresses)
        })
    }
}

/// A client builder whose connections go to the first address only, IPv4 before IPv6. The app builds
/// the client it passes to model and search calls from this.
pub(crate) fn ipv4_first_client() -> reqwest::ClientBuilder {
    reqwest::Client::builder().dns_resolver(Arc::new(Ipv4FirstResolver))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipv4_goes_first_and_each_family_keeps_its_order() {
        let ip = |text: &str| text.parse::<IpAddr>().unwrap();
        assert_eq!(
            ipv4_first([ip("2606:4700::1"), ip("1.1.1.1"), ip("2606:4700::2"), ip("8.8.8.8")]),
            [ip("1.1.1.1"), ip("8.8.8.8"), ip("2606:4700::1"), ip("2606:4700::2")]
        );
    }

    #[tokio::test]
    async fn the_client_connects_through_the_resolver() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0u8; 1024];
            let _ = socket.read(&mut buffer).await;
            socket.write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok").await.unwrap();
        });
        let client = ipv4_first_client().no_proxy().build().unwrap();
        let reply = client.get(format!("http://localhost:{port}/")).send().await.unwrap();
        assert_eq!(reply.text().await.unwrap(), "ok");
    }
}
