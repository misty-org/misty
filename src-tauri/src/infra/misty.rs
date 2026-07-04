use crate::app::runtime::MistyRuntime;
use crate::infra::paths;
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
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

#[derive(Debug, Serialize)]
pub struct NativeSystemInfo {
    os: String,
    arch: String,
    misty_home: String,
    install_dir: String,
    legacy_install_dir: String,
    db_path: String,
    setup_path: String,
    installed_version: Option<String>,
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
    #[serde(default)]
    username: String,
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
const LOCAL_REFRESH_TOKEN_DAYS: i64 = 60;
const LOCAL_ACCESS_TOKEN_REFRESH_WINDOW_MINUTES: i64 = 15;
const LICENSE_REFRESH_AFTER_DAYS: i64 = 7;
const LICENSE_VERIFIED_DAYS: i64 = 14;
#[derive(Debug, Serialize, Clone, Default)]
pub struct MistyProcessStatus {
    pub misty_pid: Option<u32>,
    pub storage_ready: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseDownload {
    name: String,
    platform: String,
    url: String,
    sha256: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseCatalogEntry {
    version: String,
    date: String,
    summary: String,
    manifest_url: String,
    changes: Vec<String>,
    downloads: Vec<ReleaseDownload>,
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
    MistyProcessStatus {
        misty_pid,
        storage_ready: true,
    }
}

#[tauri::command]
pub async fn fetch_misty_releases() -> Result<Vec<ReleaseCatalogEntry>, String> {
    let client = reqwest::Client::new();
    let releases = authed_get(
        &client,
        "https://api.github.com/repos/misty-org/misty-public/releases",
    )
    .header("Accept", "application/vnd.github+json")
    .header("User-Agent", "Misty Desktop")
    .send()
    .await
    .map_err(|error| format!("Could not fetch Misty releases: {error}"))?
    .error_for_status()
    .map_err(|error| format!("Misty releases request failed: {error}"))?
    .json::<Vec<GithubRelease>>()
    .await
    .map_err(|error| format!("Misty releases JSON was invalid: {error}"))?;

    Ok(releases
        .into_iter()
        .filter(|release| !release.draft)
        .map(release_catalog_entry)
        .collect())
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    draft: bool,
    assets: Vec<GithubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseAsset {
    name: String,
    browser_download_url: String,
}

fn release_catalog_entry(release: GithubRelease) -> ReleaseCatalogEntry {
    let version = release.tag_name;
    let semver = version.trim_start_matches('v');
    let manifest_name = format!("manifest-{semver}.json");
    let manifest_url = release
        .assets
        .iter()
        .find(|asset| asset.name == manifest_name || asset.name.starts_with("manifest-"))
        .map(|asset| asset.browser_download_url.clone())
        .unwrap_or_else(|| {
            format!(
                "https://github.com/misty-org/misty-public/releases/download/{version}/{manifest_name}"
            )
        });
    let downloads = release
        .assets
        .into_iter()
        .filter(|asset| asset.name != manifest_name && !asset.name.starts_with("manifest-"))
        .map(release_download)
        .collect();
    let changes = release_changes(release.body.as_deref());
    let summary = release
        .name
        .filter(|name| !name.trim().is_empty())
        .or_else(|| changes.first().cloned())
        .unwrap_or_else(|| "Misty release".to_owned());

    ReleaseCatalogEntry {
        version,
        date: release_date_label(release.published_at.as_deref()),
        summary,
        manifest_url,
        changes,
        downloads,
    }
}

fn release_download(asset: GithubReleaseAsset) -> ReleaseDownload {
    ReleaseDownload {
        platform: release_asset_platform(&asset.name),
        sha256: String::new(),
        name: asset.name,
        url: asset.browser_download_url,
    }
}

fn release_asset_platform(name: &str) -> String {
    let lowered = name.to_ascii_lowercase();
    for platform in [
        "macos-aarch64",
        "macos-x86_64",
        "windows-x86_64",
        "linux-x86_64",
    ] {
        if lowered.contains(platform) {
            return platform.to_owned();
        }
    }
    "unknown".to_owned()
}

fn release_changes(body: Option<&str>) -> Vec<String> {
    body.unwrap_or_default()
        .lines()
        .map(|line| line.trim().trim_start_matches(['-', '*']).trim())
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .take(8)
        .map(ToOwned::to_owned)
        .collect()
}

fn release_date_label(published_at: Option<&str>) -> String {
    published_at
        .and_then(|value| value.split('T').next())
        .filter(|value| !value.is_empty())
        .unwrap_or("Unpublished")
        .to_owned()
}

#[tauri::command]
pub fn check_system() -> Result<NativeSystemInfo, String> {
    ensure_database()?;
    build_system_info(current_user()?, current_license()?)
}

fn build_system_info(
    current_user: Option<CurrentUser>,
    current_license: Option<CurrentLicense>,
) -> Result<NativeSystemInfo, String> {
    let home = misty_home_dir()?;
    let install_dir = misty_bin_dir()?;
    let legacy_install_dir = legacy_misty_bin_dir()?;
    let db_path = misty_db_path()?;
    let setup_path = std::env::current_exe()
        .unwrap_or_else(|_| PathBuf::from("Misty"))
        .display()
        .to_string();
    let installed_version = read_installed_version(&home)?;

    Ok(NativeSystemInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        misty_home: home.display().to_string(),
        install_dir: install_dir.display().to_string(),
        legacy_install_dir: legacy_install_dir.display().to_string(),
        db_path: db_path.display().to_string(),
        setup_path,
        installed_version,
        current_user,
        current_license,
    })
}

#[tauri::command]
pub fn probe_paths(paths: Vec<String>) -> Result<Vec<PathProbe>, String> {
    Ok(paths
        .iter()
        .map(|path| probe_path(Path::new(path)))
        .collect())
}

#[tauri::command]
pub fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    if !can_open_external_url(&url) {
        return Err("Only http, https, and mailto links can be opened externally.".to_string());
    }

    if url.starts_with("https://") || url.starts_with("http://") {
        use tauri::Emitter;
        let parsed = url::Url::parse(&url).map_err(|error| error.to_string())?;
        if !parsed.username().is_empty() || parsed.password().is_some() {
            return Err("Web addresses cannot contain credentials.".into());
        }
        return app
            .emit_to("main", "misty://open-web-url", parsed.as_str())
            .map_err(|error| error.to_string());
    }
    open_url_in_system_browser(&url)
        .map_err(|error| format!("Could not open {url} in the system browser: {error}"))
}

#[tauri::command]
pub fn get_misty_process_status() -> MistyProcessStatus {
    current_misty_process_status()
}

#[tauri::command]
pub fn launch_misty(
    state: tauri::State<'_, crate::app::runtime::MistyRuntime>,
) -> Result<String, String> {
    let runtime = state.storage_runtime.snapshot();
    if runtime.ready {
        Ok("Embedded Misty runtime is already running.".to_string())
    } else {
        Err(runtime
            .error
            .unwrap_or_else(|| "Embedded Misty runtime is not ready.".to_string()))
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

#[tauri::command]
pub fn stop_misty() -> Result<String, String> {
    Ok("Storage is embedded in Misty and stops when the app exits.".to_string())
}

#[tauri::command]
pub fn restart_misty(
    state: tauri::State<'_, crate::app::runtime::MistyRuntime>,
) -> Result<String, String> {
    let runtime = state.storage_runtime.snapshot();
    if runtime.ready {
        Ok("Embedded Misty runtime is app-managed; restart Misty to reload it.".to_string())
    } else {
        Err(runtime
            .error
            .unwrap_or_else(|| "Embedded Misty runtime is not ready.".to_string()))
    }
}

#[tauri::command]
pub fn sign_out_misty(state: tauri::State<'_, MistyRuntime>) -> Result<NativeSystemInfo, String> {
    crate::infra::mobile_cache::purge_all(&state.environment.cache_dir())
        .map_err(|error| format!("Could not purge mobile account data: {error}"))?;
    ensure_database()?;
    let conn = Connection::open(misty_db_path()?)
        .map_err(|error| format!("Could not open Misty database: {error}"))?;
    bootstrap_database(&conn)
        .map_err(|error| format!("Could not initialize Misty database: {error}"))?;
    let system_info = build_system_info(None, None)?;
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| format!("Could not start Misty sign-out: {error}"))?;
    tx.execute_batch(
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
    tx.commit()
        .map_err(|error| format!("Could not finish Misty sign-out: {error}"))?;
    let _ = state
        .storage_runtime
        .call("misty/clear-session-tokens", serde_json::json!({}));

    Ok(system_info)
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
    // Build the response before mutating authentication state so a filesystem
    // status error cannot turn a successful identity commit into an ambiguous
    // command failure for the frontend.
    let system_info = build_system_info(Some(user.clone()), Some(license.clone()))?;
    let tx = conn
        .unchecked_transaction()
        .map_err(|error| format!("Could not start Misty auth update: {error}"))?;
    save_current_user_and_license(&tx, &user, &license)?;
    issue_local_refresh_token(&tx, &user)?;
    issue_local_access_token(&tx, &user)?;
    tx.commit()
        .map_err(|error| format!("Could not finish Misty auth update: {error}"))?;

    Ok(system_info)
}

#[tauri::command]
pub fn ensure_local_access_token() -> Result<NativeSystemInfo, String> {
    ensure_database()?;
    let conn = Connection::open(misty_db_path()?)
        .map_err(|error| format!("Could not open Misty database: {error}"))?;
    bootstrap_database(&conn)
        .map_err(|error| format!("Could not initialize Misty database: {error}"))?;
    if let Some(user) = current_user()? {
        if has_fresh_local_access_token(&conn, &user.id)? {
            return check_system();
        }
        if has_active_refresh_token(&conn, &user.id)? {
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
    conn.execute("DELETE FROM refresh_tokens", params![])
        .map_err(|error| format!("Could not clear previous refresh tokens: {error}"))?;
    conn.execute("DELETE FROM access_tokens", params![])
        .map_err(|error| format!("Could not clear previous access tokens: {error}"))?;
    conn.execute("DELETE FROM revoked_access_tokens", params![])
        .map_err(|error| format!("Could not clear previous revoked tokens: {error}"))?;
    conn.execute("DELETE FROM license_cache", params![])
        .map_err(|error| format!("Could not clear previous license cache: {error}"))?;
    conn.execute("DELETE FROM users", params![])
        .map_err(|error| format!("Could not clear previous Misty user: {error}"))?;
    conn.execute(
        "INSERT INTO users (id, name, username, email) VALUES (?1, ?2, ?3, ?4)",
        params![&user.id, &user.name, &user.username, &user.email],
    )
    .map_err(|error| format!("Could not save Misty user: {error}"))?;

    let verified_at = Utc::now();
    let refresh_after = verified_at + chrono::Duration::days(LICENSE_REFRESH_AFTER_DAYS);
    let verified_until = verified_at + chrono::Duration::days(LICENSE_VERIFIED_DAYS);
    conn.execute(
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

    Ok(())
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
    matches!(license.tier.as_str(), "basic" | "personal" | "pro" | "max")
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

fn has_fresh_local_access_token(conn: &Connection, user_id: &str) -> Result<bool, String> {
    let refresh_after = (Utc::now()
        + chrono::Duration::minutes(LOCAL_ACCESS_TOKEN_REFRESH_WINDOW_MINUTES))
    .to_rfc3339_opts(SecondsFormat::Secs, true);
    let count: i64 = conn
        .query_row(
            r#"
            SELECT COUNT(1)
            FROM access_tokens
            WHERE user_id = ?1
              AND revoked = 0
              AND datetime(expires_at) > datetime(?2)
            "#,
            params![user_id, refresh_after],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not inspect local access token: {error}"))?;
    Ok(count > 0)
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

fn authed_get(client: &reqwest::Client, url: &str) -> reqwest::RequestBuilder {
    let request = client.get(url);

    match github_auth_token() {
        Some(token) => request.bearer_auth(token),
        None => request,
    }
}

fn github_auth_token() -> Option<String> {
    for key in [
        "MISTY_DOWNLOAD_TOKEN",
        "MISTY_GITHUB_TOKEN",
        "GITHUB_TOKEN",
        "GH_TOKEN",
    ] {
        if let Ok(token) = std::env::var(key) {
            let token = token.trim();
            if !token.is_empty() {
                return Some(token.to_string());
            }
        }
    }

    None
}

fn ensure_database() -> Result<(), String> {
    fs::create_dir_all(misty_db_dir()?)
        .map_err(|error| format!("Could not create Misty database directory: {error}"))?;
    let conn = Connection::open(misty_db_path()?)
        .map_err(|error| format!("Could not open Misty database: {error}"))?;
    bootstrap_database(&conn)
        .map_err(|error| format!("Could not initialize Misty database: {error}"))
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
        Ok(())
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

fn can_open_external_url(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")
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
            username TEXT NOT NULL DEFAULT '',
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
    ensure_column(conn, "users", "username", "TEXT NOT NULL DEFAULT ''")?;
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
        "SELECT id, name, username, email FROM users ORDER BY rowid ASC LIMIT 1",
        params![],
        |row| {
            Ok(CurrentUser {
                id: row.get(0)?,
                name: row.get(1)?,
                username: row.get(2)?,
                email: row.get(3)?,
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
    paths::misty_home_dir().ok_or_else(|| "Could not resolve Misty data directory".to_string())
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
        "storage" | "storage.log" => Ok("storage.log"),
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

fn installed_version_path(home: &Path) -> PathBuf {
    home.join(".version")
}

fn read_installed_version(home: &Path) -> Result<Option<String>, String> {
    let path = installed_version_path(home);
    if !path.exists() {
        return Ok(None);
    }
    let version = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read installed Misty version: {error}"))?
        .trim()
        .to_string();
    Ok((!version.is_empty()).then_some(version))
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
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_misty_home() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be available")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("misty-test-{unique}"));
        fs::create_dir_all(&path).expect("temp home should be created");
        path
    }

    #[test]
    fn max_license_allows_local_use() {
        let license = CurrentLicense {
            tier: "max".to_string(),
            status: "active".to_string(),
            allows_use: true,
            expires_at: None,
            trial_started_at: None,
            license_device: None,
            verified_at: None,
            refresh_after: None,
            verified_until: None,
            needs_refresh: false,
            verification_expired: false,
        };

        assert!(license_allows_local_use(&license));
    }

    #[test]
    fn authenticated_identity_write_rolls_back_with_its_outer_transaction() {
        let conn = Connection::open_in_memory().expect("database should open");
        bootstrap_database(&conn).expect("database should bootstrap");
        let license = CurrentLicense {
            tier: "personal".to_string(),
            status: "active".to_string(),
            allows_use: true,
            expires_at: None,
            trial_started_at: None,
            license_device: None,
            verified_at: None,
            refresh_after: None,
            verified_until: None,
            needs_refresh: false,
            verification_expired: false,
        };
        let previous = CurrentUser {
            id: "account-a".to_string(),
            name: "Account A".to_string(),
            username: "account-a".to_string(),
            email: "a@example.test".to_string(),
        };
        let target = CurrentUser {
            id: "account-b".to_string(),
            name: "Account B".to_string(),
            username: "account-b".to_string(),
            email: "b@example.test".to_string(),
        };
        save_current_user_and_license(&conn, &previous, &license)
            .expect("previous identity should save");

        {
            let tx = conn
                .unchecked_transaction()
                .expect("transaction should start");
            save_current_user_and_license(&tx, &target, &license)
                .expect("target identity should stage");
            // Simulate a later token-issuance failure by dropping without a
            // commit. The original identity must remain intact.
        }

        let current_id: String = conn
            .query_row("SELECT id FROM users LIMIT 1", params![], |row| row.get(0))
            .expect("previous identity should remain");
        assert_eq!(current_id, previous.id);
    }

    #[test]
    #[cfg(debug_assertions)]
    #[test]
    fn probes_path_presence() {
        let home = temp_misty_home();
        fs::create_dir_all(home.join(".local/bin")).expect("bin dir should be created");
        fs::write(home.join(".local/bin/misty"), "misty").expect("binary should be written");

        let home_probe = probe_path(&home);
        let binary_probe = probe_path(&home.join(".local/bin/misty"));
        let missing_probe = probe_path(&home.join(".local/bin/missing-service"));

        assert!(home_probe.exists);
        assert!(home_probe.is_dir);
        assert!(binary_probe.exists);
        assert!(binary_probe.is_file);
        assert!(!missing_probe.exists);

        fs::remove_dir_all(home).ok();
    }

    #[test]
    fn external_url_allowlist_includes_mailto_without_custom_schemes() {
        assert!(can_open_external_url("https://misty.app"));
        assert!(can_open_external_url("http://localhost:1420"));
        assert!(can_open_external_url("mailto:hello@misty.app"));
        assert!(!can_open_external_url("javascript:alert(1)"));
        assert!(!can_open_external_url("misty://settings"));
        assert!(!can_open_external_url("file:///tmp/secret.txt"));
    }
}
