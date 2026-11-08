//! Links other apps hand to Misty as the default browser. A link opens in the profile
//! that claims its site ("Open these sites in this profile"), otherwise in the window
//! used last; with no window open, the profile used last opens for it.
//!
//! Links arrive natively (macOS open-URL events, Windows launch arguments) and are
//! routed here once; the window they belong to takes them from its queue
//! (`take_links`) when it starts or hears `LINKS_EVENT`.
use super::*;

/// Tells a window that links are waiting for it.
pub const LINKS_EVENT: &str = "misty://profile-links";

/// Links waiting for their profile's window, by profile.
static PENDING: Mutex<BTreeMap<String, Vec<String>>> = Mutex::new(BTreeMap::new());

/// A link's host as site claims spell it: lowercase, without `www.`.
fn link_host(url: &str) -> Option<String> {
    let url = url::Url::parse(url).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let host = url.host_str()?.to_ascii_lowercase();
    Some(host.strip_prefix("www.").map(str::to_owned).unwrap_or(host))
}

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

/// The profile whose sites claim a link. Subdomains count, and the most specific claim
/// wins (`mail.example.com` over `example.com`).
pub fn claimed_profile(spaces: &BTreeMap<String, ProfileEntry>, url: &str) -> Option<String> {
    let host = link_host(url)?;
    spaces
        .values()
        .flat_map(|entry| entry.sites.iter().map(move |site| (entry, site)))
        .filter(|(_, site)| host == **site || host.ends_with(&format!(".{site}")))
        .max_by(|(a, x), (b, y)| x.len().cmp(&y.len()).then_with(|| b.id.cmp(&a.id)))
        .map(|(entry, _)| entry.id.clone())
}

/// Which profile each link goes to: its claim, else the window used last (even
/// one closed since), else `fallback`.
fn targets<R: Runtime>(
    app: &AppHandle<R>,
    urls: Vec<String>,
    fallback: Option<&str>,
) -> BTreeMap<String, Vec<String>> {
    let claims = lock_registry()
        .map(|mut state| state.current().clone())
        .unwrap_or_default();
    let last = primary(app)
        .and_then(|window| profile_for_window(window.label()))
        .or_else(|| registry::last_focused_any().and_then(|label| profile_for_window(&label)))
        .or_else(|| fallback.map(str::to_owned))
        .unwrap_or_else(|| PERSONAL.into());
    let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for url in urls {
        let key = claimed_profile(&claims, &url).unwrap_or_else(|| last.clone());
        out.entry(key).or_default().push(url);
    }
    out
}

/// Queues links for a profile and brings forward one of its windows, opening one if
/// none does.
fn deliver<R: Runtime>(app: &AppHandle<R>, key: &str, urls: Vec<String>) {
    if let Ok(mut pending) = PENDING.lock() {
        pending.entry(key.into()).or_default().extend(urls);
    }
    let shown = windows_for_profile(app, key)
        .into_iter()
        .find(|window| is_person_window(window.label()))
        .map(|window| window.label().to_owned());
    if let Err(error) = open_profile(app, key) {
        eprintln!("Could not open a profile for a link: {error}");
        return;
    }
    // A window that just opened takes its links as it starts.
    if let Some(label) = shown {
        let _ = app.emit_to(label.as_str(), LINKS_EVENT, ());
    }
}

/// Of the links Misty was started with, the ones the asking window opens itself; the
/// rest go to their profile. Incognito windows never take links from other apps.
pub fn route_links<R: Runtime>(app: &AppHandle<R>, label: &str, urls: Vec<String>) -> Vec<String> {
    let Some(here) = parse(label) else {
        return Vec::new();
    };
    let urls: Vec<_> = urls
        .into_iter()
        .filter(|url| link_host(url).is_some())
        .collect();
    let mut mine = Vec::new();
    for (key, urls) in targets(app, urls, Some(&here.profile)) {
        if key == here.profile && !here.incognito {
            mine.extend(urls);
        } else {
            deliver(app, &key, urls);
        }
    }
    mine
}

/// Links the system handed to the app itself (no window asked for them yet).
pub fn route_app_links<R: Runtime>(app: &AppHandle<R>, urls: Vec<String>) {
    let urls: Vec<_> = urls
        .into_iter()
        .filter(|url| link_host(url).is_some())
        .collect();
    for (key, urls) in targets(app, urls, None) {
        deliver(app, &key, urls);
    }
}

/// The links waiting for this window.
pub fn take_links(label: &str) -> Vec<String> {
    let Some(key) = parse(label)
        .filter(|window| !window.incognito)
        .map(|window| window.profile)
    else {
        return Vec::new();
    };
    PENDING
        .lock()
        .ok()
        .and_then(|mut pending| pending.remove(&key))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(key: &str, sites: &[&str]) -> (String, ProfileEntry) {
        (
            key.into(),
            ProfileEntry {
                id: key.into(),
                sites: sites.iter().map(|site| (*site).into()).collect(),
                ..Default::default()
            },
        )
    }

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

    #[test]
    fn a_claimed_site_and_its_subdomains_open_in_their_profile() {
        let work = "01951d3240ac70008000000000000001";
        let mail = "01951d3240ac70008000000000000002";
        let profiles: BTreeMap<_, _> = [
            entry(PERSONAL, &[]),
            entry(work, &["example.com"]),
            entry(mail, &["mail.example.com"]),
        ]
        .into();
        assert_eq!(
            claimed_profile(&profiles, "https://example.com/a").as_deref(),
            Some(work)
        );
        assert_eq!(
            claimed_profile(&profiles, "https://www.example.com").as_deref(),
            Some(work)
        );
        assert_eq!(
            claimed_profile(&profiles, "https://docs.example.com").as_deref(),
            Some(work)
        );
        assert_eq!(
            claimed_profile(&profiles, "https://mail.example.com/inbox").as_deref(),
            Some(mail)
        );
        assert_eq!(claimed_profile(&profiles, "https://notexample.com"), None);
        assert_eq!(
            claimed_profile(&profiles, "mailto:someone@example.com"),
            None
        );
    }
}
