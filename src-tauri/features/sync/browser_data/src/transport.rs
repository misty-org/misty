//! The one check of a server address that names where an account's data on this computer is
//! filed.
use url::Url;

use crate::{Error, Result};

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
