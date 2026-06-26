use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use super::{
    FileSyncCompareDisposition, FileSyncCompareKind, FileSyncCompareResult, FileSyncCompareRow,
    FileSyncCompareSide, FileSyncPlannedAction,
};
use crate::{
    core::file_transfer::now_epoch_ms,
    error::{ApiError, ApiResult},
};

pub type FileSyncSnapshot = BTreeMap<String, FileSyncCompareSide>;

pub fn capture_local_snapshot(root: &Path) -> ApiResult<FileSyncSnapshot> {
    let metadata = fs::metadata(root).map_err(|error| {
        ApiError::Message(format!(
            "Compare root does not exist: {} ({error})",
            root.display()
        ))
    })?;
    if !metadata.is_dir() {
        return Err(ApiError::Message(format!(
            "Compare root is not a directory: {}",
            root.display()
        )));
    }
    let mut snapshot = FileSyncSnapshot::new();
    capture_local_directory(root, root, &mut snapshot)?;
    Ok(snapshot)
}

fn capture_local_directory(
    root: &Path,
    directory: &Path,
    snapshot: &mut FileSyncSnapshot,
) -> ApiResult<()> {
    for entry in fs::read_dir(directory)
        .map_err(|error| ApiError::Message(format!("Failed to scan local directory: {error}")))?
    {
        let entry = entry.map_err(|error| {
            ApiError::Message(format!("Failed to scan local directory: {error}"))
        })?;
        let path = entry.path();
        let metadata = entry
            .metadata()
            .map_err(|error| ApiError::Message(format!("Failed to stat local entry: {error}")))?;
        let relative = normalize_relative_path(path.strip_prefix(root).unwrap_or(&path));
        let is_dir = metadata.is_dir();
        snapshot.insert(
            relative,
            FileSyncCompareSide {
                present: true,
                is_remote: false,
                is_dir,
                size: if is_dir {
                    0
                } else {
                    metadata.len().min(i64::MAX as u64) as i64
                },
                last_modified: metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|duration| duration.as_millis().to_string())
                    .unwrap_or_default(),
                absolute_path: path.to_string_lossy().to_string(),
                remote_name: String::new(),
                remote_path: String::new(),
            },
        );
        if is_dir {
            capture_local_directory(root, &path, snapshot)?;
        }
    }
    Ok(())
}

pub fn compare_file_sync_snapshots(
    left: &FileSyncSnapshot,
    right: &FileSyncSnapshot,
) -> FileSyncCompareResult {
    let keys = left
        .keys()
        .chain(right.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let rows = keys
        .into_iter()
        .map(|relative_path| {
            let left_side = left.get(&relative_path).cloned().unwrap_or_default();
            let right_side = right.get(&relative_path).cloned().unwrap_or_default();
            let kind = compare_kind(&left_side, &right_side);
            let disposition = disposition(&left_side, &right_side);
            FileSyncCompareRow {
                relative_path,
                kind,
                disposition,
                left: left_side,
                right: right_side,
                action: default_action_for_disposition(disposition),
            }
        })
        .collect();
    FileSyncCompareResult {
        success: true,
        rows,
        compared_at_ms: now_epoch_ms(),
        ..FileSyncCompareResult::default()
    }
}

pub const fn default_action_for_disposition(
    disposition: FileSyncCompareDisposition,
) -> FileSyncPlannedAction {
    match disposition {
        FileSyncCompareDisposition::LeftOnly => FileSyncPlannedAction::CopyLeftToRight,
        FileSyncCompareDisposition::RightOnly => FileSyncPlannedAction::CopyRightToLeft,
        FileSyncCompareDisposition::Different
        | FileSyncCompareDisposition::Same
        | FileSyncCompareDisposition::Conflict => FileSyncPlannedAction::Skip,
    }
}

pub fn planned_rows_for_apply(rows: &[FileSyncCompareRow]) -> Vec<FileSyncCompareRow> {
    let mut candidates = rows
        .iter()
        .filter(|row| row.action != FileSyncPlannedAction::Skip)
        .cloned()
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        left.relative_path
            .len()
            .cmp(&right.relative_path.len())
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    let mut accepted: Vec<FileSyncCompareRow> = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        let covered = accepted.iter().any(|row| {
            row.action == candidate.action
                && row.kind == FileSyncCompareKind::Folder
                && path_is_descendant_or_same(&row.relative_path, &candidate.relative_path)
        });
        if !covered {
            accepted.push(candidate);
        }
    }
    accepted
}

