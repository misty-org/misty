use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[cfg(windows)]
const SUFFIX: &str = ".exe";
#[cfg(not(windows))]
const SUFFIX: &str = "";

#[allow(
    clippy::disallowed_methods,
    reason = "Misty's own helper programs sit beside its executable, outside any granted folder"
)]
fn beside(folder: &Path, service: &str) -> Option<PathBuf> {
    let program = folder.join(format!("misty-{service}{SUFFIX}"));
    std::fs::metadata(&program)
        .ok()
        .filter(|metadata| metadata.is_file())
        .map(|_| program)
}

#[allow(
    clippy::disallowed_methods,
    reason = "resolves Misty's own executable, which no grant covers"
)]
fn executable_folder() -> Option<PathBuf> {
    static FOLDER: OnceLock<Option<PathBuf>> = OnceLock::new();
    FOLDER
        .get_or_init(|| {
            let executable = std::env::current_exe().ok()?;
            let executable = std::fs::canonicalize(&executable).unwrap_or(executable);
            executable.parent().map(Path::to_path_buf)
        })
        .clone()
}

pub(crate) fn program(service: &str) -> Result<PathBuf, String> {
    let missing = || format!("The {service} helper isn't installed with this copy of Misty.");
    let folder = executable_folder().ok_or_else(missing)?;
    beside(&folder, service)
        .or_else(|| {
            folder
                .file_name()
                .filter(|name| *name == "deps")
                .and_then(|_| folder.parent())
                .and_then(|parent| beside(parent, service))
        })
        .ok_or_else(missing)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_helper_is_found_beside_the_build() {
        for service in [
            "agent-shell",
            "document-processing",
            "page-reader",
            "speech",
        ] {
            let found = program(service).unwrap();
            assert!(found.is_absolute(), "{}", found.display());
            assert!(found
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(&format!("misty-{service}"))));
        }
        assert!(program("nothing-like-it").is_err());
    }

    #[cfg(windows)]
    #[test]
    #[allow(clippy::disallowed_methods)]
    fn documents_are_parsed_by_the_confined_worker() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("notes.txt");
        std::fs::write(&path, "Quarterly notes\nRevenue grew.").unwrap();
        let stop = std::sync::atomic::AtomicBool::new(false);
        let value = documents::windows::process(&path, &stop, program).unwrap();
        let text = value["document"]["sections"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|section| section["text"].as_str())
            .collect::<String>();
        assert!(text.contains("Revenue grew."), "{value}");
    }

    #[cfg(windows)]
    #[test]
    #[allow(clippy::disallowed_methods)]
    fn cancelled_runs_never_start() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("notes.txt");
        std::fs::write(&path, "text").unwrap();
        let stop = std::sync::atomic::AtomicBool::new(true);
        assert!(documents::windows::process(&path, &stop, program).is_err());
    }
}
