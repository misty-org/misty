//! Which files of a folder are shared: ripgrep's walker with the folder's `.gitignore` (and Git's
//! own exclude file), then its `.mistyignore`, which adds rules and can take one back with
//! `!pattern`. Dotfiles count unless a rule leaves them out; `.git` never does, and links are
//! never followed.
//!
//! The walker moved to the Space drive's crate (`space_drive::ignore`), which uses the same rules
//! for what goes into a drive; shared folders use it from there.

pub use space_drive::ignore::Scan;
pub(crate) use space_drive::ignore::{scan, IGNORE_FILE};
#[cfg(test)]
pub(crate) use space_drive::ignore::{included_files, sha256_file};
