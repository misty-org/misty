//! Where a path really leads, whether or not all of it exists yet. A new file's path has to be
//! checked too, so this canonicalizes the deepest ancestor that exists and adds the rest back.
use std::{
    ffi::OsString,
    fs, io,
    path::{Component, Path, PathBuf, Prefix},
};

/// Link chains longer than this are refused, as the OS itself would.
const MAX_LINKS: usize = 40;

/// Windows network (UNC) and device paths don't count as local: even looking at one makes Windows
/// sign in to that server.
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

/// The real location of `path`, following every link and `..` in it.
pub fn resolve(path: &Path) -> io::Result<PathBuf> {
    let path = absolute(path)?;
    if !is_local_path(&path) {
        return Ok(without_dots(path.components().collect::<Vec<_>>()));
    }
    follow(path, 0)
}

/// The real location of a link itself: its folder resolved, its own name as it is.
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
        // A dangling link can't be canonicalized, but a write through it lands at its target.
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

/// Adds back the parts below the existing ancestor, last found first. They don't exist, so none is
/// a link and `..` simply steps back.
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

/// A network path's `..` removed by reading it, since it can't be touched to look.
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
