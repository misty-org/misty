use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

pub fn files_under(root: &Path) -> Result<Vec<PathBuf>> {
    let mut files = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| entry.into_path())
        .collect::<Vec<_>>();
    files.sort();
    Ok(files)
}

pub fn sha256(path: &Path) -> Result<String> {
    let mut file =
        File::open(path).with_context(|| format!("could not read {}", path.display()))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

pub fn write_checksums(root: &Path) -> Result<PathBuf> {
    let output = root.join("SHA256SUMS");
    let mut rows = Vec::new();
    for path in files_under(root)? {
        if path == output {
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .context("artifact escaped checksum root")?
            .to_string_lossy()
            .replace('\\', "/");
        rows.push(format!("{}  {relative}", sha256(&path)?));
    }
    fs::write(&output, format!("{}\n", rows.join("\n")))
        .with_context(|| format!("could not write {}", output.display()))?;
    Ok(output)
}

pub fn write_private(path: &Path, contents: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut options = fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .with_context(|| format!("could not write {}", path.display()))?;
    file.write_all(contents)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .with_context(|| format!("could not secure {}", path.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checksum_is_stable() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("sample");
        fs::write(&path, b"misty").unwrap();
        assert_eq!(
            sha256(&path).unwrap(),
            "054442e3d5a92cba98291560bbb8adc85d34fcabca97bf780c3c20351b7474e8"
        );
    }
}
