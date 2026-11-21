// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Bringing the catalog in step with the disk: a walk of the whole home folder, or an update of
//! just the paths that changed. Walked entries are compared with the manifest read-only, and a
//! writer opens only once the first change appears, so an unchanged tree costs reads alone.
use std::{
    collections::{BTreeSet, HashSet},
    hash::{BuildHasher, BuildHasherDefault, DefaultHasher},
    path::{Path, PathBuf},
};

use file_access::{
    disk::{check_disk, fs_disk},
    Access,
};
use tantivy::IndexWriter;
use walkdir::WalkDir;

use super::catalog::{self, Catalog, Signature};
use super::filter::{Pacer, ScanFilter, MAX_DEPTH};

/// A long walk commits this often, so search works part way through the first one.
const COMMIT_EVERY: u64 = 25_000;

#[derive(Clone, Copy, Debug, Default)]
pub(super) struct Changes {
    pub added: u64,
    pub updated: u64,
    pub removed: u64,
    pub unchanged: u64,
}

fn key_hash(path: &str) -> u64 {
    BuildHasherDefault::<DefaultHasher>::default().hash_one(path)
}

/// Takes walked entries and writes what changed to both halves of the catalog.
pub(super) struct Sink<'a> {
    catalog: &'a Catalog,
    writer: Option<IndexWriter>,
    /// A manifest transaction is open.
    open: bool,
    pending: u64,
    seen: HashSet<u64>,
    pub changes: Changes,
    /// Something was committed since the caller last asked.
    pub committed: bool,
}

impl<'a> Sink<'a> {
    pub(super) fn new(catalog: &'a Catalog) -> Self {
        Self {
            catalog,
            writer: None,
            open: false,
            pending: 0,
            seen: HashSet::new(),
            changes: Changes::default(),
            committed: false,
        }
    }

    fn begin(&mut self) -> Result<(), String> {
        if self.writer.is_none() {
            self.writer = Some(catalog::writer(&self.catalog.index)?);
        }
        if !self.open {
            self.catalog
                .manifest
                .execute_batch("BEGIN IMMEDIATE")
                .map_err(|error| format!("The search index's list couldn't be changed: {error}"))?;
            self.open = true;
        }
        Ok(())
    }

    fn lookup(&self, path: &str) -> Result<Option<Signature>, String> {
        catalog::lookup(&self.catalog.manifest, path)
    }

    fn changed(&mut self) -> Result<(), String> {
        self.pending += 1;
        if self.pending >= COMMIT_EVERY {
            self.commit()?;
        }
        Ok(())
    }

    pub(super) fn accept(&mut self, doc: catalog::Doc) -> Result<(), String> {
        self.seen.insert(key_hash(&doc.path));
        let existing = self.lookup(&doc.path)?;
        if existing == Some(Signature::from(&doc)) {
            self.changes.unchanged += 1;
            return Ok(());
        }
        self.begin()?;
        if let Some(writer) = &self.writer {
            catalog::put_doc(writer, &self.catalog.fields, &doc)?;
        }
        catalog::persist(&self.catalog.manifest, &doc)?;
        if existing.is_some() {
            self.changes.updated += 1;
        } else {
            self.changes.added += 1;
        }
        self.changed()
    }

    fn remove(&mut self, paths: Vec<String>) -> Result<(), String> {
        for path in paths {
            self.begin()?;
            if let Some(writer) = &self.writer {
                catalog::delete_doc(writer, &self.catalog.fields, &path);
            }
            catalog::forget(&self.catalog.manifest, &path)?;
            self.changes.removed += 1;
            self.changed()?;
        }
        Ok(())
    }

    /// Removes what the catalog holds below a fully walked `root` that the walk didn't see.
    /// Counting first avoids reading every path when nothing went.
    pub(super) fn remove_missing(&mut self, root: &str) -> Result<(), String> {
        let seen = self.changes.unchanged + self.changes.updated + self.changes.added;
        if catalog::count_below(&self.catalog.manifest, root)? == seen {
            return Ok(());
        }
        let missing = catalog::paths_below(&self.catalog.manifest, root)?
            .into_iter()
            .filter(|path| !self.seen.contains(&key_hash(path)))
            .collect();
        self.remove(missing)
    }

    /// Removes the entry at `path` and everything below it, except what this update has seen.
    pub(super) fn remove_unseen(&mut self, path: &str) -> Result<(), String> {
        let mut paths = catalog::paths_below(&self.catalog.manifest, path)?;
        if self.lookup(path)?.is_some() {
            paths.push(path.to_owned());
        }
        paths.retain(|path| !self.seen.contains(&key_hash(path)));
        self.remove(paths)
    }

