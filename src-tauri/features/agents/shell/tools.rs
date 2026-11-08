//! The shell and its tools, ready to run: one program, embedded in the signed app, with a link to it for
//! each tool's name, in a private folder that goes on `PATH`. It's the same set on every computer, and
//! nothing about it depends on what a person has installed.
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, PoisonError},
    time::SystemTime,
};

use crate::app::embedded_workers::builtin_worker;
use file_access::fs;

const PROTOCOL: u32 = 1;
const TOOL_NAMES: &[&str] = include!("worker/src/tool_names.in");
#[cfg(windows)]
const PROGRAM: &str = "misty-agent-shell.exe";
#[cfg(not(windows))]
const PROGRAM: &str = "misty-agent-shell";

pub(super) struct Tools {
    /// Holds the private folder for as long as a command may use it.
    _keep: tempfile::TempDir,
    /// The real path of the folder, which an OS profile compares against.
    pub folder: PathBuf,
    /// The real path of the program every link leads to.
    pub program: PathBuf,
    stamp: Stamp,
}

/// What the program file looked like when it was staged. Commands can't write to this folder under
/// their OS profile, so a stamp is enough to notice something else changing it, and reading the whole
/// file back for each command would keep the program's bytes in memory for nothing.
#[derive(PartialEq, Eq)]
struct Stamp {
    length: u64,
    modified: Option<SystemTime>,
}

impl Stamp {
    fn of(program: &Path) -> Option<Self> {
        let metadata = fs::symlink_metadata(program).ok()?;
        metadata.file_type().is_file().then(|| Self {
            length: metadata.len(),
            modified: metadata.modified().ok(),
        })
    }
}

static READY: Mutex<Option<Arc<Tools>>> = Mutex::new(None);

#[cfg(unix)]
fn link_tool(program: &Path, link: &Path) -> std::io::Result<()> {
    fs::symlink(program, link)
}

/// A hard link rather than a symbolic link, because Windows only lets administrators and developer
/// mode make those, and the program finds its name from what it was started as.
#[cfg(windows)]
fn link_tool(program: &Path, link: &Path) -> std::io::Result<()> {
    fs::hard_link(program, link.with_extension("exe"))
}

#[cfg(unix)]
fn seal(program: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(program, fs::Permissions::from_mode(0o500))
}

#[cfg(windows)]
fn seal(_program: &Path) -> std::io::Result<()> {
    Ok(())
}

fn stage(bytes: &[u8]) -> Result<Tools, String> {
    let failed = |_| "shell_start_failed".to_owned();
    let keep = tempfile::Builder::new()
        .prefix("misty-agent-shell-")
        .tempdir()
        .map_err(failed)?;
    // Seatbelt matches real paths, and the temp folder's own path goes through a link.
    let folder = fs::canonicalize(keep.path()).map_err(failed)?;
    let program = folder.join(PROGRAM);
    fs::write(&program, bytes).map_err(failed)?;
    seal(&program).map_err(failed)?;
    for name in TOOL_NAMES {
        link_tool(&program, &folder.join(name)).map_err(failed)?;
    }
    let stamp = Stamp::of(&program).ok_or("shell_start_failed")?;
    Ok(Tools {
        _keep: keep,
        folder,
        program,
        stamp,
    })
}

/// The program as it was staged, with every link there.
fn still_intact(tools: &Tools) -> bool {
    let links = |name: &&str| {
        let link = tools.folder.join(name);
        #[cfg(windows)]
        let link = link.with_extension("exe");
        fs::symlink_metadata(link).is_ok()
    };
    TOOL_NAMES.iter().all(links) && Stamp::of(&tools.program).as_ref() == Some(&tools.stamp)
}

/// The tools, staged now if it's the first command or the copy on disk has changed.
pub(super) fn ready() -> Result<Arc<Tools>, String> {
    let mut slot = READY.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(current) = slot.as_ref() {
        if still_intact(current) {
            return Ok(current.clone());
        }
    }
    let fresh = Arc::new(stage(builtin_worker("agent-shell", PROTOCOL)?)?);
    *slot = Some(fresh.clone());
    Ok(fresh)
}

#[cfg(test)]
#[allow(clippy::disallowed_methods)]
mod tests {
    use super::*;

    /// A private copy, since other tests are running commands through the shared one.
    fn staged() -> Tools {
        stage(builtin_worker("agent-shell", PROTOCOL).unwrap()).unwrap()
    }

    #[test]
    fn a_fresh_copy_is_intact_and_has_every_tool() {
        let tools = staged();
        assert!(still_intact(&tools));
        for name in TOOL_NAMES {
            assert!(
                std::fs::symlink_metadata(tools.folder.join(name)).is_ok(),
                "{name}"
            );
        }
    }

    #[test]
    fn a_changed_program_or_a_missing_link_is_noticed() {
        use std::os::unix::fs::PermissionsExt;
        let changed = staged();
        std::fs::set_permissions(&changed.program, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(&changed.program, b"#!/bin/sh\necho changed\n").unwrap();
        assert!(!still_intact(&changed));

        let missing = staged();
        std::fs::remove_file(missing.folder.join("rm")).unwrap();
        assert!(!still_intact(&missing));
    }
}
