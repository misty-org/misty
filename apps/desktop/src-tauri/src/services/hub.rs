use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose, Engine as _};
use chrono::{SecondsFormat, Utc};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Cursor},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;
use zip::ZipArchive;

#[derive(Debug, Serialize)]
pub struct NativeSystemInfo {
    os: String,
    arch: String,
    misty_home: String,
    install_dir: String,
    legacy_install_dir: String,
    db_path: String,
    setup_path: String,
    current_user: Option<CurrentUser>,
    current_license: Option<CurrentLicense>,
}

#[derive(Debug, Serialize)]
pub struct PathProbe {
    path: String,
    exists: bool,
    is_dir: bool,
    is_file: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CurrentUser {
    id: String,
    name: String,
    email: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CurrentLicense {
    tier: String,
    status: String,
    allows_use: bool,
    expires_at: Option<String>,
    trial_started_at: Option<String>,
    license_device: Option<String>,
    #[serde(default)]
    verified_at: Option<String>,
    #[serde(default)]
    refresh_after: Option<String>,
    #[serde(default)]
    verified_until: Option<String>,
    #[serde(default)]
    needs_refresh: bool,
    #[serde(default)]
    verification_expired: bool,
}

#[derive(Debug, Serialize)]
struct LocalAccessClaims {
    user_id: String,
    email: String,
    jti: String,
    iat: i64,
    exp: i64,
}

#[derive(Debug, Serialize)]
pub struct LogFileSnapshot {
    name: String,
    path: String,
    exists: bool,
    size_bytes: u64,
    content: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ClipboardFileRef {
    display_name: String,
    local_path: String,
    remote_name: String,
    remote_path: String,
    is_dir: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ClipboardPayload {
    payload_id: String,
    kind: String,
    source_device_id: String,
    source_device_name: String,
    revision: u64,
    created_unix_ms: i64,
    text: String,
    #[serde(default)]
    file_refs: Vec<ClipboardFileRef>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ClipboardDevice {
    device_id: String,
    device_name: String,
    last_seen_unix_ms: i64,
    online: bool,
}

#[derive(Debug, Deserialize)]
pub struct ClipboardDevicesResponse {
    #[serde(default)]
    devices: Vec<ClipboardDevice>,
}

#[derive(Debug, Serialize)]
pub struct ClipboardProxySnapshot {
    proxy_running: bool,
    proxy_url: Option<String>,
    devices: Vec<ClipboardDevice>,
    latest: Option<ClipboardPayload>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReleaseManifest {
    version: String,
    #[serde(alias = "assets", default)]
    artifacts: Vec<ReleaseArtifact>,
}

#[derive(Debug, Deserialize)]
pub struct ReleaseArtifact {
    name: String,
    platform: String,
    url: String,
    #[serde(default, rename = "sha256")]
    _sha256: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct PluginLink {
    label: String,
    url: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct PluginAction {
    label: String,
    kind: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct PluginLauncher {
    views: Vec<String>,
    show_in_launcher: bool,
    requires_selected_file: bool,
    open_mode: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct LocalPluginRecord {
    id: String,
    name: String,
    version: String,
    author: String,
    overview: String,
    status: String,
    root: String,
    enabled: bool,
    installed: bool,
    verified: bool,
    manifest_path: String,
    plugin_dir: String,
    logo_path: Option<String>,
    capabilities: Vec<String>,
    where_it_appears: Vec<String>,
    permissions: Vec<String>,
    getting_started: Vec<String>,
    changelog: Vec<String>,
    links: Vec<PluginLink>,
    actions: Vec<PluginAction>,
    launcher: PluginLauncher,
}

const LOCAL_REFRESH_TOKEN_DAYS: i64 = 60;
const LICENSE_REFRESH_AFTER_DAYS: i64 = 7;
const LICENSE_VERIFIED_DAYS: i64 = 14;

#[derive(Debug, Serialize, Clone, Default)]
pub struct MistyProcessStatus {
    misty_hub_pid: u32,
    misty_pid: Option<u32>,
    misty_proxy_pid: Option<u32>,
    misty_proxy_port: Option<u16>,
    misty_rclone_port: Option<u16>,
}

#[cfg(target_os = "windows")]
fn find_running_pid(name: &str) -> Option<u32> {
    let image_name = format!("{name}.exe");
    let filter = format!("IMAGENAME eq {image_name}");
    let output = Command::new("tasklist")
        .args(["/FI", &filter, "/FO", "CSV", "/NH"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if !line.starts_with(&format!("\"{image_name}\"")) {
            continue;
        }
        let fields: Vec<_> = line.trim_matches('"').split("\",\"").collect();
        if fields.len() > 1 {
            if let Ok(pid) = fields[1].replace(',', "").parse::<u32>() {
                return Some(pid);
            }
        }
    }

    None
}

#[cfg(not(target_os = "windows"))]
fn find_running_pid(name: &str) -> Option<u32> {
    let output = Command::new("pgrep").args(["-x", name]).output().ok()?;
    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| line.trim().parse::<u32>().ok())
}

fn current_misty_process_status() -> MistyProcessStatus {
    let misty_pid = find_running_pid("misty");
    let misty_proxy_pid = find_running_pid("misty-proxy");

    MistyProcessStatus {
        misty_hub_pid: std::process::id(),
        misty_pid,
        misty_proxy_pid,
        misty_proxy_port: misty_proxy_pid.and_then(|_| read_proxy_port_from_config()),
        misty_rclone_port: find_misty_rclone_rcd_port(),
    }
}

#[cfg(target_os = "windows")]
fn find_misty_rclone_rcd_port() -> Option<u16> {
    None
}

#[cfg(not(target_os = "windows"))]
fn find_misty_rclone_rcd_port() -> Option<u16> {
    let output = Command::new("ps")
        .args(["-axo", "command="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|command| {
            command.contains("/.misty/rclone/rclone")
                && command.contains(" rcd")
                && command.contains("--rc-addr")
        })
        .and_then(extract_port_from_command_line)
}

fn extract_port_from_command_line(command: &str) -> Option<u16> {
    let parts: Vec<_> = command.split_whitespace().collect();

    for index in 0..parts.len() {
        let part = parts[index];
        let value = if let Some(value) = part.strip_prefix("--rc-addr=") {
            Some(value)
        } else if part == "--rc-addr" {
            parts.get(index + 1).copied()
        } else {
            None
        };

        if let Some(addr) = value {
            return extract_port_from_addr(addr);
        }
    }

    None
}

fn extract_port_from_addr(addr: &str) -> Option<u16> {
    let trimmed = addr.trim_matches('"').trim_matches('\'');
    let port = trimmed.rsplit(':').next()?;
    port.parse::<u16>().ok()
}

#[tauri::command]
pub fn check_system() -> Result<NativeSystemInfo, String> {
    ensure_database()?;
    let home = misty_home_dir()?;
    let install_dir = misty_bin_dir()?;
    let legacy_install_dir = legacy_misty_bin_dir()?;
    let db_path = misty_db_path()?;
    let current_user = current_user()?;
    let current_license = current_license()?;
    let setup_path = std::env::current_exe()
        .unwrap_or_else(|_| PathBuf::from("Misty Hub"))
        .display()
        .to_string();

    Ok(NativeSystemInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        misty_home: home.display().to_string(),
        install_dir: install_dir.display().to_string(),
        legacy_install_dir: legacy_install_dir.display().to_string(),
        db_path: db_path.display().to_string(),
        setup_path,
        current_user,
        current_license,
    })
}

#[tauri::command]
pub fn ensure_misty_folders(folders: Vec<String>) -> Result<Vec<PathProbe>, String> {
    let home = misty_home_dir()?;
    let mut created = Vec::new();
    for folder in folders {
        let path = safe_misty_home_child(&home, &folder)
            .ok_or_else(|| format!("Unsafe Misty folder path: {folder}"))?;
        fs::create_dir_all(&path)
            .map_err(|error| format!("Could not create {}: {error}", path.display()))?;
        created.push(path);
    }

    Ok(created.iter().map(|path| probe_path(path)).collect())
}

#[tauri::command]
pub fn probe_paths(paths: Vec<String>) -> Result<Vec<PathProbe>, String> {
    Ok(paths
        .iter()
        .map(|path| probe_path(Path::new(path)))
        .collect())
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http and https links can be opened externally.".to_string());
    }

    open_url_in_system_browser(&url)
        .map_err(|error| format!("Could not open {url} in the system browser: {error}"))
}

#[tauri::command]
pub async fn install_misty(manifest_url: String, version: String) -> Result<String, String> {
    ensure_database()?;
    if current_user()?.is_none() {
        return Err("Sign in to Misty before installing.".to_string());
    }

    let client = reqwest::Client::new();
    let manifest = fetch_manifest(&client, &manifest_url).await?;
    let platform = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    let home = misty_home_dir()?;
    let install_dir = misty_bin_dir()?;
    fs::create_dir_all(&install_dir)
        .map_err(|error| format!("Could not create install directory: {error}"))?;
    let matching_artifacts: Vec<_> = manifest
        .artifacts
        .iter()
        .filter(|artifact| artifact.platform == platform)
        .collect();

    if matching_artifacts.is_empty() {
        return Err(format!("No Misty artifacts found for platform {platform}"));
    }

    let artifact_count = matching_artifacts.len();
    for artifact in matching_artifacts {
        let artifact_debug = format!(
            "Matched artifact platform={} name={} url={}",
            artifact.platform, artifact.name, artifact.url
        );
        if !artifact_is_zip(artifact) {
            return Err(format!(
                "{}. Unsupported artifact type for {}. Misty Hub currently expects .zip artifacts.",
                artifact_debug, artifact.name
            ));
        }

        let archive = download_artifact(&client, artifact)
            .await
            .map_err(|error| format!("{artifact_debug}. {error}"))?;
        extract_zip_archive(&archive, &home).map_err(|error| {
            format!(
                "{artifact_debug}. Could not extract {}: {error}",
                artifact.name
            )
        })?;
    }

    let resolved_version = if manifest.version.trim().is_empty() {
        version
    } else {
        manifest.version
    };

    Ok(format!(
        "Installed Misty {resolved_version} for {platform} to {} from {artifact_count} artifact(s).",
        install_dir.display()
    ))
}

#[tauri::command]
pub fn get_misty_process_status() -> MistyProcessStatus {
    current_misty_process_status()
}

#[tauri::command]
pub async fn get_clipboard_proxy_snapshot() -> Result<ClipboardProxySnapshot, String> {
    ensure_database()?;
    let status = current_misty_process_status();
    let Some(port) = status.misty_proxy_port else {
        return Ok(ClipboardProxySnapshot {
            proxy_running: false,
            proxy_url: None,
            devices: Vec::new(),
            latest: None,
            error: None,
        });
    };

    let proxy_url = format!("http://127.0.0.1:{port}");
    let token = current_local_access_token()?;
    let Some(token) = token else {
        return Ok(ClipboardProxySnapshot {
            proxy_running: true,
            proxy_url: Some(proxy_url),
            devices: Vec::new(),
            latest: None,
            error: Some("Sign in to Misty Hub to view clipboard relay state.".to_string()),
        });
    };

    let client = reqwest::Client::new();
    let devices_url = format!("{proxy_url}/api/clipboard/devices");
    let latest_url = format!("{proxy_url}/api/clipboard/latest");

    let devices = client
        .get(&devices_url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|error| format!("Could not reach misty-proxy clipboard devices: {error}"))?
        .error_for_status()
        .map_err(|error| format!("misty-proxy clipboard devices failed: {error}"))?
        .json::<ClipboardDevicesResponse>()
        .await
        .map_err(|error| format!("Clipboard devices JSON was invalid: {error}"))?
        .devices;

    let latest_response = client
        .get(&latest_url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|error| format!("Could not reach misty-proxy clipboard latest: {error}"))?;
    let latest = if latest_response.status() == reqwest::StatusCode::NO_CONTENT {
        None
    } else {
        Some(
            latest_response
                .error_for_status()
                .map_err(|error| format!("misty-proxy clipboard latest failed: {error}"))?
                .json::<ClipboardPayload>()
                .await
                .map_err(|error| format!("Clipboard latest JSON was invalid: {error}"))?,
        )
    };

    Ok(ClipboardProxySnapshot {
        proxy_running: true,
        proxy_url: Some(proxy_url),
        devices,
        latest,
        error: None,
    })
}

#[tauri::command]
pub fn launch_misty() -> Result<String, String> {
    let misty_proxy_path = misty_bin_dir()?.join(runtime_binary_name("misty-proxy"));
    let status_before = current_misty_process_status();

    if !misty_proxy_path.is_file() {
        return Err(format!(
            "Misty proxy binary was not found at {}.",
            misty_proxy_path.display()
        ));
    }

    if status_before.misty_proxy_pid.is_none() {
        append_hub_log(&format!(
            "Launching misty-proxy from {}",
            misty_proxy_path.display()
        ));
        spawn_logged_process(&misty_proxy_path, "misty-proxy")
            .map_err(|error| format!("Could not launch misty-proxy: {error}"))?;
    }

    let proxy_port_message = status_before
        .misty_proxy_pid
        .is_none()
        .then(wait_for_proxy_port)
        .flatten()
        .map(|port| format!(" misty-proxy is using port {port}."))
        .unwrap_or_default();

    if status_before.misty_proxy_pid.is_some() {
        Ok("Misty is already running. misty-proxy was already running.".to_string())
    } else {
        Ok(format!(
            "Misty is already running. Launched misty-proxy.{proxy_port_message}"
        ))
    }
}

fn wait_for_proxy_port() -> Option<u16> {
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        if let Some(port) = read_proxy_port_from_config() {
            return Some(port);
        }
        thread::sleep(Duration::from_millis(100));
    }
    read_proxy_port_from_config()
}

fn read_proxy_port_from_config() -> Option<u16> {
    let config_path = misty_home_dir().ok()?.join("config").join("misty.json");
    let body = fs::read_to_string(config_path).ok()?;
    let value: Value = serde_json::from_str(&body).ok()?;
    let port = value.get("proxy")?.get("port")?.as_u64()?;
    u16::try_from(port).ok()
}

fn stop_named_processes(names: &[&str]) -> Result<usize, String> {
    #[cfg(target_os = "windows")]
    {
        let mut stopped = 0;
        for name in names {
            let target = format!("{name}.exe");
            let output = Command::new("taskkill")
                .args(["/IM", &target, "/F"])
                .output()
                .map_err(|error| format!("Could not run taskkill for {target}: {error}"))?;

            if output.status.success() {
                stopped += 1;
                continue;
            }

            let stderr = String::from_utf8_lossy(&output.stderr).to_lowercase();
            if stderr.contains("not found") || stderr.contains("no running instance") {
                continue;
            }

            return Err(format!(
                "Could not stop {target}: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }

        Ok(stopped)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut stopped = 0;
        for name in names {
            let status = Command::new("pkill")
                .args(["-x", name])
                .status()
                .map_err(|error| format!("Could not run pkill for {name}: {error}"))?;

            match status.code() {
                Some(0) => stopped += 1,
                Some(1) => {}
                Some(code) => {
                    return Err(format!(
                        "pkill exited with status {code} while stopping {name}."
                    ));
                }
                None => {
                    return Err(format!(
                        "pkill terminated unexpectedly while stopping {name}."
                    ))
                }
            }
        }

        Ok(stopped)
    }
}

fn stop_services_processes() -> Result<usize, String> {
    stop_named_processes(&["misty-proxy"])
}

#[tauri::command]
pub fn stop_misty() -> Result<String, String> {
    let stopped = stop_services_processes()?;

    if stopped == 0 {
        Ok("No running Misty services were found. The Misty app remains open.".to_string())
    } else {
        Ok("Stopped Misty services. The Misty app remains open.".to_string())
    }
}

#[tauri::command]
pub fn restart_misty() -> Result<String, String> {
    let stopped = stop_services_processes()?;
    let launch_message = launch_misty()?;

    if stopped == 0 {
        Ok(format!(
            "No running Misty services were found. {launch_message}"
        ))
    } else {
        Ok(format!("Restarted Misty services. {launch_message}"))
    }
}

#[tauri::command]
pub fn scan_local_plugins() -> Result<Vec<LocalPluginRecord>, String> {
    let mut plugins = Vec::new();
    for root_kind in ["private", "public"] {
        let root_dir = misty_plugin_root_dir(root_kind)?;
        if !root_dir.exists() {
            continue;
        }

        let entries = fs::read_dir(&root_dir)
            .map_err(|error| format!("Could not read {}: {error}", root_dir.display()))?;
        for entry in entries {
            let entry = entry.map_err(|error| format!("Could not read plugin entry: {error}"))?;
            let plugin_dir = entry.path();
            if !plugin_dir.is_dir() {
                continue;
            }
            if let Some(plugin) = read_local_plugin_record(&plugin_dir, root_kind)? {
                plugins.push(plugin);
            }
        }
    }

    plugins.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(plugins)
}

#[tauri::command]
pub async fn install_plugin_bundle(
    plugin_id: String,
    root: String,
    url: String,
) -> Result<String, String> {
    if plugin_id.trim().is_empty() {
        return Err("Plugin id is required.".to_string());
    }
    if !matches!(root.as_str(), "public" | "private") {
        return Err(format!("Unsupported plugin root: {root}"));
    }
    if url.trim().is_empty() {
        return Err("Plugin artifact URL is required.".to_string());
    }
    if !url.to_ascii_lowercase().ends_with(".zip") {
        return Err("Plugin install currently expects a .zip bundle.".to_string());
    }

    let client = reqwest::Client::new();
    let bytes = authed_get(&client, &url)
        .send()
        .await
        .map_err(|error| format!("Could not download plugin bundle: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Plugin download failed: {error}"))?
        .bytes()
        .await
        .map_err(|error| format!("Could not read plugin bundle: {error}"))?;

    let root_dir = misty_plugin_root_dir(&root)?;
    fs::create_dir_all(&root_dir).map_err(|error| {
        format!(
            "Could not create plugin root {}: {error}",
            root_dir.display()
        )
    })?;
    extract_plugin_zip_archive(&bytes, &root_dir, &plugin_id)
        .map_err(|error| format!("Could not extract plugin bundle: {error}"))?;

    Ok(format!(
        "Installed plugin {plugin_id} into {}.",
        root_dir.join(&plugin_id).display()
    ))
}

#[tauri::command]
pub fn uninstall_plugin(plugin_id: String, root: String) -> Result<String, String> {
    if plugin_id.trim().is_empty() {
        return Err("Plugin id is required.".to_string());
    }
    let plugin_dir = misty_plugin_root_dir(&root)?.join(&plugin_id);
    if !plugin_dir.exists() {
        return Err(format!(
            "Plugin directory was not found at {}.",
            plugin_dir.display()
        ));
    }
    fs::remove_dir_all(&plugin_dir)
        .map_err(|error| format!("Could not remove {}: {error}", plugin_dir.display()))?;
    Ok(format!("Removed plugin {plugin_id}."))
}

#[tauri::command]
pub fn set_plugin_enabled(
    plugin_id: String,
    root: String,
    enabled: bool,
) -> Result<String, String> {
    if plugin_id.trim().is_empty() {
        return Err("Plugin id is required.".to_string());
    }

    let manifest_path = misty_plugin_root_dir(&root)?
        .join(&plugin_id)
        .join("manifest.json");
    let manifest_text = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("Could not read {}: {error}", manifest_path.display()))?;
    let mut manifest_json: Value = parse_json_relaxed(&manifest_text)
        .ok_or_else(|| format!("Manifest JSON was invalid at {}.", manifest_path.display()))?;
    let object = manifest_json.as_object_mut().ok_or_else(|| {
        format!(
            "Manifest at {} was not a JSON object.",
            manifest_path.display()
        )
    })?;
    object.insert("enabled".to_string(), json!(enabled));
    let next_manifest = serde_json::to_string_pretty(&manifest_json)
        .map_err(|error| format!("Could not serialize plugin manifest: {error}"))?;
    fs::write(&manifest_path, format!("{next_manifest}\n"))
        .map_err(|error| format!("Could not write {}: {error}", manifest_path.display()))?;

    Ok(format!(
        "{} plugin {plugin_id}.",
        if enabled { "Enabled" } else { "Disabled" }
    ))
}

#[tauri::command]
pub fn sign_out_misty() -> Result<NativeSystemInfo, String> {
    ensure_database()?;
    let conn = Connection::open(misty_db_path()?)
        .map_err(|error| format!("Could not open Misty database: {error}"))?;
    bootstrap_database(&conn)
        .map_err(|error| format!("Could not initialize Misty database: {error}"))?;
    conn.execute_batch(
        r#"
        UPDATE access_tokens SET revoked = 1;
        DELETE FROM refresh_tokens;
        DELETE FROM access_tokens;
        DELETE FROM license_cache;
        DELETE FROM revoked_access_tokens;
        DELETE FROM users;
        "#,
    )
    .map_err(|error| format!("Could not sign out of Misty: {error}"))?;

    check_system()
}

#[tauri::command]
pub fn save_authenticated_user(
    user: CurrentUser,
    license: Option<CurrentLicense>,
) -> Result<NativeSystemInfo, String> {
    let license = license.ok_or_else(|| "Misty license could not be verified.".to_string())?;
    if !license_allows_local_use(&license) {
        return Err("Misty license is not active for local use.".to_string());
    }

    ensure_database()?;
    let conn = Connection::open(misty_db_path()?)
        .map_err(|error| format!("Could not open Misty database: {error}"))?;
    bootstrap_database(&conn)
        .map_err(|error| format!("Could not initialize Misty database: {error}"))?;
    save_current_user_and_license(&conn, &user, &license)?;
    issue_local_refresh_token(&conn, &user)?;
    issue_local_access_token(&conn, &user)?;

    check_system()
}

#[tauri::command]
pub fn ensure_local_access_token() -> Result<NativeSystemInfo, String> {
    ensure_database()?;
    let conn = Connection::open(misty_db_path()?)
        .map_err(|error| format!("Could not open Misty database: {error}"))?;
    bootstrap_database(&conn)
        .map_err(|error| format!("Could not initialize Misty database: {error}"))?;
    if let Some(user) = current_user()? {
        if has_active_refresh_token(&conn, &user.id)? {
            issue_local_refresh_token(&conn, &user)?;
            issue_local_access_token(&conn, &user)?;
        } else {
            conn.execute(
                "UPDATE access_tokens SET revoked = 1 WHERE user_id = ?1 AND revoked = 0",
                params![&user.id],
            )
            .map_err(|error| format!("Could not revoke expired local access tokens: {error}"))?;
        }
    }
    check_system()
}

#[tauri::command]
pub fn save_verified_license(license: CurrentLicense) -> Result<NativeSystemInfo, String> {
    if !license_allows_local_use(&license) {
        return Err("Misty license is not active for local use.".to_string());
    }

    ensure_database()?;
    let conn = Connection::open(misty_db_path()?)
        .map_err(|error| format!("Could not open Misty database: {error}"))?;
    bootstrap_database(&conn)
        .map_err(|error| format!("Could not initialize Misty database: {error}"))?;
    let user = current_user()?.ok_or_else(|| "No signed in Misty user.".to_string())?;
    cache_verified_license(&conn, &user.id, &license)?;
    check_system()
}

fn save_current_user_and_license(
    conn: &Connection,
    user: &CurrentUser,
    license: &CurrentLicense,
) -> Result<(), String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| format!("Could not start Misty auth update: {error}"))?;
    tx.execute("DELETE FROM refresh_tokens", params![])
        .map_err(|error| format!("Could not clear previous refresh tokens: {error}"))?;
    tx.execute("DELETE FROM access_tokens", params![])
        .map_err(|error| format!("Could not clear previous access tokens: {error}"))?;
    tx.execute("DELETE FROM revoked_access_tokens", params![])
        .map_err(|error| format!("Could not clear previous revoked tokens: {error}"))?;
    tx.execute("DELETE FROM license_cache", params![])
        .map_err(|error| format!("Could not clear previous license cache: {error}"))?;
    tx.execute("DELETE FROM users", params![])
        .map_err(|error| format!("Could not clear previous Misty user: {error}"))?;
    tx.execute(
        "INSERT INTO users (id, name, email) VALUES (?1, ?2, ?3)",
        params![&user.id, &user.name, &user.email],
    )
    .map_err(|error| format!("Could not save Misty user: {error}"))?;

    let verified_at = Utc::now();
    let refresh_after = verified_at + chrono::Duration::days(LICENSE_REFRESH_AFTER_DAYS);
    let verified_until = verified_at + chrono::Duration::days(LICENSE_VERIFIED_DAYS);
    tx.execute(
        r#"
        INSERT INTO license_cache (
            user_id, tier, status, allows_use, expires_at, trial_started_at, license_device,
            updated_at, verified_at, refresh_after, verified_until
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        "#,
        params![
            &user.id,
            &license.tier,
            &license.status,
            i64::from(license.allows_use),
            license.expires_at.as_deref(),
            license.trial_started_at.as_deref(),
            license.license_device.as_deref(),
            verified_at.to_rfc3339_opts(SecondsFormat::Secs, true),
            verified_at.to_rfc3339_opts(SecondsFormat::Secs, true),
            refresh_after.to_rfc3339_opts(SecondsFormat::Secs, true),
            verified_until.to_rfc3339_opts(SecondsFormat::Secs, true),
        ],
    )
    .map_err(|error| format!("Could not save Misty license cache: {error}"))?;

    tx.commit()
        .map_err(|error| format!("Could not finish Misty auth update: {error}"))
}

fn license_cache_window() -> (String, String, String) {
    let verified_at = Utc::now();
    let refresh_after = verified_at + chrono::Duration::days(LICENSE_REFRESH_AFTER_DAYS);
    let verified_until = verified_at + chrono::Duration::days(LICENSE_VERIFIED_DAYS);
    (
        verified_at.to_rfc3339_opts(SecondsFormat::Secs, true),
        refresh_after.to_rfc3339_opts(SecondsFormat::Secs, true),
        verified_until.to_rfc3339_opts(SecondsFormat::Secs, true),
    )
}

fn cache_verified_license(
    conn: &Connection,
    user_id: &str,
    license: &CurrentLicense,
) -> Result<(), String> {
    let (verified_at, refresh_after, verified_until) = license_cache_window();
    conn.execute(
        r#"
        INSERT INTO license_cache (
            user_id, tier, status, allows_use, expires_at, trial_started_at, license_device,
            updated_at, verified_at, refresh_after, verified_until
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(user_id) DO UPDATE SET
            tier = excluded.tier,
            status = excluded.status,
            allows_use = excluded.allows_use,
            expires_at = excluded.expires_at,
            trial_started_at = excluded.trial_started_at,
            license_device = excluded.license_device,
            updated_at = excluded.updated_at,
            verified_at = excluded.verified_at,
            refresh_after = excluded.refresh_after,
            verified_until = excluded.verified_until
        "#,
        params![
            user_id,
            &license.tier,
            &license.status,
            i64::from(license.allows_use),
            license.expires_at.as_deref(),
            license.trial_started_at.as_deref(),
            license.license_device.as_deref(),
            &verified_at,
            &verified_at,
            &refresh_after,
            &verified_until,
        ],
    )
    .map_err(|error| format!("Could not save Misty license cache: {error}"))?;
    Ok(())
}

fn license_allows_local_use(license: &CurrentLicense) -> bool {
    matches!(license.tier.as_str(), "basic" | "personal" | "pro")
        && matches!(license.status.as_str(), "active" | "trialing")
        && license.allows_use
}

fn issue_local_access_token(conn: &Connection, user: &CurrentUser) -> Result<(), String> {
    let secret = read_or_create_jwt_secret()?;
    let issued_at = Utc::now();
    let expires_at = issued_at + chrono::Duration::hours(1);
    let token_id = Uuid::new_v4().to_string();
    let claims = LocalAccessClaims {
        user_id: user.id.clone(),
        email: user.email.clone(),
        jti: token_id.clone(),
        iat: issued_at.timestamp(),
        exp: expires_at.timestamp(),
    };
    let token = encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(&secret),
    )
    .map_err(|error| format!("Could not sign local Misty access token: {error}"))?;

    conn.execute(
        "UPDATE access_tokens SET revoked = 1 WHERE user_id = ?1 AND revoked = 0",
        params![&user.id],
    )
    .map_err(|error| format!("Could not revoke previous local access tokens: {error}"))?;
    conn.execute(
        r#"
        INSERT INTO access_tokens (id, user_id, token, expires_at, revoked)
        VALUES (?1, ?2, ?3, ?4, 0)
        "#,
        params![
            token_id,
            &user.id,
            token,
            expires_at.to_rfc3339_opts(SecondsFormat::Secs, true),
        ],
    )
    .map_err(|error| format!("Could not store local Misty access token: {error}"))?;
    Ok(())
}

fn issue_local_refresh_token(conn: &Connection, user: &CurrentUser) -> Result<(), String> {
    let token = generate_local_refresh_token();
    let token_hash = hash_token(&token);
    let encrypted_token = encrypt_refresh_token(&token)?;
    let expires_at = (Utc::now() + chrono::Duration::days(LOCAL_REFRESH_TOKEN_DAYS))
        .to_rfc3339_opts(SecondsFormat::Secs, true);

    conn.execute(
        "UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?1 AND revoked = 0",
        params![&user.id],
    )
    .map_err(|error| format!("Could not revoke previous local refresh tokens: {error}"))?;
    conn.execute(
        r#"
        INSERT INTO refresh_tokens (id, user_id, token_hash, encrypted_token, expires_at, revoked)
        VALUES (?1, ?2, ?3, ?4, ?5, 0)
        "#,
        params![
            Uuid::new_v4().to_string(),
            &user.id,
            token_hash,
            encrypted_token,
            expires_at,
        ],
    )
    .map_err(|error| format!("Could not store local refresh token: {error}"))?;
    Ok(())
}

fn has_active_refresh_token(conn: &Connection, user_id: &str) -> Result<bool, String> {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let encrypted_token: Option<String> = conn
        .query_row(
            r#"
            SELECT encrypted_token
            FROM refresh_tokens
            WHERE user_id = ?1
              AND revoked = 0
              AND datetime(expires_at) > datetime(?2)
            ORDER BY datetime(created_at) DESC
            LIMIT 1
            "#,
            params![user_id, now],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Could not read local refresh token: {error}"))?;

    match encrypted_token {
        Some(value) => decrypt_refresh_token(&value).map(|token| !token.is_empty()),
        None => Ok(false),
    }
}

fn generate_local_refresh_token() -> String {
    let mut token = [0_u8; 32];
    OsRng.fill_bytes(&mut token);
    general_purpose::URL_SAFE.encode(token)
}

fn hash_token(raw: &str) -> String {
    hex::encode(Sha256::digest(raw.as_bytes()))
}

fn encrypt_refresh_token(raw: &str) -> Result<String, String> {
    let key = read_or_create_token_encryption_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|error| format!("Could not initialize token cipher: {error}"))?;
    let mut nonce = [0_u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), raw.as_bytes())
        .map_err(|error| format!("Could not encrypt refresh token: {error}"))?;
    let mut payload = Vec::with_capacity(nonce.len() + ciphertext.len());
    payload.extend_from_slice(&nonce);
    payload.extend_from_slice(&ciphertext);
    Ok(general_purpose::STANDARD.encode(payload))
}

fn decrypt_refresh_token(encrypted: &str) -> Result<String, String> {
    let key = read_or_create_token_encryption_key()?;
    let payload = general_purpose::STANDARD
        .decode(encrypted)
        .map_err(|error| format!("Could not decode refresh token: {error}"))?;
    if payload.len() < 12 {
        return Err("Encrypted refresh token is too short".to_string());
    }
    let (nonce, ciphertext) = payload.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|error| format!("Could not initialize token cipher: {error}"))?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|error| format!("Could not decrypt refresh token: {error}"))?;
    String::from_utf8(plaintext).map_err(|error| format!("Refresh token was not UTF-8: {error}"))
}

fn read_or_create_token_encryption_key() -> Result<[u8; 32], String> {
    if let Ok(raw) = std::env::var("MISTY_TOKEN_ENCRYPTION_KEY") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let decoded = general_purpose::STANDARD
                .decode(trimmed)
                .map_err(|error| format!("Could not decode MISTY_TOKEN_ENCRYPTION_KEY: {error}"))?;
            return decoded
                .try_into()
                .map_err(|_| "MISTY_TOKEN_ENCRYPTION_KEY must decode to 32 bytes".to_string());
        }
    }

    let path = token_encryption_key_path()?;
    if let Ok(raw) = fs::read_to_string(&path) {
        let decoded = general_purpose::STANDARD
            .decode(raw.trim())
            .map_err(|error| format!("Could not decode token key: {error}"))?;
        return decoded
            .try_into()
            .map_err(|_| "Token key must decode to 32 bytes".to_string());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create token key directory: {error}"))?;
    }
    let mut key = [0_u8; 32];
    OsRng.fill_bytes(&mut key);
    fs::write(&path, general_purpose::STANDARD.encode(key))
        .map_err(|error| format!("Could not write token key: {error}"))?;
    set_user_only_file_permissions(&path)?;
    Ok(key)
}

fn token_encryption_key_path() -> Result<PathBuf, String> {
    let db_path = misty_db_path()?;
    let parent = db_path
        .parent()
        .ok_or_else(|| format!("Misty database path has no parent: {}", db_path.display()))?;
    Ok(parent.join("token.key"))
}

fn read_or_create_jwt_secret() -> Result<Vec<u8>, String> {
    let path = jwt_secret_path()?;
    if let Ok(raw) = fs::read_to_string(&path) {
        let trimmed = raw.trim();
        if let Ok(decoded) = general_purpose::STANDARD.decode(trimmed) {
            if !decoded.is_empty() {
                return Ok(decoded);
            }
        }
        if !trimmed.is_empty() {
            return Ok(trimmed.as_bytes().to_vec());
        }
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create JWT secret directory: {error}"))?;
    }
    let mut secret = [0_u8; 32];
    OsRng.fill_bytes(&mut secret);
    fs::write(&path, general_purpose::STANDARD.encode(secret))
        .map_err(|error| format!("Could not write JWT secret: {error}"))?;
    set_user_only_file_permissions(&path)?;
    Ok(secret.to_vec())
}

fn set_user_only_file_permissions(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Could not secure {}: {error}", path.display()))?;
    }
    Ok(())
}

async fn fetch_manifest(
    client: &reqwest::Client,
    manifest_url: &str,
) -> Result<ReleaseManifest, String> {
    authed_get(client, manifest_url)
        .send()
        .await
        .map_err(|error| format!("Could not fetch manifest: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Manifest request failed: {error}"))?
        .json::<ReleaseManifest>()
        .await
        .map_err(|error| format!("Manifest JSON was invalid: {error}"))
}

async fn download_artifact(
    client: &reqwest::Client,
    artifact: &ReleaseArtifact,
) -> Result<Vec<u8>, String> {
    authed_get(client, &artifact.url)
        .send()
        .await
        .map_err(|error| format!("Could not download {}: {error}", artifact.name))?
        .error_for_status()
        .map_err(|error| format!("Download failed for {}: {error}", artifact.name))?
        .bytes()
        .await
        .map(|bytes| bytes.to_vec())
        .map_err(|error| format!("Could not read {} download body: {error}", artifact.name))
}

fn authed_get(client: &reqwest::Client, url: &str) -> reqwest::RequestBuilder {
    let request = client.get(url);

    match std::env::var("MISTY_DOWNLOAD_TOKEN") {
        Ok(token) if !token.trim().is_empty() => request.bearer_auth(token),
        _ => request,
    }
}

fn extract_zip_archive(archive_bytes: &[u8], misty_home: &Path) -> io::Result<()> {
    let reader = Cursor::new(archive_bytes);
    let mut archive = ZipArchive::new(reader)?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let Some(out_path) = release_entry_destination(misty_home, entry.name()) else {
            continue;
        };

        if entry.is_dir() {
            fs::create_dir_all(&out_path)?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut out_file = File::create(&out_path)?;
        io::copy(&mut entry, &mut out_file)?;

        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&out_path, fs::Permissions::from_mode(mode))?;
        }
    }

    Ok(())
}

fn artifact_is_zip(artifact: &ReleaseArtifact) -> bool {
    artifact.name.to_ascii_lowercase().ends_with(".zip")
        || artifact.url.to_ascii_lowercase().ends_with(".zip")
}

fn extract_plugin_zip_archive(
    archive_bytes: &[u8],
    plugin_root: &Path,
    plugin_id: &str,
) -> io::Result<()> {
    let target_dir = plugin_root.join(plugin_id);
    if target_dir.exists() {
        fs::remove_dir_all(&target_dir)?;
    }
    fs::create_dir_all(&target_dir)?;

    let reader = Cursor::new(archive_bytes);
    let mut archive = ZipArchive::new(reader)?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let Some(relative_path) = plugin_archive_relative_path(entry.name(), plugin_id) else {
            continue;
        };
        let out_path = target_dir.join(relative_path);

        if entry.is_dir() {
            fs::create_dir_all(&out_path)?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut out_file = File::create(&out_path)?;
        io::copy(&mut entry, &mut out_file)?;

        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&out_path, fs::Permissions::from_mode(mode))?;
        }
    }

    if !target_dir.join("manifest.json").is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Plugin bundle did not contain manifest.json",
        ));
    }

    Ok(())
}

