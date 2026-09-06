//! Authenticated loopback proxy for restricted media workers.
//! The worker can reach only this socket; the proxy resolves each destination
//! once and refuses local, private, link-local, multicast, and reserved ranges.
use base64::Engine;
use std::{
    io::{Read, Write},
    net::{
        IpAddr, Ipv4Addr, Ipv6Addr, Shutdown, SocketAddr, TcpListener, TcpStream, ToSocketAddrs,
    },
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        Arc,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

const MAX_HEADER: usize = 16 * 1024;
const MAX_CONNECTIONS: usize = 16;
const MAX_TRANSFER: u64 = 10 * 1024 * 1024 * 1024;

pub struct PublicProxy {
    endpoint: String,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl PublicProxy {
    pub fn start(cancel: Arc<AtomicBool>) -> Result<Self, String> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| "Could not start the private media connection.")?;
        listener
            .set_nonblocking(true)
            .map_err(|_| "Could not configure the private media connection.")?;
        let address = listener
            .local_addr()
            .map_err(|_| "Private media connection unavailable.")?;
        let token = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        let authorization = format!(
            "Basic {}",
            base64::engine::general_purpose::STANDARD.encode(format!("misty:{token}"))
        );
        let active = Arc::new(AtomicUsize::new(0));
        let transferred = Arc::new(AtomicU64::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let thread = std::thread::spawn(move || {
            while !thread_stop.load(Ordering::Acquire) && !cancel.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        if active.fetch_add(1, Ordering::AcqRel) >= MAX_CONNECTIONS {
                            active.fetch_sub(1, Ordering::AcqRel);
                            reject(stream, 503);
                            continue;
                        }
                        let authorization = authorization.clone();
                        let cancel = cancel.clone();
                        let stop = thread_stop.clone();
                        let active = active.clone();
                        let transferred = transferred.clone();
                        std::thread::spawn(move || {
                            let _ = handle(stream, &authorization, &cancel, &stop, &transferred);
                            active.fetch_sub(1, Ordering::AcqRel);
                        });
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            endpoint: format!("http://misty:{token}@127.0.0.1:{}/", address.port()),
            stop,
            thread: Some(thread),
        })
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }
}

impl Drop for PublicProxy {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Ok(url) = url::Url::parse(&self.endpoint) {
            if let Some(port) = url.port() {
                let _ = TcpStream::connect((Ipv4Addr::LOCALHOST, port));
            }
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn handle(
    mut client: TcpStream,
    authorization: &str,
    cancel: &AtomicBool,
    stop: &AtomicBool,
    transferred: &AtomicU64,
) -> Result<(), ()> {
    client
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|_| ())?;
    client
        .set_write_timeout(Some(Duration::from_secs(10)))
        .map_err(|_| ())?;
    let header = match read_header(&mut client) {
        Ok(header) => header,
        Err(status) => {
            if let Ok(stream) = client.try_clone() {
                reject(stream, status);
            }
            return Err(());
        }
    };
    let split = header
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or(())?
        + 4;
    let text = std::str::from_utf8(&header[..split]).map_err(|_| ())?;
    let mut lines = text.split("\r\n");
    let request = lines.next().ok_or(())?;
    let mut parts = request.split_whitespace();
    let method = parts.next().ok_or(())?;
    let target = parts.next().ok_or(())?;
    let version = parts.next().ok_or(())?;
    if parts.next().is_some() || !matches!(version, "HTTP/1.0" | "HTTP/1.1") {
        reject(client, 400);
        return Err(());
    }
    let mut authenticated = false;
    let mut headers = Vec::new();
    for line in lines.filter(|line| !line.is_empty()) {
        let Some((name, value)) = line.split_once(':') else {
            reject(client, 400);
            return Err(());
        };
        if name.eq_ignore_ascii_case("proxy-authorization") {
            authenticated = value.trim() == authorization;
        } else if !name.eq_ignore_ascii_case("proxy-connection")
            && !name.eq_ignore_ascii_case("forwarded")
            && !name.eq_ignore_ascii_case("x-forwarded-for")
        {
            headers.push((name, value.trim()));
        }
    }
    if !authenticated {
        reject(client, 407);
        return Err(());
    }
    if method == "CONNECT" {
        let url = url::Url::parse(&format!("https://{target}/")).map_err(|_| ())?;
        let host = url.host_str().ok_or(())?;
        let port = url.port().unwrap_or(443);
        if port != 443 {
            reject(client, 403);
            return Err(());
        }
        let mut remote = match connect_public(host, port) {
            Ok(remote) => remote,
            Err(()) => {
                reject(client, 403);
                return Err(());
            }
        };
        client
            .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            .map_err(|_| ())?;
        if split < header.len() {
            remote.write_all(&header[split..]).map_err(|_| ())?;
        }
        relay(client, remote, cancel, stop, transferred)
    } else {
        if !matches!(method, "GET" | "HEAD" | "POST") {
            reject(client, 405);
            return Err(());
        }
        let url = url::Url::parse(target).map_err(|_| ())?;
        if url.scheme() != "http" || !url.username().is_empty() || url.password().is_some() {
            reject(client, 403);
            return Err(());
        }
        let host = url.host_str().ok_or(())?;
        let port = url.port().unwrap_or(80);
        if port != 80 {
            reject(client, 403);
            return Err(());
        }
        let mut remote = match connect_public(host, port) {
            Ok(remote) => remote,
            Err(()) => {
                reject(client, 403);
                return Err(());
            }
        };
        let path = match url.query() {
            Some(query) => format!("{}?{query}", url.path()),
            None => url.path().to_owned(),
        };
        write!(remote, "{method} {path} {version}\r\nHost: {host}\r\n").map_err(|_| ())?;
        for (name, value) in headers {
            if !name.eq_ignore_ascii_case("host") {
                write!(remote, "{name}: {value}\r\n").map_err(|_| ())?;
            }
        }
        remote.write_all(b"\r\n").map_err(|_| ())?;
        if split < header.len() {
            remote.write_all(&header[split..]).map_err(|_| ())?;
        }
        relay(client, remote, cancel, stop, transferred)
    }
}

fn read_header(stream: &mut TcpStream) -> Result<Vec<u8>, u16> {
    let mut bytes = Vec::with_capacity(1024);
    let mut buffer = [0u8; 2048];
    while bytes.len() <= MAX_HEADER {
        let size = stream.read(&mut buffer).map_err(|_| 408u16)?;
        if size == 0 {
            return Err(400);
        }
        bytes.extend_from_slice(&buffer[..size]);
        if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            return Ok(bytes);
        }
    }
    Err(431)
}

fn connect_public(host: &str, port: u16) -> Result<TcpStream, ()> {
    let addresses = (host, port).to_socket_addrs().map_err(|_| ())?;
    for address in addresses.filter(|address| public_ip(address.ip())) {
        if let Ok(stream) = TcpStream::connect_timeout(&address, Duration::from_secs(10)) {
            stream
                .set_read_timeout(Some(Duration::from_secs(10)))
                .map_err(|_| ())?;
            stream
                .set_write_timeout(Some(Duration::from_secs(10)))
                .map_err(|_| ())?;
            return Ok(stream);
        }
    }
    Err(())
}

fn relay(
    mut client: TcpStream,
    mut remote: TcpStream,
    cancel: &AtomicBool,
    stop: &AtomicBool,
    transferred: &AtomicU64,
) -> Result<(), ()> {
    client.set_nonblocking(true).map_err(|_| ())?;
    remote.set_nonblocking(true).map_err(|_| ())?;
    let started = Instant::now();
    let mut idle = Instant::now();
    let mut buffer = [0u8; 65_536];
    loop {
        if cancel.load(Ordering::Acquire)
            || stop.load(Ordering::Acquire)
            || started.elapsed() > Duration::from_secs(86_400)
            || idle.elapsed() > Duration::from_secs(90)
            || transferred.load(Ordering::Acquire) > MAX_TRANSFER
        {
            return Err(());
        }
        let mut moved = false;
        match move_once(&mut client, &mut remote, &mut buffer, transferred)? {
            Transfer::Closed => {
                let _ = remote.shutdown(Shutdown::Write);
                return Ok(());
            }
            Transfer::Moved => moved = true,
            Transfer::Idle => {}
        }
        match move_once(&mut remote, &mut client, &mut buffer, transferred)? {
            Transfer::Closed => {
                let _ = client.shutdown(Shutdown::Write);
                return Ok(());
            }
            Transfer::Moved => moved = true,
            Transfer::Idle => {}
        }
        if moved {
            idle = Instant::now();
        } else {
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

enum Transfer {
    Idle,
    Moved,
    Closed,
}

fn move_once(
    source: &mut TcpStream,
    destination: &mut TcpStream,
    buffer: &mut [u8],
    transferred: &AtomicU64,
) -> Result<Transfer, ()> {
    match source.read(buffer) {
        Ok(0) => Ok(Transfer::Closed),
        Ok(size) => {
            let previous = transferred.fetch_add(size as u64, Ordering::AcqRel);
            if previous.saturating_add(size as u64) > MAX_TRANSFER {
                return Err(());
            }
            destination.write_all(&buffer[..size]).map_err(|_| ())?;
            Ok(Transfer::Moved)
        }
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => Ok(Transfer::Idle),
        Err(_) => Err(()),
    }
}

fn reject(mut stream: TcpStream, status: u16) {
    let reason = match status {
        400 => "Bad Request",
        403 => "Forbidden",
        405 => "Method Not Allowed",
        407 => "Proxy Authentication Required",
        408 => "Request Timeout",
        431 => "Request Header Fields Too Large",
        _ => "Service Unavailable",
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
}

pub(super) fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => public_v4(ip),
        IpAddr::V6(ip) => public_v6(ip),
    }
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0
        || a == 10
        || a == 127
        || a >= 224
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 192 && b == 88 && c == 99)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113))
}

