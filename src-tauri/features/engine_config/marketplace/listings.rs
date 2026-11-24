use serde_json::Value;

use super::parse::{author, text, MarketItem};

const CATALOG_LIMIT: u64 = 8 << 20;

pub(super) fn read_json(path: &std::path::Path) -> Option<Value> {
    if file_access::fs::metadata(path).ok()?.len() > CATALOG_LIMIT {
        return None;
    }
    serde_json::from_slice(&file_access::fs::read(path).ok()?).ok()
}

pub(super) fn claude_catalog_details(items: &mut [MarketItem]) {
    let plugins = crate::engine_config::support::claude_home().join("plugins");
    let Some(Value::Object(known)) = read_json(&plugins.join("known_marketplaces.json")) else {
        return;
    };
    let mut details = std::collections::HashMap::new();
    for (marketplace, entry) in known {
        let folder = entry["installLocation"]
            .as_str()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| plugins.join("marketplaces").join(&marketplace));
        let Some(catalog) = read_json(&folder.join(".claude-plugin").join("marketplace.json"))
        else {
            continue;
        };
        let repo = text(&entry["source"], "repo").filter(|repo| valid_repo(repo));
        for plugin in catalog["plugins"].as_array().into_iter().flatten() {
            let Some(name) = plugin["name"].as_str() else {
                continue;
            };
            let folder = plugin["source"]
                .as_str()
                .map(|path| path.trim_start_matches("./"))
                .filter(|path| valid_folder(path));
            let link = text(plugin, "homepage")
                .filter(|url| url.starts_with("https://"))
                .or_else(|| {
                    Some(format!(
                        "https://github.com/{}/tree/HEAD/{}",
                        repo.as_deref()?,
                        folder?
                    ))
                });
            details.insert(format!("{name}@{marketplace}"), (author(plugin), link));
        }
    }
    for item in items {
        if let Some((author, link)) = details.get(&item.id) {
            item.author = item.author.take().or_else(|| author.clone());
            item.link = item.link.take().or_else(|| link.clone());
        }
    }
}

fn valid_repo(repo: &str) -> bool {
    let mut parts = repo.split('/');
    let ok = |part: Option<&str>| {
        part.is_some_and(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        })
    };
    ok(parts.next()) && ok(parts.next()) && parts.next().is_none()
}

fn valid_folder(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && path.split('/').all(|part| {
            !part.is_empty()
                && part != ".."
                && part
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        })
}
