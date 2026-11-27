// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Bringing the catalog in step with the disk: a walk of the whole home folder, or an update of
//! just the paths that changed. The walk is the disk gate's own (`walk`), over checked folder
//! handles that never follow a link and skip closed places. Walked entries are compared with the
//! manifest read-only, and the index's one writer is touched only once a change appears, so an
//! unchanged tree costs reads alone. The whole walk goes one top folder of home at a time, saving
//! after each, so a walk cut short (Misty quit, the person turned indexing off) picks up after the
//! last folder it finished, with the disk's events since it began replayed over the rest.
use std::{
    collections::{BTreeMap, BTreeSet, HashSet},
    ffi::OsString,
    hash::{BuildHasher, BuildHasherDefault, DefaultHasher},
    io,
    path::{Path, PathBuf},
};

use file_access::{
    disk::{
        walk::{walk as walk_checked, WalkFlow, WalkFor},
        CheckedDir, ItemKind,
    },
    Access,
};

use super::catalog::{self, Catalog, Signature};
use super::filter::{Pacer, ScanFilter, MAX_DEPTH};

const COMMIT_EVERY: u64 = 25_000;
const STOPPED: &str = "Indexing was stopped.";

#[derive(Clone, Copy, Debug, Default)]
pub(super) struct Changes {
    pub added: u64,
    pub updated: u64,
    pub removed: u64,
    pub unchanged: u64,
}

impl Changes {
    pub(super) fn any(&self) -> bool {
        self.added + self.updated + self.removed > 0
    }
}

fn key_hash(path: &str) -> u64 {
    BuildHasherDefault::<DefaultHasher>::default().hash_one(path)
}

pub(super) struct Sink<'a> {
    catalog: &'a mut Catalog,
    publish: &'a dyn Fn(),
    open: bool,
    pending: u64,
    seen: HashSet<u64>,
    pub changes: Changes,
}

impl<'a> Sink<'a> {
    pub(super) fn new(catalog: &'a mut Catalog, publish: &'a dyn Fn()) -> Self {
        Self {
            catalog,
            publish,
            open: false,
            pending: 0,
            seen: HashSet::new(),
            changes: Changes::default(),
        }
    }

    fn begin(&mut self) -> Result<(), String> {
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
        catalog::put_doc(&self.catalog.writer, &self.catalog.fields, &doc)?;
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
            catalog::delete_doc(&self.catalog.writer, &self.catalog.fields, &path);
            catalog::forget(&self.catalog.manifest, &path)?;
            self.changes.removed += 1;
            self.changed()?;
        }
        Ok(())
    }

    fn keep(&mut self, path: &str) {
        self.seen.insert(key_hash(path));
    }

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

    pub(super) fn remove_unseen(&mut self, path: &str) -> Result<(), String> {
        let mut paths = catalog::paths_below(&self.catalog.manifest, path)?;
        if self.lookup(path)?.is_some() {
            paths.push(path.to_owned());
        }
        paths.retain(|path| !self.seen.contains(&key_hash(path)));
        self.remove(paths)
    }

    fn commit(&mut self) -> Result<(), String> {
        if self.pending > 0 {
            self.catalog
                .writer
                .commit()
                .map_err(|error| format!("The search index couldn't be saved: {error}"))?;
        }
        if self.open {
            self.catalog
                .manifest
                .execute_batch("COMMIT")
                .map_err(|error| format!("The search index's list couldn't be saved: {error}"))?;
            self.open = false;
        }
        if self.pending > 0 {
            (self.publish)();
        }
        self.pending = 0;
        Ok(())
    }

    pub(super) fn finish(mut self) -> Result<Changes, String> {
        self.commit()?;
        Ok(self.changes)
    }
}

impl Drop for Sink<'_> {
    fn drop(&mut self) {
        if self.open {
            let _ = self.catalog.manifest.execute_batch("ROLLBACK");
            let _ = self.catalog.writer.rollback();
        }
    }
}

