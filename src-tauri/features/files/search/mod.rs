// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Search: a names-only index of the home folder, fuzzy and typo-tolerant, as Kura's. It lives in
//! `files-index/` in this build's Misty data folder (tantivy's index and its scan manifest, both
//! its own files, never `misty.db`), and runs only while the disk grant is on.
//!
//! One background thread walks the home folder at startup (and every few hours after, as a
//! safety net), gently and at background priority, while a watch on the folder applies changes as
//! they happen. Files' own changes reach the watch at once through `note_*`. The state goes out on
//! `files://index` as an `IndexStatus`.
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
        Arc, Mutex, OnceLock, RwLock, TryLockError,
    },
    time::{Duration, Instant},
};

use file_access::{
    disk::{check_disk, disk_allowed},
    Access,
};
use serde::Serialize;
use tantivy::IndexReader;
use tauri::{AppHandle, Emitter};

use super::entry::{entry_for, FileEntry};
use super::{asked_path, blocking, person_window};

mod catalog;
mod filter;
mod query;
mod scan;
mod watch;

use catalog::{Catalog, Fields};
use watch::IndexWatch;

pub const EVENT: &str = "files://index";

const RESCAN_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
const GRANT_CHECK: Duration = Duration::from_secs(5);
const MOST_RESULTS: usize = 500;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IndexState {
    Off,
    Indexing,
    Ready,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub state: IndexState,
    pub files: u64,
}

pub(super) struct Service {
    app: AppHandle,
    root: PathBuf,
    home: PathBuf,
    catalog: Mutex<Option<Catalog>>,
    reader: RwLock<Option<(IndexReader, Fields)>>,
    running: AtomicBool,
    state: AtomicU8,
    files: AtomicU64,
    watch: Mutex<Option<IndexWatch>>,
}

static SERVICE: OnceLock<Arc<Service>> = OnceLock::new();

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn service(app: &AppHandle) -> Option<&'static Arc<Service>> {
    if let Some(service) = SERVICE.get() {
        return Some(service);
    }
    let root = catalog::root()?;
    let home = dirs::home_dir()?;
    Some(SERVICE.get_or_init(|| {
        Arc::new(Service {
            app: app.clone(),
            root,
            home,
            catalog: Mutex::new(None),
            reader: RwLock::new(None),
            running: AtomicBool::new(false),
            state: AtomicU8::new(0),
            files: AtomicU64::new(0),
            watch: Mutex::new(None),
        })
    }))
}

impl Service {
    fn status(&self) -> IndexStatus {
        let state = match self.state.load(Ordering::SeqCst) {
            1 => IndexState::Indexing,
            2 => IndexState::Ready,
            _ => IndexState::Off,
        };
        let state = if disk_allowed() {
            state
        } else {
            IndexState::Off
        };
        IndexStatus {
            state,
            files: self.files.load(Ordering::SeqCst),
        }
    }

    fn emit(&self) {
        let _ = self.app.emit(EVENT, self.status());
    }

    fn set_state(&self, state: IndexState) {
        let value = match state {
            IndexState::Off => 0,
            IndexState::Indexing => 1,
            IndexState::Ready => 2,
        };
        if self.state.swap(value, Ordering::SeqCst) != value {
            self.emit();
        }
    }

    fn published(&self) {
        let reader = self
            .reader
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some((reader, _)) = reader.as_ref() {
            if reader.reload().is_ok() {
                self.files
                    .store(reader.searcher().num_docs(), Ordering::SeqCst);
            }
        }
        drop(reader);
        self.emit();
    }

