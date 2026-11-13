//! Which apps Misty offers to connect directly: servers run by the app's own maker, never a
//! middleman that would hold the person's tokens on its servers.
//!
//! Browsing shows the makers below. Searching asks the official MCP Registry, keeping a server only
//! when the registry verified its publisher owns a domain (`app.linear/…`), it is served from that
//! domain, the publisher isn't one that lists other companies' apps, and its name doesn't claim
//! another company's brand. Whether an app takes a sign-in Misty can do without a key of its own is
//! checked separately (`oauth::discover`), and only those are offered.
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

const REGISTRY: &str = "https://registry.modelcontextprotocol.io/v0/servers";
/// The apps checked when this build was made (`generate.rs`).
const CATALOG: &str = include_str!("catalog.json");
const SEARCH_LIMIT: usize = 100;
/// What a server's sign-in takes changes rarely; ask again after this long.
const CHECK_KEPT: Duration = Duration::from_secs(24 * 60 * 60);

/// Makers whose own servers take a sign-in with no key of Misty's, checked 2026-11-11. Each is
/// checked again before it is offered.
pub const MAKERS: &[(&str, &str)] = &[
    ("Notion", "https://mcp.notion.com/mcp"),
    ("Linear", "https://mcp.linear.app/mcp"),
    ("Atlassian", "https://mcp.atlassian.com/v1/mcp"),
    ("Figma", "https://mcp.figma.com/mcp"),
    ("Airtable", "https://mcp.airtable.com/mcp"),
    ("Dropbox", "https://mcp.dropbox.com/mcp"),
    ("monday.com", "https://mcp.monday.com/mcp"),
    ("ClickUp", "https://mcp.clickup.com/mcp"),
    ("Todoist", "https://ai.todoist.net/mcp"),
    ("Miro", "https://mcp.miro.com/"),
    ("Canva", "https://mcp.canva.com/mcp"),
    ("Calendly", "https://mcp.calendly.com"),
    ("Cal.com", "https://mcp.cal.com/mcp"),
    ("Granola", "https://mcp.granola.ai/mcp"),
    ("Fireflies", "https://api.fireflies.ai/mcp"),
    ("Gamma", "https://mcp.gamma.app/mcp"),
    ("Intercom", "https://mcp.intercom.com/mcp"),
    ("Attio", "https://mcp.attio.com/mcp"),
    ("Close", "https://mcp.close.com/mcp"),
    ("Stripe", "https://mcp.stripe.com"),
    ("PayPal", "https://mcp.paypal.com/mcp"),
    ("Square", "https://mcp.squareup.com/mcp"),
    ("Ramp", "https://mcp.ramp.com/mcp"),
    ("Plaid", "https://api.dashboard.plaid.com/mcp/"),
    ("Webflow", "https://mcp.webflow.com/mcp"),
    ("Wix", "https://mcp.wix.com/mcp"),
    ("GitLab", "https://gitlab.com/api/v4/mcp"),
    ("Sentry", "https://mcp.sentry.dev/mcp"),
    ("Vercel", "https://mcp.vercel.com"),
    ("Netlify", "https://netlify-mcp.netlify.app/mcp"),
    ("Cloudflare", "https://bindings.mcp.cloudflare.com/mcp"),
    ("Supabase", "https://mcp.supabase.com/mcp"),
    ("Neon", "https://mcp.neon.tech/mcp"),
    ("PostHog", "https://mcp.posthog.com/mcp"),
    ("Honeycomb", "https://mcp.honeycomb.io/mcp"),
    ("Buildkite", "https://mcp.buildkite.com/mcp"),
    ("Jam", "https://mcp.jam.dev/mcp"),
];

/// Brands whose name in another publisher's server means a middleman, with the domains that are
/// really theirs.
const BRANDS: &[(&str, &[&str])] = &[
    ("notion", &["notion.com", "notion.so"]),
    ("linear", &["linear.app"]),
    ("atlassian", &["atlassian.com"]),
    ("jira", &["atlassian.com"]),
    ("confluence", &["atlassian.com"]),
    ("figma", &["figma.com"]),
    ("airtable", &["airtable.com"]),
    ("dropbox", &["dropbox.com"]),
    ("monday", &["monday.com"]),
    ("clickup", &["clickup.com"]),
    ("todoist", &["todoist.net", "todoist.com"]),
    ("miro", &["miro.com"]),
    ("canva", &["canva.com"]),
    ("calendly", &["calendly.com"]),
    ("intercom", &["intercom.com"]),
    ("stripe", &["stripe.com"]),
    ("paypal", &["paypal.com"]),
    ("gmail", &["google.com", "googleapis.com"]),
    ("google", &["google.com", "googleapis.com"]),
    ("youtube", &["google.com", "googleapis.com", "youtube.com"]),
    ("slack", &["slack.com"]),
    ("github", &["github.com", "githubcopilot.com"]),
    ("gitlab", &["gitlab.com"]),
    ("hubspot", &["hubspot.com"]),
    ("salesforce", &["salesforce.com"]),
    ("asana", &["asana.com"]),
    ("trello", &["atlassian.com", "trello.com"]),
    ("outlook", &["microsoft.com"]),
    ("microsoft", &["microsoft.com"]),
    ("teams", &["microsoft.com"]),
    ("onedrive", &["microsoft.com"]),
    ("sharepoint", &["microsoft.com"]),
    ("shopify", &["shopify.com", "shopify.dev"]),
    ("zoom", &["zoom.us"]),
    ("discord", &["discord.com"]),
    ("whatsapp", &["whatsapp.com", "meta.com"]),
    ("instagram", &["instagram.com", "meta.com"]),
    ("facebook", &["facebook.com", "meta.com"]),
    ("spotify", &["spotify.com"]),
    ("quickbooks", &["intuit.com"]),
    ("xero", &["xero.com"]),
    ("zendesk", &["zendesk.com"]),
    ("box", &["box.com"]),
    ("webflow", &["webflow.com"]),
    ("vercel", &["vercel.com"]),
    ("supabase", &["supabase.com"]),
];

