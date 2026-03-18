use std::{
    fs,
    path::{Path, PathBuf},
};

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWithAssociation {
    pub key: String,
    pub application_path: String,
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

    pub async fn open_with_association_for_path(
        &self,
        file_path: String,
    ) -> ApiResult<Option<String>> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || open_with_association_for_path(path, file_path))
            .await
            .map_err(|err| ApiError::Message(format!("Settings worker failed: {err}")))?
    }

    pub async fn set_open_with_association_for_path(
        &self,
        file_path: String,
        application_path: String,
    ) -> ApiResult<SettingsSnapshot> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || {
            set_open_with_association_for_path(path, file_path, application_path)
        })
        .await
        .map_err(|err| ApiError::Message(format!("Settings worker failed: {err}")))?
    }

    pub async fn open_with_associations(&self) -> ApiResult<Vec<OpenWithAssociation>> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || open_with_associations(path))
            .await
            .map_err(|err| ApiError::Message(format!("Settings worker failed: {err}")))?
    }

    pub async fn remove_open_with_association(&self, key: String) -> ApiResult<SettingsSnapshot> {
        let path = self.path.clone();
        tokio::task::spawn_blocking(move || remove_open_with_association(path, key))
            .await
            .map_err(|err| ApiError::Message(format!("Settings worker failed: {err}")))?
    }
}

fn load_settings(path: PathBuf) -> ApiResult<SettingsSnapshot> {
    let mut document = load_settings_document(&path)?;
    migrate_legacy_open_with_if_needed(&path, &mut document)?;

    Ok(SettingsSnapshot {
        path: path.display().to_string(),
        document,
    })
}

fn load_settings_document(path: &Path) -> ApiResult<Value> {
    match fs::read_to_string(path) {
        Ok(raw) => Ok(serde_json::from_str::<Value>(&raw)
            .ok()
            .filter(Value::is_object)
            .unwrap_or_else(|| Value::Object(Default::default()))),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            Ok(Value::Object(Default::default()))
        }
        Err(err) => {
            return Err(ApiError::Message(format!(
                "Failed to read ~/.misty/config/settings.json: {err}"
            )));
        }
    }
}

fn save_settings(path: PathBuf, document: Value) -> ApiResult<SettingsSnapshot> {
    if !document.is_object() {
        return Err(ApiError::Message(
            "Settings document must be a JSON object.".to_owned(),
        ));
    }

    save_settings_document(&path, &document)?;

    Ok(SettingsSnapshot {
        path: path.display().to_string(),
        document,
    })
}

fn save_settings_document(path: &Path, document: &Value) -> ApiResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            ApiError::Message(format!("Failed to create settings directory: {err}"))
        })?;
    }

    let encoded = serde_json::to_string_pretty(document)?;
    fs::write(path, format!("{encoded}\n")).map_err(|err| {
        ApiError::Message(format!(
            "Failed to write ~/.misty/config/settings.json: {err}"
        ))
    })
}

