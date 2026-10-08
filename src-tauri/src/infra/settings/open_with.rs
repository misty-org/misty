//! Open With associations: which application opens a file type.
//!
//! Associations sync through the account's settings, so an application only
//! opens files here once someone chose it on this device (see
//! `open-with-approved.json`). Others fall back to the system default.
use super::*;

pub(super) fn open_with_association_for_path(
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

    // Associations sync through the account; an application nobody chose on
    // this device falls back to the system default. This is decided before
    // the path is touched, so a synced network path is never contacted.
    let current: Vec<String> = open_with
        .values()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();
    let approved = approved_applications(&settings_path, &current)?;
    if !approved.contains(&application_path)
        || !crate::platform::synced_paths::is_local_path(Path::new(&application_path))
    {
        return Ok(None);
    }
    if Path::new(&application_path).exists() {
        return Ok(Some(application_path));
    }

    open_with.remove(&key);
    save_settings_document(&settings_path, &document)?;
    Ok(None)
}

/// Applications the person chose for Open With on this device. Never synced.
pub(super) fn approved_applications_path(settings_path: &Path) -> PathBuf {
    settings_path.with_file_name("open-with-approved.json")
}

/// Before this list existed, every association had been chosen here or had
/// already been applied; those are approved once, as they stand.
pub(super) fn approved_applications(
    settings_path: &Path,
    current: &[String],
) -> ApiResult<std::collections::BTreeSet<String>> {
    let path = approved_applications_path(settings_path);
    if let Some(approved) = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    {
        return Ok(approved);
    }
    let seeded: std::collections::BTreeSet<String> = current.iter().cloned().collect();
    write_approved_applications(&path, &seeded)?;
    Ok(seeded)
}

pub(super) fn write_approved_applications(
    path: &Path,
    approved: &std::collections::BTreeSet<String>,
) -> ApiResult<()> {
    let bytes = serde_json::to_vec(approved)
        .map_err(|err| ApiError::Message(format!("Open With approvals failed: {err}")))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| ApiError::Message(format!("Open With approvals failed: {err}")))?;
    }
    fs::write(path, bytes)
        .map_err(|err| ApiError::Message(format!("Open With approvals failed: {err}")))
}

pub(super) fn set_open_with_association_for_path(
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
    let current: Vec<String> = document
        .get("open_with")
        .and_then(Value::as_object)
        .map(|open_with| {
            open_with
                .values()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let mut approved = approved_applications(&settings_path, &current)?;
    approved.insert(application_path.clone());
    write_approved_applications(&approved_applications_path(&settings_path), &approved)?;
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

pub(super) fn open_with_associations(
    settings_path: PathBuf,
) -> ApiResult<Vec<OpenWithAssociation>> {
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
        if !crate::platform::synced_paths::is_local_path(Path::new(application_path))
            || !Path::new(application_path).exists()
        {
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

pub(super) fn remove_open_with_association(
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

pub(super) fn migrate_legacy_open_with_if_needed(
    settings_path: &Path,
    document: &mut Value,
) -> ApiResult<()> {
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

pub(super) fn legacy_open_with_path(settings_path: &Path) -> Option<PathBuf> {
    settings_path
        .parent()?
        .parent()
        .map(|root| root.join("open_with.json"))
}

pub(super) fn association_key_for_path(file_path: &str) -> String {
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
