//! The runs a project can still undo, and keeping that list short: the last
//! 20 runs per project, for 14 days.
use std::{
    fs,
    path::PathBuf,
    time::{Duration, SystemTime},
};

use serde_json::{json, Value};

use super::{valid_id, Checkpoints, Manifest, KEEP_DAYS, KEEP_PER_PROJECT};

impl Checkpoints {
    /// The first run in a project that started after `created_at`.
    pub fn next_after(
        &self,
        scope_id: &str,
        run_id: &str,
        created_at: u64,
    ) -> Option<(PathBuf, Manifest)> {
        fs::read_dir(self.dir.join(scope_id))
            .ok()?
            .flatten()
            .filter_map(|entry| self.manifest(scope_id, &entry.file_name().to_string_lossy()))
            .filter(|(_, manifest)| manifest.run_id != run_id && manifest.created_at >= created_at)
            .min_by_key(|(_, manifest)| manifest.created_at)
    }

    /// Runs that can be undone in a project, newest first.
    pub fn list(&self, scope_id: &str) -> Vec<Value> {
        if !valid_id(scope_id) {
            return Vec::new();
        }
        let mut found: Vec<(u64, Value)> = fs::read_dir(self.dir.join(scope_id))
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|entry| {
                let (_, manifest) = self.manifest(scope_id, &entry.file_name().to_string_lossy())?;
                let view = json!({ "runId": manifest.run_id, "createdAt": manifest.created_at, "complete": manifest.complete });
                Some((manifest.created_at, view))
            })
            .collect();
        found.sort_by_key(|(created, _)| std::cmp::Reverse(*created));
        found.into_iter().map(|(_, value)| value).collect()
    }

    /// Forgets every checkpoint of a project (when it's removed).
    pub fn forget(&self, scope_id: &str) {
        if valid_id(scope_id) {
            let _ = fs::remove_dir_all(self.dir.join(scope_id));
        }
    }

    pub(super) fn prune(&self, scope_id: &str) {
        let Ok(entries) = fs::read_dir(self.dir.join(scope_id)) else {
            return;
        };
        let cutoff = SystemTime::now() - Duration::from_secs(KEEP_DAYS * 86_400);
        let mut runs: Vec<(SystemTime, PathBuf)> = entries
            .flatten()
            .filter_map(|entry| Some((entry.metadata().ok()?.modified().ok()?, entry.path())))
            .collect();
        runs.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));
        for (index, (modified, path)) in runs.into_iter().enumerate() {
            if modified < cutoff || index >= KEEP_PER_PROJECT {
                let _ = fs::remove_dir_all(path);
            }
        }
    }
}
