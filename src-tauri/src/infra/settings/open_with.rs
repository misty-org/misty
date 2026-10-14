//! Open With associations: which application opens a file type. They are this
//! device's own choices (settings never leave the device), stored in the settings
//! document under `open_with`.
use super::*;

pub(super) fn open_with_association_for_path(
    store: &Store,
    file_path: String,
) -> ApiResult<Option<String>> {
    let mut document = load_settings_document(store)?;
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

    // A network path is never contacted just to look it up.
    if !crate::platform::synced_paths::is_local_path(Path::new(&application_path)) {
        return Ok(None);
    }
    if Path::new(&application_path).exists() {
        return Ok(Some(application_path));
    }

    open_with.remove(&key);
    save_settings_document(store, &document)?;
    Ok(None)
}

pub(super) fn set_open_with_association_for_path(
    store: &Store,
    file_path: String,
    application_path: String,
) -> ApiResult<SettingsSnapshot> {
    if application_path.trim().is_empty() {
        return Err(ApiError::Message(
            "Application path is required.".to_owned(),
        ));
    }

    let mut document = load_settings_document(store)?;
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
    save_settings(store, document)
}

pub(super) fn open_with_associations(store: &Store) -> ApiResult<Vec<OpenWithAssociation>> {
    let mut document = load_settings_document(store)?;
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
        save_settings_document(store, &document)?;
    }
    Ok(associations)
}

pub(super) fn remove_open_with_association(
    store: &Store,
    key: String,
) -> ApiResult<SettingsSnapshot> {
    let mut document = load_settings_document(store)?;
    let Some(root) = document.as_object_mut() else {
        return Err(ApiError::Message(
            "Settings document must be a JSON object.".to_owned(),
        ));
    };
    if let Some(open_with) = root.get_mut("open_with").and_then(Value::as_object_mut) {
        open_with.remove(&key);
    }
    save_settings(store, document)
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
