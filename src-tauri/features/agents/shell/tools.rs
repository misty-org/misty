use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, PoisonError},
};

use file_access::fs;

const TOOL_NAMES: &[&str] = include!("worker/src/tool_names.in");
#[cfg(windows)]
const PROGRAM: &str = "misty-agent-shell.exe";

pub(super) struct Tools {
    _keep: tempfile::TempDir,
    pub folder: PathBuf,
    pub program: PathBuf,
}

static READY: Mutex<Option<Arc<Tools>>> = Mutex::new(None);

#[cfg(unix)]
fn place(bundled: &Path, _folder: &Path) -> std::io::Result<PathBuf> {
    Ok(bundled.to_path_buf())
}

#[cfg(windows)]
#[allow(
    clippy::disallowed_methods,
    reason = "copies Misty's own shell from beside its executable, which no grant covers"
)]
fn place(bundled: &Path, folder: &Path) -> std::io::Result<PathBuf> {
    let program = folder.join(PROGRAM);
    std::fs::copy(bundled, &program)?;
    Ok(program)
}

#[cfg(unix)]
fn tool_link(folder: &Path, name: &str) -> PathBuf {
    folder.join(name)
}

#[cfg(windows)]
fn tool_link(folder: &Path, name: &str) -> PathBuf {
    folder.join(name).with_extension("exe")
}

#[cfg(unix)]
fn link_tool(program: &Path, link: &Path) -> std::io::Result<()> {
    fs::symlink(program, link)
}

#[cfg(windows)]
fn link_tool(program: &Path, link: &Path) -> std::io::Result<()> {
    fs::hard_link(program, link)
}

fn stage(bundled: &Path) -> Result<Tools, String> {
    let failed = |_| "shell_start_failed".to_owned();
    let keep = tempfile::Builder::new()
        .prefix("misty-agent-shell-")
        .tempdir()
        .map_err(failed)?;
    let folder = fs::canonicalize(keep.path()).map_err(failed)?;
    let program = place(bundled, &folder).map_err(failed)?;
    for name in TOOL_NAMES {
        link_tool(&program, &tool_link(&folder, name)).map_err(failed)?;
    }
    Ok(Tools {
        _keep: keep,
        folder,
        program,
    })
}

#[cfg(unix)]
fn linked(tools: &Tools, link: &Path) -> bool {
    fs::read_link(link).is_ok_and(|target| target == tools.program)
}

#[cfg(windows)]
fn linked(_tools: &Tools, link: &Path) -> bool {
    fs::symlink_metadata(link).is_ok_and(|metadata| metadata.file_type().is_file())
}

fn still_intact(tools: &Tools, bundled: &Path) -> bool {
    (cfg!(windows) || tools.program == bundled)
        && TOOL_NAMES
            .iter()
            .all(|name| linked(tools, &tool_link(&tools.folder, name)))
}

pub(super) fn ready() -> Result<Arc<Tools>, String> {
    let bundled = crate::app::workers::program("agent-shell")?;
    let mut slot = READY.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(current) = slot.as_ref() {
        if still_intact(current, &bundled) {
            return Ok(current.clone());
        }
    }
    let fresh = Arc::new(stage(&bundled)?);
    *slot = Some(fresh.clone());
    Ok(fresh)
}

#[cfg(test)]
#[allow(clippy::disallowed_methods)]
mod tests {
    use super::*;

    fn staged() -> (Tools, PathBuf) {
        let bundled = crate::app::workers::program("agent-shell").unwrap();
        (stage(&bundled).unwrap(), bundled)
    }

    #[test]
    fn a_fresh_folder_is_intact_and_has_every_tool() {
        let (tools, bundled) = staged();
        assert!(still_intact(&tools, &bundled));
        for name in TOOL_NAMES {
            assert!(
                std::fs::symlink_metadata(tools.folder.join(name)).is_ok(),
                "{name}"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_missing_or_redirected_link_is_noticed() {
        let (missing, bundled) = staged();
        std::fs::remove_file(missing.folder.join("rm")).unwrap();
        assert!(!still_intact(&missing, &bundled));

        let (redirected, bundled) = staged();
        std::fs::remove_file(redirected.folder.join("ls")).unwrap();
        std::os::unix::fs::symlink("/bin/ls", redirected.folder.join("ls")).unwrap();
        assert!(!still_intact(&redirected, &bundled));
    }
}
