use serde_json::Value;
use std::time::Duration;

use super::parse::{author, text, valid_name, MarketItem, MarketSource};
use super::parse_more::*;
use super::{parse_json, plugin_word, run_ok, LIST_LIMIT};

const GALLERY_URL: &str = "https://geminicli.com/extensions.json";
const GALLERY_KEPT: Duration = Duration::from_secs(60 * 60);
const GALLERY_LIMIT: usize = 16 << 20;

pub(super) async fn list_loose(
    engine: &'static str,
) -> Result<(Vec<MarketItem>, Vec<MarketSource>), String> {
    let word = plugin_word(engine);
    let available = [word, "list", "--available", "--json"];
    let installed = [word, "list", "--json"];
    let marketplaces: &[&str] = &[word, "marketplace", "list", "--json"];
    let plugins = match run_ok(engine, &available, LIST_LIMIT).await {
        Ok(output) => parse_json(engine, &output)?,
        Err(_) => {
            let installed = parse_json(engine, &run_ok(engine, &installed, LIST_LIMIT).await?)?;
            let installed = match installed {
                Value::Array(_) => installed,
                mut listing => listing["installed"].take(),
            };
            serde_json::json!({ "installed": installed, "available": Vec::<Value>::new() })
        }
    };
    let sources = run_ok(engine, marketplaces, LIST_LIMIT).await;
    let sources = sources
        .ok()
        .and_then(|text| parse_json(engine, &text).ok())
        .map(|value| loose_sources(&value))
        .unwrap_or_default();
    Ok((loose_items(engine, &plugins), sources))
}

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

static GALLERY: std::sync::Mutex<Option<(std::time::Instant, std::sync::Arc<Value>)>> =
    std::sync::Mutex::new(None);

async fn gallery() -> Result<std::sync::Arc<Value>, String> {
    if let Some((at, value)) = GALLERY
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .as_ref()
    {
        if at.elapsed() < GALLERY_KEPT {
            return Ok(value.clone());
        }
    }
    let failed = || "Gemini's extension gallery couldn't be reached.".to_string();
    let response = crate::engine_config::support::http_client()?
        .get(GALLERY_URL)
        .send()
        .await
        .map_err(|_| failed())?;
    if !response.status().is_success() {
        return Err(failed());
    }
    let bytes = response.bytes().await.map_err(|_| failed())?;
    if bytes.len() > GALLERY_LIMIT {
        return Err(failed());
    }
    let value = std::sync::Arc::new(serde_json::from_slice::<Value>(&bytes).map_err(|_| failed())?);
    *GALLERY
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) =
        Some((std::time::Instant::now(), value.clone()));
    Ok(value)
}

fn extension_folder(engine: &str) -> (std::path::PathBuf, &'static [&'static str]) {
    match engine {
        "gemini" => (
            crate::engine_config::support::engine_home(Some("GEMINI_CLI_HOME"), ".gemini")
                .join("extensions"),
            &["gemini-extension.json"],
        ),
        _ => (
            crate::engine_config::support::engine_home(None, ".qwen").join("extensions"),
            &["qwen-extension.json", "gemini-extension.json"],
        ),
    }
}

fn installed_extensions(engine: &str) -> Vec<InstalledExtension> {
    let (folder, manifests) = extension_folder(engine);
    let Ok(entries) = file_access::fs::read_dir(&folder) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let dir = entry.path();
            let manifest = manifests.iter().find_map(|name| {
                let bytes = file_access::fs::read(dir.join(name)).ok()?;
                serde_json::from_slice::<Value>(&bytes).ok()
            })?;
            let name = manifest["name"].as_str()?.trim().to_string();
            if !valid_name(&name) {
                return None;
            }
            let source = [
                ".gemini-extension-install.json",
                ".qwen-extension-install.json",
            ]
            .iter()
            .find_map(|record| {
                let bytes = file_access::fs::read(dir.join(record)).ok()?;
                let value = serde_json::from_slice::<Value>(&bytes).ok()?;
                value["source"].as_str().map(str::to_string)
            });
            Some(InstalledExtension {
                description: manifest["description"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
                name,
                source,
            })
        })
        .collect()
}

pub(super) async fn list_gallery(
    engine: &'static str,
) -> Result<(Vec<MarketItem>, Vec<MarketSource>), String> {
    let gallery = gallery().await?;
    let installed = tokio::task::spawn_blocking(move || installed_extensions(engine))
        .await
        .unwrap_or_default();
    let source = MarketSource {
        name: "Gemini extension gallery".into(),
        location: GALLERY_URL.into(),
    };
    Ok((gallery_items(engine, &gallery, &installed), vec![source]))
}
