use std::{
    io,
    net::{IpAddr, SocketAddr},
    sync::Arc,
};

use futures_util::future::BoxFuture;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};

pub(crate) fn ipv4_first(found: impl IntoIterator<Item = IpAddr>) -> Vec<IpAddr> {
    let (mut ordered, six): (Vec<IpAddr>, Vec<IpAddr>) =
        found.into_iter().partition(IpAddr::is_ipv4);
    ordered.extend(six);
    ordered
}

pub(crate) trait HostLookup: Send + Sync {
    fn lookup<'a>(&'a self, host: &'a str) -> BoxFuture<'a, io::Result<Vec<IpAddr>>>;
}

pub(crate) struct SystemLookup;

impl HostLookup for SystemLookup {
    fn lookup<'a>(&'a self, host: &'a str) -> BoxFuture<'a, io::Result<Vec<IpAddr>>> {
        Box::pin(async move {
            Ok(tokio::net::lookup_host((host, 0))
                .await?
                .map(|found| found.ip())
                .collect())
        })
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

pub(crate) fn ipv4_first_client() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .dns_resolver(Arc::new(Ipv4FirstResolver))
        .redirect(stay_on_the_host())
}

fn stay_on_the_host() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        let place = |url: &reqwest::Url| {
            (
                url.host_str().map(str::to_owned),
                url.port_or_known_default(),
            )
        };
        let same = attempt
            .previous()
            .first()
            .is_some_and(|first| place(first) == place(attempt.url()));
        if same && attempt.previous().len() < 10 {
            attempt.follow()
        } else {
            attempt.stop()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipv4_goes_first_and_each_family_keeps_its_order() {
        let ip = |text: &str| text.parse::<IpAddr>().unwrap();
        assert_eq!(
            ipv4_first([
                ip("2606:4700::1"),
                ip("1.1.1.1"),
                ip("2606:4700::2"),
                ip("8.8.8.8")
            ]),
            [
                ip("1.1.1.1"),
                ip("8.8.8.8"),
                ip("2606:4700::1"),
                ip("2606:4700::2")
            ]
        );
    }

    async fn serves_once(reply: String) -> (u16, tokio::task::JoinHandle<String>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let served = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0u8; 2048];
            let read = socket.read(&mut buffer).await.unwrap();
            socket.write_all(reply.as_bytes()).await.unwrap();
            String::from_utf8_lossy(&buffer[..read]).into_owned()
        });
        (port, served)
    }

    #[tokio::test]
    async fn a_redirect_to_another_host_never_gets_the_key() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let (other, other_served) =
            serves_once("HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n".to_owned()).await;
        let (first, _) = serves_once(format!(
            "HTTP/1.1 307 Temporary Redirect\r\nlocation: http://127.0.0.1:{other}/steal\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
        ))
        .await;
        let client = ipv4_first_client().no_proxy().build().unwrap();
        let response = client
            .post(format!("http://127.0.0.1:{first}/search"))
            .header("X-API-KEY", "secret")
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status().as_u16(),
            307,
            "the redirect comes back rather than being followed"
        );
        tokio::task::yield_now().await;
        assert!(
            !other_served.is_finished(),
            "the other host was never asked"
        );
        other_served.abort();
    }

    #[tokio::test]
    async fn a_redirect_on_the_same_host_is_followed() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let _ = rustls::crypto::ring::default_provider().install_default();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            for reply in [
                "HTTP/1.1 307 Temporary Redirect\r\nlocation: /v1/search\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
                "HTTP/1.1 200 OK\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
            ] {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buffer = [0u8; 2048];
                let _ = socket.read(&mut buffer).await;
                socket.write_all(reply.as_bytes()).await.unwrap();
            }
        });
        let client = ipv4_first_client().no_proxy().build().unwrap();
        let response = client
            .post(format!("http://127.0.0.1:{port}/search"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), 200);
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
            socket
                .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok")
                .await
                .unwrap();
        });
        let client = ipv4_first_client().no_proxy().build().unwrap();
        let reply = client
            .get(format!("http://localhost:{port}/"))
            .send()
            .await
            .unwrap();
        assert_eq!(reply.text().await.unwrap(), "ok");
    }
}
