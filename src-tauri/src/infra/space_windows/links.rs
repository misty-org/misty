//! Links other apps hand to Misty as the default browser. A link opens in the Space
//! that claims its site ("Open these sites in this Space"), otherwise in the Space
//! window used last; with no window open, the Space used last opens for it.
//!
//! Links arrive natively (macOS open-URL events, Windows launch arguments) and are
//! routed here once; the window they belong to takes them from its queue
//! (`take_links`) when it starts or hears `LINKS_EVENT`.
use super::*;

/// Tells a Space window that links are waiting for it.
pub const LINKS_EVENT: &str = "misty://space-links";

/// Links waiting for their Space's window, by Space key.
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

/// The Space whose sites claim a link. Subdomains count, and the most specific claim
/// wins (`mail.example.com` over `example.com`).
pub fn claimed_space(spaces: &BTreeMap<String, SpaceEntry>, url: &str) -> Option<String> {
    let host = link_host(url)?;
    spaces
        .values()
        .flat_map(|entry| entry.sites.iter().map(move |site| (entry, site)))
        .filter(|(_, site)| host == **site || host.ends_with(&format!(".{site}")))
        .max_by(|(a, x), (b, y)| x.len().cmp(&y.len()).then_with(|| b.key.cmp(&a.key)))
        .map(|(entry, _)| entry.key.clone())
}

/// Which Space each link goes to: its claim, else the Space window used last (even
/// one closed since), else `fallback`.
fn targets<R: Runtime>(
    app: &AppHandle<R>,
    urls: Vec<String>,
    fallback: Option<&str>,
) -> BTreeMap<String, Vec<String>> {
    let claims = lock_registry()
        .map(|state| state.spaces.clone())
        .unwrap_or_default();
    let last = primary(app)
        .and_then(|window| space_for_window(window.label()))
        .or_else(|| registry::last_focused_any().and_then(|label| space_for_window(&label)))
        .or_else(|| fallback.map(str::to_owned))
        .unwrap_or_else(|| PERSONAL.into());
    let mut out: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for url in urls {
        let key = claimed_space(&claims, &url).unwrap_or_else(|| last.clone());
        out.entry(key).or_default().push(url);
    }
    out
}

/// Queues links for a Space and brings forward a window showing it, opening one if
/// none does.
fn deliver<R: Runtime>(app: &AppHandle<R>, key: &str, urls: Vec<String>) {
    if let Ok(mut pending) = PENDING.lock() {
        pending.entry(key.into()).or_default().extend(urls);
    }
    let shown = windows_for_space(app, key)
        .into_iter()
        .find(|window| is_space_window(window.label()))
        .map(|window| window.label().to_owned());
    if let Err(error) = open_space(app, key) {
        eprintln!("Could not open a Space for a link: {error}");
        return;
    }
    // A window that just opened takes its links as it starts.
    if let Some(label) = shown {
        let _ = app.emit_to(label.as_str(), LINKS_EVENT, ());
    }
}

/// Of the links Misty was started with, the ones the asking window opens itself; the
/// rest go to their Space. Incognito windows never take links from other apps.
pub fn route_links<R: Runtime>(app: &AppHandle<R>, label: &str, urls: Vec<String>) -> Vec<String> {
    let Some(here) = parse(label) else {
        return Vec::new();
    };
    let urls: Vec<_> = urls.into_iter().filter(|url| link_host(url).is_some()).collect();
    let mut mine = Vec::new();
    for (key, urls) in targets(app, urls, Some(&here.space)) {
        if key == here.space && !here.incognito {
            mine.extend(urls);
        } else {
            deliver(app, &key, urls);
        }
    }
    mine
}

/// Links the system handed to the app itself (no window asked for them yet).
pub fn route_app_links<R: Runtime>(app: &AppHandle<R>, urls: Vec<String>) {
    let urls: Vec<_> = urls.into_iter().filter(|url| link_host(url).is_some()).collect();
    for (key, urls) in targets(app, urls, None) {
        deliver(app, &key, urls);
    }
}

/// The links waiting for this Space window.
pub fn take_links(label: &str) -> Vec<String> {
    let Some(key) = parse(label)
        .filter(|window| !window.incognito)
        .map(|window| window.space)
    else {
        return Vec::new();
    };
    PENDING
        .lock()
        .ok()
        .and_then(|mut pending| pending.remove(&key))
        .unwrap_or_default()
}

/// Copies a Space's claimed sites from its vault. Returns whether they changed.
pub fn set_space_sites(key: &str, sites: Vec<String>) -> bool {
    let Ok(mut state) = lock_registry() else {
        return false;
    };
    ensure_entry(&mut state, key);
    let entry = state.spaces.get_mut(key).expect("entry exists");
    if entry.sites == sites {
        return false;
    }
    entry.sites = sites;
    save(&state);
    true
}

/// The sites a Space claims, as last read from its vault.
pub fn space_sites(key: &str) -> Vec<String> {
    lock_registry()
        .ok()
        .and_then(|state| state.spaces.get(key).map(|entry| entry.sites.clone()))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(key: &str, sites: &[&str]) -> (String, SpaceEntry) {
        (
            key.into(),
            SpaceEntry {
                key: key.into(),
                sites: sites.iter().map(|site| (*site).into()).collect(),
                ..Default::default()
            },
        )
    }

    #[test]
    fn a_claimed_site_and_its_subdomains_open_in_their_space() {
        let work = "01951d3240ac70008000000000000001";
        let mail = "01951d3240ac70008000000000000002";
        let spaces: BTreeMap<_, _> = [
            entry(PERSONAL, &[]),
            entry(work, &["example.com"]),
            entry(mail, &["mail.example.com"]),
        ]
        .into();
        assert_eq!(claimed_space(&spaces, "https://example.com/a").as_deref(), Some(work));
        assert_eq!(claimed_space(&spaces, "https://www.example.com").as_deref(), Some(work));
        assert_eq!(claimed_space(&spaces, "https://docs.example.com").as_deref(), Some(work));
        assert_eq!(claimed_space(&spaces, "https://mail.example.com/inbox").as_deref(), Some(mail));
        assert_eq!(claimed_space(&spaces, "https://notexample.com"), None);
        assert_eq!(claimed_space(&spaces, "mailto:someone@example.com"), None);
    }
}
