//! One public page, fetched without cookies or saved sign-ins. This runs on the person's computer on behalf of a model reading untrusted
//! pages, so nothing may reach their own network. Every hop is checked before connecting: http or
//! https, no credentials in the address, and a host that resolves only to public addresses.
//!
//! The TypeScript ran the check inside the connection's own lookup, so the name couldn't be
//! re-resolved somewhere private. Here each hop resolves the name once, checks every answer, and
//! builds a client for that hop alone with the chosen address pinned by `ClientBuilder::resolve`.
//! The client then never does a lookup of its own, so a DNS change between the check and the connect
//! can't move it. That needs its own client per hop rather than one passed in: an override is set on
//! the whole client, and a shared client's pool could also reuse a connection made for an older
//! answer. The clients have no proxy, since a proxy would make the lookup somewhere else, and follow
//! no redirects, since each hop has to come back here. Their resolver refuses everything, so a name
//! the override somehow misses fails rather than reaching the system's DNS.
use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::Arc,
    time::Duration,
};

use reqwest::{
    dns::{Name, Resolve, Resolving},
    header,
    redirect::Policy,
    Client, Response,
};
use url::{Host, Url};

use crate::network::{ipv4_first, HostLookup, SystemLookup};
use crate::text::js_trim;

use super::decode::BodyDecoder;

const MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
const TIMEOUT_MS: u64 = 20_000;
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 MistyFetch/1";
const ACCEPT: &str = "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5";
const READABLE_TYPES: [&str; 7] = ["text/html", "application/xhtml+xml", "text/plain", "text/markdown", "application/json", "application/xml", "text/xml"];

/// A short code the tool turns into plain words.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WebFetchFailed {
    InvalidUrl,
    PrivateAddress,
    FetchTimeout,
    FetchFailed,
    TooManyRedirects,
    UnsupportedContent,
    /// The page arrived, but whatever reads it failed.
    ReadFailed,
}

impl WebFetchFailed {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::InvalidUrl => "invalid_url",
            Self::PrivateAddress => "private_address",
            Self::FetchTimeout => "fetch_timeout",
            Self::ReadFailed => "page_read_failed",
            Self::FetchFailed => "fetch_failed",
            Self::TooManyRedirects => "too_many_redirects",
            Self::UnsupportedContent => "unsupported_content",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FetchedPage {
    pub(crate) final_url: String,
    pub(crate) status: u16,
    pub(crate) content_type: String,
    pub(crate) body: String,
    pub(crate) truncated: bool,
}

const REFUSED_V4: [(Ipv4Addr, u32); 14] = [
    (Ipv4Addr::new(0, 0, 0, 0), 8),
    (Ipv4Addr::new(10, 0, 0, 0), 8),
    (Ipv4Addr::new(100, 64, 0, 0), 10),
    (Ipv4Addr::new(127, 0, 0, 0), 8),
    (Ipv4Addr::new(169, 254, 0, 0), 16),
    (Ipv4Addr::new(172, 16, 0, 0), 12),
    (Ipv4Addr::new(192, 0, 0, 0), 24),
    (Ipv4Addr::new(192, 0, 2, 0), 24),
    (Ipv4Addr::new(192, 168, 0, 0), 16),
    (Ipv4Addr::new(198, 18, 0, 0), 15),
    (Ipv4Addr::new(198, 51, 100, 0), 24),
    (Ipv4Addr::new(203, 0, 113, 0), 24),
    (Ipv4Addr::new(224, 0, 0, 0), 4),
    (Ipv4Addr::new(240, 0, 0, 0), 4),
];

// ::/96 also covers :: and ::1. NAT64 and 6to4 addresses can carry a private IPv4 address.
const REFUSED_V6: [(Ipv6Addr, u32); 9] = [
    (Ipv6Addr::new(0, 0, 0, 0, 0, 0, 0, 0), 96),
    (Ipv6Addr::new(0x64, 0xff9b, 0, 0, 0, 0, 0, 0), 96),
    (Ipv6Addr::new(0x64, 0xff9b, 1, 0, 0, 0, 0, 0), 48),
    // Site-local, deprecated but still routed on some networks.
    (Ipv6Addr::new(0xfec0, 0, 0, 0, 0, 0, 0, 0), 10),
    (Ipv6Addr::new(0x2002, 0, 0, 0, 0, 0, 0, 0), 16),
    (Ipv6Addr::new(0xfc00, 0, 0, 0, 0, 0, 0, 0), 7),
    (Ipv6Addr::new(0xfe80, 0, 0, 0, 0, 0, 0, 0), 10),
    (Ipv6Addr::new(0xff00, 0, 0, 0, 0, 0, 0, 0), 8),
    (Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 0), 32),
];

