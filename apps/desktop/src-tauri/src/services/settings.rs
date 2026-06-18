use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{ApiError, ApiResult};
use crate::services::environment::AppEnvironmentService;

#[derive(Debug, Clone)]
pub struct SettingsService {
    path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    pub path: String,
    pub document: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSettingsRequest {
    pub document: Value,
}

impl SettingsService {
    pub fn new(environment: AppEnvironmentService) -> Self {
        Self {
            path: environment.settings_path(),
        }
    }

    pub async fn snapshot(&self) -> ApiResult<SettingsSnapshot> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || load_settings(path))
            .await
            .map_err(|err| ApiError::Message(format!("Settings worker failed: {err}")))?
    }

    pub async fn save(&self, request: SaveSettingsRequest) -> ApiResult<SettingsSnapshot> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || save_settings(path, request.document))
            .await
            .map_err(|err| ApiError::Message(format!("Settings worker failed: {err}")))?
    }
}

fn load_settings(path: PathBuf) -> ApiResult<SettingsSnapshot> {
    let document = match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str::<Value>(&raw)
            .ok()
            .filter(Value::is_object)
            .unwrap_or_else(|| Value::Object(Default::default())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Value::Object(Default::default()),
        Err(err) => {
            return Err(ApiError::Message(format!(
                "Failed to read ~/.misty/config/settings.json: {err}"
            )));
        }
    };

    Ok(SettingsSnapshot {
        path: path.display().to_string(),
        document,
    })
}

fn save_settings(path: PathBuf, document: Value) -> ApiResult<SettingsSnapshot> {
    if !document.is_object() {
        return Err(ApiError::Message(
            "Settings document must be a JSON object.".to_owned(),
        ));
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            ApiError::Message(format!("Failed to create settings directory: {err}"))
        })?;
    }

    let encoded = serde_json::to_string_pretty(&document)?;
    fs::write(&path, format!("{encoded}\n")).map_err(|err| {
        ApiError::Message(format!(
            "Failed to write ~/.misty/config/settings.json: {err}"
        ))
    })?;

    Ok(SettingsSnapshot {
        path: path.display().to_string(),
        document,
    })
}
