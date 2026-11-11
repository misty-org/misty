//! The sites a profile lists as its own, as hosts.

/// Hosts as typed (`example.com`, `https://mail.example.com/…`): lowercased, without
/// `www.`, deduplicated and capped.
pub(crate) fn normalize_sites(sites: &[String]) -> Vec<String> {
    use browser_data::document::entities;
    let mut hosts = Vec::new();
    for site in sites {
        let value = site.trim().to_ascii_lowercase();
        if value.is_empty() {
            continue;
        }
        let address = if value.contains("://") {
            value
        } else {
            format!("https://{value}")
        };
        let Some(host) = url::Url::parse(&address)
            .ok()
            .and_then(|url| url.host_str().map(str::to_owned))
        else {
            continue;
        };
        let host = host.strip_prefix("www.").unwrap_or(&host).to_owned();
        if entities::site_host(&host) && !hosts.contains(&host) {
            hosts.push(host);
        }
    }
    hosts.truncate(entities::MAX_SPACE_SITES);
    hosts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typed_sites_become_hosts() {
        let typed = [
            " Example.com ",
            "https://www.example.com/path",
            "mail.example.com",
            "",
            "not a site",
            "http://[::1]/",
        ]
        .map(String::from);
        assert_eq!(
            normalize_sites(&typed),
            vec!["example.com".to_owned(), "mail.example.com".to_owned()]
        );
    }
}