fn in_v4(address: Ipv4Addr, network: Ipv4Addr, prefix: u32) -> bool {
    u32::from(address) >> (32 - prefix) == u32::from(network) >> (32 - prefix)
}

fn in_v6(address: Ipv6Addr, network: Ipv6Addr, prefix: u32) -> bool {
    u128::from(address) >> (128 - prefix) == u128::from(network) >> (128 - prefix)
}

/// Whether an address is on the public internet. IPv4-mapped IPv6 addresses count as their IPv4 address.
pub fn is_public_ip(address: IpAddr) -> bool {
    let v4 = |address: Ipv4Addr| !REFUSED_V4.iter().any(|(network, prefix)| in_v4(address, *network, *prefix));
    match address {
        IpAddr::V4(address) => v4(address),
        IpAddr::V6(address) => match address.to_ipv4_mapped() {
            Some(mapped) => v4(mapped),
            None => !REFUSED_V6.iter().any(|(network, prefix)| in_v6(address, *network, *prefix)),
        },
    }
}

/// `isPublicAddress`, for an address as text. Anything that isn't an address isn't public.
#[cfg(test)]
pub(crate) fn is_public_address(address: &str) -> bool {
    address.parse::<IpAddr>().is_ok_and(is_public_ip)
}

/// The address as a URL this may connect to, or why not.
fn checked_url(address: &str, base: Option<&Url>) -> Result<Url, WebFetchFailed> {
    let parsed = match base {
        Some(base) => base.join(address),
        None => Url::parse(address),
    };
    let url = parsed.map_err(|_| WebFetchFailed::InvalidUrl)?;
    let scheme = url.scheme() == "http" || url.scheme() == "https";
    if !scheme || !url.username().is_empty() || url.password().is_some_and(|password| !password.is_empty()) || url.host_str().map_or(true, str::is_empty) {
        return Err(WebFetchFailed::InvalidUrl);
    }
    Ok(url)
}

/// The only resolver a pinned client has, behind its one override.
struct NoLookups;

impl Resolve for NoLookups {
    fn resolve(&self, _name: Name) -> Resolving {
        Box::pin(async { Err("a pinned client looks nothing up".into()) })
    }
}

pub(crate) type Check<'a> = dyn Fn(IpAddr) -> bool + Send + Sync + 'a;

/// A client for one hop, pinned to an address that passed the check.
async fn pinned_client(url: &Url, check: &Check<'_>, lookup: &dyn HostLookup) -> Result<Client, WebFetchFailed> {
    let builder = Client::builder()
        .no_proxy()
        .http1_only()
        .redirect(Policy::none())
        .pool_max_idle_per_host(0)
        .dns_resolver(Arc::new(NoLookups))
        // Decoding is done here, under the size limit, whatever another crate turns on in reqwest.
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd();
    let literal = |address: IpAddr| if check(address) { Ok(()) } else { Err(WebFetchFailed::PrivateAddress) };
    let builder = match url.host() {
        // A literal address has no lookup to go through.
        Some(Host::Ipv4(address)) => literal(IpAddr::V4(address)).map(|()| builder)?,
        Some(Host::Ipv6(address)) => literal(IpAddr::V6(address)).map(|()| builder)?,
        Some(Host::Domain(host)) => {
            let found = lookup.lookup(host).await.map_err(|_| WebFetchFailed::FetchFailed)?;
            // A name with any address that isn't public is refused, not just the one it would use.
            if found.is_empty() || found.iter().any(|address| !check(*address)) {
                return Err(WebFetchFailed::PrivateAddress);
            }
            // Only the first gets a connection, IPv4 before IPv6 (`network.rs`). The port is ignored here.
            let first = ipv4_first(found).into_iter().next().ok_or(WebFetchFailed::PrivateAddress)?;
            builder.resolve(host, SocketAddr::new(first, 0))
        }
        None => return Err(WebFetchFailed::InvalidUrl),
    };
    builder.build().map_err(|_| WebFetchFailed::FetchFailed)
}