fn compare_kind(left: &FileSyncCompareSide, right: &FileSyncCompareSide) -> FileSyncCompareKind {
    if left.present && right.present && left.is_dir != right.is_dir {
        FileSyncCompareKind::Mismatch
    } else if (left.present && left.is_dir) || (right.present && right.is_dir) {
        FileSyncCompareKind::Folder
    } else {
        FileSyncCompareKind::File
    }
}

fn disposition(
    left: &FileSyncCompareSide,
    right: &FileSyncCompareSide,
) -> FileSyncCompareDisposition {
    match (left.present, right.present) {
        (false, true) => FileSyncCompareDisposition::RightOnly,
        (true, false) => FileSyncCompareDisposition::LeftOnly,
        (false, false) => FileSyncCompareDisposition::Same,
        (true, true) if left.is_dir != right.is_dir => FileSyncCompareDisposition::Conflict,
        (true, true) if left.is_dir => FileSyncCompareDisposition::Same,
        (true, true) if left.size == right.size && left.last_modified == right.last_modified => {
            FileSyncCompareDisposition::Same
        }
        (true, true) => FileSyncCompareDisposition::Different,
    }
}

fn normalize_relative_path(path: &Path) -> String {
    let normalized = path.components().collect::<PathBuf>();
    let value = normalized.to_string_lossy().replace('\\', "/");
    if value == "." {
        String::new()
    } else {
        value
    }
}

fn path_is_descendant_or_same(parent: &str, child: &str) -> bool {
    if parent.is_empty() || child.is_empty() {
        return false;
    }
    Path::new(child).starts_with(Path::new(parent))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn side(is_dir: bool, size: i64, modified: &str) -> FileSyncCompareSide {
        FileSyncCompareSide {
            present: true,
            is_dir,
            size,
            last_modified: modified.into(),
            ..FileSyncCompareSide::default()
        }
    }

    #[test]
    fn compare_classifies_presence_mismatch_and_differences() {
        let left = BTreeMap::from([
            ("left.txt".into(), side(false, 1, "a")),
            ("different.txt".into(), side(false, 1, "a")),
            ("mismatch".into(), side(true, 0, "")),
        ]);
        let right = BTreeMap::from([
            ("right.txt".into(), side(false, 1, "a")),
            ("different.txt".into(), side(false, 2, "b")),
            ("mismatch".into(), side(false, 0, "")),
        ]);
        let result = compare_file_sync_snapshots(&left, &right);
        assert!(result.success);
        assert_eq!(
            result.rows[0].disposition,
            FileSyncCompareDisposition::Different
        );
        assert!(result
            .rows
            .iter()
            .any(|row| row.disposition == FileSyncCompareDisposition::Conflict));
        assert!(result
            .rows
            .iter()
            .any(|row| row.action == FileSyncPlannedAction::CopyLeftToRight));
    }

    #[test]
    fn apply_plan_elides_children_covered_by_folder_copy() {
        let rows = vec![
            FileSyncCompareRow {
                relative_path: "folder".into(),
                kind: FileSyncCompareKind::Folder,
                action: FileSyncPlannedAction::CopyLeftToRight,
                ..FileSyncCompareRow::default()
            },
            FileSyncCompareRow {
                relative_path: "folder/file.txt".into(),
                action: FileSyncPlannedAction::CopyLeftToRight,
                ..FileSyncCompareRow::default()
            },
        ];
        assert_eq!(planned_rows_for_apply(&rows).len(), 1);
    }
}
