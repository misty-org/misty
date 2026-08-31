use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{
    error::{ApiError, ApiResult},
    infra::{environment::AppEnvironmentService, system_dependencies::resolve_executable},
};

#[derive(Clone)]
pub struct ExtensionToolResolver {
    roots: [PathBuf; 2],
    settings_path: PathBuf,
}

impl ExtensionToolResolver {
    pub fn new(environment: &AppEnvironmentService) -> Self {
        Self {
            roots: [
                environment.plugins_private_dir(),
                environment.plugins_public_dir(),
            ],
            settings_path: environment.settings_path(),
        }
    }

    pub fn resolve(&self, plugin_id: &str, tool_id: &str) -> ApiResult<PathBuf> {
        if !safe_id(plugin_id) || !safe_id(tool_id) {
            return Err(ApiError::Message(
                "Invalid extension tool identifier.".to_owned(),
            ));
        }
        let mut bundle_error = None;
        for root in &self.roots {
            let directory = root.join(plugin_id);
            if directory.is_dir() {
                match resolve_from_directory(&directory, tool_id) {
                    Ok(path) => return Ok(path),
                    Err(error) if requires_strict_bundle_verification(&directory, tool_id) => {
                        return Err(error);
                    }
                    Err(error) => bundle_error.get_or_insert(error),
                };
            }
        }
        if let Some(path) = resolve_executable(tool_id, Some(&self.settings_path)) {
            return Ok(path);
        }
        Err(bundle_error.unwrap_or_else(|| {
            ApiError::Message(format!(
                "The bundled {tool_id} tool is not installed for this extension."
            ))
        }))
    }
}

fn requires_strict_bundle_verification(directory: &Path, tool_id: &str) -> bool {
    let Ok(bytes) = fs::read(directory.join("manifest.json")) else {
        return false;
    };
    let Ok(manifest) = serde_json::from_slice::<Value>(&bytes) else {
        return true;
    };
    manifest
        .get("tools")
        .and_then(Value::as_array)
        .and_then(|variants| {
            variants.iter().find(|value| {
                value.get("id").and_then(Value::as_str) == Some(tool_id)
                    && value.get("platform").and_then(Value::as_str) == Some(current_platform())
                    && value.get("architecture").and_then(Value::as_str)
                        == Some(current_architecture())
            })
        })
        .and_then(|variant| variant.get("sha256"))
        .and_then(Value::as_str)
        .is_some_and(|digest| !digest.is_empty())
}

fn resolve_from_directory(directory: &Path, tool_id: &str) -> ApiResult<PathBuf> {
    let canonical_root = fs::canonicalize(directory).map_err(|_| {
        ApiError::Message("The verified extension directory is unavailable.".to_owned())
    })?;
    let manifest: Value = serde_json::from_slice(
        &fs::read(directory.join("manifest.json"))
            .map_err(|_| ApiError::Message("The extension manifest is unavailable.".to_owned()))?,
    )
    .map_err(|_| ApiError::Message("The extension manifest is invalid.".to_owned()))?;
    let variants = manifest
        .get("tools")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ApiError::Message("This extension does not declare bundled tools.".to_owned())
        })?;
    let platform = current_platform();
    let architecture = current_architecture();
    let variant = variants
        .iter()
        .find(|value| {
            value.get("id").and_then(Value::as_str) == Some(tool_id)
                && value.get("platform").and_then(Value::as_str) == Some(platform)
                && value.get("architecture").and_then(Value::as_str) == Some(architecture)
        })
        .ok_or_else(|| {
            ApiError::Message(format!(
                "The extension does not declare {tool_id} for {platform}-{architecture}."
            ))
        })?;
    let relative = variant
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::Message("Bundled tool path is missing.".to_owned()))?;
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative_path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(ApiError::Message("Bundled tool path is unsafe.".to_owned()));
    }
    let candidate = fs::canonicalize(canonical_root.join(relative_path))
        .map_err(|_| ApiError::Message(format!("Bundled {tool_id} is missing.")))?;
    if !candidate.starts_with(&canonical_root) || !candidate.is_file() {
        return Err(ApiError::Message(
            "Bundled tool escaped the verified extension directory.".to_owned(),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if fs::metadata(&candidate)
            .map(|meta| meta.permissions().mode() & 0o111 == 0)
            .unwrap_or(true)
        {
            return Err(ApiError::Message(
                "Bundled tool is not executable.".to_owned(),
            ));
        }
    }
    if let Some(expected) = variant
        .get("sha256")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        let actual = hex::encode(Sha256::digest(fs::read(&candidate).map_err(|_| {
            ApiError::Message("Bundled tool could not be verified.".to_owned())
        })?));
        if !actual.eq_ignore_ascii_case(expected) {
            return Err(ApiError::Message(
                "Bundled tool failed SHA-256 verification.".to_owned(),
            ));
        }
    }
    Ok(candidate)
}

