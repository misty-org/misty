//! The device channel's socket, and the TLS roots every socket here uses.
use super::*;

/// Opens an authenticated-elsewhere WebSocket (the URL carries a one-use
/// ticket) with the system's TLS roots and the caller's frame bound. Used by the
/// device channel.
pub async fn open_device_socket(
    url: &Url,
    max_frame: usize,
) -> Result<WebSocketStream<MaybeTlsStream<TcpStream>>> {
    let connector = if url.scheme() == "wss" {
        Some(tls_connector()?)
    } else if url.scheme() == "ws"
        && matches!(url.host(), Some(url::Host::Domain("localhost")))
            | matches!(url.host(), Some(url::Host::Ipv4(ip)) if ip.is_loopback())
    {
        None
    } else {
        return Err(Error::Invalid);
    };
    let config = WebSocketConfig::default()
        .read_buffer_size(8192)
        .write_buffer_size(8192)
        .max_write_buffer_size(1 << 20)
        .max_message_size(Some(max_frame))
        .max_frame_size(Some(max_frame));
    let (stream, _) = timeout(
        REQUEST_TIMEOUT,
        connect_async_tls_with_config(url.as_str(), Some(config), false, connector),
    )
    .await
    .map_err(|_| Error::Network)?
    .map_err(|_| Error::Network)?;
    Ok(stream)
}

pub use tokio_tungstenite::tungstenite::{Error as SocketError, Message as SocketMessage};

pub(crate) fn tls_connector() -> Result<Connector> {
    let mut roots = rustls::RootCertStore::empty();
    for certificate in rustls_native_certs::load_native_certs().certs {
        roots.add(certificate).map_err(|_| Error::Network)?;
    }
    if roots.is_empty() {
        return Err(Error::Network);
    }
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|_| Error::Network)?
    .with_root_certificates(roots)
    .with_no_client_auth();
    Ok(Connector::Rustls(Arc::new(config)))
}