/// Publishers that list many other companies' apps under their own domain, from the registry as
/// read on 2026-11-11 (more than five servers on one domain). Anything they publish is skipped.
const HOSTS_OF_OTHERS: &[&str] = &[
    "smithery.ai",
    "waystation.ai",
    "civai.co",
    "mcpbundles.com",
    "a2awire.com",
    "textforagents.com",
    "wishpool.app",
    "getvda.ai",
    "openkrill.app",
    "jojapi.com",
    "modevc.com",
    "olyport.com",
    "edgethirteen.com",
    "dropwatchhq.com",
    "hasdata.com",
    "wondel.ai",
    "eliteaiempire.com",
    "goaimoat.com",
    "penguindriver.com",
    "youraitools.co",
    "gotsimplified.com",
    "moltlinestudio.com",
    "chipp.ai",
    "saifs.ai",
    "trendsapi.ai",
    "trendsmcp.ai",
    "faceabot.com",
    "pianam.cn",
    "roxyapi.com",
    "myagents.click",
    "seoapi.com",
    "kwekuanansi.ai",
    "clawhard.com",
    "modernmustardseed.com",
    "b77.ai",
    "gumballtools.com",
    "daedalmap.com",
    "superagnt.com",
    "ainetcafe.com",
    "timzinin.com",
    "mcp.com.ai",
    "insightfulmcp.com",
    "kipper.com",
    "apify.com",
    "composio.dev",
    "zapier.com",
    "pipedream.net",
    "klavis.ai",
    "mcp.run",
    "glama.ai",
];

/// One app a person can connect.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct CatalogApp {
    pub name: String,
    pub description: String,
    pub url: String,
    /// The short name its tools are filed under: `notion`.
    pub app: String,
    /// The maker's own logo, an https address; empty when none was found.
    pub icon: String,
    /// Its sign-in was found keyless when this build's catalog was made; others are checked live.
    pub checked: bool,
}

/// The second-to-last part of a host: `mcp.notion.com` → `notion`.
pub fn app_key(url: &str) -> String {
    let host = url::Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_lowercase))
        .unwrap_or_default();
    let labels: Vec<&str> = host.split('.').collect();
    let key = match labels.as_slice() {
        [.., name, "co" | "com", _] if name.len() > 2 && labels.len() >= 3 => name,
        [.., name, _] => name,
        _ => host.as_str(),
    };
    let key: String = key.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if key.is_empty() {
        "app".to_owned()
    } else {
        key
    }
}

fn host_of(url: &str) -> Option<String> {
    url::Url::parse(url)
        .ok()
        .filter(|url| url.scheme() == "https")
        .and_then(|url| url.host_str().map(str::to_lowercase))
}