fn kind_doc(
    path: &Path,
    kind: ItemKind,
    len: u64,
    modified: Option<std::time::SystemTime>,
) -> Option<catalog::Doc> {
    match kind {
        ItemKind::File => catalog::doc_at(path, true, false, len, modified),
        ItemKind::Dir => catalog::doc_at(path, false, true, len, modified),
        ItemKind::Other => catalog::doc_at(path, false, false, len, modified),
        ItemKind::Link => None,
    }
}

fn walk(
    start: &Path,
    depth: usize,
    filter: &ScanFilter,
    sink: &mut Sink<'_>,
    pacer: &mut Pacer,
    keep_going: &dyn Fn() -> bool,
) -> Result<(), String> {
    let mut failure: Option<String> = None;
    let mut visit = |step: file_access::disk::WalkStep<'_>| -> io::Result<WalkFlow> {
        if !keep_going() {
            failure = Some(STOPPED.to_owned());
            return Ok(WalkFlow::Stop);
        }
        pacer.pace();
        let path = step.dir.path().join(&step.item.name);
        let reach = depth + step.depth + 1;
        let folder = step.item.kind == ItemKind::Dir;
        if folder && (reach >= MAX_DEPTH || filter.excludes(&path)) {
            return Ok(WalkFlow::SkipDir);
        }
        let Some(doc) = kind_doc(&path, step.item.kind, step.item.len, step.item.modified) else {
            return Ok(WalkFlow::Continue);
        };
        if let Err(error) = sink.accept(doc) {
            failure = Some(error);
            return Ok(WalkFlow::Stop);
        }
        Ok(WalkFlow::Continue)
    };
    let walked = walk_checked(start, Access::Read, WalkFor::Person, &mut visit);
    if let Some(failure) = failure {
        return Err(failure);
    }
    walked.map_err(|error| super::super::failed(start, error))
}

fn top_folders(
    home: &Path,
    filter: &ScanFilter,
    sink: &mut Sink<'_>,
    keep_going: &dyn Fn() -> bool,
) -> Result<Vec<String>, String> {
    let mut folders = Vec::new();
    let mut failure: Option<String> = None;
    let mut visit = |step: file_access::disk::WalkStep<'_>| -> io::Result<WalkFlow> {
        if !keep_going() {
            failure = Some(STOPPED.to_owned());
            return Ok(WalkFlow::Stop);
        }
        let path = step.dir.path().join(&step.item.name);
        let folder = step.item.kind == ItemKind::Dir;
        if folder && filter.excludes(&path) {
            return Ok(WalkFlow::SkipDir);
        }
        if let Some(doc) = kind_doc(&path, step.item.kind, step.item.len, step.item.modified) {
            if let Err(error) = sink.accept(doc) {
                failure = Some(error);
                return Ok(WalkFlow::Stop);
            }
        }
        if folder {
            folders.push(step.item.name.to_string_lossy().into_owned());
            return Ok(WalkFlow::SkipDir);
        }
        Ok(WalkFlow::Continue)
    };
    let walked = walk_checked(home, Access::Read, WalkFor::Person, &mut visit);
    if let Some(failure) = failure {
        return Err(failure);
    }
    walked.map_err(|error| super::super::failed(home, error))?;
    folders.sort();
    Ok(folders)
}

fn top_part<'p>(home: &Path, path: &'p str) -> Option<&'p str> {
    let home = home.to_string_lossy();
    let rest = path.strip_prefix(home.as_ref())?;
    let rest = rest.trim_start_matches(['/', '\\']);
    Some(rest.split(['/', '\\']).next().unwrap_or(rest))
}

