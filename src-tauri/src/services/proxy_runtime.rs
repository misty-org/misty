use std::{
    env,
    sync::{Arc, RwLock},
};

use serde::Serialize;

use crate::services::environment::AppEnvironmentService;

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
            ProxyRuntimeMode::Embedded => start_embedded_runtime(environment, mode),
            ProxyRuntimeMode::Disabled => ProxyRuntimeSnapshot {
                mode,
                proxy_url: None,
                ready: false,
                error: Some("Misty proxy runtime is disabled.".to_owned()),
            },
            ProxyRuntimeMode::External | ProxyRuntimeMode::Spawn => {
                start_embedded_runtime(environment, ProxyRuntimeMode::Embedded)
            }
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
        None
    }

    pub fn invoke_embedded(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        if self.snapshot().mode != ProxyRuntimeMode::Embedded {
            return Err("Embedded proxy runtime is not active.".to_owned());
        }
        invoke_embedded_runtime(method, params)
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
    let _ = environment;
    let requested = env::var("MISTY_PROXY_RUNTIME")
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "auto".to_owned());

    match requested.as_str() {
        "off" | "disabled" | "none" => ProxyRuntimeMode::Disabled,
        _ => ProxyRuntimeMode::Embedded,
    }
}

#[cfg(feature = "embedded-proxy-go")]
fn embedded_rclone_backend() -> String {
    env::var("MISTY_RCLONE_BACKEND")
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "misty-rclone".to_owned())
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

fn invoke_embedded_runtime(
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    #[cfg(feature = "embedded-proxy-go")]
    {
        embedded_go::invoke_proxy(method, params)
    }

    #[cfg(not(feature = "embedded-proxy-go"))]
    {
        let _ = method;
        let _ = params;
        Err("Embedded misty-proxy runtime is not linked.".to_owned())
    }
}

