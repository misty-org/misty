use std::{
    ffi::OsString,
    fs, io,
    path::{Component, Path, PathBuf, Prefix},
};

const MAX_LINKS: usize = 40;

pub fn is_local_path(path: &Path) -> bool {
    match path.components().next() {
        Some(Component::Prefix(prefix)) => {
            matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
        }
        _ => true,
    }
}

fn absolute(path: &Path) -> io::Result<PathBuf> {
    if path.is_absolute() {
        Ok(path.to_path_buf())
    } else {
        Ok(std::env::current_dir()?.join(path))
    }
}

pub fn resolve(path: &Path) -> io::Result<PathBuf> {
    let path = absolute(path)?;
    if !is_local_path(&path) {
        return Ok(without_dots(path.components().collect::<Vec<_>>()));
    }
    follow(path, 0)
}

pub fn resolve_parent(path: &Path) -> io::Result<PathBuf> {
    let path = absolute(path)?;
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => Ok(resolve(parent)?.join(name)),
        _ => resolve(&path),
    }
}

enum Part {
    Up,
    Name(OsString),
}

fn follow(path: PathBuf, links: usize) -> io::Result<PathBuf> {
    if links > MAX_LINKS {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Too many links in this path.",
        ));
    }
    let mut missing = Vec::new();
    let mut current = path.as_path();
    loop {
        if let Ok(real) = fs::canonicalize(current) {
            return Ok(rejoin(real, missing));
        }
        if let Ok(target) = fs::read_link(current) {
            let target = match current.parent() {
                Some(parent) if !target.is_absolute() => parent.join(target),
                _ => target,
            };
            return follow(rejoin(target, missing), links + 1);
        }
        let Some(parent) = current.parent() else {
            return Ok(rejoin(current.to_path_buf(), missing));
        };
        missing.push(match current.components().next_back() {
            Some(Component::ParentDir) => Part::Up,
            Some(part) => Part::Name(part.as_os_str().to_owned()),
            None => return Ok(rejoin(current.to_path_buf(), missing)),
        });
        current = parent;
    }
}

fn rejoin(mut base: PathBuf, missing: Vec<Part>) -> PathBuf {
    for part in missing.into_iter().rev() {
        match part {
            Part::Up => {
                base.pop();
            }
            Part::Name(name) => base.push(name),
        }
    }
    base
}

fn without_dots(components: Vec<Component<'_>>) -> PathBuf {
    let mut result = PathBuf::new();
    for part in components {
        match part {
            Component::ParentDir => {
                result.pop();
            }
            Component::CurDir => {}
            part => result.push(part),
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn network_and_device_paths_are_never_local() {
        assert!(is_local_path(Path::new("/Users/me/Downloads")));
        assert!(is_local_path(Path::new("relative")));
        #[cfg(windows)]
        {
            assert!(is_local_path(Path::new(r"C:\Users\me\Downloads")));
            assert!(is_local_path(Path::new(r"\\?\C:\Users\me")));
            assert!(!is_local_path(Path::new(r"\\server\share\folder")));
            assert!(!is_local_path(Path::new(r"\\?\UNC\server\share")));
            assert!(!is_local_path(Path::new(r"\\.\pipe\name")));
        }
    }
}