fn open_with_association_for_path(
    settings_path: PathBuf,
    file_path: String,
) -> ApiResult<Option<String>> {
    let mut document = load_settings_document(&settings_path)?;
    migrate_legacy_open_with_if_needed(&settings_path, &mut document)?;
    let key = association_key_for_path(&file_path);
    let Some(open_with) = document.get_mut("open_with").and_then(Value::as_object_mut) else {
        return Ok(None);
    };
    let Some(application_path) = open_with
        .get(&key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
    else {
        return Ok(None);
    };

    if Path::new(&application_path).exists() {
        return Ok(Some(application_path));
    }

    open_with.remove(&key);
    save_settings_document(&settings_path, &document)?;
    Ok(None)
}

fn set_open_with_association_for_path(
    settings_path: PathBuf,
    file_path: String,
    application_path: String,
) -> ApiResult<SettingsSnapshot> {
    if application_path.trim().is_empty() {
        return Err(ApiError::Message(
            "Application path is required.".to_owned(),
        ));
    }

    let mut document = load_settings_document(&settings_path)?;
    migrate_legacy_open_with_if_needed(&settings_path, &mut document)?;
    let key = association_key_for_path(&file_path);
    let Some(root) = document.as_object_mut() else {
        return Err(ApiError::Message(
            "Settings document must be a JSON object.".to_owned(),
        ));
    };
    let open_with = root
        .entry("open_with")
        .or_insert_with(|| Value::Object(Default::default()));
    if !open_with.is_object() {
        *open_with = Value::Object(Default::default());
    }
    open_with
        .as_object_mut()
        .expect("open_with object")
        .insert(key, Value::String(application_path));
    save_settings(settings_path, document)
}

fn open_with_associations(settings_path: PathBuf) -> ApiResult<Vec<OpenWithAssociation>> {
    let mut document = load_settings_document(&settings_path)?;
    migrate_legacy_open_with_if_needed(&settings_path, &mut document)?;
    let Some(open_with) = document.get_mut("open_with").and_then(Value::as_object_mut) else {
        return Ok(Vec::new());
    };

    let mut removed_missing = false;
    let mut associations = Vec::new();
    open_with.retain(|key, value| {
        let Some(application_path) = value.as_str().filter(|value| !value.trim().is_empty()) else {
            removed_missing = true;
            return false;
        };
        if !Path::new(application_path).exists() {
            removed_missing = true;
            return false;
        }
        associations.push(OpenWithAssociation {
            key: key.clone(),
            application_path: application_path.to_owned(),
        });
        true
    });
    associations.sort_by(|left, right| left.key.cmp(&right.key));
    if removed_missing {
        save_settings_document(&settings_path, &document)?;
    }
    Ok(associations)
}

fn remove_open_with_association(
    settings_path: PathBuf,
    key: String,
) -> ApiResult<SettingsSnapshot> {
    let mut document = load_settings_document(&settings_path)?;
    migrate_legacy_open_with_if_needed(&settings_path, &mut document)?;
    let Some(root) = document.as_object_mut() else {
        return Err(ApiError::Message(
            "Settings document must be a JSON object.".to_owned(),
        ));
    };
    if let Some(open_with) = root.get_mut("open_with").and_then(Value::as_object_mut) {
        open_with.remove(&key);
    }
    save_settings(settings_path, document)
}

fn migrate_legacy_open_with_if_needed(settings_path: &Path, document: &mut Value) -> ApiResult<()> {
    if document.get("open_with").is_some_and(Value::is_object) {
        return Ok(());
    }

    let Some(legacy_path) = legacy_open_with_path(settings_path) else {
        return Ok(());
    };
    let legacy = match fs::read_to_string(&legacy_path) {
        Ok(raw) => serde_json::from_str::<Value>(&raw)
            .ok()
            .filter(Value::is_object)
            .unwrap_or_else(|| Value::Object(Default::default())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => {
            return Err(ApiError::Message(format!(
                "Failed to read legacy open_with.json: {err}"
            )));
        }
    };
    let Some(legacy_map) = legacy.as_object() else {
        return Ok(());
    };
    let open_with = legacy_map
        .iter()
        .filter_map(|(key, value)| {
            value
                .as_str()
                .map(|path| (key.clone(), Value::String(path.to_owned())))
        })
        .collect();
    if let Some(root) = document.as_object_mut() {
        root.insert("open_with".to_owned(), Value::Object(open_with));
        save_settings_document(settings_path, document)?;
        let _ = fs::remove_file(legacy_path);
    }
    Ok(())
}

fn legacy_open_with_path(settings_path: &Path) -> Option<PathBuf> {
    settings_path
        .parent()?
        .parent()
        .map(|root| root.join("open_with.json"))
}

fn association_key_for_path(file_path: &str) -> String {
    let normalized = file_path.replace('\\', "/");
    let file_name = normalized
        .split('/')
        .filter(|part| !part.is_empty())
        .next_back()
        .unwrap_or(file_path);
    let key = file_name
        .rfind('.')
        .map(|index| &file_name[index..])
        .unwrap_or(file_name);
    key.to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    fn test_settings_path() -> PathBuf {
        let root = std::env::temp_dir().join(format!("misty-settings-test-{}", Uuid::new_v4()));
        root.join("config").join("settings.json")
    }

    fn make_existing_app(settings_path: &Path, name: &str) -> PathBuf {
        let app_path = settings_path
            .parent()
            .and_then(Path::parent)
            .expect("test settings root")
            .join(name);
        fs::create_dir_all(app_path.parent().expect("test app parent")).expect("create app parent");
        fs::write(&app_path, "test app").expect("write test app");
        app_path
    }

    #[test]
    fn association_key_matches_native_extension_or_filename_rules() {
        assert_eq!(association_key_for_path("/tmp/Report.PDF"), ".pdf");
        assert_eq!(
            association_key_for_path("C:\\Users\\me\\Makefile"),
            "makefile"
        );
    }

    #[test]
    fn set_and_get_open_with_association_uses_settings_document() {
        let settings_path = test_settings_path();
        let app_path = make_existing_app(&settings_path, "Preview.app");

        set_open_with_association_for_path(
            settings_path.clone(),
            "/tmp/report.PDF".to_owned(),
            app_path.display().to_string(),
        )
        .expect("set association");

        let association =
            open_with_association_for_path(settings_path.clone(), "/tmp/other.pdf".to_owned())
                .expect("get association");
        assert_eq!(association, Some(app_path.display().to_string()));

        let saved = load_settings_document(&settings_path).expect("load settings");
        assert_eq!(
            saved
                .get("open_with")
                .and_then(Value::as_object)
                .and_then(|open_with| open_with.get(".pdf"))
                .and_then(Value::as_str),
            Some(app_path.to_str().expect("utf-8 app path")),
        );

        let _ = fs::remove_dir_all(
            settings_path
                .parent()
                .and_then(Path::parent)
                .expect("test root"),
        );
    }

    #[test]
    fn missing_open_with_application_is_pruned() {
        let settings_path = test_settings_path();
        save_settings(
            settings_path.clone(),
            json!({ "open_with": { ".txt": "/definitely/missing/app" } }),
        )
        .expect("save settings");

        let association =
            open_with_association_for_path(settings_path.clone(), "/tmp/note.txt".to_owned())
                .expect("get association");
        assert_eq!(association, None);

        let saved = load_settings_document(&settings_path).expect("load settings");
        assert!(saved
            .get("open_with")
            .and_then(Value::as_object)
            .and_then(|open_with| open_with.get(".txt"))
            .is_none(),);

        let _ = fs::remove_dir_all(
            settings_path
                .parent()
                .and_then(Path::parent)
                .expect("test root"),
        );
    }

    #[test]
    fn legacy_open_with_file_migrates_into_settings() {
        let settings_path = test_settings_path();
        let root = settings_path
            .parent()
            .and_then(Path::parent)
            .expect("test root");
        fs::create_dir_all(root).expect("create test root");
        let app_path = make_existing_app(&settings_path, "Editor.app");
        fs::write(
            root.join("open_with.json"),
            json!({ ".md": app_path.display().to_string() }).to_string(),
        )
        .expect("write legacy open_with");

        let association =
            open_with_association_for_path(settings_path.clone(), "/tmp/readme.md".to_owned())
                .expect("get association");
        assert_eq!(association, Some(app_path.display().to_string()));
        assert!(!root.join("open_with.json").exists());

        let saved = load_settings_document(&settings_path).expect("load settings");
        assert_eq!(
            saved
                .get("open_with")
                .and_then(Value::as_object)
                .and_then(|open_with| open_with.get(".md"))
                .and_then(Value::as_str),
            Some(app_path.to_str().expect("utf-8 app path")),
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn lists_open_with_associations_and_prunes_missing_apps() {
        let settings_path = test_settings_path();
        let app_path = make_existing_app(&settings_path, "TextEdit.app");
        save_settings(
            settings_path.clone(),
            json!({
                "open_with": {
                    ".txt": app_path.display().to_string(),
                    ".bad": "/definitely/missing/app"
                }
            }),
        )
        .expect("save settings");

        let associations =
            open_with_associations(settings_path.clone()).expect("list associations");
        assert_eq!(associations.len(), 1);
        assert_eq!(associations[0].key, ".txt");
        assert_eq!(
            associations[0].application_path,
            app_path.display().to_string()
        );

        let saved = load_settings_document(&settings_path).expect("load settings");
        assert!(saved
            .get("open_with")
            .and_then(Value::as_object)
            .and_then(|open_with| open_with.get(".bad"))
            .is_none());

        let _ = fs::remove_dir_all(
            settings_path
                .parent()
                .and_then(Path::parent)
                .expect("test root"),
        );
    }

    #[test]
    fn removes_open_with_association_by_key() {
        let settings_path = test_settings_path();
        let app_path = make_existing_app(&settings_path, "Preview.app");
        save_settings(
            settings_path.clone(),
            json!({ "open_with": { ".pdf": app_path.display().to_string() } }),
        )
        .expect("save settings");

        remove_open_with_association(settings_path.clone(), ".pdf".to_owned())
            .expect("remove association");

        let saved = load_settings_document(&settings_path).expect("load settings");
        assert!(saved
            .get("open_with")
            .and_then(Value::as_object)
            .and_then(|open_with| open_with.get(".pdf"))
            .is_none());

        let _ = fs::remove_dir_all(
            settings_path
                .parent()
                .and_then(Path::parent)
                .expect("test root"),
        );
    }
}
