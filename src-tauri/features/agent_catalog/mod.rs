// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use file_access::fs;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;

const PROVIDER_ID: &str = "agency-agents";
const CATALOG_DIR: &str = "agent-catalogs";
const ARCHIVE: &str = "agency-agents.tar.zst";
const MOST_CATALOG_BYTES: u64 = 64 * 1024 * 1024;
const SOURCE_URL: &str = "https://github.com/msitarzewski/agency-agents";
const SOURCE_REVISION: &str = "459dce837db3bdfdc4763d3fefd1fd854e73c8f1";

#[derive(Debug, Clone, Deserialize)]
struct LocalizedText {
    en: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogDivision {
    id: String,
    order: usize,
    count: usize,
    icon: Option<String>,
    color: Option<String>,
    label: LocalizedText,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogManifest {
    schema_version: u32,
    provider_id: String,
    display_name: String,
    source_url: String,
    source_revision: String,
    license: String,
    division_count: usize,
    agent_count: usize,
    divisions: Vec<CatalogDivision>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogAgent {
    id: String,
    provider_id: String,
    division_id: String,
    source_revision: String,
    prompt_path: String,
    prompt_hash: String,
    name: LocalizedText,
    description: LocalizedText,
    emoji: Option<String>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    vibe: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogAgentsDocument {
    schema_version: u32,
    agents: Vec<CatalogAgent>,
}

#[derive(Debug, Clone)]
struct LoadedCatalog {
    archive: PathBuf,
    manifest: CatalogManifest,
    agents: Vec<CatalogAgent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogProviderView {
    id: String,
    display_name: String,
    source_url: String,
    source_revision: String,
    license: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogDivisionView {
    id: String,
    order: usize,
    icon: Option<String>,
    color: Option<String>,
    label: String,
    count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogAgentView {
    id: String,
    division_id: String,
    name: String,
    description: String,
    icon: Option<String>,
    color: Option<String>,
    vibe: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogView {
    provider: CatalogProviderView,
    divisions: Vec<CatalogDivisionView>,
    agents: Vec<CatalogAgentView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPrompt {
    id: String,
    name: String,
    description: String,
    icon: Option<String>,
    prompt: String,
    prompt_hash: String,
}

fn validate_agent_id(id: &str) -> Result<(), String> {
    let Some(path) = id.strip_prefix("agency-agents:") else {
        return Err("A persona's id must start with `agency-agents:`.".to_string());
    };
    validate_safe_relative_path(path, "persona id")
}

fn validate_safe_relative_path(value: &str, label: &str) -> Result<(), String> {
    if value.trim() != value || value.is_empty() || value.contains('\\') || value.contains(':') {
        return Err(format!("Unsafe {label} `{value}`."));
    }
    let path = Path::new(value);
    if path.is_absolute() {
        return Err(format!("Unsafe {label} `{value}`."));
    }
    for component in path.components() {
        if matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_) | Component::CurDir
        ) {
            return Err(format!("Unsafe {label} `{value}`."));
        }
    }
    Ok(())
}

fn archive_candidates(resource_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(root) = resource_dir {
        candidates.push(root.join(CATALOG_DIR).join(ARCHIVE));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(executable_dir) = executable.parent() {
            if cfg!(target_os = "macos") {
                if let Some(contents_dir) = executable_dir.parent() {
                    candidates.push(
                        contents_dir
                            .join("Resources")
                            .join(CATALOG_DIR)
                            .join(ARCHIVE),
                    );
                }
            }
            candidates.push(executable_dir.join(CATALOG_DIR).join(ARCHIVE));
        }
    }
    if cfg!(debug_assertions) {
        candidates.push(PathBuf::from(env!("MISTY_AGENT_CATALOG")));
    }
    candidates
}

#[allow(
    clippy::disallowed_methods,
    reason = "probes where the persona catalog is installed before granting that folder"
)]
fn is_archive(candidate: &Path) -> bool {
    candidate.is_file()
}

fn resolve_archive(resource_dir: Option<&Path>) -> Result<PathBuf, String> {
    let found = archive_candidates(resource_dir)
        .into_iter()
        .find(|candidate| is_archive(candidate))
        .ok_or_else(|| {
            "The persona catalog isn't installed with this copy of Misty.".to_string()
        })?;
    if let Some(folder) = found.parent() {
        file_access::allow_bundled_resources(folder);
    }
    Ok(found)
}

fn unpack(archive: &Path, wanted: &[&str]) -> Result<HashMap<String, Vec<u8>>, String> {
    let unreadable = |error: std::io::Error| format!("Couldn't read the persona catalog: {error}");
    let file = fs::File::open(archive).map_err(unreadable)?;
    let decoder = zstd::stream::read::Decoder::new(file).map_err(unreadable)?;
    let mut entries = tar::Archive::new(decoder.take(MOST_CATALOG_BYTES));
    let mut found = HashMap::new();
    for entry in entries.entries().map_err(unreadable)? {
        let mut entry = entry.map_err(unreadable)?;
        let name = entry
            .path()
            .map_err(unreadable)?
            .to_string_lossy()
            .into_owned();
        if wanted.contains(&name.as_str()) && !found.contains_key(&name) {
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).map_err(unreadable)?;
            found.insert(name, bytes);
            if found.len() == wanted.len() {
                break;
            }
        }
    }
    Ok(found)
}

fn parse<T: for<'de> Deserialize<'de>>(
    files: &HashMap<String, Vec<u8>>,
    name: &str,
    label: &str,
) -> Result<T, String> {
    let bytes = files
        .get(name)
        .ok_or_else(|| format!("Couldn't read {label}: it isn't in the catalog."))?;
    serde_json::from_slice(bytes).map_err(|error| format!("The {label} isn't valid: {error}"))
}

fn load_catalog(archive: PathBuf) -> Result<LoadedCatalog, String> {
    let files = unpack(&archive, &["manifest.json", "agents.json"])?;
    let manifest: CatalogManifest = parse(&files, "manifest.json", "catalog manifest")?;
    let document: CatalogAgentsDocument = parse(&files, "agents.json", "catalog entries")?;
    if manifest.schema_version != 1 || document.schema_version != 1 {
        return Err("This persona catalog's version isn't supported.".to_string());
    }
    if manifest.provider_id != PROVIDER_ID
        || manifest.source_url != SOURCE_URL
        || manifest.source_revision != SOURCE_REVISION
        || manifest.license != "MIT"
    {
        return Err("This persona catalog's source or license isn't the bundled one.".to_string());
    }
    if manifest.division_count != manifest.divisions.len()
        || manifest.agent_count != document.agents.len()
    {
        return Err("The persona catalog's counts don't match.".to_string());
    }
    let division_ids: HashSet<&str> = manifest
        .divisions
        .iter()
        .map(|division| division.id.as_str())
        .collect();
    let mut agent_ids = HashSet::new();
    for agent in &document.agents {
        validate_agent_id(&agent.id)?;
        validate_safe_relative_path(&agent.prompt_path, "prompt path")?;
        if agent.provider_id != PROVIDER_ID
            || agent.source_revision != manifest.source_revision
            || !division_ids.contains(agent.division_id.as_str())
            || !agent_ids.insert(agent.id.as_str())
        {
            return Err(format!("The catalog entry `{}` isn't valid.", agent.id));
        }
    }
    Ok(LoadedCatalog {
        archive,
        manifest,
        agents: document.agents,
    })
}

fn catalog(app: &tauri::AppHandle) -> Result<&'static LoadedCatalog, String> {
    static LOADED: OnceLock<LoadedCatalog> = OnceLock::new();
    if let Some(loaded) = LOADED.get() {
        return Ok(loaded);
    }
    let resource_dir = app.path().resource_dir().ok();
    let loaded = load_catalog(resolve_archive(resource_dir.as_deref())?)?;
    Ok(LOADED.get_or_init(|| loaded))
}

fn build_catalog_view(catalog: &LoadedCatalog) -> CatalogView {
    let mut divisions: Vec<CatalogDivisionView> = catalog
        .manifest
        .divisions
        .iter()
        .map(|division| CatalogDivisionView {
            id: division.id.clone(),
            order: division.order,
            icon: division.icon.clone(),
            color: division.color.clone(),
            label: division.label.en.clone(),
            count: division.count,
        })
        .collect();
    divisions.sort_by_key(|division| division.order);
    let agents = catalog
        .agents
        .iter()
        .map(|agent| CatalogAgentView {
            id: agent.id.clone(),
            division_id: agent.division_id.clone(),
            name: agent.name.en.clone(),
            description: agent.description.en.clone(),
            icon: agent.emoji.clone(),
            color: agent.color.clone(),
            vibe: agent.vibe.clone(),
        })
        .collect();
    CatalogView {
        provider: CatalogProviderView {
            id: catalog.manifest.provider_id.clone(),
            display_name: catalog.manifest.display_name.clone(),
            source_url: catalog.manifest.source_url.clone(),
            source_revision: catalog.manifest.source_revision.clone(),
            license: catalog.manifest.license.clone(),
        },
        divisions,
        agents,
    }
}

fn resolve_prompt<'a>(
    catalog: &'a LoadedCatalog,
    agent_id: &str,
) -> Result<(&'a CatalogAgent, String), String> {
    validate_agent_id(agent_id)?;
    let agent = catalog
        .agents
        .iter()
        .find(|entry| entry.id == agent_id)
        .ok_or_else(|| format!("There's no persona `{agent_id}`."))?;
    let prompt = unpack(&catalog.archive, &[agent.prompt_path.as_str()])?
        .remove(&agent.prompt_path)
        .ok_or_else(|| "Couldn't read the persona's prompt: it isn't in the catalog.".to_string())
        .and_then(|bytes| {
            String::from_utf8(bytes)
                .map_err(|_| "Couldn't read the persona's prompt: it isn't text.".to_string())
        })?;
    if prompt.trim().is_empty() {
        return Err(format!("The persona `{agent_id}` has an empty prompt."));
    }
    let actual_hash = format!("{:x}", Sha256::digest(prompt.as_bytes()));
    if !actual_hash.eq_ignore_ascii_case(&agent.prompt_hash) {
        return Err(format!(
            "The persona `{agent_id}` doesn't match the bundled pack."
        ));
    }
    Ok((agent, prompt))
}

#[tauri::command]
pub async fn agent_catalog_list(app: tauri::AppHandle) -> Result<CatalogView, String> {
    tauri::async_runtime::spawn_blocking(move || catalog(&app).map(build_catalog_view))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn agent_catalog_prompt(
    app: tauri::AppHandle,
    agent_id: String,
) -> Result<CatalogPrompt, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let catalog = catalog(&app)?;
        let (agent, prompt) = resolve_prompt(catalog, agent_id.trim())?;
        Ok(CatalogPrompt {
            id: agent.id.clone(),
            name: agent.name.en.clone(),
            description: agent.description.en.clone(),
            icon: agent.emoji.clone(),
            prompt,
            prompt_hash: agent.prompt_hash.clone(),
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_packed_catalog_loads_and_every_prompt_matches_its_hash() {
        let archive = resolve_archive(None).expect("the packed catalog");
        let catalog = load_catalog(archive).expect("the bundled catalog");
        assert_eq!(catalog.agents.len(), catalog.manifest.agent_count);
        for agent in &catalog.agents {
            resolve_prompt(&catalog, &agent.id).expect("a matching prompt");
        }
    }

    #[test]
    fn ids_and_paths_that_climb_out_are_refused() {
        assert!(validate_agent_id("agency-agents:../secrets").is_err());
        assert!(validate_agent_id("other:design/x").is_err());
        assert!(validate_safe_relative_path("/etc/passwd", "path").is_err());
        assert!(validate_agent_id("agency-agents:design/design-ui-designer").is_ok());
    }
}