fn within(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

/// The domain a registry name's publisher proved they own: `app.linear/linear` → `linear.app`.
/// GitHub and GitLab namespaces prove only an account there, so they give none.
fn proven_domain(name: &str) -> Option<String> {
    let namespace = name.split('/').next()?.to_lowercase();
    if namespace.starts_with("io.github.") || namespace.starts_with("io.gitlab.") {
        return None;
    }
    let parts: Vec<&str> = namespace.split('.').collect();
    (parts.len() >= 2).then(|| parts.into_iter().rev().collect::<Vec<_>>().join("."))
}

/// Whether a server is run by its app's own maker, as far as the registry shows.
pub fn by_maker(name: &str, title: &str, url: &str) -> bool {
    let (Some(domain), Some(host)) = (proven_domain(name), host_of(url)) else {
        return false;
    };
    if !within(&host, &domain) {
        return false;
    }
    if HOSTS_OF_OTHERS.iter().any(|other| within(&host, other)) {
        return false;
    }
    let words = format!("{name} {title}").to_lowercase();
    let words: HashSet<&str> = words
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect();
    !BRANDS.iter().any(|(brand, owners)| {
        words.contains(brand) && !owners.iter().any(|owner| within(&host, owner))
    })
}

/// The makers, for browsing.
pub fn makers() -> Vec<CatalogApp> {
    static APPS: std::sync::LazyLock<Vec<CatalogApp>> = std::sync::LazyLock::new(|| {
        #[derive(serde::Deserialize)]
        struct Shipped {
            name: String,
            #[serde(default)]
            description: String,
            url: String,
            #[serde(default)]
            icon: String,
        }
        let shipped: Vec<Shipped> = serde_json::from_str(CATALOG).unwrap_or_default();
        let mut apps: Vec<CatalogApp> = shipped
            .into_iter()
            .filter(|item| item.url.starts_with("https://"))
            .map(|item| CatalogApp {
                app: app_key(&item.url),
                name: item.name,
                description: item.description,
                url: item.url,
                icon: item.icon,
                checked: true,
            })
            .collect();
        // A build whose catalog is missing still offers the named makers.
        if apps.is_empty() {
            apps = MAKERS
                .iter()
                .map(|(name, url)| CatalogApp {
                    name: (*name).to_owned(),
                    description: String::new(),
                    url: (*url).to_owned(),
                    app: app_key(url),
                    icon: String::new(),
                    checked: false,
                })
                .collect();
        }
        apps
    });
    APPS.clone()
}

/// Whether an app came from the shipped catalog, whose sign-ins were checked when it was built.
pub fn shipped(url: &str) -> bool {
    makers().iter().any(|app| app.url == url)
}

/// One page of the makers matching `search` (all of them when it is empty), and how many match.
pub fn page(search: &str, offset: usize, limit: usize) -> (Vec<CatalogApp>, usize) {
    let needle = search.trim().to_lowercase();
    let matching: Vec<CatalogApp> = makers()
        .into_iter()
        .filter(|app| {
            needle.is_empty()
                || app.name.to_lowercase().contains(&needle)
                || app.app.contains(&needle)
                || app.description.to_lowercase().contains(&needle)
        })
        .collect();
    let total = matching.len();
    (
        matching.into_iter().skip(offset).take(limit).collect(),
        total,
    )
}

/// The makers' servers among one registry page.
pub fn from_registry(page: &Value) -> Vec<CatalogApp> {
    let mut seen = HashSet::new();
    let mut found = Vec::new();
    for item in page["servers"].as_array().into_iter().flatten() {
        let server = &item["server"];
        let status = item["_meta"]["io.modelcontextprotocol.registry/official"]["status"]
            .as_str()
            .unwrap_or("active");
        if status != "active" {
            continue;
        }
        let name = server["name"].as_str().unwrap_or_default();
        let title = server["title"].as_str().unwrap_or_default();
        let remote = server["remotes"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|remote| remote["type"] == "streamable-http")
            .filter_map(|remote| remote["url"].as_str())
            .find(|url| by_maker(name, title, url));
        let Some(url) = remote else { continue };
        if !seen.insert(url.to_owned()) {
            continue;
        }
        let shown = if title.trim().is_empty() {
            name.rsplit('/').next().unwrap_or(name).to_owned()
        } else {
            title.trim().to_owned()
        };
        found.push(CatalogApp {
            name: super::super::client::truncate(&shown, 60),
            description: super::super::client::truncate(
                server["description"].as_str().unwrap_or_default(),
                200,
            ),
            url: url.to_owned(),
            app: app_key(url),
            icon: server["icons"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|icon| icon["src"].as_str())
                .find(|src| src.starts_with("https://"))
                .unwrap_or_default()
                .to_owned(),
            checked: false,
        });
    }
    found
}

/// Servers the registry has for `search` that the shipped catalog doesn't: makers' servers
/// published since it was built.
pub async fn search_registry(
    http: &reqwest::Client,
    search: &str,
) -> Result<Vec<CatalogApp>, String> {
    let page: Value = http
        .get(REGISTRY)
        .query(&[
            ("search", search.trim()),
            ("version", "latest"),
            ("limit", &SEARCH_LIMIT.to_string()),
        ])
        .send()
        .await
        .map_err(|_| "Misty couldn't reach the app directory. Try again.".to_owned())?
        .json()
        .await
        .map_err(|_| "The app directory gave an answer Misty can't read.".to_owned())?;
    Ok(from_registry(&page)
        .into_iter()
        .filter(|app| !shipped(&app.url))
        .collect())
}

fn checks() -> &'static Mutex<HashMap<String, (String, Instant)>> {
    static CHECKS: std::sync::OnceLock<Mutex<HashMap<String, (String, Instant)>>> =
        std::sync::OnceLock::new();
    CHECKS.get_or_init(Default::default)
}

/// What a sign-in to `url` takes (`keyless`, `open`, `needs_app` or `unreachable`), remembered for
/// a day.
pub async fn check(http: &reqwest::Client, url: &str) -> String {
    if let Some((code, at)) = checks()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get(url)
        .cloned()
    {
        if at.elapsed() < CHECK_KEPT {
            return code;
        }
    }
    let code = super::oauth::discover(http, url).await.code().to_owned();
    // An answer that may be a passing outage isn't remembered.
    if code != "unreachable" {
        checks()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(url.to_owned(), (code.clone(), Instant::now()));
    }
    code
}