pub(super) fn scan(
    catalog: &mut Catalog,
    home: &Path,
    resume_after: Option<&str>,
    keep_going: &dyn Fn() -> bool,
    publish: &dyn Fn(),
    part_done: &mut dyn FnMut(&Catalog, &str) -> Result<(), String>,
) -> Result<Changes, String> {
    let filter = ScanFilter::new(home);
    let mut sink = Sink::new(catalog, publish);
    let mut pacer = Pacer::default();
    let folders = top_folders(home, &filter, &mut sink, keep_going)?;
    let mut skipped: HashSet<String> = HashSet::new();
    for name in &folders {
        if resume_after.is_some_and(|done| name.as_str() <= done) {
            skipped.insert(name.clone());
            continue;
        }
        let path = home.join(name);
        walk(&path, 1, &filter, &mut sink, &mut pacer, keep_going)?;
        sink.remove_unseen(&path.to_string_lossy())?;
        sink.commit()?;
        part_done(&*sink.catalog, name)?;
    }
    if skipped.is_empty() {
        sink.remove_missing(&home.to_string_lossy())?;
    } else {
        let missing = catalog::paths_below(&sink.catalog.manifest, &home.to_string_lossy())?
            .into_iter()
            .filter(|path| !sink.seen.contains(&key_hash(path)))
            .filter(|path| top_part(home, path).is_none_or(|part| !skipped.contains(part)))
            .collect();
        sink.remove(missing)?;
    }
    sink.finish()
}

pub(super) fn apply(
    catalog: &mut Catalog,
    home: &Path,
    changed: &BTreeSet<PathBuf>,
    rescan: &BTreeSet<PathBuf>,
    keep_going: &dyn Fn() -> bool,
    publish: &dyn Fn(),
) -> Result<Changes, String> {
    let filter = ScanFilter::new(home);
    let mut sink = Sink::new(catalog, publish);
    let mut pacer = Pacer::default();
    let mut by_folder: BTreeMap<PathBuf, Vec<(OsString, usize)>> = BTreeMap::new();
    for path in changed {
        let Some(depth) = filter.reach(path).filter(|depth| *depth > 0) else {
            continue;
        };
        let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
            continue;
        };
        by_folder
            .entry(parent.to_path_buf())
            .or_default()
            .push((name.to_owned(), depth));
    }
    for (parent, names) in by_folder {
        if !keep_going() {
            return Err(STOPPED.to_owned());
        }
        let folder = match CheckedDir::open(&parent, Access::Read) {
            Ok(folder) => Some(folder),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(_) => continue,
        };
        for (name, depth) in names {
            let path = parent.join(&name);
            let text = path.to_string_lossy().into_owned();
            let meta = match folder.as_ref().map(|folder| folder.metadata(&name)) {
                Some(Ok(meta)) => meta,
                Some(Err(error)) if error.kind() != io::ErrorKind::NotFound => continue,
                _ => {
                    sink.remove_unseen(&text)?;
                    continue;
                }
            };
            let kind = if meta.file_type().is_symlink() {
                ItemKind::Link
            } else if meta.is_dir() {
                ItemKind::Dir
            } else if meta.is_file() {
                ItemKind::File
            } else {
                ItemKind::Other
            };
            let Some(doc) = kind_doc(&path, kind, meta.len(), meta.modified().ok()) else {
                sink.remove_unseen(&text)?;
                continue;
            };
            if kind == ItemKind::Dir && sink.lookup(&doc.path)?.is_none() {
                sink.accept(doc)?;
                walk(&path, depth, &filter, &mut sink, &mut pacer, keep_going)?;
                sink.remove_unseen(&text)?;
            } else {
                sink.accept(doc)?;
            }
        }
    }
    for path in rescan {
        let Some(depth) = filter.reach(path) else {
            continue;
        };
        let text = path.to_string_lossy().into_owned();
        match CheckedDir::open(path, Access::Read) {
            Ok(_) => {
                sink.keep(&text);
                walk(path, depth, &filter, &mut sink, &mut pacer, keep_going)?
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(_) => continue,
        }
        sink.remove_unseen(&text)?;
    }
    sink.finish()
}
