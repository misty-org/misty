//! Builds `catalog.json`, the apps Misty offers to connect directly, from the official MCP Registry:
//! every server run by its app's own maker (`catalog::by_maker`) whose sign-in needs no key of
//! Misty's (`oauth::discover`), with the logo its maker published. Run it before a release:
//!
//! ```text
//! cargo test --lib -- --ignored generate_direct_catalog --nocapture
//! ```
//!
//! Only public data is read: registry pages, servers' sign-in metadata (nothing is registered) and
//! makers' home pages for their icons.
use std::collections::HashSet;
use std::time::Duration;

use futures_util::stream::{self, StreamExt};
use serde::Serialize;
use serde_json::Value;

use super::catalog::{self, CatalogApp};
use super::oauth::{self, Access};

const REGISTRY: &str = "https://registry.modelcontextprotocol.io/v0/servers";
const OUT: &str = "features/agents/connected_apps/direct/catalog.json";
const AT_ONCE: usize = 48;
const PER_SERVER: Duration = Duration::from_secs(25);
const ICON_LIMIT: usize = 512 << 10;

#[derive(Serialize, serde::Deserialize)]
struct Entry {
    name: String,
    description: String,
    url: String,
    icon: String,
}

async fn registry_pages(http: &reqwest::Client) -> Vec<Value> {
    let mut items = Vec::new();
    let mut cursor = String::new();
    for page in 0..1000 {
        let mut query = vec![("limit", "100".to_owned()), ("version", "latest".to_owned())];
        if !cursor.is_empty() {
            query.push(("cursor", cursor.clone()));
        }
        let mut answer = None;
        for _ in 0..3 {
            if let Ok(response) = http.get(REGISTRY).query(&query).send().await {
                if let Ok(value) = response.json::<Value>().await {
                    answer = Some(value);
                    break;
                }
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
        let Some(value) = answer else { break };
        items.extend(value["servers"].as_array().cloned().unwrap_or_default());
        cursor = value["metadata"]["nextCursor"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        if page % 20 == 0 {
            println!("registry: {} entries", items.len());
        }
        if cursor.is_empty() {
            break;
        }
    }
    items
}

/// `<link rel="…icon…" href="…">` on a home page, the largest first.
fn page_icons(html: &str, base: &url::Url) -> Vec<String> {
    let link = regex::Regex::new(r"(?is)<link\b[^>]*>").unwrap();
    let attribute = |tag: &str, name: &str| {
        let pattern = format!(r#"(?is)\b{name}\s*=\s*["']([^"']*)["']"#);
        regex::Regex::new(&pattern)
            .unwrap()
            .captures(tag)
            .map(|found| found[1].trim().to_owned())
    };
    let mut found: Vec<(u32, String)> = Vec::new();
    for tag in link.find_iter(html).map(|item| item.as_str()) {
        let rel = attribute(tag, "rel").unwrap_or_default().to_lowercase();
        if !rel.split_whitespace().any(|word| word == "icon" || word == "apple-touch-icon") {
            continue;
        }
        let Some(href) = attribute(tag, "href").filter(|href| !href.starts_with("data:")) else {
            continue;
        };
        let Ok(resolved) = base.join(&href) else { continue };
        if resolved.scheme() != "https" {
            continue;
        }
        let size = attribute(tag, "sizes")
            .and_then(|sizes| sizes.split('x').next().and_then(|n| n.parse().ok()))
            .unwrap_or(0);
        let rank = if href.ends_with(".svg") {
            1000
        } else if rel.contains("apple-touch-icon") {
            180.max(size)
        } else {
            size.max(16)
        };
        found.push((rank, resolved.to_string()));
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, url)| url).collect()
}

/// Whether `url` answers with an image of reasonable size.
async fn is_image(http: &reqwest::Client, url: &str) -> bool {
    let Ok(response) = http.get(url).send().await else {
        return false;
    };
    let image = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|kind| kind.starts_with("image/"));
    response.status().is_success()
        && image
        && response.bytes().await.is_ok_and(|bytes| !bytes.is_empty() && bytes.len() <= ICON_LIMIT)
}

/// The maker's own logo: the icon published with the server, else the one the maker's home page
/// declares, else its `favicon.ico`.
async fn official_icon(http: &reqwest::Client, server: &Value, url: &str) -> String {
    for icon in server["icons"].as_array().into_iter().flatten() {
        if let Some(src) = icon["src"].as_str().filter(|src| src.starts_with("https://")) {
            if is_image(http, src).await {
                return src.to_owned();
            }
        }
    }
    let Some(home) = home_of(url) else {
        return String::new();
    };
    if let Ok(response) = http.get(home.as_str()).send().await {
        let final_url = response.url().clone();
        if let Ok(html) = response.text().await {
            for candidate in page_icons(&html[..html.len().min(ICON_LIMIT)], &final_url).into_iter().take(3) {
                if is_image(http, &candidate).await {
                    return candidate;
                }
            }
        }
    }
    let favicon = format!("{}favicon.ico", home.as_str());
    if is_image(http, &favicon).await {
        return favicon;
    }
    String::new()
}

/// A publisher domain with more servers than this lists other companies' apps.
const MOST_PER_DOMAIN: usize = 5;

fn domain_of(url: &str) -> String {
    home_of(url)
        .and_then(|home| home.host_str().map(str::to_owned))
        .unwrap_or_default()
}

/// The order apps are browsed in: words before symbols and digits.
fn sort_key(name: &str) -> (bool, String) {
    let lower = name.trim().to_lowercase();
    (!lower.starts_with(|c: char| c.is_alphabetic()), lower)
}

/// The named makers first, in their order; then, leaving out publishers that list other companies'
/// apps, every app with its maker's logo by name, then those without one.
fn tidy(entries: Vec<Entry>) -> Vec<Entry> {
    let named: Vec<&str> = catalog::MAKERS.iter().map(|(_, url)| *url).collect();
    let named_domains: HashSet<String> = named.iter().map(|url| domain_of(url)).collect();
    let mut per_domain = std::collections::HashMap::<String, usize>::new();
    for entry in &entries {
        *per_domain.entry(domain_of(&entry.url)).or_default() += 1;
    }
    let (mut first, mut rest): (Vec<Entry>, Vec<Entry>) = entries
        .into_iter()
        .filter(|entry| {
            let domain = domain_of(&entry.url);
            named_domains.contains(&domain)
                || per_domain.get(&domain).copied().unwrap_or(0) <= MOST_PER_DOMAIN
        })
        .partition(|entry| named.contains(&entry.url.as_str()));
    first.sort_by_key(|entry| named.iter().position(|url| *url == entry.url));
    rest.sort_by(|a, b| {
        (a.icon.is_empty(), sort_key(&a.name)).cmp(&(b.icon.is_empty(), sort_key(&b.name)))
    });
    first.extend(rest);
    first
}

/// Applies `tidy` to the catalog as it is, without reading the registry again.
#[test]
#[ignore]
fn tidy_direct_catalog() {
    let entries: Vec<Entry> =
        serde_json::from_str(&std::fs::read_to_string(OUT).unwrap()).unwrap();
    let before = entries.len();
    let list = tidy(entries);
    std::fs::write(OUT, serde_json::to_string_pretty(&list).unwrap()).unwrap();
    println!("kept {} of {before} apps", list.len());
}

/// `https://notion.com/` for `https://mcp.notion.com/mcp`: the maker's registrable domain.
fn home_of(url: &str) -> Option<url::Url> {
    let host = url::Url::parse(url).ok()?.host_str()?.to_lowercase();
    let labels: Vec<&str> = host.split('.').collect();
    let keep = match labels.as_slice() {
        [.., _, "co" | "com" | "org" | "net", tld] if tld.len() == 2 && labels.len() >= 3 => 3,
        _ => 2,
    };
    let domain = labels[labels.len().saturating_sub(keep)..].join(".");
    url::Url::parse(&format!("https://{domain}/")).ok()
}

async fn entry_for(http: &reqwest::Client, app: CatalogApp, server: Value) -> Option<Entry> {
    let checked = tokio::time::timeout(PER_SERVER, oauth::discover(http, &app.url)).await;
    if !matches!(checked, Ok(Access::Keyless(_))) {
        return None;
    }
    let icon = tokio::time::timeout(PER_SERVER, official_icon(http, &server, &app.url))
        .await
        .unwrap_or_default();
    Some(Entry {
        name: app.name,
        description: app.description,
        url: app.url,
        icon,
    })
}

#[tokio::test]
#[ignore]
async fn generate_direct_catalog() {
    let http = crate::engine_config::support::http_client().unwrap();
    let items = registry_pages(&http).await;
    println!("registry: {} entries in all", items.len());
    // The makers the app names first, then every maker the registry has.
    let mut candidates: Vec<(CatalogApp, Value)> = catalog::MAKERS
        .iter()
        .map(|(name, url)| {
            (
                CatalogApp {
                    name: (*name).to_owned(),
                    description: String::new(),
                    url: (*url).to_owned(),
                    app: catalog::app_key(url),
                    icon: String::new(),
                    checked: false,
                },
                Value::Null,
            )
        })
        .collect();
    let mut seen: HashSet<String> = candidates.iter().map(|(app, _)| app.url.clone()).collect();
    for item in &items {
        let page = serde_json::json!({ "servers": [item] });
        for app in catalog::from_registry(&page) {
            if seen.insert(app.url.clone()) {
                candidates.push((app, item["server"].clone()));
            }
        }
    }
    println!("makers' servers to check: {}", candidates.len());
    let total = candidates.len();
    let mut done = 0usize;
    let mut entries: Vec<(usize, Entry)> = Vec::new();
    let mut results = stream::iter(candidates.into_iter().enumerate())
        .map(|(index, (app, server))| {
            let http = http.clone();
            async move { (index, entry_for(&http, app, server).await) }
        })
        .buffer_unordered(AT_ONCE);
    while let Some((index, entry)) = results.next().await {
        done += 1;
        if let Some(entry) = entry {
            entries.push((index, entry));
        }
        if done % 250 == 0 {
            println!("checked {done}/{total}, keyless {}", entries.len());
        }
    }
    entries.sort_by_key(|(index, _)| *index);
    let list = tidy(entries.into_iter().map(|(_, entry)| entry).collect());
    let with_icons = list.iter().filter(|entry| !entry.icon.is_empty()).count();
    std::fs::write(OUT, serde_json::to_string_pretty(&list).unwrap()).unwrap();
    println!("wrote {} apps, {with_icons} with an official icon", list.len());
}
