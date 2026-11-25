use std::path::{Path, PathBuf};

use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::bundles::{read_inside, unpacked};
use super::files::{blob, RegistryFile};
use crate::app::runtime::MistyRuntime;
use crate::engine_config::marketplace::{self, InstallOutcome};

const MARKETPLACE: &str = "misty-registry";
const NATIVE: &[&str] = &["claude", "codex"];
const MAX_SAMPLE_BYTES: u64 = 4 << 20;
const MAX_TEXT_BYTES: u64 = 512 << 10;

fn person_window(webview: &tauri::Webview) -> Result<(), String> {
    if crate::browser::app_windows::is_person_window(webview.label()) {
        Ok(())
    } else {
        Err("Only a profile's window can do this.".into())
    }
}

fn store(app: &AppHandle) -> database::store::Store {
    app.state::<MistyRuntime>().environment.store()
}

fn home() -> Result<PathBuf, String> {
    file_access::paths::misty_home_dir().ok_or_else(|| "Misty has no data folder.".to_owned())
}

fn plain(part: &str) -> bool {
    !part.is_empty()
        && part.len() <= 120
        && !part.starts_with(['-', '.'])
        && part
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Placed {
    engine: String,
    how: String,
    #[serde(default)]
    skills: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRecord {
    kind: String,
    id: String,
    digest: String,
    name: String,
    placed: Vec<Placed>,
    installed_at: i64,
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

fn record(app: &AppHandle, kind: &str, id: &str, digest: &str, name: &str, placed: &[Placed]) -> Result<(), String> {
    let placed = serde_json::to_string(&json!({ "name": name, "placed": placed })).map_err(|error| error.to_string())?;
    store(app)
        .connect()
        .and_then(|connection| {
            connection.execute(
                "INSERT OR REPLACE INTO registry_installs(kind, id, digest, placed, installed_at) VALUES(?1, ?2, ?3, ?4, ?5)",
                params![kind, id, digest, placed, now()],
            )
        })
        .map(drop)
        .map_err(|error| error.to_string())
}

fn records(app: &AppHandle) -> Result<Vec<InstallRecord>, String> {
    let connection = store(app).connect().map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare("SELECT kind, id, digest, placed, installed_at FROM registry_installs")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|(kind, id, digest, placed, installed_at)| {
            let body: Value = serde_json::from_str(&placed).unwrap_or(Value::Null);
            InstallRecord {
                kind,
                id,
                digest,
                name: body.get("name").and_then(Value::as_str).unwrap_or("").to_string(),
                placed: body
                    .get("placed")
                    .cloned()
                    .and_then(|value| serde_json::from_value(value).ok())
                    .unwrap_or_default(),
                installed_at,
            }
        })
        .collect();
    Ok(rows)
}

fn forget(app: &AppHandle, kind: &str, id: &str) -> Result<(), String> {
    store(app)
        .connect()
        .and_then(|connection| {
            connection.execute(
                "DELETE FROM registry_installs WHERE kind = ?1 AND id = ?2",
                params![kind, id],
            )
        })
        .map(drop)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn registry_installs(app: AppHandle) -> Result<Vec<InstallRecord>, String> {
    records(&app)
}

fn marketplace_dir() -> Result<PathBuf, String> {
    Ok(home()?.join("registry-plugins"))
}

fn manifest_of(folder: &Path) -> Value {
    file_access::fs::read_to_string(folder.join(".claude-plugin").join("plugin.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(Value::Null)
}

fn write_marketplace(root: &Path) -> Result<(), String> {
    let mut plugins = Vec::new();
    if let Ok(entries) = file_access::fs::read_dir(root.join("plugins")) {
        let mut folders: Vec<PathBuf> = entries.filter_map(Result::ok).map(|entry| entry.path()).collect();
        folders.sort();
        for folder in folders {
            let manifest = manifest_of(&folder);
            let Some(name) = manifest.get("name").and_then(Value::as_str) else {
                continue;
            };
            let Some(dir) = folder.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            plugins.push(json!({
                "name": name,
                "source": format!("./plugins/{dir}"),
                "description": manifest.get("description").cloned().unwrap_or(Value::Null),
            }));
        }
    }
    let catalog = json!({ "name": MARKETPLACE, "owner": { "name": "Misty" }, "plugins": plugins });
    file_access::fs::create_dir_all(root.join(".claude-plugin")).map_err(|error| error.to_string())?;
    file_access::fs::write(
        root.join(".claude-plugin").join("marketplace.json"),
        serde_json::to_vec_pretty(&catalog).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    file_access::fs::create_dir_all(to)?;
    for entry in file_access::fs::read_dir(from)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let target = to.join(entry.file_name());
        if kind.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if kind.is_file() && entry.file_name() != ".misty-unpacked" {
            file_access::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

const COMPONENTS: &[&str] = &[".claude-plugin", ".codex-plugin", "skills", "commands", "agents", "hooks", "hooks.json", ".mcp.json"];

fn relative(path: &str) -> Option<PathBuf> {
    let mut clean = PathBuf::new();
    for part in Path::new(path).components() {
        match part {
            std::path::Component::Normal(name) => clean.push(name),
            std::path::Component::CurDir => {}
            _ => return None,
        }
    }
    Some(clean)
}

fn skill_folders(dir: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) {
        if file_access::fs::is_file(dir.join("SKILL.md")) {
            found.push(dir.to_path_buf());
            return;
        }
        if depth == 0 {
            return;
        }
        let mut children: Vec<PathBuf> = file_access::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| !matches!(name, ".git" | ".claude-plugin" | ".codex-plugin" | "node_modules"))
            })
            .collect();
        children.sort();
        for child in children {
            walk(&child, depth - 1, found);
        }
    }
    let mut found = Vec::new();
    walk(dir, 4, &mut found);
    found
}

fn skill_name(folder: &Path, fallback: &str) -> String {
    file_access::fs::read_to_string(folder.join("SKILL.md"))
        .ok()
        .and_then(|text| {
            let front = text.strip_prefix("---")?.split("\n---").next()?.to_string();
            front.lines().find_map(|line| {
                let value = line.trim().strip_prefix("name:")?.trim().trim_matches(['"', '\'']);
                plain(value).then(|| value.to_string())
            })
        })
        .unwrap_or_else(|| fallback.to_string())
}

fn gather_skills(mine: &Path, manifest: &mut Value, fallback: &str) -> std::io::Result<bool> {
    let skills = mine.join("skills");
    let declared: Vec<String> = match manifest.get("skills") {
        Some(Value::String(one)) => vec![one.clone()],
        Some(Value::Array(many)) => many.iter().filter_map(Value::as_str).map(str::to_string).collect(),
        _ => Vec::new(),
    };
    if declared.is_empty() && file_access::fs::is_dir(&skills) {
        return Ok(false);
    }
    let mut folders: Vec<PathBuf> = if declared.is_empty() {
        skill_folders(mine)
    } else {
        declared
            .iter()
            .filter_map(|path| relative(path))
            .map(|path| mine.join(path))
            .filter(|path| file_access::fs::is_dir(path))
            .flat_map(|path| skill_folders(&path))
            .collect()
    };
    folders.sort_by_key(|folder| folder == mine);
    folders.dedup();
    if folders.is_empty() {
        return Ok(false);
    }
    for folder in folders {
        if folder.parent() == Some(skills.as_path()) {
            continue;
        }
        if folder == mine {
            let target = skills.join(skill_name(mine, fallback));
            if file_access::fs::exists(&target) {
                continue;
            }
            file_access::fs::create_dir_all(&target)?;
            for entry in file_access::fs::read_dir(mine)?.filter_map(Result::ok) {
                let file_name = entry.file_name();
                if file_name.to_str().is_some_and(|name| COMPONENTS.contains(&name)) {
                    continue;
                }
                file_access::fs::rename(entry.path(), target.join(file_name))?;
            }
            continue;
        }
        let own = folder.file_name().and_then(|name| name.to_str()).filter(|name| plain(name)).map(str::to_string);
        let target = skills.join(own.unwrap_or_else(|| skill_name(&folder, fallback)));
        if !file_access::fs::exists(&target) {
            file_access::fs::create_dir_all(&skills)?;
            file_access::fs::rename(&folder, &target)?;
        }
    }
    if let Some(fields) = manifest.as_object_mut() {
        fields.remove("skills");
    }
    Ok(true)
}

fn engine_name(engine: &str) -> Option<&'static str> {
    NATIVE.iter().copied().find(|known| *known == engine)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRequest {
    id: String,
    #[serde(default)]
    description: String,
    repo: String,
    commit: String,
    path: String,
    bundle: RegistryFile,
    #[serde(default)]
    native: Vec<String>,
    #[serde(default)]
    skill_targets: Vec<String>,
    #[serde(default)]
    accept: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "result")]
pub enum PluginOutcome {
    Installed { placed: Vec<Placed> },
    ConfirmCommand { engine: String, command: marketplace::ShownCommand },
}

#[tauri::command]
pub async fn registry_plugin_install(
    webview: tauri::Webview,
    app: AppHandle,
    request: PluginRequest,
) -> Result<PluginOutcome, String> {
    person_window(&webview)?;
    let (name, outcome) = place_plugin(&request).await?;
    if let PluginOutcome::Installed { placed } = &outcome {
        record(&app, "plugins", &request.id, &request.bundle.sha256, &name, placed)?;
    }
    Ok(outcome)
}

async fn place_plugin(request: &PluginRequest) -> Result<(String, PluginOutcome), String> {
    if !plain(&request.id) {
        return Err("That isn't a plugin Misty can install.".into());
    }
    let folder = unpacked(&request.bundle).await?;
    let mut manifest = manifest_of(&folder);
    let name = manifest
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| plain(name))
        .map(str::to_string)
        .unwrap_or_else(|| request.id.clone());
    let root = marketplace_dir()?;
    let mine = root.join("plugins").join(&request.id);
    let _ = file_access::fs::remove_dir_all(&mine);
    copy_tree(&folder, &mine).map_err(|error| error.to_string())?;
    let fallback = request.path.rsplit('/').find(|part| plain(part)).unwrap_or(&name).to_string();
    let gathered = gather_skills(&mine, &mut manifest, &fallback).map_err(|error| error.to_string())?;
    if manifest.is_null() || gathered {
        if manifest.is_null() {
            manifest = json!({ "name": name, "description": request.description });
        }
        file_access::fs::create_dir_all(mine.join(".claude-plugin")).map_err(|error| error.to_string())?;
        file_access::fs::write(
            mine.join(".claude-plugin").join("plugin.json"),
            serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
    }
    write_marketplace(&root)?;
    let source = root.to_string_lossy().into_owned();
    let qualified = format!("{name}@{MARKETPLACE}");
    let mut placed = Vec::new();
    for engine in request.native.iter().filter_map(|engine| engine_name(engine)) {
        if marketplace::add_source(engine, &source).await.is_err() && engine == "claude" {
            let _ = marketplace::run_ok(engine, &["plugin", "marketplace", "update", MARKETPLACE], std::time::Duration::from_secs(60)).await;
        }
        match marketplace::install(engine, &qualified, request.accept.clone()).await? {
            InstallOutcome::Installed => placed.push(Placed { engine: engine.into(), how: "plugin".into(), skills: Vec::new() }),
            InstallOutcome::ConfirmCommand { command } => {
                return Ok((name, PluginOutcome::ConfirmCommand { engine: engine.into(), command }));
            }
        }
    }
    if !request.skill_targets.is_empty() {
        let mut skills = Vec::new();
        if let Ok(entries) = file_access::fs::read_dir(mine.join("skills")) {
            for entry in entries.filter_map(Result::ok) {
                let skill = entry.path();
                if !file_access::fs::is_file(skill.join("SKILL.md")) {
                    continue;
                }
                let Some(dir) = skill.file_name().and_then(|name| name.to_str()).map(str::to_string) else {
                    continue;
                };
                let (owner, repo) = request.repo.split_once('/').unwrap_or(("", ""));
                let input = json!({
                    "name": dir,
                    "description": "",
                    "directory": format!("{}/skills/{dir}", request.path.trim_matches('/')).trim_start_matches("./").trim_start_matches('/'),
                    "repoOwner": owner,
                    "repoName": repo,
                    "repoBranch": request.commit,
                });
                let installed = crate::engine_config::skills_hub::install_from_folder(skill, input, request.skill_targets.clone()).await?;
                if let Some(id) = installed.pointer("/skill/id").and_then(Value::as_str) {
                    skills.push(id.to_string());
                }
            }
        }
        for target in &request.skill_targets {
            placed.push(Placed { engine: target.clone(), how: "skills".into(), skills: skills.clone() });
        }
    }
    Ok((name, PluginOutcome::Installed { placed }))
}

#[tauri::command]
pub async fn registry_plugin_remove(webview: tauri::Webview, app: AppHandle, id: String) -> Result<(), String> {
    person_window(&webview)?;
    let Some(found) = records(&app)?.into_iter().find(|one| one.kind == "plugins" && one.id == id) else {
        return Ok(());
    };
    unplace_plugin(&id, &found.name, &found.placed).await?;
    forget(&app, "plugins", &id)
}

async fn unplace_plugin(id: &str, name: &str, placed: &[Placed]) -> Result<(), String> {
    let qualified = format!("{name}@{MARKETPLACE}");
    let mut skills = std::collections::BTreeSet::new();
    for one in placed {
        if one.how == "plugin" {
            if let Some(engine) = engine_name(&one.engine) {
                let _ = marketplace::remove(engine, &qualified).await;
            }
        }
        skills.extend(one.skills.iter().cloned());
    }
    for skill in skills {
        let _ = crate::engine_config::skills_hub::uninstall(&skill);
    }
    let root = marketplace_dir()?;
    if plain(id) {
        let _ = file_access::fs::remove_dir_all(root.join("plugins").join(id));
    }
    write_marketplace(&root)
}

#[tauri::command]
pub async fn registry_bundle_text(bundle: RegistryFile, path: Option<String>) -> Result<String, String> {
    let folder = unpacked(&bundle).await?;
    let path = match path.filter(|path| !path.is_empty()) {
        Some(path) => path,
        None => file_access::fs::read_dir(&folder)
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| name.to_lowercase().ends_with(".md"))
            .min()
            .ok_or_else(|| "The bundle holds no Markdown.".to_string())?,
    };
    read_inside(&folder, &path, MAX_TEXT_BYTES)
}

#[tauri::command]
pub async fn registry_sample(file: RegistryFile) -> Result<tauri::ipc::Response, String> {
    blob(&file, MAX_SAMPLE_BYTES).await.map(tauri::ipc::Response::new)
}

fn env_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
        && !name.starts_with(|c: char| c.is_ascii_digit())
}

fn quoted(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[tauri::command]
pub fn registry_mcp_keys(
    webview: tauri::Webview,
    server: String,
    values: Vec<(String, String)>,
) -> Result<String, String> {
    person_window(&webview)?;
    write_mcp_keys(&server, &values)
}

fn write_mcp_keys(server: &str, values: &[(String, String)]) -> Result<String, String> {
    if !plain(server) || values.iter().any(|(name, value)| !env_name(name) || value.contains('\0')) {
        return Err("Those keys can't be kept.".into());
    }
    let folder = home()?.join(".env").join("client").join("mcp");
    let file = folder.join(format!("{server}.env"));
    if values.is_empty() {
        if file_access::fs::exists(&file) {
            file_access::fs::remove_file(&file).map_err(|error| error.to_string())?;
        }
        return Ok(String::new());
    }
    file_access::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    let text: String = values
        .iter()
        .map(|(name, value)| format!("{name}={}\n", quoted(value)))
        .collect();
    file_access::fs::write(&file, text).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = file_access::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o700));
        file_access::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).map_err(|error| error.to_string())?;
    }
    Ok(file.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picked(var: &str) -> Value {
        serde_json::from_str(&std::env::var(var).unwrap_or_else(|_| panic!("set {var}"))).expect("JSON entry")
    }

    fn file_of(entry: &Value) -> RegistryFile {
        serde_json::from_value(entry["bundle"].clone()).expect("a bundle")
    }

    async fn engine_lists(engine: &str, name: &str) -> bool {
        let qualified = format!("{name}@{MARKETPLACE}");
        let out = marketplace::run_ok(engine, &["plugin", "list", "--json"], std::time::Duration::from_secs(60))
            .await
            .unwrap_or_default();
        eprintln!("{engine} plugin list: {}", out.replace(char::is_whitespace, "").chars().take(500).collect::<String>());
        out.contains(&qualified) || out.contains(&format!("\"{name}\""))
    }

    #[tokio::test]
    #[ignore = "downloads an MCP server from npm and runs Claude Code and Codex in a throwaway HOME"]
    async fn mcp_package_starts_with_its_key_from_the_root_env() {
        use crate::engine_config::mcp::add::{add_server, McpAddRequest, McpAddTarget};
        let _ = rustls::crypto::ring::default_provider().install_default();
        file_access::paths::isolate_for_tests();
        let home = PathBuf::from(std::env::var("HOME").unwrap());
        let file = write_mcp_keys("brave-search", &[("BRAVE_API_KEY".into(), "misty's test key".into())]).unwrap();
        assert!(PathBuf::from(&file).starts_with(home.join(".misty")), "the key stays under the root");
        assert!(file.ends_with(".env/client/mcp/brave-search.env"));
        let target = || McpAddTarget::Stdio {
            command: "/bin/sh".into(),
            args: vec![
                "-c".into(),
                "set -a; . \"$0\"; set +a; exec \"$@\"".into(),
                file.clone(),
                "npx".into(),
                "-y".into(),
                "@brave/brave-search-mcp-server@2.2.0".into(),
            ],
        };
        for engine in ["claude", "codex"] {
            add_server(McpAddRequest {
                engine: engine.into(),
                name: "brave-search".into(),
                target: target(),
                env: Vec::new(),
                headers: Vec::new(),
                scope: None,
            })
            .await
            .unwrap_or_else(|error| panic!("{engine} adds the server: {error:?}"));
        }
        let claude = marketplace::run_ok("claude", &["mcp", "list"], std::time::Duration::from_secs(120)).await.unwrap();
        eprintln!("claude mcp list: {claude}");
        assert!(claude.contains("brave-search") && claude.contains("Connected"), "Claude Code starts the server with its key");
        let codex = marketplace::run_ok("codex", &["mcp", "list"], std::time::Duration::from_secs(60)).await.unwrap();
        eprintln!("codex mcp list: {codex}");
        assert!(codex.contains("brave-search"), "Codex has the server");
        let config = std::fs::read_to_string(home.join(".claude.json")).unwrap_or_default();
        assert!(!config.contains("misty's test key"), "the key never sits in the engine's config");
    }

    #[tokio::test]
    #[ignore = "reaches registry.mistysys.com and runs the installed engines in a throwaway HOME"]
    async fn explore_installs_end_to_end() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        file_access::paths::isolate_for_tests();
        let home = PathBuf::from(std::env::var("HOME").unwrap());

        let sample: RegistryFile = serde_json::from_value(picked("MISTY_E2E_SAMPLE")).unwrap();
        let sound = blob(&sample, MAX_SAMPLE_BYTES).await.expect("the sample downloads and matches");
        assert_eq!(sound.len() as u64, sample.size);

        let template = picked("MISTY_E2E_TEMPLATE");
        let text = registry_bundle_text(file_of(&template), None).await.expect("the template reads");
        assert!(text.len() > 40, "the template has instructions");

        let skill = picked("MISTY_E2E_SKILL");
        let (owner, repo) = skill["source"]["repo"].as_str().unwrap().split_once('/').unwrap();
        let installed = crate::engine_config::skills_hub::install_from_folder(
            unpacked(&file_of(&skill)).await.expect("the skill unpacks"),
            json!({
                "name": skill["name"], "description": skill["description"],
                "directory": skill["source"]["path"], "repoOwner": owner, "repoName": repo,
                "repoBranch": skill["source"]["commit"],
            }),
            vec!["claude".into()],
        )
        .await
        .expect("the skill installs");
        let directory = installed.pointer("/skill/directory").and_then(Value::as_str).unwrap().to_string();
        assert!(home.join(".claude/skills").join(&directory).join("SKILL.md").is_file(), "Claude Code sees the skill");
        crate::engine_config::skills_hub::uninstall(installed.pointer("/skill/id").and_then(Value::as_str).unwrap())
            .expect("the skill removes");
        assert!(!home.join(".claude/skills").join(&directory).exists(), "the skill is gone from Claude Code");

        let plugin = picked("MISTY_E2E_PLUGIN");
        let engines: Vec<String> = std::env::var("MISTY_E2E_ENGINES")
            .unwrap_or_else(|_| "claude,codex".into())
            .split(',')
            .map(str::to_string)
            .collect();
        let request = PluginRequest {
            id: plugin["id"].as_str().unwrap().into(),
            description: plugin["description"].as_str().unwrap_or("").into(),
            repo: plugin["source"]["repo"].as_str().unwrap().into(),
            commit: plugin["source"]["commit"].as_str().unwrap().into(),
            path: plugin["source"]["path"].as_str().unwrap().into(),
            bundle: file_of(&plugin),
            native: engines.clone(),
            skill_targets: vec!["gemini".into()],
            accept: None,
        };
        let (name, outcome) = place_plugin(&request).await.expect("the plugin installs");
        let PluginOutcome::Installed { placed } = outcome else {
            panic!("an engine asked to run a command for this plugin; pick one without");
        };
        for engine in &engines {
            assert!(placed.iter().any(|one| &one.engine == engine && one.how == "plugin"), "{engine} took the plugin");
            assert!(engine_lists(engine, &name).await, "{engine} lists {name}");
        }
        if plugin["includes"]["skills"].as_u64().unwrap_or(0) > 0 {
            let skills = marketplace_dir().unwrap().join("plugins").join(&request.id).join("skills");
            let laid_out = std::fs::read_dir(&skills)
                .into_iter()
                .flatten()
                .filter_map(Result::ok)
                .filter(|entry| entry.path().join("SKILL.md").is_file())
                .count();
            eprintln!("{} skills laid out under {}", laid_out, skills.display());
            assert!(laid_out > 0, "the plugin's skills sit where the engines find them");
            let elsewhere = placed.iter().find(|one| one.engine == "gemini").map(|one| one.skills.len()).unwrap_or(0);
            assert_eq!(elsewhere, laid_out, "every skill reached the engine without plugins");
        }
        unplace_plugin(&request.id, &name, &placed).await.expect("the plugin removes");
        for engine in &engines {
            assert!(!engine_lists(engine, &name).await, "{engine} no longer lists {name}");
        }
    }

    #[test]
    fn a_plugin_of_loose_skills_is_laid_out_where_engines_find_them() {
        let scratch = std::env::temp_dir().join(format!("misty-gather-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&scratch);
        let write = |path: &Path, text: &str| {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        };

        let root = scratch.join("root");
        write(&root.join("SKILL.md"), "---\nname: beautiful-article\ndescription: x\n---\nBody");
        write(&root.join("references/types.md"), "types");
        write(&root.join("LICENSE"), "MIT");
        let mut manifest = Value::Null;
        assert!(gather_skills(&root, &mut manifest, "fallback").unwrap());
        assert!(root.join("skills/beautiful-article/SKILL.md").is_file());
        assert!(root.join("skills/beautiful-article/references/types.md").is_file());
        assert!(!root.join("SKILL.md").exists());

        let loose = scratch.join("loose");
        write(&loose.join("matlab-one/SKILL.md"), "one");
        write(&loose.join("matlab-two/SKILL.md"), "two");
        write(&loose.join("LICENSE"), "MIT");
        let mut manifest = Value::Null;
        assert!(gather_skills(&loose, &mut manifest, "fallback").unwrap());
        assert!(loose.join("skills/matlab-one/SKILL.md").is_file());
        assert!(loose.join("skills/matlab-two/SKILL.md").is_file());
        assert!(loose.join("LICENSE").is_file());

        let declared = scratch.join("declared");
        write(&declared.join(".claude-plugin/plugin.json"), "{}");
        write(&declared.join("remove-marks/SKILL.md"), "skill");
        let mut manifest = json!({ "name": "remove-marks", "skills": "./" });
        assert!(gather_skills(&declared, &mut manifest, "fallback").unwrap());
        assert!(declared.join("skills/remove-marks/SKILL.md").is_file());
        assert!(manifest.get("skills").is_none());

        let nested = scratch.join("nested");
        write(&nested.join(".claude-plugin/plugin.json"), "{}");
        write(&nested.join(".claude/skills/mnemos/SKILL.md"), "skill");
        let mut manifest = json!({ "name": "mnemos" });
        assert!(gather_skills(&nested, &mut manifest, "fallback").unwrap());
        assert!(nested.join("skills/mnemos/SKILL.md").is_file());

        let standard = scratch.join("standard");
        write(&standard.join("skills/a/SKILL.md"), "a");
        let mut manifest = json!({ "name": "standard" });
        assert!(!gather_skills(&standard, &mut manifest, "fallback").unwrap());
        assert_eq!(manifest, json!({ "name": "standard" }));

        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn keys_are_quoted_for_the_shell() {
        assert_eq!(quoted("a'b c"), "'a'\\''b c'");
        assert!(env_name("BRAVE_API_KEY"));
        assert!(!env_name("brave"));
        assert!(!env_name("A=B"));
    }
}