#[cfg(feature = "embedded-proxy-go")]
mod embedded_go {
    use std::ffi::{CStr, CString};
    use std::os::raw::c_char;
    #[cfg(windows)]
    use std::path::PathBuf;

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
        rclone_config_password: Option<String>,
    }

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct EmbeddedProxyResponse {
        proxy_url: Option<String>,
        ready: bool,
        error: Option<String>,
    }

    #[cfg(not(windows))]
    mod symbols {
        use super::c_char;

        extern "C" {
            fn MistyProxyStart(config_json: *const c_char) -> *mut c_char;
            fn MistyProxyStop() -> *mut c_char;
            fn MistyProxySnapshot() -> *mut c_char;
            fn MistyProxyInvoke(request_json: *const c_char) -> *mut c_char;
            fn MistyProxyFree(value: *mut c_char);
        }

        pub unsafe fn start(config_json: *const c_char) -> Result<*mut c_char, String> {
            Ok(MistyProxyStart(config_json))
        }

        pub unsafe fn stop() -> Result<*mut c_char, String> {
            Ok(MistyProxyStop())
        }

        pub unsafe fn snapshot() -> Result<*mut c_char, String> {
            Ok(MistyProxySnapshot())
        }

        pub unsafe fn invoke(request_json: *const c_char) -> Result<*mut c_char, String> {
            Ok(MistyProxyInvoke(request_json))
        }

        pub unsafe fn free(value: *mut c_char) {
            MistyProxyFree(value);
        }
    }

    #[cfg(windows)]
    mod symbols {
        use super::{c_char, PathBuf};
        use libloading::Library;
        use std::env;
        use std::sync::OnceLock;

        type StartFn = unsafe extern "C" fn(*const c_char) -> *mut c_char;
        type StopFn = unsafe extern "C" fn() -> *mut c_char;
        type SnapshotFn = unsafe extern "C" fn() -> *mut c_char;
        type InvokeFn = unsafe extern "C" fn(*const c_char) -> *mut c_char;
        type FreeFn = unsafe extern "C" fn(*mut c_char);

        struct ProxyLibrary {
            _library: Library,
            start: StartFn,
            stop: StopFn,
            snapshot: SnapshotFn,
            invoke: InvokeFn,
            free: FreeFn,
        }

        static PROXY_LIBRARY: OnceLock<Result<ProxyLibrary, String>> = OnceLock::new();

        pub unsafe fn start(config_json: *const c_char) -> Result<*mut c_char, String> {
            Ok((load()?.start)(config_json))
        }

        pub unsafe fn stop() -> Result<*mut c_char, String> {
            Ok((load()?.stop)())
        }

        pub unsafe fn snapshot() -> Result<*mut c_char, String> {
            Ok((load()?.snapshot)())
        }

        pub unsafe fn invoke(request_json: *const c_char) -> Result<*mut c_char, String> {
            Ok((load()?.invoke)(request_json))
        }

        pub unsafe fn free(value: *mut c_char) {
            if let Ok(library) = load() {
                (library.free)(value);
            }
        }

        fn load() -> Result<&'static ProxyLibrary, String> {
            match PROXY_LIBRARY.get_or_init(load_library) {
                Ok(library) => Ok(library),
                Err(error) => Err(error.clone()),
            }
        }

        fn load_library() -> Result<ProxyLibrary, String> {
            let paths = proxy_library_paths();
            let mut errors = Vec::new();
            let mut loaded = None;
            for path in &paths {
                match unsafe { Library::new(path) } {
                    Ok(library) => {
                        loaded = Some((path.clone(), library));
                        break;
                    }
                    Err(error) => errors.push(format!("{}: {error}", path.display())),
                }
            }
            let Some((_path, library)) = loaded else {
                return Err(format!(
                    "Could not load embedded misty-proxy DLL. Tried: {}",
                    errors.join("; ")
                ));
            };
            unsafe {
                let start: StartFn = *library
                    .get(b"MistyProxyStart\0")
                    .map_err(|error| format!("MistyProxyStart was not exported: {error}"))?;
                let stop: StopFn = *library
                    .get(b"MistyProxyStop\0")
                    .map_err(|error| format!("MistyProxyStop was not exported: {error}"))?;
                let snapshot: SnapshotFn = *library
                    .get(b"MistyProxySnapshot\0")
                    .map_err(|error| format!("MistyProxySnapshot was not exported: {error}"))?;
                let invoke: InvokeFn = *library
                    .get(b"MistyProxyInvoke\0")
                    .map_err(|error| format!("MistyProxyInvoke was not exported: {error}"))?;
                let free: FreeFn = *library
                    .get(b"MistyProxyFree\0")
                    .map_err(|error| format!("MistyProxyFree was not exported: {error}"))?;
                Ok(ProxyLibrary {
                    _library: library,
                    start,
                    stop,
                    snapshot,
                    invoke,
                    free,
                })
            }
        }

        fn proxy_library_paths() -> Vec<PathBuf> {
            let mut paths = Vec::new();
            if let Some(dir) = env::var_os("MISTY_PROXY_GO_LIB_DIR") {
                let dir = PathBuf::from(dir);
                if dir.is_absolute() {
                    paths.push(dir.join("misty_proxy.dll"));
                } else {
                    if let Ok(cwd) = env::current_dir() {
                        paths.push(cwd.join(&dir).join("misty_proxy.dll"));
                    }
                    paths.push(
                        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                            .parent()
                            .unwrap_or_else(|| std::path::Path::new("."))
                            .join(&dir)
                            .join("misty_proxy.dll"),
                    );
                    paths.push(
                        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                            .join(&dir)
                            .join("misty_proxy.dll"),
                    );
                }
            }
            if let Ok(exe) = env::current_exe() {
                if let Some(dir) = exe.parent() {
                    paths.push(dir.join("misty_proxy.dll"));
                }
            }
            paths.push(PathBuf::from("misty_proxy.dll"));
            dedupe_paths(paths)
        }

        fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
            let mut deduped = Vec::new();
            for path in paths {
                if !deduped.iter().any(|existing| existing == &path) {
                    deduped.push(path);
                }
            }
            deduped
        }
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
            rclone_config_password: crate::services::keychain::rclone_config_password(),
        };
        match call_go_proxy_start(&config) {
            Ok(response) => ProxyRuntimeSnapshot {
                mode,
                proxy_url: None,
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
        let response = unsafe { symbols::snapshot()? };
        let response = decode_go_proxy_response(response, "snapshot")?;
        Ok(ProxyRuntimeSnapshot {
            mode,
            proxy_url: None,
            ready: response.ready,
            error: response.error,
        })
    }

    pub fn stop_proxy() {
        if let Ok(response) = unsafe { symbols::stop() } {
            if !response.is_null() {
                unsafe { symbols::free(response) };
            }
        }
    }

    pub fn invoke_proxy(
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let request = serde_json::json!({
            "method": method,
            "params": params,
        });
        let request_json = serde_json::to_string(&request)
            .map_err(|error| format!("Could not encode embedded proxy invoke request: {error}"))?;
        let request_json = CString::new(request_json).map_err(|_| {
            "Embedded proxy invoke request contained an unexpected NUL byte.".to_owned()
        })?;
        let response = unsafe { symbols::invoke(request_json.as_ptr())? };
        let response_json = decode_go_string_response(response, "invoke")?;
        let response: serde_json::Value = serde_json::from_str(&response_json)
            .map_err(|error| format!("Embedded proxy invoke JSON was invalid: {error}"))?;
        if response
            .get("ok")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
        {
            return Ok(response
                .get("data")
                .cloned()
                .unwrap_or(serde_json::Value::Null));
        }
        let message = response
            .get("error")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("Embedded proxy invoke failed.");
        Err(message.to_owned())
    }

    fn call_go_proxy_start(config: &EmbeddedProxyConfig) -> Result<EmbeddedProxyResponse, String> {
        let config_json = serde_json::to_string(config)
            .map_err(|error| format!("Could not encode embedded proxy config: {error}"))?;
        let config_json = CString::new(config_json)
            .map_err(|_| "Embedded proxy config contained an unexpected NUL byte.".to_owned())?;
        let response = unsafe { symbols::start(config_json.as_ptr())? };
        if response.is_null() {
            return Err("Embedded misty-proxy returned no startup response.".to_owned());
        }
        decode_go_proxy_response(response, "startup")
    }

    fn decode_go_proxy_response(
        response: *mut c_char,
        context: &str,
    ) -> Result<EmbeddedProxyResponse, String> {
        let response_json = decode_go_string_response(response, context)?;
        serde_json::from_str::<EmbeddedProxyResponse>(&response_json)
            .map_err(|error| format!("Embedded misty-proxy {context} JSON was invalid: {error}"))
    }

    fn decode_go_string_response(response: *mut c_char, context: &str) -> Result<String, String> {
        if response.is_null() {
            return Err(format!(
                "Embedded misty-proxy returned no {context} response."
            ));
        }
        let response_json = unsafe { CStr::from_ptr(response) }
            .to_string_lossy()
            .into_owned();
        unsafe { symbols::free(response) };
        Ok(response_json)
    }
}