fn public_v6(ip: Ipv6Addr) -> bool {
    let octets = ip.octets();
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return public_v4(mapped);
    }
    !(ip.is_unspecified()
        || ip.is_loopback()
        || octets[0] & 0xfe == 0xfc
        || (octets[0] == 0xfe && octets[1] & 0xc0 == 0x80)
        || octets[0] == 0xff
        || (octets[0..4] == [0x20, 0x01, 0x0d, 0xb8]))
}

pub fn proxy_port(endpoint: &str) -> Result<u16, String> {
    let url = url::Url::parse(endpoint).map_err(|_| "Invalid private media connection.")?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.username() != "misty"
        || url.password().is_none_or(str::is_empty)
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Media workers require their private Host connection.".into());
    }
    url.port()
        .filter(|port| *port != 0)
        .ok_or("Invalid private media connection.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserved_and_local_addresses_are_never_public_destinations() {
        for address in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.1.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "192.0.2.1",
            "198.51.100.1",
            "203.0.113.1",
            "::1",
            "fe80::1",
            "fc00::1",
            "2001:db8::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(!public_ip(address.parse().unwrap()), "{address}");
        }
        assert!(public_ip("1.1.1.1".parse().unwrap()));
        assert!(public_ip("2606:4700:4700::1111".parse().unwrap()));
    }

    #[test]
    fn authenticated_proxy_still_rejects_loopback_targets() {
        let cancel = Arc::new(AtomicBool::new(false));
        let proxy = PublicProxy::start(cancel).unwrap();
        let url = url::Url::parse(proxy.endpoint()).unwrap();
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, url.port().unwrap())).unwrap();
        let authorization = base64::engine::general_purpose::STANDARD.encode(format!(
            "{}:{}",
            url.username(),
            url.password().unwrap()
        ));
        write!(
            stream,
            "CONNECT 127.0.0.1:443 HTTP/1.1\r\nProxy-Authorization: Basic {authorization}\r\n\r\n"
        )
        .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        assert!(response.starts_with("HTTP/1.1 403"));
        drop(proxy);
    }

    #[test]
    fn worker_endpoint_validation_rejects_foreign_connections() {
        assert!(proxy_port("http://misty:secret@127.0.0.1:1234/").is_ok());
        for endpoint in [
            "https://misty:secret@127.0.0.1:1234/",
            "http://misty:secret@example.com:1234/",
            "http://127.0.0.1:1234/",
            "http://misty:secret@127.0.0.1:1234/other",
        ] {
            assert!(proxy_port(endpoint).is_err(), "{endpoint}");
        }
    }
}
