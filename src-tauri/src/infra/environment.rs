use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

use crate::infra::paths;

#[derive(Clone)]
pub struct AppEnvironmentService {
    inner: Arc<AppEnvironment>,
}

#[derive(Debug, Clone)]
pub struct AppEnvironment {
    pub home_dir: PathBuf,
    pub misty_dir: PathBuf,
    pub config_dir: PathBuf,
    pub db_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub tmp_dir: PathBuf,
    pub notes_dir: PathBuf,
    pub plugins_public_dir: PathBuf,
    pub plugins_private_dir: PathBuf,
    pub settings_path: PathBuf,
    pub misty_config_path: PathBuf,
    pub workspaces_path: PathBuf,
    pub commands_path: PathBuf,
    pub server_url: Option<String>,
    pub server_mode: ServerMode,
    pub server_deployment_id: Option<String>,
    pub server_name: Option<String>,
    pub grpc_address: String,
    pub mount_path: String,
    pub config_exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEnvironmentSnapshot {
    pub home_dir: String,
    pub misty_dir: String,
    pub config_dir: String,
    pub db_dir: String,
    pub cache_dir: String,
    pub tmp_dir: String,
    pub notes_dir: String,
    pub plugins_public_dir: String,
    pub plugins_private_dir: String,
    pub settings_path: String,
    pub misty_config_path: String,
    pub workspaces_path: String,
    pub commands_path: String,
    pub server_url: Option<String>,
    pub server_mode: ServerMode,
    pub server_deployment_id: Option<String>,
    pub server_name: Option<String>,
    pub grpc_address: String,
    pub mount_path: String,
    pub config_exists: bool,
    pub derived_env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ServerMode {
    #[default]
    Hosted,
    SelfHosted,
}

#[derive(Debug, Deserialize, Serialize)]
struct MistyConfig {
    server: Option<MistyServerConfig>,
}

#[derive(Debug, Deserialize, Serialize)]
struct MistyServerConfig {
    #[serde(default)]
    mode: ServerMode,
    url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    deployment_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
}

impl AppEnvironmentService {
    pub fn new() -> Self {
        Self::new_with_data_root(None)
    }

    pub fn new_with_data_root(data_root: Option<PathBuf>) -> Self {
        Self {
            inner: Arc::new(AppEnvironment::load(data_root)),
        }
    }

    pub fn snapshot(&self) -> AppEnvironmentSnapshot {
        self.inner.snapshot()
    }

    pub fn misty_config_path(&self) -> PathBuf {
        self.inner.misty_config_path.clone()
    }

    pub fn misty_db_path(&self) -> PathBuf {
        self.inner.db_dir.join("data.db")
    }

    pub fn settings_path(&self) -> PathBuf {
        self.inner.settings_path.clone()
    }

    pub fn commands_path(&self) -> PathBuf {
        self.inner.commands_path.clone()
    }

    pub fn config_dir(&self) -> PathBuf {
        self.inner.config_dir.clone()
    }

    pub fn plugins_public_dir(&self) -> PathBuf {
        self.inner.plugins_public_dir.clone()
    }

    pub fn plugins_private_dir(&self) -> PathBuf {
        self.inner.plugins_private_dir.clone()
    }

    pub fn home_dir(&self) -> PathBuf {
        self.inner.home_dir.clone()
    }

    pub fn mount_root(&self) -> PathBuf {
        let configured = PathBuf::from(&self.inner.mount_path);
        if configured.is_absolute() {
            configured
        } else {
            self.inner.home_dir.join(configured)
        }
    }

    pub fn cache_dir(&self) -> PathBuf {
        self.inner.cache_dir.clone()
    }

    pub fn notes_dir(&self) -> PathBuf {
        self.inner.notes_dir.clone()
    }

    pub fn workspaces_path(&self) -> PathBuf {
        self.inner.workspaces_path.clone()
    }

    pub fn configure_server(
        &self,
        mode: ServerMode,
        raw_url: Option<String>,
        deployment_id: Option<String>,
        name: Option<String>,
    ) -> Result<(), String> {
        let url = validate_server_url(mode, raw_url)?;
        let deployment_id = validate_deployment_id(mode, deployment_id)?;
        let name = validate_server_name(mode, name)?;
        let document = MistyConfig {
            server: Some(MistyServerConfig {
                mode,
                url,
                deployment_id,
                name,
            }),
        };
        let bytes = serde_json::to_vec_pretty(&document)
            .map_err(|error| format!("Could not encode Misty server configuration: {error}"))?;
        let path = self.misty_config_path();
        let parent = path
            .parent()
            .ok_or_else(|| "Misty configuration path has no parent directory.".to_owned())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create Misty configuration directory: {error}"))?;
        let temporary = path.with_extension("json.tmp");
        fs::write(&temporary, bytes)
            .map_err(|error| format!("Could not write Misty server configuration: {error}"))?;
        replace_file(&temporary, &path)
            .map_err(|error| format!("Could not activate Misty server configuration: {error}"))?;
        Ok(())
    }

    #[cfg(test)]
    pub fn for_test_home(home_dir: PathBuf) -> Self {
        Self {
            inner: Arc::new(AppEnvironment::for_home(home_dir)),
        }
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

impl AppEnvironment {
    fn load(data_root: Option<PathBuf>) -> Self {
        let home_dir = data_root.or_else(resolve_home_dir).unwrap_or_default();
        let misty_dir = home_dir.join(".misty");
        let config_dir = misty_dir.join("config");
        let db_dir = misty_dir.join("db");
        let cache_dir = misty_dir.join(".cache");
        let tmp_dir = misty_dir.join("tmp");
        let notes_dir = misty_dir.join("notes");
        let plugins_public_dir = misty_dir.join("plugins").join("public");
        let plugins_private_dir = misty_dir.join("plugins").join("private");
        let settings_path = config_dir.join("settings.json");
        let misty_config_path = config_dir.join("misty.json");
        let workspaces_path = config_dir.join("workspaces.json");
        let commands_path = config_dir.join("commands.msy");
        ensure_mobile_user_dirs(&home_dir);
        let grpc_address = settings_advanced_string(&settings_path, "server_address")
            .unwrap_or_else(|| "localhost:50051".to_owned());
        let mount_path = settings_advanced_string(&settings_path, "mount_path")
            .unwrap_or_else(|| ".misty/mnt".to_owned());

        let parsed_config = read_misty_config(&misty_config_path);
        let server_url = parsed_config
            .as_ref()
            .and_then(|config| config.server.as_ref())
            .and_then(|server| server.url.clone())
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let server_mode = parsed_config
            .as_ref()
            .and_then(|config| config.server.as_ref())
            .map(|server| server.mode)
            .unwrap_or_default();
        let server_deployment_id = parsed_config
            .as_ref()
            .and_then(|config| config.server.as_ref())
            .and_then(|server| server.deployment_id.clone());
        let server_name = parsed_config
            .as_ref()
            .and_then(|config| config.server.as_ref())
            .and_then(|server| server.name.clone());

        Self {
            home_dir,
            misty_dir,
            config_dir,
            db_dir,
            cache_dir,
            tmp_dir,
            notes_dir,
            plugins_public_dir,
            plugins_private_dir,
            settings_path,
            misty_config_path: misty_config_path.clone(),
            workspaces_path,
            commands_path,
            server_url,
            server_mode,
            server_deployment_id,
            server_name,
            grpc_address,
            mount_path,
            config_exists: misty_config_path.exists(),
        }
    }

    #[cfg(test)]
    fn for_home(home_dir: PathBuf) -> Self {
        let misty_dir = home_dir.join(".misty");
        let config_dir = misty_dir.join("config");
        let db_dir = misty_dir.join("db");
        let cache_dir = misty_dir.join(".cache");
        let tmp_dir = misty_dir.join("tmp");
        let notes_dir = misty_dir.join("notes");
        let plugins_public_dir = misty_dir.join("plugins").join("public");
        let plugins_private_dir = misty_dir.join("plugins").join("private");
        let settings_path = config_dir.join("settings.json");
        let misty_config_path = config_dir.join("misty.json");
        let workspaces_path = config_dir.join("workspaces.json");
        let commands_path = config_dir.join("commands.msy");
        ensure_mobile_user_dirs(&home_dir);
        let grpc_address = settings_advanced_string(&settings_path, "server_address")
            .unwrap_or_else(|| "localhost:50051".to_owned());
        let mount_path = settings_advanced_string(&settings_path, "mount_path")
            .unwrap_or_else(|| ".misty/mnt".to_owned());

        Self {
            home_dir,
            misty_dir,
            config_dir,
            db_dir,
            cache_dir,
            tmp_dir,
            notes_dir,
            plugins_public_dir,
            plugins_private_dir,
            settings_path,
            misty_config_path,
            workspaces_path,
            commands_path,
            server_url: None,
            server_mode: ServerMode::Hosted,
            server_deployment_id: None,
            server_name: None,
            grpc_address,
            mount_path,
            config_exists: false,
        }
    }

    fn snapshot(&self) -> AppEnvironmentSnapshot {
        let mut derived_env = BTreeMap::new();
        if let Some(server_url) = &self.server_url {
            derived_env.insert("MISTY_SERVER_URL".to_owned(), server_url.clone());
        }
        derived_env.insert("MISTY_GRPC_ADDRESS".to_owned(), self.grpc_address.clone());
        derived_env.insert("MISTY_MOUNT_PATH".to_owned(), self.mount_path.clone());

        AppEnvironmentSnapshot {
            home_dir: display_path(&self.home_dir),
            misty_dir: display_path(&self.misty_dir),
            config_dir: display_path(&self.config_dir),
            db_dir: display_path(&self.db_dir),
            cache_dir: display_path(&self.cache_dir),
            tmp_dir: display_path(&self.tmp_dir),
            notes_dir: display_path(&self.notes_dir),
            plugins_public_dir: display_path(&self.plugins_public_dir),
            plugins_private_dir: display_path(&self.plugins_private_dir),
            settings_path: display_path(&self.settings_path),
            misty_config_path: display_path(&self.misty_config_path),
            workspaces_path: display_path(&self.workspaces_path),
            commands_path: display_path(&self.commands_path),
            server_url: self.server_url.clone(),
            server_mode: self.server_mode,
            server_deployment_id: self.server_deployment_id.clone(),
            server_name: self.server_name.clone(),
            grpc_address: self.grpc_address.clone(),
            mount_path: self.mount_path.clone(),
            config_exists: self.config_exists,
            derived_env,
        }
    }
}

fn validate_server_url(
    mode: ServerMode,
    raw_url: Option<String>,
) -> Result<Option<String>, String> {
    if mode == ServerMode::Hosted {
        return Ok(None);
    }
    let raw = raw_url
        .unwrap_or_default()
        .trim()
        .trim_end_matches('/')
        .to_owned();
    if raw.is_empty() {
        return Err("A self-hosted Misty server URL is required.".to_owned());
    }
    let parsed =
        Url::parse(&raw).map_err(|_| "The self-hosted server URL is invalid.".to_owned())?;
    let hostname = parsed
        .host_str()
        .ok_or_else(|| "The self-hosted server URL must include a hostname.".to_owned())?;
    let loopback = matches!(hostname, "localhost" | "127.0.0.1" | "::1");
    if parsed.scheme() != "https" && !(loopback && parsed.scheme() == "http") {
        return Err(
            "Self-hosted servers must use HTTPS unless they run on this device.".to_owned(),
        );
    }
    if parsed.username() != ""
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(
            "The self-hosted server URL cannot contain credentials, a query, or a fragment."
                .to_owned(),
        );
    }
    Ok(Some(raw))
}

fn validate_deployment_id(
    mode: ServerMode,
    deployment_id: Option<String>,
) -> Result<Option<String>, String> {
    if mode == ServerMode::Hosted {
        return Ok(None);
    }
    let value = deployment_id.unwrap_or_default().trim().to_owned();
    if value.len() < 8
        || value.len() > 200
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        return Err("The self-hosted deployment identifier is invalid.".to_owned());
    }
    Ok(Some(value))
}

fn validate_server_name(mode: ServerMode, name: Option<String>) -> Result<Option<String>, String> {
    if mode == ServerMode::Hosted {
        return Ok(None);
    }
    let value = name.unwrap_or_default().trim().to_owned();
    if value.is_empty() || value.chars().count() > 120 {
        return Err("The self-hosted server name is invalid.".to_owned());
    }
    Ok(Some(value))
}

fn read_misty_config(path: &Path) -> Option<MistyConfig> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn settings_advanced_string(path: &Path, key: &str) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    let document: Value = serde_json::from_str(&raw).ok()?;
    let value = document
        .get("advanced")
        .and_then(Value::as_object)
        .and_then(|advanced| advanced.get(key))
        .and_then(Value::as_str)?
        .trim()
        .to_owned();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn resolve_home_dir() -> Option<PathBuf> {
    paths::misty_data_root()
}

fn display_path(path: &Path) -> String {
    clean_display_path(path.display().to_string().as_str())
}

#[cfg(windows)]
fn clean_display_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        path.to_string()
    }
}