    fn prepare(self: &Arc<Self>) -> Result<(), String> {
        let mut catalog = lock(&self.catalog);
        if catalog.is_none() {
            let opened = catalog::open(&self.root)?;
            *self
                .reader
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) =
                Some((opened.reader.clone(), opened.fields));
            *catalog = Some(opened);
        }
        drop(catalog);
        self.published();
        let mut watch = lock(&self.watch);
        if watch.is_none() {
            match IndexWatch::start(Arc::downgrade(self), &self.home) {
                Ok(started) => *watch = Some(started),
                Err(error) => eprintln!("{error}"),
            }
        }
        Ok(())
    }

    fn run(self: Arc<Self>) {
        let _priority = filter::BackgroundPriority::enter();
        'running: while disk_allowed() {
            self.set_state(IndexState::Indexing);
            if let Err(error) = self.prepare() {
                eprintln!("{error}");
                break;
            }
            let keep_going = || disk_allowed();
            let walked = match lock(&self.catalog).as_ref() {
                Some(catalog) => scan::scan(catalog, &self.home, &keep_going),
                None => Ok(scan::Changes::default()),
            };
            if let Err(error) = walked {
                if disk_allowed() {
                    eprintln!("Files' search index couldn't walk the home folder: {error}");
                }
            }
            self.published();
            if !disk_allowed() {
                break;
            }
            self.set_state(IndexState::Ready);
            let next = Instant::now() + RESCAN_EVERY;
            while Instant::now() < next {
                if !disk_allowed() {
                    break 'running;
                }
                std::thread::sleep(GRANT_CHECK);
            }
        }
        *lock(&self.watch) = None;
        self.running.store(false, Ordering::SeqCst);
        self.set_state(IndexState::Off);
        self.emit();
    }

    pub(super) fn apply(
        &self,
        changed: &[PathBuf],
        rescan: &[PathBuf],
    ) -> Option<Result<(), String>> {
        if !disk_allowed() {
            return Some(Ok(()));
        }
        let catalog = match self.catalog.try_lock() {
            Ok(catalog) => catalog,
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(TryLockError::WouldBlock) => return None,
        };
        let Some(open) = catalog.as_ref() else {
            return Some(Ok(()));
        };
        let result = scan::apply(open, &self.home, changed, rescan, &|| disk_allowed());
        drop(catalog);
        Some(result.map(|changes| {
            if changes.added + changes.updated + changes.removed > 0 {
                self.published();
            }
        }))
    }

    fn search(
        &self,
        text: &str,
        scope: Option<&Path>,
        limit: usize,
    ) -> Result<Vec<FileEntry>, String> {
        let reader = self
            .reader
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some((reader, fields)) = reader.as_ref() else {
            return Ok(Vec::new());
        };
        let found = query::matches(reader, fields, text, scope)?;
        Ok(found
            .iter()
            .map(|doc| PathBuf::from(&doc.path))
            .filter(|path| check_disk(path, Access::Read).is_ok())
            .filter_map(|path| entry_for(&path).ok())
            .take(limit)
            .collect())
    }
}

fn published() {
    if let Some(service) = SERVICE.get() {
        service.published();
    }
}

pub fn start_indexing(app: &AppHandle) {
    if !disk_allowed() {
        return;
    }
    let Some(service) = service(app) else {
        return;
    };
    if service.running.swap(true, Ordering::SeqCst) {
        return;
    }
    let worker = service.clone();
    let spawned = std::thread::Builder::new()
        .name("misty-files-index".into())
        .spawn(move || worker.run());
    if let Err(error) = spawned {
        service.running.store(false, Ordering::SeqCst);
        eprintln!("Files' search index couldn't start: {error}");
    }
}

fn note(path: &Path) {
    if let Some(service) = SERVICE.get() {
        if let Some(watch) = lock(&service.watch).as_ref() {
            watch.note(path);
        }
    }
}

pub fn note_added(path: &Path) {
    note(path);
}

pub fn note_removed(path: &Path) {
    note(path);
}

pub fn note_renamed(from: &Path, to: &Path) {
    note(from);
    note(to);
}

#[tauri::command]
pub async fn files_search(
    webview: tauri::Webview,
    query: String,
    scope: Option<String>,
    limit: usize,
) -> Result<Vec<FileEntry>, String> {
    person_window(&webview)?;
    let scope = scope
        .filter(|scope| !scope.trim().is_empty())
        .map(|scope| asked_path(&scope))
        .transpose()?;
    if query.trim().is_empty() || !disk_allowed() {
        return Ok(Vec::new());
    }
    let Some(service) = SERVICE.get().cloned() else {
        return Ok(Vec::new());
    };
    blocking(move || service.search(&query, scope.as_deref(), limit.clamp(1, MOST_RESULTS))).await
}

#[tauri::command]
pub fn files_index_status(webview: tauri::Webview) -> Result<IndexStatus, String> {
    person_window(&webview)?;
    Ok(SERVICE
        .get()
        .map(|service| service.status())
        .unwrap_or(IndexStatus {
            state: IndexState::Off,
            files: 0,
        }))
}
