use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};

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
    pub assets_dir: PathBuf,
    pub plugins_public_dir: PathBuf,
    pub plugins_private_dir: PathBuf,
    pub settings_path: PathBuf,
    pub misty_config_path: PathBuf,
    pub workspaces_path: PathBuf,
    pub commands_path: PathBuf,
    pub proxy_url: Option<String>,
    pub server_url: Option<String>,
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
    pub assets_dir: String,
    pub plugins_public_dir: String,
    pub plugins_private_dir: String,
    pub settings_path: String,
    pub misty_config_path: String,
    pub workspaces_path: String,
    pub commands_path: String,
    pub proxy_url: Option<String>,
    pub server_url: Option<String>,
    pub grpc_address: String,
    pub mount_path: String,
    pub config_exists: bool,
    pub derived_env: BTreeMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct MistyConfig {
    proxy: Option<MistyProxyConfig>,
    server: Option<MistyServerConfig>,
}

#[derive(Debug, Deserialize)]
struct MistyProxyConfig {
    port: Option<u16>,
}

#[derive(Debug, Deserialize)]
struct MistyServerConfig {
    url: Option<String>,
}

impl AppEnvironmentService {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(AppEnvironment::load()),
        }
    }

    pub fn snapshot(&self) -> AppEnvironmentSnapshot {
        self.inner.snapshot()
    }

    pub fn proxy_url(&self) -> Option<String> {
        self.inner.proxy_url.clone()
    }

    pub fn misty_db_path(&self) -> PathBuf {
        self.inner.db_dir.join("misty.db")
    }

    pub fn settings_path(&self) -> PathBuf {
        self.inner.settings_path.clone()
    }

    pub fn commands_path(&self) -> PathBuf {
        self.inner.commands_path.clone()
    }

    pub fn home_dir(&self) -> PathBuf {
        self.inner.home_dir.clone()
    }
}

impl AppEnvironment {
    fn load() -> Self {
        let home_dir = resolve_home_dir().unwrap_or_default();
        let misty_dir = home_dir.join(".misty");
        let config_dir = misty_dir.join("config");
        let db_dir = misty_dir.join("db");
        let cache_dir = misty_dir.join(".cache");
        let tmp_dir = misty_dir.join("tmp");
        let assets_dir = misty_dir.join("assets");
        let plugins_public_dir = misty_dir.join("plugins").join("public");
        let plugins_private_dir = misty_dir.join("plugins").join("private");
        let settings_path = config_dir.join("settings.json");
        let misty_config_path = config_dir.join("misty.json");
        let workspaces_path = config_dir.join("workspaces.json");
        let commands_path = config_dir.join("commands.msy");

        let parsed_config = read_misty_config(&misty_config_path);
        let config_proxy_url = parsed_config
            .as_ref()
            .and_then(|config| config.proxy.as_ref())
            .and_then(|proxy| proxy.port)
            .map(|port| format!("http://127.0.0.1:{port}"));
        let proxy_url = env::var("PROXY_SERVICE_URL")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .or(config_proxy_url);
        let server_url = parsed_config
            .as_ref()
            .and_then(|config| config.server.as_ref())
            .and_then(|server| server.url.clone())
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());

        Self {
            home_dir,
            misty_dir,
            config_dir,
            db_dir,
            cache_dir,
            tmp_dir,
            assets_dir,
            plugins_public_dir,
            plugins_private_dir,
            settings_path,
            misty_config_path: misty_config_path.clone(),
            workspaces_path,
            commands_path,
            proxy_url,
            server_url,
            grpc_address: "localhost:50051".to_owned(),
            mount_path: ".misty/mnt".to_owned(),
            config_exists: misty_config_path.exists(),
        }
    }

    fn snapshot(&self) -> AppEnvironmentSnapshot {
        let mut derived_env = BTreeMap::new();
        if let Some(proxy_url) = &self.proxy_url {
            derived_env.insert("PROXY_SERVICE_URL".to_owned(), proxy_url.clone());
        }
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
            assets_dir: display_path(&self.assets_dir),
            plugins_public_dir: display_path(&self.plugins_public_dir),
            plugins_private_dir: display_path(&self.plugins_private_dir),
            settings_path: display_path(&self.settings_path),
            misty_config_path: display_path(&self.misty_config_path),
            workspaces_path: display_path(&self.workspaces_path),
            commands_path: display_path(&self.commands_path),
            proxy_url: self.proxy_url.clone(),
            server_url: self.server_url.clone(),
            grpc_address: self.grpc_address.clone(),
            mount_path: self.mount_path.clone(),
            config_exists: self.config_exists,
            derived_env,
        }
    }
}

fn read_misty_config(path: &Path) -> Option<MistyConfig> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn resolve_home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn display_path(path: &Path) -> String {
    path.display().to_string()
}