#[cfg(not(windows))]
fn clean_display_path(path: &str) -> String {
    path.to_string()
}

#[cfg(target_os = "ios")]
fn ensure_mobile_user_dirs(home_dir: &Path) {
    for name in ["Documents", "Downloads"] {
        let _ = fs::create_dir_all(home_dir.join(name));
    }
}

#[cfg(not(target_os = "ios"))]
fn ensure_mobile_user_dirs(_home_dir: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_home(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        env::temp_dir().join(format!("misty-env-{name}-{nanos}"))
    }

    #[test]
    fn application_database_uses_existing_shared_data_db() {
        let root = env::temp_dir().join("misty-env-shared-data-db");
        let service = AppEnvironmentService {
            inner: Arc::new(AppEnvironment {
                home_dir: root.clone(),
                misty_dir: root.join(".misty"),
                config_dir: root.join(".misty/config"),
                db_dir: root.join(".misty/db"),
                cache_dir: root.join(".misty/.cache"),
                tmp_dir: root.join(".misty/tmp"),
                notes_dir: root.join(".misty/notes"),
                plugins_public_dir: root.join(".misty/plugins/public"),
                plugins_private_dir: root.join(".misty/plugins/private"),
                settings_path: root.join(".misty/config/settings.json"),
                misty_config_path: root.join(".misty/config/misty.json"),
                workspaces_path: root.join(".misty/config/workspaces.json"),
                commands_path: root.join(".misty/config/commands.msy"),
                server_url: None,
                server_mode: ServerMode::Hosted,
                server_deployment_id: None,
                server_name: None,
                grpc_address: "localhost:50051".to_owned(),
                mount_path: ".misty/mnt".to_owned(),
                config_exists: false,
            }),
        };

        assert_eq!(service.misty_db_path(), root.join(".misty/db/data.db"));
        assert_eq!(service.misty_db_path(), root.join(".misty/db/data.db"));
    }

    #[test]
    fn environment_uses_saved_advanced_connection_settings() {
        let root = unique_test_home("advanced-settings");
        let settings_path = root.join(".misty/config/settings.json");
        fs::create_dir_all(settings_path.parent().expect("settings parent"))
            .expect("create settings parent");
        fs::write(
            &settings_path,
            r#"{
              "advanced": {
                "server_address": "127.0.0.1:60051",
                "mount_path": "/Volumes/Misty"
              }
            }"#,
        )
        .expect("write settings");

        let environment = AppEnvironment::for_home(root.clone());
        let snapshot = environment.snapshot();

        assert_eq!(
            snapshot.notes_dir,
            display_path(&root.join(".misty").join("notes"))
        );
        assert_eq!(snapshot.grpc_address, "127.0.0.1:60051");
        assert_eq!(snapshot.mount_path, "/Volumes/Misty");
        assert_eq!(
            snapshot.derived_env.get("MISTY_GRPC_ADDRESS"),
            Some(&"127.0.0.1:60051".to_owned()),
        );
        assert_eq!(
            snapshot.derived_env.get("MISTY_MOUNT_PATH"),
            Some(&"/Volumes/Misty".to_owned()),
        );
    }

    #[test]
    fn self_hosted_configuration_is_validated_and_activated_atomically() {
        let root = unique_test_home("self-hosted");
        let service = AppEnvironmentService::for_test_home(root.clone());

        service
            .configure_server(
                ServerMode::SelfHosted,
                Some("https://misty.example.com/api/".to_owned()),
                Some("server_00000000-0000-0000-0000-000000000001".to_owned()),
                Some("Studio LAN".to_owned()),
            )
            .expect("configure self-hosted server");

        let environment = AppEnvironment::load(Some(root.clone()));
        assert_eq!(environment.server_mode, ServerMode::SelfHosted);
        assert_eq!(environment.server_name.as_deref(), Some("Studio LAN"));
        assert_eq!(
            environment.server_url.as_deref(),
            Some("https://misty.example.com/api")
        );
        assert!(!root.join(".misty/config/misty.json.tmp").exists());
    }

    #[test]
    fn self_hosted_configuration_rejects_insecure_non_loopback_urls() {
        assert!(validate_server_url(
            ServerMode::SelfHosted,
            Some("http://misty.lan/api".to_owned())
        )
        .is_err());
        assert!(validate_server_url(
            ServerMode::SelfHosted,
            Some("http://127.0.0.1:8080/api".to_owned())
        )
        .is_ok());
    }
}
