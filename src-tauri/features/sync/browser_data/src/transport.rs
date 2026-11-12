//! The device channel's WebSocket transport, and the one check of a server address that names
//! where an account's data on this computer is filed. Errors never include a request URL: its
//! query may contain a one-use connection ticket.
use std::{sync::Arc, time::Duration};

use tokio::{net::TcpStream, time::timeout};
use tokio_tungstenite::{
    connect_async_tls_with_config, tungstenite::protocol::WebSocketConfig, Connector,
    MaybeTlsStream, WebSocketStream,
};
use url::Url;

use crate::{Error, Result};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// A server address as this computer files an account's data under it: HTTPS, or HTTP on this
/// computer, with no credentials, query or fragment, and no trailing slash.
pub fn deployment(base: &str) -> Result<String> {
    let base = Url::parse(base).map_err(|_| Error::Invalid)?;
    let loopback = match base.host() {
        Some(url::Host::Domain("localhost")) => true,
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        _ => false,
    };
    if !(base.scheme() == "https" || (base.scheme() == "http" && loopback))
        || base.host_str().is_none()
        || !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
    {
        return Err(Error::Invalid);
    }
    Ok(base.as_str().trim_end_matches('/').to_owned())
}

mod socket;
pub use socket::*;
