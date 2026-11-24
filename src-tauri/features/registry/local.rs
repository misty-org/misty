use serde_json::Value;

#[cfg(debug_assertions)]
mod overlay {
    use std::path::PathBuf;

    use serde_json::Value;

    const PINS: &str = "MISTY_LOCAL_APPS";

    fn pins_file() -> Option<PathBuf> {
        std::env::var_os(PINS)
            .map(PathBuf::from)
            .filter(|path| path.is_file())
    }

    fn builds_folder() -> Option<PathBuf> {
        pins_file()?.parent()?.join("builds").canonicalize().ok()
    }

    pub fn with_local_apps(mut apps: Value) -> Value {
        let Some(path) = pins_file() else {
            return apps;
        };
        let Some(local) = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        else {
            return apps;
        };
        let Some(extra) = local.get("apps").and_then(Value::as_array) else {
            return apps;
        };
        let Some(list) = apps.get_mut("apps").and_then(Value::as_array_mut) else {
            return apps;
        };
        for entry in extra {
            let Some(id) = entry.get("id").and_then(Value::as_str) else {
                continue;
            };
            list.retain(|known| known.get("id").and_then(Value::as_str) != Some(id));
            list.push(entry.clone());
        }
        apps
    }

    pub fn read_build(url: &url::Url, max: u64) -> Result<Vec<u8>, String> {
        let refused = || "Only the registry's local builds open from this computer.".to_owned();
        let folder = builds_folder().ok_or_else(refused)?;
        let path = url
            .to_file_path()
            .map_err(|()| refused())?
            .canonicalize()
            .map_err(|_| refused())?;
        if !path.starts_with(&folder)
            || path.extension().and_then(|ext| ext.to_str()) != Some("zip")
        {
            return Err(refused());
        }
        let size = std::fs::metadata(&path).map_err(|_| refused())?.len();
        if size > max {
            return Err("The app is larger than a bundle may be.".into());
        }
        std::fs::read(&path).map_err(|_| refused())
    }
}

#[cfg(debug_assertions)]
pub use overlay::read_build;

pub fn with_local_apps(apps: Value) -> Value {
    #[cfg(debug_assertions)]
    {
        overlay::with_local_apps(apps)
    }
    #[cfg(not(debug_assertions))]
    {
        apps
    }
}
