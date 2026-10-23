use crate::app::runtime::MistyRuntime;
use crate::infra::paths;
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

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
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CurrentUser {
    id: String,
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

const LICENSE_REFRESH_AFTER_DAYS: i64 = 7;
const LICENSE_VERIFIED_DAYS: i64 = 14;
/// The account this device last signed in with. The server owns the account; this only
/// lets the app show who is signed in and whether the license was verified recently.
/// It lives in `misty.db` with everything else (sign-in already depends on that
/// database, since the account's tokens are in it).
#[derive(Default, Serialize, Deserialize)]
struct StoredSession {
    user: Option<CurrentUser>,
    license: Option<CurrentLicense>,
}

static SESSION_LOCK: Mutex<()> = Mutex::new(());

fn session_store() -> Result<super::store::Store, String> {
    misty_home_dir()
        .map(|home| super::store::Store::at(home.join(".local").join("data").join("misty.db")))
}

fn read_session() -> StoredSession {
    // A missing or damaged record is a signed-out device, never an error.
    session_store()
        .ok()
        .and_then(|store| store.connect().ok())
        .and_then(|connection| {
            connection
                .query_row("SELECT document FROM session WHERE id = 1", [], |row| {
                    row.get::<_, String>(0)
                })
                .ok()
        })
        .and_then(|document| serde_json::from_str(&document).ok())
        .unwrap_or_default()
}

fn write_session(session: &StoredSession) -> Result<(), String> {
    let document = serde_json::to_string(session).map_err(|error| error.to_string())?;
    let connection = session_store()?
        .connect()
        .map_err(|error| format!("Could not open the Misty database: {error}"))?;
    connection
        .execute(
            "INSERT INTO session (id, document) VALUES (1, ?1)
             ON CONFLICT (id) DO UPDATE SET document = excluded.document",
            [document],
        )
        .map(|_| ())
        .map_err(|error| format!("Could not save the Misty session: {error}"))
}

fn parse_time(value: Option<&str>) -> Option<DateTime<Utc>> {
    value
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|time| time.with_timezone(&Utc))
}

/// A license stamped as verified now, with when it should be rechecked and
/// when it stops allowing use if it never is.
fn verified_license(license: &CurrentLicense) -> CurrentLicense {
    let verified_at = Utc::now();
    let stamp = |time: DateTime<Utc>| Some(time.to_rfc3339_opts(SecondsFormat::Secs, true));
    CurrentLicense {
        verified_at: stamp(verified_at),
        refresh_after: stamp(verified_at + chrono::Duration::days(LICENSE_REFRESH_AFTER_DAYS)),
        verified_until: stamp(verified_at + chrono::Duration::days(LICENSE_VERIFIED_DAYS)),
        needs_refresh: false,
        verification_expired: false,
        ..license.clone()
    }
}

/// The stored license as the app sees it now: due for a recheck, or no longer
/// allowing use because it went unverified for too long.
fn license_now(mut license: CurrentLicense) -> CurrentLicense {
    let now = Utc::now();
    license.needs_refresh =
        parse_time(license.refresh_after.as_deref()).is_none_or(|due| due <= now);
    license.verification_expired =
        parse_time(license.verified_until.as_deref()).is_some_and(|until| until <= now);
    if license.verification_expired {
        license.allows_use = false;
    }
    license
}

fn session_info() -> Result<NativeSystemInfo, String> {
    let stored = read_session();
    build_system_info(stored.user, stored.license.map(license_now))
}

/// Async so the file work never runs on the UI thread.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn check_system() -> Result<NativeSystemInfo, String> {
    blocking(session_info).await
}

#[tauri::command]
pub async fn sign_out_misty(
    _state: tauri::State<'_, MistyRuntime>,
) -> Result<NativeSystemInfo, String> {
    blocking(|| {
        let _guard = SESSION_LOCK.lock().map_err(|_| "Misty session is busy.")?;
        write_session(&StoredSession::default())?;
        build_system_info(None, None)
    })
    .await
}

#[tauri::command]
pub async fn save_authenticated_user(
    user: CurrentUser,
    license: Option<CurrentLicense>,
) -> Result<NativeSystemInfo, String> {
    blocking(move || {
        let license = license.ok_or_else(|| "Misty license could not be verified.".to_string())?;
        if !license_allows_local_use(&license) {
            return Err("Misty license is not active for local use.".to_string());
        }
        let _guard = SESSION_LOCK.lock().map_err(|_| "Misty session is busy.")?;
        write_session(&StoredSession {
            user: Some(user),
            license: Some(verified_license(&license)),
        })?;
        session_info()
    })
    .await
}

#[tauri::command]
pub async fn save_verified_license(license: CurrentLicense) -> Result<NativeSystemInfo, String> {
    blocking(move || {
        if !license_allows_local_use(&license) {
            return Err("Misty license is not active for local use.".to_string());
        }
        let _guard = SESSION_LOCK.lock().map_err(|_| "Misty session is busy.")?;
        let mut stored = read_session();
        if stored.user.is_none() {
            return Err("No signed in Misty user.".to_string());
        }
        stored.license = Some(verified_license(&license));
        write_session(&stored)?;
        session_info()
    })
    .await
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

fn license_allows_local_use(license: &CurrentLicense) -> bool {
    matches!(license.tier.as_str(), "basic" | "personal" | "pro" | "max")
        && matches!(license.status.as_str(), "active" | "trialing")
        && license.allows_use
}

fn misty_home_dir() -> Result<PathBuf, String> {
    paths::misty_home_dir().ok_or_else(|| "Could not resolve Misty data directory".to_string())
}

fn misty_bin_dir() -> Result<PathBuf, String> {
    misty_home_dir().map(|home| home.join(".local").join("bin"))
}

fn legacy_misty_bin_dir() -> Result<PathBuf, String> {
    misty_home_dir().map(|home| home.join("local").join("bin"))
}

fn misty_db_path() -> Result<PathBuf, String> {
    misty_home_dir().map(|home| home.join(".local").join("data").join("misty.db"))
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

#[cfg(test)]
mod tests {
    use super::*;

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

    fn license(tier: &str) -> CurrentLicense {
        CurrentLicense {
            tier: tier.to_string(),
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
        }
    }

    #[test]
    fn a_fresh_license_is_not_due_and_a_stale_one_stops_allowing_use() {
        let fresh = license_now(verified_license(&license("pro")));
        assert!(!fresh.needs_refresh && !fresh.verification_expired && fresh.allows_use);

        let mut stale = verified_license(&license("pro"));
        stale.refresh_after = Some("2020-01-01T00:00:00Z".to_string());
        stale.verified_until = Some("2020-01-15T00:00:00Z".to_string());
        let stale = license_now(stale);
        assert!(stale.needs_refresh && stale.verification_expired && !stale.allows_use);
    }

    #[test]
    fn a_license_without_timestamps_is_rechecked() {
        assert!(license_now(license("pro")).needs_refresh);
    }

    #[test]
    fn a_damaged_session_file_reads_as_signed_out() {
        let parsed: Option<StoredSession> = serde_json::from_slice(b"{ not json").ok();
        assert!(parsed.is_none());
        let stored = StoredSession {
            user: Some(CurrentUser {
                id: "a".into(),
                username: "a".into(),
                email: "a@example.test".into(),
            }),
            license: Some(verified_license(&license("pro"))),
        };
        let round: StoredSession =
            serde_json::from_slice(&serde_json::to_vec(&stored).unwrap()).unwrap();
        assert_eq!(round.user.unwrap().id, "a");
        assert!(round.license.unwrap().refresh_after.is_some());
    }
}
