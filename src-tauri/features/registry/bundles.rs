use std::io::Read;
use std::path::{Component, Path, PathBuf};

use flate2::read::GzDecoder;

use super::files::{blob, RegistryFile};

const MAX_BUNDLE_BYTES: u64 = 64 << 20;
const MAX_UNPACKED_BYTES: u64 = 256 << 20;
const MAX_ENTRIES: usize = 5000;
const DONE: &str = ".misty-unpacked";

fn bundles_dir() -> Result<PathBuf, String> {
    file_access::paths::misty_home_dir()
        .map(|home| home.join("registry-bundles"))
        .ok_or_else(|| "Misty has no data folder to keep the registry's bundles in.".to_owned())
}

fn inside(path: &Path) -> Option<PathBuf> {
    let mut clean = PathBuf::new();
    for part in path.components() {
        match part {
            Component::Normal(name) => clean.push(name),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!clean.as_os_str().is_empty()).then_some(clean)
}

fn unpack(bytes: &[u8], into: &Path) -> Result<(), String> {
    let refused = || "The registry's bundle isn't one Misty can open.".to_string();
    let mut archive = tar::Archive::new(GzDecoder::new(bytes));
    let mut total = 0u64;
    for (count, entry) in archive.entries().map_err(|_| refused())?.enumerate() {
        if count >= MAX_ENTRIES {
            return Err(refused());
        }
        let mut entry = entry.map_err(|_| refused())?;
        let kind = entry.header().entry_type();
        let Some(relative) = entry.path().ok().and_then(|path| inside(&path)) else {
            continue;
        };
        let out = into.join(&relative);
        if kind.is_dir() {
            file_access::fs::create_dir_all(&out).map_err(|error| error.to_string())?;
            continue;
        }
        if !kind.is_file() {
            continue;
        }
        total += entry.header().size().unwrap_or(0);
        if total > MAX_UNPACKED_BYTES {
            return Err(refused());
        }
        if let Some(parent) = out.parent() {
            file_access::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut data = Vec::new();
        entry.read_to_end(&mut data).map_err(|_| refused())?;
        file_access::fs::write(&out, &data).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        if entry.header().mode().is_ok_and(|mode| mode & 0o111 != 0) {
            use std::os::unix::fs::PermissionsExt;
            let _ = file_access::fs::set_permissions(&out, std::fs::Permissions::from_mode(0o755));
        }
    }
    Ok(())
}

pub async fn unpacked(file: &RegistryFile) -> Result<PathBuf, String> {
    let folder = bundles_dir()?.join(&file.sha256);
    if file_access::fs::is_file(folder.join(DONE)) {
        return Ok(folder);
    }
    let bytes = blob(file, MAX_BUNDLE_BYTES).await?;
    let staging = bundles_dir()?.join(format!(".{}-{}", file.sha256, std::process::id()));
    let _ = file_access::fs::remove_dir_all(&staging);
    file_access::fs::create_dir_all(&staging).map_err(|error| error.to_string())?;
    if let Err(error) = unpack(&bytes, &staging) {
        let _ = file_access::fs::remove_dir_all(&staging);
        return Err(error);
    }
    file_access::fs::write(staging.join(DONE), &file.sha256).map_err(|error| error.to_string())?;
    let _ = file_access::fs::remove_dir_all(&folder);
    file_access::fs::rename(&staging, &folder).map_err(|error| error.to_string())?;
    Ok(folder)
}

pub fn read_inside(folder: &Path, path: &str, most: u64) -> Result<String, String> {
    let relative =
        inside(Path::new(path)).ok_or_else(|| "That file isn't in the bundle.".to_string())?;
    let file = folder.join(relative);
    let size = file_access::fs::metadata(&file)
        .map_err(|_| "That file isn't in the bundle.".to_string())?
        .len();
    if size > most {
        return Err("The file is larger than Misty reads.".into());
    }
    file_access::fs::read_to_string(&file).map_err(|_| "The file isn't text.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bundle_never_writes_outside_its_folder() {
        assert!(inside(Path::new("../etc/passwd")).is_none());
        assert!(inside(Path::new("/etc/passwd")).is_none());
        assert_eq!(
            inside(Path::new("./skills/a/SKILL.md")),
            Some(PathBuf::from("skills/a/SKILL.md"))
        );
    }
}
