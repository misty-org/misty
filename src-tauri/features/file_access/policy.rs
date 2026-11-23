use std::path::{Path, PathBuf};

use super::{real_path, Access, Reach};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Shape {
    Folder,
    Exact,
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

    pub fn allows(&self, real: &Path, access: Access) -> bool {
        self.rules
            .iter()
            .any(|rule| rule.gives(access) && rule.covers(real))
    }

    pub fn reach_covers(&self, reach: Reach, real: &Path) -> bool {
        self.rules
            .iter()
            .any(|rule| rule.reach == reach && rule.covers(real))
    }

    pub fn roots_of(&self, reach: Reach) -> Vec<PathBuf> {
        self.rules
            .iter()
            .filter(|rule| rule.reach == reach)
            .map(|rule| rule.root.clone())
            .collect()
    }

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
