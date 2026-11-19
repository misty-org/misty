//! Which folder a server is started in: the project a file belongs to, found by the files that
//! mark a project's top (package.json, Cargo.toml, go.mod and the like) at or above it. The search
//! never leaves the linked folder, and falls back to it.

use std::path::{Path, PathBuf};

use super::catalog::Language;

/// The project folder for `file`, inside `folder`. Both are real paths from `linked_path`.
pub(super) fn workspace_root(language: Language, folder: &Path, file: &Path) -> PathBuf {
    let Some(start) = file.parent().filter(|parent| parent.starts_with(folder)) else {
        return folder.to_path_buf();
    };
    let Some(nearest) = up_from(start, folder)
        .find(|dir| language.root_markers().iter().any(|name| has(dir, name)))
    else {
        return folder.to_path_buf();
    };
    match language {
        // A crate inside a Cargo workspace belongs to the workspace: the nearest manifest at or
        // above the crate that has a `[workspace]` table, as Cargo itself decides.
        Language::Rust => up_from(nearest, folder)
            .find(|dir| declares_workspace(&dir.join("Cargo.toml")))
            .unwrap_or(nearest)
            .to_path_buf(),
        // A go.work above a module ties it to the modules beside it.
        Language::Go => up_from(nearest, folder)
            .find(|dir| has(dir, "go.work"))
            .unwrap_or(nearest)
            .to_path_buf(),
        Language::TypeScript | Language::Python => nearest.to_path_buf(),
    }
}

/// `start` and each folder above it, up to and including `folder`.
fn up_from<'a>(start: &'a Path, folder: &'a Path) -> impl Iterator<Item = &'a Path> {
    start
        .ancestors()
        .take_while(move |dir| dir.starts_with(folder))
}

fn has(dir: &Path, name: &str) -> bool {
    file_access::fs::is_file(dir.join(name))
}

fn declares_workspace(manifest: &Path) -> bool {
    let Ok(text) = file_access::fs::read_to_string(manifest) else {
        return false;
    };
    text.parse::<toml::Table>()
        .is_ok_and(|table| table.contains_key("workspace"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_walk_stops_at_the_linked_folder() {
        let folder = Path::new("/work/repo");
        let start = Path::new("/work/repo/crates/a/src");
        let seen: Vec<&Path> = up_from(start, folder).collect();
        assert_eq!(seen.first(), Some(&start));
        assert_eq!(seen.last(), Some(&folder));
        assert!(seen.iter().all(|dir| dir.starts_with(folder)));
    }

    #[test]
    fn a_file_outside_the_folder_uses_the_folder() {
        let folder = Path::new("/work/repo");
        assert_eq!(
            workspace_root(Language::Rust, folder, Path::new("/elsewhere/main.rs")),
            folder.to_path_buf()
        );
    }
}