#[cfg(all(test, feature = "embedded-proxy-go"))]
mod tests {
    use std::{env, fs};

    use super::*;
    use serde_json::Value;

    fn unique_test_home(name: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        env::temp_dir().join(format!("misty-proxy-runtime-{name}-{nanos}"))
    }

    #[test]
    fn auto_runtime_uses_embedded_even_with_external_proxy_env() {
        env::remove_var("MISTY_PROXY_RUNTIME");
        env::remove_var("PROXY_SERVICE_URL");
        let environment = AppEnvironmentService::for_test_home(unique_test_home("runtime-mode"));
        assert_eq!(
            resolve_proxy_runtime_mode(&environment),
            ProxyRuntimeMode::Embedded
        );

        env::set_var("PROXY_SERVICE_URL", "http://127.0.0.1:9999");
        assert_eq!(
            resolve_proxy_runtime_mode(&environment),
            ProxyRuntimeMode::Embedded
        );
        env::remove_var("PROXY_SERVICE_URL");
    }

    #[test]
    fn embedded_go_runtime_invokes_remote_health() {
        let home_dir = unique_test_home("health");
        fs::create_dir_all(&home_dir).expect("create test home");
        env::set_var("MISTY_RCLONE_BACKEND", "misty-rclone");
        let environment = AppEnvironmentService::for_test_home(home_dir.clone());

        let snapshot = start_embedded_runtime(&environment, ProxyRuntimeMode::Embedded);
        let result = std::panic::catch_unwind(|| {
            assert!(snapshot.ready, "embedded proxy was not ready: {snapshot:?}");
            let payload = invoke_embedded_runtime("remote.health", serde_json::json!({}))
                .expect("remote.health invoke");
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
