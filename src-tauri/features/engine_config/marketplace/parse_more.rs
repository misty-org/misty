use serde_json::Value;

use super::parse::{
    author, readable, source_link, split_id, text, valid_id, valid_name, MarketItem, MarketSource,
};

pub fn plain(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for next in chars.by_ref() {
                    if next.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

pub fn omp_sources(output: &str) -> Vec<MarketSource> {
    plain(output)
        .lines()
        .filter(|line| line.starts_with("  ") && !line.starts_with("   "))
        .filter_map(|line| {
            let line = line.trim();
            let (name, location) = line.split_once("  ")?;
            valid_name(name.trim()).then(|| MarketSource {
                name: name.trim().to_string(),
                location: location.trim().to_string(),
            })
        })
        .collect()
}

pub fn omp_available(output: &str, marketplace: &str) -> Vec<MarketItem> {
    let mut items: Vec<MarketItem> = Vec::new();
    for line in plain(output).lines() {
        if let Some(description) = line.strip_prefix("    ") {
            if let Some(last) = items.last_mut() {
                if last.description.is_empty() {
                    last.description = description.trim().to_string();
                }
            }
            continue;
        }
        let Some(entry) = line.strip_prefix("  ") else {
            continue;
        };
        let entry = entry.trim();
        let name = match entry.rsplit_once('@') {
            Some((name, _version)) if !name.is_empty() => name,
            _ => entry,
        };
        if !valid_name(name) {
            continue;
        }
        items.push(MarketItem {
            id: format!("{name}@{marketplace}"),
            name: readable(name),
            description: String::new(),
            engine: "omp".into(),
            marketplace: marketplace.to_string(),
            category: None,
            installed: false,
            enabled: false,
            installs: None,
            link: None,
            sign_in: None,
            stars: None,
            author: None,
        });
    }
    items
}

pub fn omp_mark_installed(items: &mut Vec<MarketItem>, listing: &Value) {
    for entry in listing["marketplace"].as_array().into_iter().flatten() {
        let Some(id) = text(entry, "id") else {
            continue;
        };
        let enabled = entry["entries"][0]["enabled"].as_bool().unwrap_or(true);
        if let Some(item) = items.iter_mut().find(|item| item.id == id) {
            item.installed = true;
            item.enabled = enabled;
            continue;
        }
        let (name, marketplace) = split_id(&id);
        items.push(MarketItem {
            name: readable(&name),
            description: String::new(),
            engine: "omp".into(),
            marketplace,
            category: None,
            installed: true,
            enabled,
            installs: None,
            link: None,
            sign_in: None,
            stars: None,
            author: None,
            id,
        });
    }
}

pub fn loose_items(engine: &str, listing: &Value) -> Vec<MarketItem> {
    let lists: Vec<(&Value, bool)> = if listing.is_array() {
        vec![(listing, false)]
    } else {
        vec![
            (&listing["installed"], true),
            (&listing["available"], false),
            (&listing["plugins"], false),
        ]
    };
    let entries = lists.into_iter().flat_map(|(list, installed)| {
        list.as_array()
            .into_iter()
            .flatten()
            .map(move |entry| (entry, installed))
    });
    let mut items: Vec<MarketItem> = Vec::new();
    for (entry, listed_installed) in entries {
        let marketplace = text(entry, "marketplaceName")
            .or_else(|| text(entry, "marketplace"))
            .unwrap_or_default();
        let id = text(entry, "pluginId")
            .or_else(|| text(entry, "id"))
            .or_else(|| {
                let name = text(entry, "name")?;
                (!marketplace.is_empty()).then(|| format!("{name}@{marketplace}"))
            });
        let Some(id) = id.filter(|id| valid_id(id)) else {
            continue;
        };
        let installed = entry["installed"].as_bool().unwrap_or(listed_installed);
        if let Some(existing) = items.iter_mut().find(|item| item.id == id) {
            existing.installed |= installed;
            continue;
        }
        let (name, from_id) = split_id(&id);
        items.push(MarketItem {
            name: text(entry, "displayName")
                .unwrap_or_else(|| readable(&text(entry, "name").unwrap_or(name))),
            description: text(entry, "description").unwrap_or_default(),
            engine: engine.to_string(),
            marketplace: if marketplace.is_empty() {
                from_id
            } else {
                marketplace
            },
            category: text(entry, "category"),
            installed,
            enabled: entry["enabled"].as_bool().unwrap_or(installed),
            installs: entry["installCount"]
                .as_u64()
                .or_else(|| entry["installs"].as_u64()),
            link: text(entry, "homepage").or_else(|| source_link(&entry["source"])),
            sign_in: None,
            stars: None,
            author: author(entry),
            id,
        });
    }
    items
}

pub fn loose_sources(listing: &Value) -> Vec<MarketSource> {
    let list = if listing.is_array() {
        listing
    } else {
        &listing["marketplaces"]
    };
    list.as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let name = text(entry, "name")?;
            let location = text(entry, "repo")
                .or_else(|| text(entry, "url"))
                .or_else(|| text(entry, "source"))
                .or_else(|| text(&entry["source"], "repo"))
                .or_else(|| text(&entry["source"], "url"))
                .or_else(|| text(entry, "path"))
                .unwrap_or_default();
            Some(MarketSource { name, location })
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq)]
pub struct InstalledExtension {
    pub name: String,
    pub description: String,
    pub source: Option<String>,
}

pub fn gallery_items(
    engine: &str,
    gallery: &Value,
    installed: &[InstalledExtension],
) -> Vec<MarketItem> {
    let mut matched = vec![false; installed.len()];
    let mut items: Vec<MarketItem> = gallery
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let url = text(entry, "url").filter(|url| valid_gallery_url(url))?;
            let name = text(entry, "extensionName").or_else(|| text(entry, "fullName"))?;
            let found = installed.iter().position(|extension| {
                extension.name.eq_ignore_ascii_case(&name)
                    || extension
                        .source
                        .as_deref()
                        .is_some_and(|source| source.trim_end_matches(".git") == url)
            });
            if let Some(at) = found {
                matched[at] = true;
            }
            Some(MarketItem {
                id: if found.is_some() {
                    installed[found?].name.clone()
                } else {
                    url.clone()
                },
                name: readable(&name),
                description: text(entry, "extensionDescription")
                    .or_else(|| text(entry, "repoDescription"))
                    .unwrap_or_default(),
                engine: engine.to_string(),
                marketplace: text(entry, "fullName").unwrap_or_default(),
                category: None,
                installed: found.is_some(),
                enabled: found.is_some(),
                installs: None,
                link: Some(url),
                sign_in: None,
                stars: entry["stars"].as_u64(),
                author: None,
            })
        })
        .collect();
    for (extension, seen) in installed.iter().zip(matched) {
        if seen {
            continue;
        }
        items.push(MarketItem {
            id: extension.name.clone(),
            name: readable(&extension.name),
            description: extension.description.clone(),
            engine: engine.to_string(),
            marketplace: String::new(),
            category: None,
            installed: true,
            enabled: true,
            installs: None,
            link: extension
                .source
                .clone()
                .filter(|url| url.starts_with("https://")),
            sign_in: None,
            stars: None,
            author: None,
        });
    }
    items
}

pub fn valid_gallery_url(url: &str) -> bool {
    let Some(path) = url.strip_prefix("https://github.com/") else {
        return false;
    };
    let mut parts = path.trim_end_matches('/').split('/');
    matches!(
        (parts.next(), parts.next(), parts.next()),
        (Some(owner), Some(repo), None) if valid_name(owner) && valid_name(repo)
    )
}