fn plugin_archive_relative_path(entry_name: &str, plugin_id: &str) -> Option<PathBuf> {
    let entry_path = Path::new(entry_name);
    if entry_path.is_absolute() {
        return None;
    }

    let mut components = Vec::new();
    for component in entry_path.components() {
        match component {
            Component::Normal(value) => components.push(value.to_string_lossy().to_string()),
            Component::CurDir => {}
            _ => return None,
        }
    }

    if components.is_empty() {
        return None;
    }

    let slice = if components[0] == plugin_id {
        &components[1..]
    } else {
        &components[..]
    };

    if slice.is_empty() {
        return None;
    }

    let mut relative = PathBuf::new();
    for part in slice {
        relative.push(part);
    }
    Some(relative)
}

fn misty_plugin_root_dir(root: &str) -> Result<PathBuf, String> {
    match root {
        "public" => misty_home_dir().map(|home| home.join("plugins").join("public")),
        "private" => misty_home_dir().map(|home| home.join("plugins").join("private")),
        _ => Err(format!("Unsupported plugin root: {root}")),
    }
}

fn read_local_plugin_record(
    plugin_dir: &Path,
    root: &str,
) -> Result<Option<LocalPluginRecord>, String> {
    let manifest_path = plugin_dir.join("manifest.json");
    if !manifest_path.is_file() {
        return Ok(None);
    }

    let manifest_text = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("Could not read {}: {error}", manifest_path.display()))?;
    let manifest_json: Value = parse_json_relaxed(&manifest_text).unwrap_or_else(|| json!({}));
    let detail_json = plugin_dir
        .join("plugin.json")
        .is_file()
        .then(|| fs::read_to_string(plugin_dir.join("plugin.json")))
        .transpose()
        .map_err(|error| {
            format!(
                "Could not read plugin metadata in {}: {error}",
                plugin_dir.display()
            )
        })?
        .and_then(|text| serde_json::from_str::<Value>(&text).ok());

    let manifest_enabled = manifest_json
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true);

    let plugin_json = detail_json.unwrap_or_else(|| json!({}));
    let id = string_field(&plugin_json, &manifest_json, "id").unwrap_or_else(|| {
        plugin_dir
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| "plugin".to_string())
    });
    let name = string_field(&plugin_json, &manifest_json, "name").unwrap_or_else(|| id.clone());
    let version = string_field(&plugin_json, &manifest_json, "version")
        .unwrap_or_else(|| "0.0.0".to_string());
    let author = string_field(&plugin_json, &manifest_json, "author").unwrap_or_default();
    let overview = string_field(&plugin_json, &manifest_json, "overview")
        .or_else(|| string_field(&plugin_json, &manifest_json, "description"))
        .unwrap_or_default();
    let status = if manifest_enabled {
        "installed"
    } else {
        "disabled"
    }
    .to_string();
    let verified = plugin_json
        .get("verified")
        .and_then(Value::as_bool)
        .or_else(|| manifest_json.get("verified").and_then(Value::as_bool))
        .unwrap_or(false);

    Ok(Some(LocalPluginRecord {
        id,
        name,
        version,
        author,
        overview,
        status,
        root: root.to_string(),
        enabled: manifest_enabled,
        installed: true,
        verified,
        manifest_path: manifest_path.display().to_string(),
        plugin_dir: plugin_dir.display().to_string(),
        logo_path: plugin_logo_path(plugin_dir),
        capabilities: string_list(&plugin_json, "capabilities"),
        where_it_appears: string_list(&plugin_json, "where_it_appears"),
        permissions: string_list(&plugin_json, "permissions"),
        getting_started: string_list(&plugin_json, "getting_started"),
        changelog: string_list(&plugin_json, "changelog"),
        links: plugin_links(&plugin_json),
        actions: plugin_actions(&plugin_json),
        launcher: plugin_launcher(&plugin_json, &manifest_json),
    }))
}