    /// Commits both halves, the index first.
    fn commit(&mut self) -> Result<(), String> {
        if let Some(writer) = self.writer.as_mut() {
            writer.commit().map_err(|error| format!("The search index couldn't be saved: {error}"))?;
        }
        if self.open {
            self.catalog
                .manifest
                .execute_batch("COMMIT")
                .map_err(|error| format!("The search index's list couldn't be saved: {error}"))?;
            self.open = false;
        }
        if self.pending > 0 {
            self.committed = true;
        }
        self.pending = 0;
        Ok(())
    }

    /// Commits what is left and lets the writer finish its merges.
    pub(super) fn finish(mut self) -> Result<Changes, String> {
        self.commit()?;
        if let Some(writer) = self.writer.take() {
            writer
                .wait_merging_threads()
                .map_err(|error| format!("The search index couldn't be saved: {error}"))?;
        }
        Ok(self.changes)
    }
}

impl Drop for Sink<'_> {
    fn drop(&mut self) {
        // Not finished (a failure or a stop): the manifest goes back with the writer's
        // uncommitted documents, which dropping the writer discards.
        if self.open {
            let _ = self.catalog.manifest.execute_batch("ROLLBACK");
        }
    }
}

/// Walks `start` (at `depth` below the home folder) as a scan would and hands every entry to the
/// sink; the start itself too, unless it is the home folder. `keep_going` is asked as it walks.
fn walk(
    start: &Path,
    depth: usize,
    filter: &ScanFilter,
    sink: &mut Sink<'_>,
    pacer: &mut Pacer,
    keep_going: &dyn Fn() -> bool,
) -> Result<u64, String> {
    check_disk(start, Access::Read).map_err(|error| super::super::failed(start, error))?;
    let mut count = 0u64;
    let walker = WalkDir::new(start)
        .follow_links(false)
        .max_depth(MAX_DEPTH.saturating_sub(depth))
        .into_iter()
        .filter_entry(|entry| entry.depth() == 0 || !filter.excludes(entry.path()));
    for entry in walker {
        if !keep_going() {
            return Err("Indexing was stopped.".to_owned());
        }
        pacer.pace();
        let Ok(entry) = entry else { continue };
        if (entry.depth() == 0 && depth == 0) || entry.file_type().is_symlink() {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if let Some(doc) = catalog::local_doc(entry.path(), &meta) {
            sink.accept(doc)?;
            count += 1;
        }
        if sink.committed {
            sink.committed = false;
            super::published();
        }
    }
    Ok(count)
}

/// Walks the whole home folder and brings the catalog in step with it.
pub(super) fn scan(catalog: &Catalog, home: &Path, keep_going: &dyn Fn() -> bool) -> Result<Changes, String> {
    let filter = ScanFilter::new(home);
    let mut sink = Sink::new(catalog);
    let mut pacer = Pacer::default();
    walk(home, 0, &filter, &mut sink, &mut pacer, keep_going)?;
    sink.remove_missing(&home.to_string_lossy())?;
    sink.finish()
}

/// Applies changes at `changed` without walking the home folder: what exists now is added or
/// updated, what is gone is removed with everything below it, and a folder new to the catalog is
/// indexed with its contents. Folders in `rescan` (events below them were dropped) are walked and
/// reconciled. Paths a scan wouldn't reach are left alone.
pub(super) fn apply(
    catalog: &Catalog,
    home: &Path,
    changed: &[PathBuf],
    rescan: &[PathBuf],
    keep_going: &dyn Fn() -> bool,
) -> Result<Changes, String> {
    let filter = ScanFilter::new(home);
    let mut sink = Sink::new(catalog);
    let mut pacer = Pacer::default();
    // Sorted, so a folder comes before what is inside it.
    let changed: BTreeSet<&PathBuf> = changed.iter().collect();
    for path in changed {
        let Some(depth) = filter.reach(path).filter(|depth| *depth > 0) else { continue };
        let text = path.to_string_lossy().into_owned();
        match fs_disk::symlink_metadata(path) {
            // Scans skip links, so a link in an entry's place removes it.
            Ok(meta) if !meta.file_type().is_symlink() => {
                let Some(doc) = catalog::local_doc(path, &meta) else { continue };
                // A folder made or moved in brings its contents, often without an event for each.
                if meta.is_dir() && sink.lookup(&doc.path)?.is_none() {
                    walk(path, depth, &filter, &mut sink, &mut pacer, keep_going)?;
                    sink.remove_unseen(&text)?;
                } else {
                    sink.accept(doc)?;
                }
            }
            Ok(_) => sink.remove_unseen(&text)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => sink.remove_unseen(&text)?,
            Err(_) => {}
        }
    }
    let rescan: BTreeSet<&PathBuf> = rescan.iter().collect();
    for path in rescan {
        let Some(depth) = filter.reach(path) else { continue };
        if fs_disk::is_dir(path) {
            walk(path, depth, &filter, &mut sink, &mut pacer, keep_going)?;
        }
        sink.remove_unseen(&path.to_string_lossy())?;
    }
    sink.finish()
}
