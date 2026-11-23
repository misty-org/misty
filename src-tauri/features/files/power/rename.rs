// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Rename Items, as Finder's: replace text, add text before or after, or a new name with a
//! number. Each works on the name without its extension, so a file stays the kind it was; a
//! folder's whole name is its name. A new name that is empty, can't be a name, or is taken (on
//! the disk, or by another item in the same batch) clashes, and that item stays as it is.
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

use file_access::disk::{fs_disk, place};
use file_access::Access;
use serde::{Deserialize, Serialize};

use super::super::entry::{extension, is_package_name};
use super::super::gated;
use super::super::transfer::{Failure, TransferResult};
use super::{display_name, failed, record, Change};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum At {
    Before,
    After,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RenameRule {
    Replace { find: String, replace: String },
    Add { text: String, at: At },
    Format { base: String, start: u64, at: At },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamePreview {
    pub from: String,
    pub to: String,
    pub clash: bool,
}

pub(super) struct Plan {
    pub path: PathBuf,
    pub preview: RenamePreview,
}

fn split(name: &str, folder: bool) -> (&str, &str) {
    if folder && !is_package_name(name) {
        return (name, "");
    }
    match extension(name) {
        Some(ext) => name.split_at(name.len() - ext.len() - 1),
        None => (name, ""),
    }
}

pub(super) fn new_name(rule: &RenameRule, name: &str, folder: bool, position: u64) -> String {
    let (stem, ext) = split(name, folder);
    let stem = match rule {
        RenameRule::Replace { find, replace } if !find.is_empty() => {
            stem.replace(find.as_str(), replace)
        }
        RenameRule::Replace { .. } => stem.to_owned(),
        RenameRule::Add {
            text,
            at: At::Before,
        } => format!("{text}{stem}"),
        RenameRule::Add {
            text,
            at: At::After,
        } => format!("{stem}{text}"),
        RenameRule::Format { base, start, at } => {
            let number = start.saturating_add(position);
            match at {
                At::Before => format!("{number}{base}"),
                At::After => format!("{base}{number}"),
            }
        }
    };
    format!("{stem}{ext}")
}

fn valid_name(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." || name.contains(['/', '\0']) {
        return false;
    }
    if cfg!(windows) {
        let reserved = ['\\', ':', '*', '?', '"', '<', '>', '|'];
        return !name.contains(reserved) && !name.ends_with(['.', ' ']);
    }
    !(cfg!(target_os = "macos") && name.contains(':'))
}

fn key(dir: &Path, name: &str) -> (PathBuf, String) {
    let name = if cfg!(any(target_os = "macos", windows)) {
        name.to_lowercase()
    } else {
        name.to_owned()
    };
    (dir.to_path_buf(), name)
}

pub(super) fn mark_clashes(
    items: Vec<(PathBuf, String, String)>,
    taken: impl Fn(&Path, &str, &str) -> bool,
) -> Vec<Plan> {
    let mut wanted: HashSet<(PathBuf, String)> = HashSet::new();
    let mut doubled: HashSet<(PathBuf, String)> = HashSet::new();
    for (path, from, to) in &items {
        if from != to {
            let dir = path.parent().unwrap_or(path);
            if !wanted.insert(key(dir, to)) {
                doubled.insert(key(dir, to));
            }
        }
    }
    items
        .into_iter()
        .map(|(path, from, to)| {
            let dir = path.parent().unwrap_or(&path).to_path_buf();
            let clash = from != to
                && (!valid_name(&to)
                    || doubled.contains(&key(&dir, &to))
                    || taken(&dir, &from, &to));
            Plan {
                preview: RenamePreview { from, to, clash },
                path,
            }
        })
        .collect()
}

fn taken_on_disk(dir: &Path, from: &str, to: &str) -> bool {
    if key(dir, from) == key(dir, to) {
        return false;
    }
    fs_disk::exists(dir.join(to))
}

pub(super) fn plan(paths: &[PathBuf], rule: &RenameRule) -> Vec<Plan> {
    let items = paths
        .iter()
        .enumerate()
        .map(|(position, path)| {
            let from = display_name(path);
            let folder = gated::is_dir(path);
            let to = new_name(rule, &from, folder, position as u64);
            (path.clone(), from, to)
        })
        .collect();
    mark_clashes(items, taken_on_disk)
}

fn rename_one(path: &Path, to: &str) -> Result<PathBuf, String> {
    let (folder, from) = gated::parent(path, Access::Write).map_err(|error| error.to_string())?;
    place::rename_new(&folder, &from, &folder, std::ffi::OsStr::new(to)).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            "that name is taken".to_owned()
        } else {
            error.to_string()
        }
    })?;
    Ok(path.with_file_name(to))
}

