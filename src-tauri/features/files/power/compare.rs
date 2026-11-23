// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Compare folders: everything in either folder by its path inside it. Two files are the same
//! when their contents are: sizes first, then, only when the sizes agree, their SHA-256. A folder
//! in both is changed when anything under it differs; a folder in only one is one row, without
//! its contents listed. Links compare by where they point.
use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    path::{Path, PathBuf},
};

use file_access::{
    disk::{check_disk, fs_disk},
    Access,
};
use serde::Serialize;
use walkdir::WalkDir;

use super::{failed, sha256_of};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CompareState {
    Same,
    Changed,
    OnlyLeft,
    OnlyRight,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareRow {
    pub relative: String,
    pub state: CompareState,
    pub folder: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub right_size: Option<u64>,
}

#[derive(Clone, Debug, PartialEq)]
pub(super) enum Item {
    Folder,
    File(u64),
    Link(PathBuf),
}

pub(super) type Inventory = BTreeMap<String, Item>;

fn inventory(root: &Path) -> Result<Inventory, String> {
    check_disk(root, Access::Read).map_err(|error| failed(root, error))?;
    if !fs_disk::is_dir(root) {
        return Err(failed(root, "only folders can be compared"));
    }
    let mut items = Inventory::new();
    for entry in WalkDir::new(root).min_depth(1).follow_links(false) {
        let Ok(entry) = entry else { continue };
        if entry.file_name() == ".DS_Store" {
            continue;
        }
        let Ok(relative) = entry.path().strip_prefix(root) else {
            continue;
        };
        let relative = relative
            .components()
            .map(|part| part.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/");
        let kind = entry.file_type();
        let item = if kind.is_symlink() {
            Item::Link(fs_disk::read_link(entry.path()).unwrap_or_default())
        } else if kind.is_dir() {
            Item::Folder
        } else {
            Item::File(entry.metadata().map(|meta| meta.len()).unwrap_or(0))
        };
        items.insert(relative, item);
    }
    Ok(items)
}

fn ancestors(relative: &str) -> impl Iterator<Item = &str> {
    relative
        .match_indices('/')
        .map(move |(at, _)| &relative[..at])
}

fn size(item: Option<&Item>) -> Option<u64> {
    match item {
        Some(Item::File(size)) => Some(*size),
        _ => None,
    }
}

pub(super) fn rows(
    left: &Inventory,
    right: &Inventory,
    mut same_content: impl FnMut(&str) -> bool,
) -> Vec<CompareRow> {
    let paths: BTreeSet<&String> = left.keys().chain(right.keys()).collect();
    let mut lone_folders: HashSet<&str> = HashSet::new();
    let mut rows = Vec::new();
    for relative in paths {
        if ancestors(relative).any(|folder| lone_folders.contains(folder)) {
            continue;
        }
        let (l, r) = (left.get(relative), right.get(relative));
        let folder = matches!(l, Some(Item::Folder)) || matches!(r, Some(Item::Folder));
        let state = match (l, r) {
            (Some(_), None) => CompareState::OnlyLeft,
            (None, Some(_)) => CompareState::OnlyRight,
            (Some(Item::Folder), Some(Item::Folder)) => CompareState::Same,
            (Some(Item::File(a)), Some(Item::File(b))) if a == b => {
                if same_content(relative) {
                    CompareState::Same
                } else {
                    CompareState::Changed
                }
            }
            (Some(Item::Link(a)), Some(Item::Link(b))) if a == b => CompareState::Same,
            _ => CompareState::Changed,
        };
        if folder && matches!(state, CompareState::OnlyLeft | CompareState::OnlyRight) {
            lone_folders.insert(relative.as_str());
        }
        rows.push(CompareRow {
            relative: relative.clone(),
            state,
            folder,
            left_size: size(l),
            right_size: size(r),
        });
    }
    let changed: HashSet<String> = rows
        .iter()
        .filter(|row| row.state != CompareState::Same)
        .flat_map(|row| {
            ancestors(&row.relative)
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .collect();
    for row in &mut rows {
        if row.folder && row.state == CompareState::Same && changed.contains(&row.relative) {
            row.state = CompareState::Changed;
        }
    }
    rows
}

pub(super) fn compare(left: &Path, right: &Path) -> Result<Vec<CompareRow>, String> {
    let left_items = inventory(left)?;
    let right_items = inventory(right)?;
    let hash =
        |root: &Path, relative: &str| sha256_of(&root.join(relative), |_| true).ok().flatten();
    Ok(rows(&left_items, &right_items, |relative| {
        let one = hash(left, relative);
        one.is_some() && one == hash(right, relative)
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inventory_of(items: &[(&str, Item)]) -> Inventory {
        items
            .iter()
            .map(|(path, item)| ((*path).to_owned(), item.clone()))
            .collect()
    }

    #[test]
    fn rows_compare_by_content_and_fold_lone_folders() {
        let left = inventory_of(&[
            ("docs", Item::Folder),
            ("docs/a.txt", Item::File(3)),
            ("docs/b.txt", Item::File(5)),
            ("old", Item::Folder),
            ("old/x.txt", Item::File(1)),
            ("same", Item::Folder),
            ("same/s.txt", Item::File(2)),
            ("link", Item::Link(PathBuf::from("docs"))),
        ]);
        let right = inventory_of(&[
            ("docs", Item::Folder),
            ("docs/a.txt", Item::File(3)),
            ("docs/b.txt", Item::File(6)),
            ("new.txt", Item::File(4)),
            ("same", Item::Folder),
            ("same/s.txt", Item::File(2)),
            ("link", Item::Link(PathBuf::from("docs"))),
        ]);
        let rows = rows(&left, &right, |relative| relative != "docs/a.txt");
        let states: Vec<(&str, CompareState)> = rows
            .iter()
            .map(|row| (row.relative.as_str(), row.state))
            .collect();
        assert_eq!(
            states,
            [
                ("docs", CompareState::Changed),
                ("docs/a.txt", CompareState::Changed),
                ("docs/b.txt", CompareState::Changed),
                ("link", CompareState::Same),
                ("new.txt", CompareState::OnlyRight),
                ("old", CompareState::OnlyLeft),
                ("same", CompareState::Same),
                ("same/s.txt", CompareState::Same),
            ]
        );
        let b = rows
            .iter()
            .find(|row| row.relative == "docs/b.txt")
            .expect("b");
        assert_eq!((b.left_size, b.right_size), (Some(5), Some(6)));
    }

    #[test]
    fn folders_compare_on_the_disk() {
        let root = tempfile::tempdir().expect("temp folder");
        let (left, right) = (root.path().join("left"), root.path().join("right"));
        for dir in [&left, &right] {
            fs_disk::create_dir_all(dir.join("sub")).expect("folder");
        }
        fs_disk::write(left.join("sub/same.txt"), b"hello").expect("write");
        fs_disk::write(right.join("sub/same.txt"), b"hello").expect("write");
        fs_disk::write(left.join("sub/changed.txt"), b"abc").expect("write");
        fs_disk::write(right.join("sub/changed.txt"), b"abd").expect("write");
        let rows = compare(&left, &right).expect("compare");
        let state = |relative: &str| {
            rows.iter()
                .find(|row| row.relative == relative)
                .map(|row| row.state)
        };
        assert_eq!(state("sub/same.txt"), Some(CompareState::Same));
        assert_eq!(state("sub/changed.txt"), Some(CompareState::Changed));
        assert_eq!(state("sub"), Some(CompareState::Changed));
    }
}
