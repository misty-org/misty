//! Listing the plugins of the engines whose CLIs don't answer like Claude Code and Codex: Oh My
//! Pi, Qoder, CodeBuddy and MiniMax, and Gemini CLI and Qwen Code, which install from Gemini's
//! public extension gallery.

use serde_json::Value;
use std::time::Duration;

use super::parse::{valid_name, MarketItem, MarketSource};
use super::parse_more::*;
use super::{parse_json, plugin_word, run_ok, LIST_LIMIT};

/// Gemini's public extension gallery: every extension it lists, ranked by GitHub stars.
const GALLERY_URL: &str = "https://geminicli.com/extensions.json";
/// The gallery changes daily at most; it's read again after this long.
const GALLERY_KEPT: Duration = Duration::from_secs(60 * 60);
/// The gallery is a couple of megabytes; anything far bigger is not it.
const GALLERY_LIMIT: usize = 16 << 20;

/// Oh My Pi lists what it has installed as JSON, and each marketplace's plugins as text.
pub(super) async fn list_omp() -> Result<(Vec<MarketItem>, Vec<MarketSource>), String> {
    let (installed, sources) = tokio::join!(
        run_ok("omp", &["plugin", "list", "--json"], LIST_LIMIT),
        run_ok("omp", &["plugin", "marketplace", "list"], LIST_LIMIT),
    );
    let installed = parse_json("omp", &installed?)?;
    let sources = omp_sources(&sources?);
    let listings = futures_util::future::join_all(sources.iter().map(|source| async move {
        let output = run_ok("omp", &["plugin", "discover", &source.name], LIST_LIMIT).await;
        omp_available(&output.unwrap_or_default(), &source.name)
    }))
    .await;
    let mut items: Vec<MarketItem> = listings.into_iter().flatten().collect();
    omp_mark_installed(&mut items, &installed);
    Ok((items, sources))
}

/// Qoder, CodeBuddy and MiniMax: Claude-style `plugin list --available --json`. CodeBuddy's docs
/// show `--json` but not `--available`, so a refusal falls back to the installed list.
pub(super) async fn list_loose(engine: &'static str) -> Result<(Vec<MarketItem>, Vec<MarketSource>), String> {
    let word = plugin_word(engine);
    let available = [word, "list", "--available", "--json"];
    let installed = [word, "list", "--json"];
    let marketplaces = [word, "marketplace", "list", "--json"];
    let (plugins, sources) = tokio::join!(
        async {
            match run_ok(engine, &available, LIST_LIMIT).await {
                Ok(output) => Ok(output),
                Err(_) => run_ok(engine, &installed, LIST_LIMIT).await,
            }
        },
        run_ok(engine, &marketplaces, LIST_LIMIT),
    );
    let plugins = parse_json(engine, &plugins?)?;
    let sources = sources
        .ok()
        .and_then(|text| parse_json(engine, &text).ok())
        .map(|value| loose_sources(&value))
        .unwrap_or_default();
    Ok((loose_items(engine, &plugins), sources))
}

static GALLERY: std::sync::Mutex<Option<(std::time::Instant, std::sync::Arc<Value>)>> =
    std::sync::Mutex::new(None);

/// Gemini's extension gallery, kept for an hour. It's public: nothing about the person goes with
/// the request.
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

/// Where an engine keeps its extensions, and the manifest and install-record names it uses.
fn extension_folder(engine: &str) -> (std::path::PathBuf, &'static [&'static str]) {
    match engine {
        "gemini" => (
            crate::engine_config::support::engine_home(Some("GEMINI_CLI_HOME"), ".gemini").join("extensions"),
            &["gemini-extension.json"],
        ),
        _ => (
            crate::engine_config::support::engine_home(None, ".qwen").join("extensions"),
            &["qwen-extension.json", "gemini-extension.json"],
        ),
    }
}

/// The extensions an engine has installed, from each folder's manifest and install record.
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

/// Gemini CLI and Qwen Code: the gallery, with what the engine has installed marked.
pub(super) async fn list_gallery(engine: &'static str) -> Result<(Vec<MarketItem>, Vec<MarketSource>), String> {
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
