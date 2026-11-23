use rusqlite::{params, OptionalExtension};

const DEVICE_SCOPE: &str = "drive:device";
const CACHE_LIMIT_SCOPE: &str = "drive:cache-limit";
const DEFAULT_CACHE_LIMIT: u64 = 10 * 1024 * 1024 * 1024;
pub(crate) const MIN_CACHE_LIMIT: u64 = 64 * 1024 * 1024;
pub(crate) const NO_CACHE_LIMIT: u64 = u64::MAX;
const MAX_NAME: usize = 64;

fn read(store: &database::store::Store, scope: &str) -> Option<serde_json::Value> {
    let connection = store.connect().ok()?;
    let text: Option<String> = connection
        .query_row(
            "SELECT document FROM settings_state WHERE scope = ?1",
            [scope],
            |row| row.get(0),
        )
        .optional()
        .ok()?;
    serde_json::from_str(&text?).ok()
}

fn is_device_id(text: &str) -> bool {
    text.strip_prefix("dev_")
        .and_then(|rest| uuid::Uuid::parse_str(rest).ok().map(|id| (rest, id)))
        .is_some_and(|(rest, id)| rest == id.hyphenated().to_string())
}

fn write(
    store: &database::store::Store,
    scope: &str,
    value: &serde_json::Value,
) -> Result<(), String> {
    let connection = store
        .connect()
        .map_err(|_| "Misty couldn't read its settings.".to_string())?;
    connection
        .execute(
            "INSERT INTO settings_state (scope, revision, document) VALUES (?1, 1, ?2)
             ON CONFLICT(scope) DO UPDATE SET revision = revision + 1, document = excluded.document",
            params![scope, value.to_string()],
        )
        .map(|_| ())
        .map_err(|_| "Misty couldn't save its settings.".to_string())
}

pub(crate) fn device_id(store: &database::store::Store) -> Result<String, String> {
    if let Some(id) = read(store, DEVICE_SCOPE)
        .and_then(|value| value.as_str().map(str::to_owned))
        .filter(|id| is_device_id(id))
    {
        return Ok(id);
    }
    let id = format!("dev_{}", uuid::Uuid::new_v4().hyphenated());
    write(store, DEVICE_SCOPE, &serde_json::Value::String(id.clone()))?;
    Ok(id)
}

pub(crate) fn cache_limit(store: &database::store::Store) -> u64 {
    match read(store, CACHE_LIMIT_SCOPE) {
        Some(serde_json::Value::Null) => NO_CACHE_LIMIT,
        Some(value) => value
            .as_u64()
            .filter(|limit| *limit >= MIN_CACHE_LIMIT)
            .unwrap_or(DEFAULT_CACHE_LIMIT),
        None => DEFAULT_CACHE_LIMIT,
    }
}

pub(crate) fn set_cache_limit(
    store: &database::store::Store,
    bytes: Option<u64>,
) -> Result<u64, String> {
    if bytes.is_some_and(|bytes| bytes < MIN_CACHE_LIMIT) {
        return Err("The cache has to be at least 64 MB.".into());
    }
    let value = bytes.map_or(serde_json::Value::Null, serde_json::Value::from);
    write(store, CACHE_LIMIT_SCOPE, &value)?;
    Ok(bytes.unwrap_or(NO_CACHE_LIMIT))
}

pub(crate) fn computer_name() -> String {
    let named = system_name().unwrap_or_default();
    let clean: String = named
        .trim()
        .trim_end_matches(".local")
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_NAME)
        .collect();
    if clean.trim().is_empty() {
        "This computer".to_owned()
    } else {
        clean.trim().to_owned()
    }
}

#[cfg(target_os = "macos")]
fn system_name() -> Option<String> {
    let output = std::process::Command::new("/usr/sbin/scutil")
        .args(["--get", "ComputerName"])
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .filter(|name| !name.is_empty())
        .or_else(host_name)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn system_name() -> Option<String> {
    host_name()
}

#[cfg(windows)]
fn system_name() -> Option<String> {
    std::env::var("COMPUTERNAME").ok()
}

#[cfg(unix)]
fn host_name() -> Option<String> {
    let mut buffer = [0u8; 256];
    // SAFETY: the buffer is as long as the size given; the result is NUL-terminated on success.
    let result = unsafe { libc::gethostname(buffer.as_mut_ptr().cast(), buffer.len()) };
    if result != 0 {
        return None;
    }
    let end = buffer
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(buffer.len());
    Some(String::from_utf8_lossy(&buffer[..end]).into_owned())
}
