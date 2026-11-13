//! The table of what's allowed, kept apart from the disk so its rules can be tested by themselves.
use std::path::{Path, PathBuf};

use super::{real_path, Access, Reach};

/// What a rule covers beside its root.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Shape {
    /// The folder and everything in it.
    Folder,
    /// That path alone: one file, or a folder's own listing without what's inside.
    Exact,
    /// Whatever is inside the entries of the folder whose names start this way.
    NamesStarting(&'static str),
}

#[derive(Clone, Debug)]
struct Rule {
    reach: Reach,
    root: PathBuf,
    shape: Shape,
    access: Access,
}

impl Rule {
    fn covers(&self, real: &Path) -> bool {
        match self.shape {
            // Compares whole path parts, so `/x/.misty-evil` isn't inside `/x/.misty`.
            Shape::Folder => real.starts_with(&self.root),
            Shape::Exact => real == self.root,
            Shape::NamesStarting(start) => real
                .strip_prefix(&self.root)
                .ok()
                .and_then(|inside| inside.components().next())
                .is_some_and(|name| name.as_os_str().to_string_lossy().starts_with(start)),
        }
    }

    fn gives(&self, access: Access) -> bool {
        self.access == Access::Write || access == Access::Read
    }
}

#[derive(Debug, Default)]
pub(super) struct Policy {
    rules: Vec<Rule>,
}

impl Policy {
    /// Adds a rule on `root`'s real location. A second rule for the same place and reach replaces
    /// the first, so a read grant can become a write grant and back.
    pub fn add(&mut self, reach: Reach, root: &Path, shape: Shape, access: Access) {
        let Ok(root) = real_path::resolve(root) else {
            return;
        };
        self.rules
            .retain(|rule| rule.reach != reach || rule.root != root || rule.shape != shape);
        self.rules.push(Rule {
            reach,
            root,
            shape,
            access,
        });
    }

    pub fn remove(&mut self, reach: Reach, root: &Path) {
        let root = real_path::resolve(root).unwrap_or_else(|_| root.to_path_buf());
        self.rules
            .retain(|rule| rule.reach != reach || rule.root != root);
    }

    pub fn remove_all(&mut self, reach: Reach) {
        self.rules.retain(|rule| rule.reach != reach);
    }

    /// `real` has to be a real path already, from `real_path`.
    pub fn allows(&self, real: &Path, access: Access) -> bool {
        self.rules
            .iter()
            .any(|rule| rule.gives(access) && rule.covers(real))
    }

    /// Whether the person picked exactly this file in a system dialog.
    pub fn was_picked(&self, real: &Path) -> bool {
        self.rules
            .iter()
            .any(|rule| rule.reach == Reach::PickedFile && rule.root == real)
    }

    #[cfg(test)]
    pub fn allows_path(&self, path: &Path, access: Access) -> bool {
        real_path::resolve(path).is_ok_and(|real| self.allows(&real, access))
    }
}