fn safe_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}
#[cfg(target_os = "macos")]
fn current_platform() -> &'static str {
    "macos"
}
#[cfg(target_os = "windows")]
fn current_platform() -> &'static str {
    "windows"
}
#[cfg(target_os = "linux")]
fn current_platform() -> &'static str {
    "linux"
}
#[cfg(target_arch = "aarch64")]
fn current_architecture() -> &'static str {
    "aarch64"
}
#[cfg(target_arch = "x86_64")]
fn current_architecture() -> &'static str {
    "x86_64"
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;
    #[test]
    fn rejects_traversal_absolute_and_symlink_escape() {
        let root = std::env::temp_dir().join(format!("misty-tools-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        for unsafe_path in ["../tool", "/tmp/tool"] {
            fs::write(root.join("manifest.json"), serde_json::json!({"tools":[{"id":"ffmpeg","platform":current_platform(),"architecture":current_architecture(),"path":unsafe_path}]}).to_string()).unwrap();
            assert!(resolve_from_directory(&root, "ffmpeg").is_err());
        }
        let _ = fs::remove_dir_all(root);
    }
    #[test]
    fn resolves_only_declared_executable_with_matching_digest() {
        let root = std::env::temp_dir().join(format!("misty-tools-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("tools")).unwrap();
        let tool = root.join("tools/tool");
        fs::write(&tool, b"fixture").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&tool, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let digest = hex::encode(Sha256::digest(b"fixture"));
        fs::write(root.join("manifest.json"), serde_json::json!({"tools":[{"id":"ffmpeg","version":"1.0","platform":current_platform(),"architecture":current_architecture(),"path":"tools/tool","sha256":digest}]}).to_string()).unwrap();
        assert_eq!(
            resolve_from_directory(&root, "ffmpeg").unwrap(),
            fs::canonicalize(tool).unwrap()
        );
        assert!(resolve_from_directory(&root, "restic").is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn falls_back_to_a_configured_tool_for_an_unpinned_development_bundle() {
        let root = std::env::temp_dir().join(format!("misty-tools-fallback-{}", Uuid::new_v4()));
        let environment = AppEnvironmentService::new_with_data_root(Some(root.clone()));
        let plugin = environment.plugins_private_dir().join("quick_convert");
        let tools = root.join("configured-tools");
        fs::create_dir_all(&plugin).unwrap();
        fs::create_dir_all(&tools).unwrap();
        fs::write(
            plugin.join("manifest.json"),
            serde_json::json!({"tools":[{"id":"ffmpeg","platform":current_platform(),"architecture":current_architecture(),"path":"tools/ffmpeg"}]}).to_string(),
        ).unwrap();
        let executable = tools.join(if cfg!(target_os = "windows") {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        });
        fs::write(&executable, b"fixture").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
        }
        fs::create_dir_all(environment.settings_path().parent().unwrap()).unwrap();
        fs::write(
            environment.settings_path(),
            serde_json::json!({"advanced":{"extension_tools_path":tools.display().to_string()}})
                .to_string(),
        )
        .unwrap();

        assert_eq!(
            ExtensionToolResolver::new(&environment)
                .resolve("quick_convert", "ffmpeg")
                .unwrap(),
            executable
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn does_not_fall_back_when_a_verified_bundle_is_missing() {
        let root = std::env::temp_dir().join(format!("misty-tools-strict-{}", Uuid::new_v4()));
        let environment = AppEnvironmentService::new_with_data_root(Some(root.clone()));
        let plugin = environment.plugins_private_dir().join("quick_convert");
        let tools = root.join("configured-tools");
        fs::create_dir_all(&plugin).unwrap();
        fs::create_dir_all(&tools).unwrap();
        fs::write(
            plugin.join("manifest.json"),
            serde_json::json!({"tools":[{"id":"ffmpeg","platform":current_platform(),"architecture":current_architecture(),"path":"tools/ffmpeg","sha256":"deadbeef"}]}).to_string(),
        ).unwrap();
        let executable = tools.join(if cfg!(target_os = "windows") {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        });
        fs::write(&executable, b"fixture").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
        }
        fs::create_dir_all(environment.settings_path().parent().unwrap()).unwrap();
        fs::write(
            environment.settings_path(),
            serde_json::json!({"advanced":{"extension_tools_path":tools.display().to_string()}})
                .to_string(),
        )
        .unwrap();

        assert!(ExtensionToolResolver::new(&environment)
            .resolve("quick_convert", "ffmpeg")
            .is_err());
        let _ = fs::remove_dir_all(root);
    }
}
