use std::{
    env, fs,
    path::Path,
    sync::{Arc, RwLock},
};

use serde::Serialize;
use serde_json::Value;

use crate::services::{environment::AppEnvironmentService, hub};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProxyRuntimeMode {
    External,
    Spawn,
    Embedded,
    Disabled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyRuntimeSnapshot {
    pub mode: ProxyRuntimeMode,
    pub proxy_url: Option<String>,
    pub ready: bool,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct ProxyRuntimeService {
    inner: Arc<ProxyRuntimeState>,
}

struct ProxyRuntimeState {
    snapshot: RwLock<ProxyRuntimeSnapshot>,
}

impl ProxyRuntimeService {
    pub fn start(environment: &AppEnvironmentService) -> Self {
        let mode = resolve_proxy_runtime_mode(environment);
        let snapshot = match mode {
            ProxyRuntimeMode::External => ProxyRuntimeSnapshot {
                mode,
                proxy_url: environment.proxy_url(),
                ready: environment.proxy_url().is_some(),
                error: environment
                    .proxy_url()
                    .is_none()
                    .then(|| "PROXY_SERVICE_URL is not configured.".to_owned()),
            },
            ProxyRuntimeMode::Spawn => start_spawn_runtime(environment, mode),
            ProxyRuntimeMode::Embedded => start_embedded_runtime(environment, mode),
            ProxyRuntimeMode::Disabled => ProxyRuntimeSnapshot {
                mode,
                proxy_url: None,
                ready: false,
                error: Some("Misty proxy runtime is disabled.".to_owned()),
            },
        };
        Self {
            inner: Arc::new(ProxyRuntimeState {
                snapshot: RwLock::new(snapshot),
            }),
        }
    }

    pub fn snapshot(&self) -> ProxyRuntimeSnapshot {
        let cached = self
            .inner
            .snapshot
            .read()
            .map(|snapshot| snapshot.clone())
            .unwrap_or_else(|_| ProxyRuntimeSnapshot {
                mode: ProxyRuntimeMode::Disabled,
                proxy_url: None,
                ready: false,
                error: Some("Proxy runtime state is unavailable.".to_owned()),
            });
        if cached.mode == ProxyRuntimeMode::Embedded {
            return snapshot_embedded_runtime(cached.mode).unwrap_or(cached);
        }
        cached
    }

    pub fn proxy_url(&self) -> Option<String> {
        self.snapshot().proxy_url
    }
}

impl Drop for ProxyRuntimeState {
    fn drop(&mut self) {
        let mode = self
            .snapshot
            .read()
            .map(|snapshot| snapshot.mode)
            .unwrap_or(ProxyRuntimeMode::Disabled);
        if mode == ProxyRuntimeMode::Embedded {
            stop_embedded_runtime();
        }
    }
}

fn resolve_proxy_runtime_mode(environment: &AppEnvironmentService) -> ProxyRuntimeMode {
    let requested = env::var("MISTY_PROXY_RUNTIME")
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "auto".to_owned());

    match requested.as_str() {
        "external" => ProxyRuntimeMode::External,
        "spawn" => ProxyRuntimeMode::Spawn,
        "embedded" => ProxyRuntimeMode::Embedded,
        "off" | "disabled" | "none" => ProxyRuntimeMode::Disabled,
        _ if configured_external_proxy_url().is_some() => ProxyRuntimeMode::External,
        _ if cfg!(any(mobile, target_os = "ios", target_os = "android")) => {
            ProxyRuntimeMode::Embedded
        }
        _ if environment.proxy_url().is_some() => ProxyRuntimeMode::External,
        _ => ProxyRuntimeMode::Spawn,
    }
}

fn configured_external_proxy_url() -> Option<String> {
    env::var("PROXY_SERVICE_URL")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

#[cfg(feature = "embedded-proxy-go")]
fn embedded_rclone_backend() -> String {
    env::var("MISTY_RCLONE_BACKEND")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if cfg!(any(mobile, target_os = "ios", target_os = "android")) {
                "librclone".to_owned()
            } else {
                "external".to_owned()
            }
        })
}

