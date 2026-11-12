// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
//
// The changes panel's reads and index writes, through libgit2: status with line counts and
// ahead/behind, one file's patch, both sides of an image, staging, unstaging, discarding,
// branches, switching and creating them, and `git init`. Commit, push and pull run the person's
// own `git` instead (see git.rs), so their hooks, signing and credentials apply.

mod branches;
mod diff;
mod index;
mod status;

pub(crate) use branches::*;
pub(crate) use diff::*;
pub(crate) use index::*;
pub(crate) use status::*;