fn plugin_logo_path(plugin_dir: &Path) -> Option<String> {
    let assets_dir = plugin_dir.join("assets");
    [
        assets_dir.join("logo.svg"),
        assets_dir.join("logo.png"),
        assets_dir.join("icon.svg"),
        assets_dir.join("icon.png"),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .map(|path| path.display().to_string())
}

fn parse_json_relaxed(text: &str) -> Option<Value> {
    serde_json::from_str(text)
        .ok()
        .or_else(|| serde_json::from_str(&strip_trailing_commas(text)).ok())
}

fn strip_trailing_commas(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    let mut in_string = false;
    let mut escaped = false;

    while i < chars.len() {
        let ch = chars[i];
        if in_string {
            out.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }

        if ch == '"' {
            in_string = true;
            out.push(ch);
            i += 1;
            continue;
        }

        if ch == ',' {
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if j < chars.len() && matches!(chars[j], '}' | ']') {
                i += 1;
                continue;
            }
        }

        out.push(ch);
        i += 1;
    }

    out
}

fn string_field(primary: &Value, fallback: &Value, key: &str) -> Option<String> {
    primary
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            fallback
                .get(key)
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
}

fn string_list(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn plugin_links(value: &Value) -> Vec<PluginLink> {
    value
        .get("links")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(PluginLink {
                        label: item.get("label")?.as_str()?.to_string(),
                        url: item.get("url")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn plugin_actions(value: &Value) -> Vec<PluginAction> {
    value
        .get("actions")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(PluginAction {
                        label: item.get("label")?.as_str()?.to_string(),
                        kind: item.get("kind")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn plugin_launcher(plugin_json: &Value, manifest_json: &Value) -> PluginLauncher {
    let launcher_json = plugin_json
        .get("launcher")
        .filter(|value| value.is_object())
        .or_else(|| {
            manifest_json
                .get("launcher")
                .filter(|value| value.is_object())
        });

    PluginLauncher {
        views: launcher_json
            .and_then(|value| value.get("views"))
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect()
            })
            .unwrap_or_default(),
        show_in_launcher: launcher_json
            .and_then(|value| value.get("show_in_launcher"))
            .and_then(Value::as_bool)
            .unwrap_or(true),
        requires_selected_file: launcher_json
            .and_then(|value| value.get("requires_selected_file"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        open_mode: launcher_json
            .and_then(|value| value.get("open_mode"))
            .and_then(Value::as_str)
            .unwrap_or("tab")
            .to_string(),
    }
}

fn ensure_database() -> Result<(), String> {
    fs::create_dir_all(misty_db_dir()?)
        .map_err(|error| format!("Could not create Misty database directory: {error}"))?;
    let conn = Connection::open(misty_db_path()?)
        .map_err(|error| format!("Could not open Misty database: {error}"))?;
    bootstrap_database(&conn)
        .map_err(|error| format!("Could not initialize Misty database: {error}"))
}

fn release_entry_destination(misty_home: &Path, entry_name: &str) -> Option<PathBuf> {
    let entry_path = Path::new(entry_name);
    if entry_path.is_absolute() {
        return None;
    }

    let mut components = entry_path.components();
    let first = match components.next()? {
        Component::Normal(value) => value.to_string_lossy().to_string(),
        _ => return None,
    };

    let mut relative = PathBuf::new();
    for component in components {
        match component {
            Component::Normal(value) => relative.push(value),
            Component::CurDir => {}
            _ => return None,
        }
    }

    let mut destination = match first.as_str() {
        "bin" => misty_home.join(".local").join("bin"),
        "assets" => misty_home.join("assets"),
        "scripts" => misty_home.join("scripts"),
        other => misty_home.join(other),
    };
    destination.push(relative);
    Some(destination)
}

fn safe_misty_home_child(home: &Path, relative: &str) -> Option<PathBuf> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute() {
        return None;
    }

    let mut safe = PathBuf::new();
    for component in relative_path.components() {
        match component {
            Component::Normal(value) => safe.push(value),
            Component::CurDir => {}
            _ => return None,
        }
    }

    Some(home.join(safe))
}

fn probe_path(path: &Path) -> PathProbe {
    PathProbe {
        path: path.display().to_string(),
        exists: path.exists(),
        is_dir: path.is_dir(),
        is_file: path.is_file(),
    }
}

fn open_url_in_system_browser(url: &str) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(url).spawn()?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd").args(["/C", "start", "", url]).spawn()?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open").arg(url).spawn()?;
        return Ok(());
    }
}

fn bootstrap_database(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS files (
            file_path TEXT PRIMARY KEY,
            mtime INTEGER NOT NULL,
            size INTEGER NOT NULL,
            is_dir INTEGER NOT NULL DEFAULT 0,
            hash TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            token_valid_after TEXT
        );

        CREATE TABLE IF NOT EXISTS refresh_tokens (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            encrypted_token TEXT NOT NULL DEFAULT '',
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            revoked INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id
            ON refresh_tokens(user_id);
        CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash
            ON refresh_tokens(token_hash);

        CREATE TABLE IF NOT EXISTS access_tokens (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            revoked INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_access_tokens_user_id
            ON access_tokens(user_id);
        CREATE INDEX IF NOT EXISTS idx_access_tokens_expires_at
            ON access_tokens(expires_at);

        CREATE TABLE IF NOT EXISTS revoked_access_tokens (
            token_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            revoked_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_revoked_access_tokens_user_id
            ON revoked_access_tokens(user_id);
        CREATE INDEX IF NOT EXISTS idx_revoked_access_tokens_expires_at
            ON revoked_access_tokens(expires_at);

        CREATE TABLE IF NOT EXISTS license_cache (
            user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            tier TEXT NOT NULL,
            status TEXT NOT NULL,
            allows_use INTEGER NOT NULL,
            expires_at TEXT,
            trial_started_at TEXT,
            license_device TEXT,
            verified_at TEXT,
            refresh_after TEXT,
            verified_until TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        "#,
    )?;
    ensure_column(conn, "license_cache", "verified_at", "TEXT")?;
    ensure_column(conn, "license_cache", "refresh_after", "TEXT")?;
    ensure_column(conn, "license_cache", "verified_until", "TEXT")?;
    conn.execute_batch(
        r#"
        UPDATE license_cache
        SET
            verified_at = COALESCE(verified_at, updated_at),
            refresh_after = COALESCE(refresh_after, datetime(updated_at, '+7 days')),
            verified_until = COALESCE(verified_until, datetime(updated_at, '+14 days'));
        "#,
    )?;
    Ok(())
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut rows = stmt.query(params![])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(());
        }
    }
    conn.execute_batch(&format!(
        "ALTER TABLE {table} ADD COLUMN {column} {definition}"
    ))
}

fn current_user() -> Result<Option<CurrentUser>, String> {
    let conn = Connection::open(misty_db_path()?)
        .map_err(|error| format!("Could not open Misty database: {error}"))?;
    bootstrap_database(&conn)
        .map_err(|error| format!("Could not initialize Misty database: {error}"))?;

    conn.query_row(
        "SELECT id, name, email FROM users ORDER BY rowid ASC LIMIT 1",
        params![],
        |row| {
            Ok(CurrentUser {
                id: row.get(0)?,
                name: row.get(1)?,
                email: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|error| format!("Could not read signed in Misty user: {error}"))
}

fn current_local_access_token() -> Result<Option<String>, String> {
    let conn = Connection::open(misty_db_path()?)
        .map_err(|error| format!("Could not open Misty database: {error}"))?;
    bootstrap_database(&conn)
        .map_err(|error| format!("Could not initialize Misty database: {error}"))?;

    conn.query_row(
        r#"
        SELECT token
        FROM access_tokens
        WHERE revoked = 0
          AND datetime(expires_at) > datetime('now')
        ORDER BY datetime(created_at) DESC
        LIMIT 1
        "#,
        params![],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|error| format!("Could not read local Misty access token: {error}"))
}

fn current_license() -> Result<Option<CurrentLicense>, String> {
    let conn = Connection::open(misty_db_path()?)
        .map_err(|error| format!("Could not open Misty database: {error}"))?;
    bootstrap_database(&conn)
        .map_err(|error| format!("Could not initialize Misty database: {error}"))?;

    conn.query_row(
        r#"
        SELECT tier, status, allows_use, expires_at, trial_started_at, license_device,
               verified_at, refresh_after, verified_until,
               datetime(refresh_after) <= datetime('now') AS needs_refresh,
               datetime(verified_until) <= datetime('now') AS verification_expired
        FROM license_cache
        ORDER BY updated_at DESC
        LIMIT 1
        "#,
        params![],
        |row| {
            Ok(CurrentLicense {
                tier: row.get(0)?,
                status: row.get(1)?,
                allows_use: row.get::<_, i64>(2)? != 0,
                expires_at: row.get(3)?,
                trial_started_at: row.get(4)?,
                license_device: row.get(5)?,
                verified_at: row.get(6)?,
                refresh_after: row.get(7)?,
                verified_until: row.get(8)?,
                needs_refresh: row.get::<_, i64>(9)? != 0,
                verification_expired: row.get::<_, i64>(10)? != 0,
            })
        },
    )
    .optional()
    .map(|license| {
        license.map(|mut license| {
            if license.verification_expired {
                license.allows_use = false;
            }
            license
        })
    })
    .map_err(|error| format!("Could not read Misty license cache: {error}"))
}

fn misty_home_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".misty"))
        .ok_or_else(|| "Could not resolve home directory".to_string())
}

fn misty_logs_dir() -> Result<PathBuf, String> {
    let dir = misty_home_dir()?.join("logs");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create Misty log directory: {error}"))?;
    Ok(dir)
}

fn component_log_filename(name: &str) -> Result<&'static str, String> {
    match name {
        "misty" | "misty.log" => Ok("misty.log"),
        "misty-proxy" | "misty-proxy.log" => Ok("misty-proxy.log"),
        "misty-rclone" | "misty-rclone.log" => Ok("misty-rclone.log"),
        "misty-hub" | "misty-hub.log" => Ok("misty-hub.log"),
        _ => Err(format!("Unknown Misty log: {name}")),
    }
}

fn append_log_file(name: &str) -> Result<File, String> {
    let path = misty_logs_dir()?.join(component_log_filename(name)?);
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("Could not open {}: {error}", path.display()))
}

fn spawn_logged_process(path: &Path, log_name: &str) -> Result<(), String> {
    let stdout = append_log_file(log_name)?;
    let stderr = stdout
        .try_clone()
        .map_err(|error| format!("Could not clone log handle for {log_name}: {error}"))?;
    Command::new(path)
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn append_hub_log(message: &str) {
    if let Ok(mut file) = append_log_file("misty-hub") {
        use std::io::Write;
        let timestamp = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        let _ = writeln!(file, "[{timestamp}] {message}");
    }
}

#[tauri::command]
pub fn read_misty_log(name: String, max_bytes: Option<u64>) -> Result<LogFileSnapshot, String> {
    let filename = component_log_filename(&name)?.to_string();
    let path = misty_logs_dir()?.join(&filename);
    let max_bytes = max_bytes.unwrap_or(256 * 1024).clamp(4 * 1024, 1024 * 1024);
    if !path.exists() {
        return Ok(LogFileSnapshot {
            name: filename,
            path: path.display().to_string(),
            exists: false,
            size_bytes: 0,
            content: String::new(),
        });
    }

    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
    let bytes =
        fs::read(&path).map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let start = bytes.len().saturating_sub(max_bytes as usize);
    let content = String::from_utf8_lossy(&bytes[start..]).to_string();
    Ok(LogFileSnapshot {
        name: filename,
        path: path.display().to_string(),
        exists: true,
        size_bytes: metadata.len(),
        content,
    })
}

fn misty_bin_dir() -> Result<PathBuf, String> {
    misty_home_dir().map(|home| home.join(".local").join("bin"))
}

fn legacy_misty_bin_dir() -> Result<PathBuf, String> {
    misty_home_dir().map(|home| home.join("local").join("bin"))
}

fn misty_db_dir() -> Result<PathBuf, String> {
    misty_home_dir().map(|home| home.join("db"))
}

fn misty_db_path() -> Result<PathBuf, String> {
    misty_home_dir().map(|home| home.join("db").join("data.db"))
}

fn jwt_secret_path() -> Result<PathBuf, String> {
    misty_home_dir().map(|home| home.join("config").join("jwt.secret"))
}

fn runtime_binary_name(base: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        format!("{base}.exe")
    }

    #[cfg(not(target_os = "windows"))]
    {
        base.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        io::{Cursor, Write},
        time::{SystemTime, UNIX_EPOCH},
    };
    use zip::{write::SimpleFileOptions, ZipWriter};

    fn temp_misty_home() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be available")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("misty-hub-test-{unique}"));
        fs::create_dir_all(&path).expect("temp home should be created");
        path
    }

    #[test]
    fn maps_release_roots_to_misty_home_destinations() {
        let home = PathBuf::from("/tmp/misty-home");

        assert_eq!(
            release_entry_destination(&home, "bin/misty").unwrap(),
            home.join(".local/bin/misty")
        );
        assert_eq!(
            release_entry_destination(&home, "assets/themes/default.css").unwrap(),
            home.join("assets/themes/default.css")
        );
        assert_eq!(
            release_entry_destination(&home, "scripts/bootstrap.sh").unwrap(),
            home.join("scripts/bootstrap.sh")
        );
        assert_eq!(
            release_entry_destination(&home, "plugins/public/example/plugin.json").unwrap(),
            home.join("plugins/public/example/plugin.json")
        );
    }

    #[test]
    fn rejects_unsafe_archive_entries() {
        let home = PathBuf::from("/tmp/misty-home");

        assert!(release_entry_destination(&home, "../misty").is_none());
        assert!(release_entry_destination(&home, "bin/../../misty").is_none());
        assert!(release_entry_destination(&home, "/bin/misty").is_none());
    }

    #[test]
    fn extracts_only_paths_present_in_zip() {
        let home = temp_misty_home();
        fs::create_dir_all(home.join("assets/themes")).expect("assets dir should exist");
        fs::write(home.join("assets/themes/user.css"), "keep")
            .expect("unrelated file should be written");
        fs::write(home.join("assets/themes/default.css"), "old")
            .expect("old release file should be written");

        let mut cursor = Cursor::new(Vec::new());
        {
            let mut zip = ZipWriter::new(&mut cursor);
            let options = SimpleFileOptions::default().unix_permissions(0o755);
            zip.start_file("bin/misty", options).unwrap();
            zip.write_all(b"misty-bin").unwrap();
            zip.start_file("assets/themes/default.css", SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"new").unwrap();
            zip.start_file("scripts/bootstrap.sh", options).unwrap();
            zip.write_all(b"#!/bin/sh\n").unwrap();
            zip.finish().unwrap();
        }

        extract_zip_archive(&cursor.into_inner(), &home).expect("zip should extract");

        assert_eq!(
            fs::read(home.join(".local/bin/misty")).unwrap(),
            b"misty-bin"
        );
        assert_eq!(
            fs::read_to_string(home.join("assets/themes/default.css")).unwrap(),
            "new"
        );
        assert_eq!(
            fs::read_to_string(home.join("assets/themes/user.css")).unwrap(),
            "keep"
        );
        assert!(home.join("scripts/bootstrap.sh").is_file());

        fs::remove_dir_all(home).ok();
    }

    #[test]
    fn probes_path_presence() {
        let home = temp_misty_home();
        fs::create_dir_all(home.join(".local/bin")).expect("bin dir should be created");
        fs::write(home.join(".local/bin/misty"), "misty").expect("binary should be written");

        let home_probe = probe_path(&home);
        let binary_probe = probe_path(&home.join(".local/bin/misty"));
        let missing_probe = probe_path(&home.join(".local/bin/misty-proxy"));

        assert!(home_probe.exists);
        assert!(home_probe.is_dir);
        assert!(binary_probe.exists);
        assert!(binary_probe.is_file);
        assert!(!missing_probe.exists);

        fs::remove_dir_all(home).ok();
    }
}
