//! Address policy for the built-in LAN file browser.
use std::net::IpAddr;

pub fn is_lan_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(ip) => ip.is_private() || ip.is_link_local() || ip.is_loopback(),
        IpAddr::V6(ip) => ip
            .to_ipv4_mapped()
            .map(|ip| is_lan_address(ip.into()))
            .unwrap_or_else(|| {
                ip.is_unique_local() || ip.is_unicast_link_local() || ip.is_loopback()
            }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn permits_lan_and_loopback_but_not_internet_or_unspecified_addresses() {
        for address in [
            "192.168.1.4",
            "10.0.0.2",
            "172.16.0.2",
            "169.254.1.2",
            "127.0.0.1",
            "::1",
            "fd00::1",
            "fe80::1",
            "::ffff:192.168.1.4",
        ] {
            assert!(is_lan_address(address.parse().unwrap()), "{address}");
        }
        for address in [
            "8.8.8.8",
            "0.0.0.0",
            "224.0.0.1",
            "::",
            "2001:4860:4860::8888",
            "::ffff:8.8.8.8",
        ] {
            assert!(!is_lan_address(address.parse().unwrap()), "{address}");
        }
    }
}