fn start_spawn_runtime(
    environment: &AppEnvironmentService,
    mode: ProxyRuntimeMode,
) -> ProxyRuntimeSnapshot {
    if let Some(proxy_url) = environment.proxy_url() {
        return ProxyRuntimeSnapshot {
            mode: ProxyRuntimeMode::External,
            proxy_url: Some(proxy_url),
            ready: true,
            error: None,
        };
    }

    match hub::launch_misty() {
        Ok(_) => {
            let proxy_url = read_proxy_url_from_config(&environment.misty_config_path());
            ProxyRuntimeSnapshot {
                mode,
                ready: proxy_url.is_some(),
                error: proxy_url.is_none().then(|| {
                    "misty-proxy launched, but did not publish a local port yet.".to_owned()
                }),
                proxy_url,
            }
        }
        Err(error) => ProxyRuntimeSnapshot {
            mode,
            proxy_url: None,
            ready: false,
            error: Some(error),
        },
    }
}

fn start_embedded_runtime(
    _environment: &AppEnvironmentService,
    mode: ProxyRuntimeMode,
) -> ProxyRuntimeSnapshot {
    #[cfg(feature = "embedded-proxy-go")]
    {
        return embedded_go::start_proxy(_environment, mode);
    }

    #[cfg(not(feature = "embedded-proxy-go"))]
    ProxyRuntimeSnapshot {
        mode,
        proxy_url: None,
        ready: false,
        error: Some(
            "Embedded misty-proxy runtime is not linked yet. Bundle the Go proxy library and expose MistyProxyStart/MistyProxyStop before enabling this mode."
                .to_owned(),
        ),
    }
}

fn stop_embedded_runtime() {
    #[cfg(feature = "embedded-proxy-go")]
    embedded_go::stop_proxy();
}

fn snapshot_embedded_runtime(mode: ProxyRuntimeMode) -> Option<ProxyRuntimeSnapshot> {
    #[cfg(feature = "embedded-proxy-go")]
    {
        embedded_go::snapshot_proxy(mode).ok()
    }

    #[cfg(not(feature = "embedded-proxy-go"))]
    {
        let _ = mode;
        None
    }
}

fn read_proxy_url_from_config(path: &Path) -> Option<String> {
    let body = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&body).ok()?;
    let port = value.get("proxy")?.get("port")?.as_u64()?;
    let port = u16::try_from(port).ok()?;
    Some(format!("http://127.0.0.1:{port}"))
}

#[cfg(feature = "embedded-proxy-go")]
mod embedded_go {
    use std::ffi::{CStr, CString};
    use std::os::raw::c_char;

    use serde::Deserialize;