pub(super) fn rename_many(window: &str, paths: &[PathBuf], rule: &RenameRule) -> TransferResult {
    let mut created = Vec::new();
    let mut failures = Vec::new();
    let mut moved = Vec::new();
    for Plan { path, preview } in plan(paths, rule) {
        if preview.from == preview.to {
            continue;
        }
        let done = if preview.clash {
            Err(if valid_name(&preview.to) {
                "that name is taken".to_owned()
            } else {
                "that isn't a name a file can have".to_owned()
            })
        } else {
            rename_one(&path, &preview.to)
        };
        match done {
            Ok(target) => {
                super::super::search::note_renamed(&path, &target);
                created.push(target.display().to_string());
                moved.push((path.clone(), target));
            }
            Err(error) => failures.push(Failure {
                path: path.display().to_string(),
                error: failed(&path, error),
            }),
        }
    }
    if !moved.is_empty() {
        record(window, "Rename Items", Change::Moved(moved));
    }
    TransferResult {
        created,
        failed: failures,
        cancelled: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn replace(find: &str, replace: &str) -> RenameRule {
        RenameRule::Replace {
            find: find.into(),
            replace: replace.into(),
        }
    }

    #[test]
    fn rules_change_the_name_and_keep_the_extension() {
        assert_eq!(
            new_name(&replace("IMG", "Trip"), "IMG_0042.JPG", false, 0),
            "Trip_0042.JPG"
        );
        assert_eq!(new_name(&replace("jpg", "png"), "a.jpg", false, 0), "a.jpg");
        assert_eq!(new_name(&replace("", "x"), "a.txt", false, 0), "a.txt");
        let add = RenameRule::Add {
            text: " copy".into(),
            at: At::After,
        };
        assert_eq!(new_name(&add, "Report.pdf", false, 0), "Report copy.pdf");
        let before = RenameRule::Add {
            text: "Draft ".into(),
            at: At::Before,
        };
        assert_eq!(new_name(&before, ".bashrc", false, 0), "Draft .bashrc");
        let format = RenameRule::Format {
            base: "Photo ".into(),
            start: 1,
            at: At::After,
        };
        assert_eq!(new_name(&format, "IMG_1.heic", false, 0), "Photo 1.heic");
        assert_eq!(new_name(&format, "IMG_9.heic", false, 2), "Photo 3.heic");
        let numbered = RenameRule::Format {
            base: " Scan".into(),
            start: 7,
            at: At::Before,
        };
        assert_eq!(new_name(&numbered, "x.pdf", false, 0), "7 Scan.pdf");
    }

    #[test]
    fn a_folders_whole_name_is_its_name() {
        assert_eq!(new_name(&replace(".", "-"), "v1.2", true, 0), "v1-2");
    }

    #[test]
    fn clashes_are_empty_names_doubles_and_names_in_use() {
        let dir = PathBuf::from("/tmp/rename");
        let items = vec![
            (dir.join("a.txt"), "a.txt".to_owned(), "b.txt".to_owned()),
            (dir.join("c.txt"), "c.txt".to_owned(), "b.txt".to_owned()),
            (dir.join("d.txt"), "d.txt".to_owned(), ".txt".to_owned()),
            (
                dir.join("e.txt"),
                "e.txt".to_owned(),
                "taken.txt".to_owned(),
            ),
            (dir.join("f.txt"), "f.txt".to_owned(), "fine.txt".to_owned()),
            (dir.join("g.txt"), "g.txt".to_owned(), "g.txt".to_owned()),
            (dir.join("h.txt"), "h.txt".to_owned(), "x/y.txt".to_owned()),
        ];
        let clashes: Vec<bool> = mark_clashes(items, |_, _, to| to == "taken.txt")
            .into_iter()
            .map(|plan| plan.preview.clash)
            .collect();
        assert_eq!(clashes, [true, true, false, true, false, false, true]);
    }
}
