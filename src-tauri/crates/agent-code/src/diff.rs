//! Line diffs in one shape for every surface: an answer's changes, a project's
//! uncommitted work, and a commit. The desktop renders them like Claude Code
//! and Codex: files with +/- counts, hunks with old and new line numbers.
use serde::Serialize;
use similar::{ChangeTag, TextDiff};

/// Lines shown per file before the rest is summarized.
const MAX_FILE_LINES: usize = 3_000;
/// Lines across all files before later files list only their counts.
const MAX_TOTAL_LINES: usize = 20_000;
pub const MAX_FILES: usize = 300;
/// Files larger than this are compared by size only.
const MAX_TEXT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub kind: &'static str,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new: Option<u32>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<Line>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: Status,
    pub additions: u32,
    pub deletions: u32,
    pub binary: bool,
    pub hunks: Vec<Hunk>,
    /// Hunks were left out to keep the diff a readable size.
    pub truncated: bool,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiffSet {
    pub files: Vec<FileDiff>,
    pub additions: u32,
    pub deletions: u32,
    /// More files changed than are listed.
    pub more_files: u32,
}

fn is_binary(bytes: &[u8]) -> bool {
    bytes.len() > MAX_TEXT_BYTES || bytes.iter().take(8_000).any(|byte| *byte == 0)
}

/// Builds diffs file by file, keeping the whole set within its budget.
#[derive(Default)]
pub struct Builder {
    set: DiffSet,
    lines: usize,
}

impl Builder {
    /// Adds one file. `old` is None for an added file, `new` None for a deleted one.
    pub fn file(&mut self, path: &str, old_path: Option<&str>, old: Option<&[u8]>, new: Option<&[u8]>) {
        if self.set.files.len() >= MAX_FILES {
            self.set.more_files += 1;
            return;
        }
        let status = match (old, new, old_path) {
            (None, _, _) => Status::Added,
            (_, None, _) => Status::Deleted,
            (_, _, Some(previous)) if previous != path => Status::Renamed,
            _ => Status::Modified,
        };
        let old_bytes = old.unwrap_or_default();
        let new_bytes = new.unwrap_or_default();
        let mut file = FileDiff {
            path: path.to_owned(),
            old_path: old_path.filter(|previous| *previous != path).map(str::to_owned),
            status,
            additions: 0,
            deletions: 0,
            binary: false,
            hunks: Vec::new(),
            truncated: false,
        };
        if is_binary(old_bytes) || is_binary(new_bytes) {
            file.binary = true;
            self.push(file);
            return;
        }
        let old_text = String::from_utf8_lossy(old_bytes);
        let new_text = String::from_utf8_lossy(new_bytes);
        let diff = TextDiff::from_lines(old_text.as_ref(), new_text.as_ref());
        let mut shown = 0usize;
        for group in diff.grouped_ops(3) {
            let (Some(first), Some(last)) = (group.first(), group.last()) else {
                continue;
            };
            let old_range = first.old_range().start..last.old_range().end;
            let new_range = first.new_range().start..last.new_range().end;
            let mut hunk = Hunk {
                old_start: old_range.start as u32 + 1,
                old_lines: old_range.len() as u32,
                new_start: new_range.start as u32 + 1,
                new_lines: new_range.len() as u32,
                lines: Vec::new(),
            };
            for op in &group {
                for change in diff.iter_changes(op) {
                    let kind = match change.tag() {
                        ChangeTag::Equal => "context",
                        ChangeTag::Insert => {
                            file.additions += 1;
                            "add"
                        }
                        ChangeTag::Delete => {
                            file.deletions += 1;
                            "del"
                        }
                    };
                    if shown >= MAX_FILE_LINES || self.lines + shown >= MAX_TOTAL_LINES {
                        file.truncated = true;
                        continue;
                    }
                    shown += 1;
                    let text = change.value().trim_end_matches(['\n', '\r']);
                    hunk.lines.push(Line {
                        kind,
                        text: text.chars().take(2_000).collect(),
                        old: change.old_index().map(|index| index as u32 + 1),
                        new: change.new_index().map(|index| index as u32 + 1),
                    });
                }
            }
            if !hunk.lines.is_empty() {
                file.hunks.push(hunk);
            }
        }
        self.lines += shown;
        self.push(file);
    }

    fn push(&mut self, file: FileDiff) {
        self.set.additions += file.additions;
        self.set.deletions += file.deletions;
        self.set.files.push(file);
    }

    pub fn finish(mut self) -> DiffSet {
        self.set.files.sort_by(|a, b| a.path.cmp(&b.path));
        self.set
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_and_numbers_lines() {
        let mut builder = Builder::default();
        builder.file("a.txt", None, Some(b"one\ntwo\nthree\n"), Some(b"one\n2\nthree\nfour\n"));
        builder.file("new.txt", None, None, Some(b"hi\n"));
        builder.file("gone.txt", None, Some(b"bye\n"), None);
        builder.file("logo.png", None, Some(b"\x89PNG\0"), Some(b"\x89PNG\0\0"));
        let set = builder.finish();
        let a = set.files.iter().find(|file| file.path == "a.txt").unwrap();
        assert_eq!((a.additions, a.deletions, a.status), (2, 1, Status::Modified));
        let lines: Vec<_> = a.hunks[0].lines.iter().map(|line| (line.kind, line.text.as_str(), line.old, line.new)).collect();
        assert_eq!(
            lines,
            vec![
                ("context", "one", Some(1), Some(1)),
                ("del", "two", Some(2), None),
                ("add", "2", None, Some(2)),
                ("context", "three", Some(3), Some(3)),
                ("add", "four", None, Some(4)),
            ]
        );
        assert_eq!(set.files.iter().find(|file| file.path == "new.txt").unwrap().status, Status::Added);
        assert_eq!(set.files.iter().find(|file| file.path == "gone.txt").unwrap().status, Status::Deleted);
        assert!(set.files.iter().find(|file| file.path == "logo.png").unwrap().binary);
        assert_eq!((set.additions, set.deletions), (3, 2));
    }
}