async fn request(url: &Url, check: &Check<'_>, lookup: &dyn HostLookup) -> Result<Response, WebFetchFailed> {
    let client = pinned_client(url, check, lookup).await?;
    client
        .get(url.clone())
        .header(header::USER_AGENT, USER_AGENT)
        .header(header::ACCEPT, ACCEPT)
        .header(header::ACCEPT_ENCODING, "gzip, deflate, br")
        .header(header::CONNECTION, "close")
        .send()
        .await
        .map_err(|_| WebFetchFailed::FetchFailed)
}

/// A header as Node gives it: bytes read as Latin-1, repeated values joined.
fn header_text(response: &Response, name: header::HeaderName) -> Option<String> {
    let values: Vec<String> = response.headers().get_all(name).iter().map(|value| value.as_bytes().iter().map(|byte| char::from(*byte)).collect()).collect();
    (!values.is_empty()).then(|| values.join(", "))
}

/// Up to the limit of the decoded body, and whether there was more.
async fn read_body(mut response: Response) -> Result<(Vec<u8>, bool), WebFetchFailed> {
    let encoding = header_text(&response, header::CONTENT_ENCODING).unwrap_or_default().to_lowercase();
    let mut decoder = BodyDecoder::new(&encoding, MAX_BYTES);
    while !decoder.full() {
        match response.chunk().await.map_err(|_| WebFetchFailed::FetchFailed)? {
            Some(chunk) => decoder.write(&chunk).map_err(|_| WebFetchFailed::FetchFailed)?,
            None => break,
        }
    }
    decoder.finish().map_err(|_| WebFetchFailed::FetchFailed)
}

async fn follow(mut current: Url, check: &Check<'_>, lookup: &dyn HostLookup) -> Result<FetchedPage, WebFetchFailed> {
    for _ in 0..=MAX_REDIRECTS {
        let response = request(&current, check, lookup).await?;
        let status = response.status().as_u16();
        if (300..400).contains(&status) {
            let location = header_text(&response, header::LOCATION).filter(|location| !location.is_empty()).ok_or(WebFetchFailed::FetchFailed)?;
            current = checked_url(&location, Some(&current))?;
            continue;
        }
        let content_type = header_text(&response, header::CONTENT_TYPE).unwrap_or_default().to_lowercase();
        if !content_type.is_empty() && !READABLE_TYPES.iter().any(|kind| content_type.starts_with(kind)) {
            return Err(WebFetchFailed::UnsupportedContent);
        }
        let (body, truncated) = read_body(response).await?;
        return Ok(FetchedPage {
            final_url: current.to_string(),
            status,
            content_type,
            body: String::from_utf8_lossy(&body).into_owned(),
            truncated,
        });
    }
    Err(WebFetchFailed::TooManyRedirects)
}

/// Fetches a public address with every hop checked.
pub(crate) async fn fetch_public_page(address: &str) -> Result<FetchedPage, WebFetchFailed> {
    fetch_checked(address, &is_public_ip, &SystemLookup).await
}

/// `fetch_public_page` with the check and the lookup given in, which is how tests stand in for a
/// public site or a name that changes its answer.
pub(crate) async fn fetch_checked(address: &str, check: &Check<'_>, lookup: &dyn HostLookup) -> Result<FetchedPage, WebFetchFailed> {
    let start = checked_url(js_trim(address), None)?;
    tokio::time::timeout(Duration::from_millis(TIMEOUT_MS), follow(start, check, lookup))
        .await
        .unwrap_or(Err(WebFetchFailed::FetchTimeout))
}

#[cfg(test)]
#[path = "public_fetch_tests.rs"]
mod tests;
