use std::collections::HashMap;
use std::path::Path;

pub(crate) fn file(dir: &Path, files: &HashMap<String, String>, role: &str) -> Option<String> {
    let names = files.get(role)?;
    let joined: Vec<String> = names
        .split(',')
        .map(|name| dir.join(name.trim()).to_string_lossy().into_owned())
        .collect();
    Some(joined.join(","))
}

pub(crate) fn threads() -> i32 {
    let cores = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(2);
    cores.saturating_sub(1).clamp(1, 4) as i32
}