    use super::*;

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct EmbeddedProxyConfig {
        data_dir: String,
        config_dir: String,
        db_dir: String,
        cache_dir: String,
        tmp_dir: String,
        bind_host: String,
        port: u16,
        server_url: Option<String>,
        rclone_backend: String,
        rclone_enabled: bool,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct EmbeddedProxyResponse {
        proxy_url: Option<String>,
        ready: bool,
        error: Option<String>,
    }

    extern "C" {
        fn MistyProxyStart(config_json: *const c_char) -> *mut c_char;
        fn MistyProxyStop() -> *mut c_char;
        fn MistyProxySnapshot() -> *mut c_char;
        fn MistyProxyFree(value: *mut c_char);
    }

    pub fn start_proxy(
        environment: &AppEnvironmentService,
        mode: ProxyRuntimeMode,
    ) -> ProxyRuntimeSnapshot {
        let rclone_backend = embedded_rclone_backend();
        let config = EmbeddedProxyConfig {
            data_dir: environment.home_dir().display().to_string(),
            config_dir: environment.snapshot().config_dir,
            db_dir: environment.snapshot().db_dir,
            cache_dir: environment.cache_dir().display().to_string(),
            tmp_dir: environment.snapshot().tmp_dir,
            bind_host: "127.0.0.1".to_owned(),
            port: 0,
            server_url: environment.snapshot().server_url,
            rclone_enabled: rclone_backend == "external",
            rclone_backend,
        };
        match call_go_proxy_start(&config) {
            Ok(response) => ProxyRuntimeSnapshot {
                mode,
                proxy_url: response.proxy_url,
                ready: response.ready,
                error: response.error,
            },
            Err(error) => ProxyRuntimeSnapshot {
                mode,
                proxy_url: None,
                ready: false,
                error: Some(error),
            },
        }
    }

    pub fn snapshot_proxy(mode: ProxyRuntimeMode) -> Result<ProxyRuntimeSnapshot, String> {
        let response = unsafe { MistyProxySnapshot() };
        let response = decode_go_proxy_response(response, "snapshot")?;
        Ok(ProxyRuntimeSnapshot {
            mode,
            proxy_url: response.proxy_url,
            ready: response.ready,
            error: response.error,
        })
    }

    pub fn stop_proxy() {
        let response = unsafe { MistyProxyStop() };
        if !response.is_null() {
            unsafe { MistyProxyFree(response) };
        }
    }

    fn call_go_proxy_start(config: &EmbeddedProxyConfig) -> Result<EmbeddedProxyResponse, String> {
        let config_json = serde_json::to_string(config)
            .map_err(|error| format!("Could not encode embedded proxy config: {error}"))?;
        let config_json = CString::new(config_json)
            .map_err(|_| "Embedded proxy config contained an unexpected NUL byte.".to_owned())?;
        let response = unsafe { MistyProxyStart(config_json.as_ptr()) };
        if response.is_null() {
            return Err("Embedded misty-proxy returned no startup response.".to_owned());
        }
        decode_go_proxy_response(response, "startup")
    }

    fn decode_go_proxy_response(
        response: *mut c_char,
        context: &str,
    ) -> Result<EmbeddedProxyResponse, String> {
        if response.is_null() {
            return Err(format!(
                "Embedded misty-proxy returned no {context} response."
            ));
        }
        let response_json = unsafe { CStr::from_ptr(response) }
            .to_string_lossy()
            .into_owned();
        unsafe { MistyProxyFree(response) };
        serde_json::from_str::<EmbeddedProxyResponse>(&response_json)
            .map_err(|error| format!("Embedded misty-proxy {context} JSON was invalid: {error}"))
    }
}

#[cfg(all(test, feature = "embedded-proxy-go"))]
mod tests {
    use std::{env, fs, time::Duration};

    use super::*;

    fn unique_test_home(name: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        env::temp_dir().join(format!("misty-proxy-runtime-{name}-{nanos}"))
    }

    #[test]
    fn embedded_go_runtime_serves_health() {
        let home_dir = unique_test_home("health");
        fs::create_dir_all(&home_dir).expect("create test home");
        env::set_var("MISTY_RCLONE_BACKEND", "librclone");
        let environment = AppEnvironmentService::for_test_home(home_dir.clone());

        let snapshot = start_embedded_runtime(&environment, ProxyRuntimeMode::Embedded);
        let result = std::panic::catch_unwind(|| {
            assert!(snapshot.ready, "embedded proxy was not ready: {snapshot:?}");
            let proxy_url = snapshot.proxy_url.as_deref().expect("embedded proxy URL");

            let client = reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(2))
                .build()
                .expect("http client");
            let response = client
                .get(format!("{proxy_url}/api/health"))
                .send()
                .expect("GET /api/health");
            assert!(
                response.status().is_success(),
                "health returned {}",
                response.status()
            );
            let payload: Value = response.json().expect("health json");
            assert_eq!(payload.get("ok").and_then(Value::as_bool), Some(true));

            let response = client
                .get(format!("{proxy_url}/api/remote/health"))
                .send()
                .expect("GET /api/remote/health");
            assert!(
                response.status().is_success(),
                "remote health returned {}",
                response.status()
            );
            let payload: Value = response.json().expect("remote health json");
            assert_eq!(
                payload.get("backend").and_then(Value::as_str),
                Some("librclone")
            );
            assert_eq!(payload.get("ready").and_then(Value::as_bool), Some(true));
        });

        stop_embedded_runtime();
        env::remove_var("MISTY_RCLONE_BACKEND");
        let _ = fs::remove_dir_all(home_dir);
        result.expect("embedded proxy health smoke")
    }
}
