// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Search: a names-only index of the home folder, fuzzy and typo-tolerant, as Kura's. It lives in
//! `files-index/` in this build's Misty data folder (tantivy's index and its scan manifest, both
//! its own files, never `misty.db`), and runs only while the disk grant is on.
//!
//! One thread owns the index: its one writer and the manifest. Everything else sends it a message:
//! the shared file event stream's bursts, Files' own changes (`note_*`) and a change of the disk
//! grant (`grant_changed`). It walks the home folder only the first time, after a schema change,
//! or when the system says events were lost; otherwise it resumes from the last event it took
//! (kept in the manifest) and applies only what changed. Searches read the index on their own
//! threads and never wait for it. The state goes out on `files://index` as an `IndexStatus`.
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
        mpsc, Arc, LazyLock, Mutex, OnceLock, RwLock,
    },
    time::{Duration, Instant},
};

use file_access::{
    disk::{disk_allowed, CheckedDir},
    Access,
};
use serde::Serialize;
use tantivy::IndexReader;
use tauri::{AppHandle, Emitter};

use super::entry::FileEntry;
use super::fs_events::{self, Event, RESUMES};
use super::listing::Lister;
use super::{asked_path, blocking, person_window};

mod catalog;
mod filter;
mod query;
mod scan;

use catalog::{Catalog, Fields};

pub const EVENT: &str = "files://index";

const MOST_RESULTS: usize = 500;
const DEBOUNCE: Duration = Duration::from_millis(100);
const MAX_DELAY: Duration = Duration::from_secs(1);
const SUPERSEDED: &str = "superseded";

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

enum Message {
    Events(Vec<Event>),
    Note(PathBuf),
    Grant,
}

struct Shared {
    app: AppHandle,
    sender: mpsc::Sender<Message>,
    reader: RwLock<Option<(IndexReader, Fields)>>,
    following: AtomicBool,
    state: AtomicU8,
    files: AtomicU64,
}

static SHARED: OnceLock<Arc<Shared>> = OnceLock::new();
static TURNS: AtomicU64 = AtomicU64::new(1);
static LATEST: LazyLock<Mutex<HashMap<String, u64>>> = LazyLock::new(Mutex::default);

impl Shared {
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

    fn reader(&self) -> Option<(IndexReader, Fields)> {
        self.reader
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn published(&self) {
        if let Some((reader, _)) = self.reader() {
            if reader.reload().is_ok() {
                self.files
                    .store(reader.searcher().num_docs(), Ordering::SeqCst);
            }
        }
        self.emit();
    }

    fn send(&self, message: Message) {
        let _ = self.sender.send(message);
    }
}

struct Open {
    catalog: Catalog,
    home: PathBuf,
    asked_home: PathBuf,
    resumable: bool,
}

struct Actor {
    shared: Arc<Shared>,
    root: PathBuf,
    open: Option<Open>,
}

#[derive(Default)]
struct Batch {
    changed: BTreeSet<PathBuf>,
    rescan: BTreeSet<PathBuf>,
    last: u64,
    grant: bool,
}

impl Batch {
    fn add(&mut self, message: Message) {
        match message {
            Message::Grant => self.grant = true,
            Message::Note(path) => {
                self.changed.insert(path);
            }
            Message::Events(events) => {
                for event in events {
                    self.last = self.last.max(event.id);
                    if event.rescan {
                        self.rescan.insert(event.path);
                    } else {
                        self.changed.insert(event.path);
                    }
                }
            }
        }
    }

    fn is_empty(&self) -> bool {
        self.changed.is_empty() && self.rescan.is_empty() && self.last == 0
    }
}

fn keep_going() -> bool {
    disk_allowed()
}

impl Actor {
    fn run(mut self, receiver: mpsc::Receiver<Message>) {
        let _priority = filter::BackgroundPriority::enter();
        self.grant();
        while let Ok(first) = receiver.recv() {
            let mut batch = Batch::default();
            batch.add(first);
            let started = Instant::now();
            while !batch.grant {
                let left = MAX_DELAY.saturating_sub(started.elapsed());
                if left.is_zero() {
                    break;
                }
                match receiver.recv_timeout(DEBOUNCE.min(left)) {
                    Ok(message) => batch.add(message),
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            let grant = batch.grant;
            if !batch.is_empty() {
                self.apply(batch);
            }
            if grant || !disk_allowed() {
                self.grant();
            }
        }
    }

    fn publish(&self) {
        self.shared.published();
    }

    fn grant(&mut self) {
        match (disk_allowed(), self.open.is_some()) {
            (true, false) => {
                if let Err(error) = self.start() {
                    eprintln!("{error}");
                    self.stop();
                }
            }
            (false, true) => self.stop(),
            _ => {}
        }
    }

    fn stop(&mut self) {
        self.shared.following.store(false, Ordering::SeqCst);
        if let Err(error) = fs_events::follow_index(None, None) {
            eprintln!("{error}");
        }
        self.open = None;
        self.shared.set_state(IndexState::Off);
    }

    fn start(&mut self) -> Result<(), String> {
        self.shared.set_state(IndexState::Indexing);
        let asked_home = dirs::home_dir().ok_or("Files' search index found no home folder.")?;
        let home = CheckedDir::open(&asked_home, Access::Read)
            .map(|dir| dir.path().to_path_buf())
            .map_err(|error| format!("Files' search index can't read the home folder: {error}"))?;
        let catalog = catalog::open(&self.root)?;
        *self
            .shared
            .reader
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) =
            Some((catalog.reader.clone(), catalog.fields));
        self.shared.published();
        let stored = catalog::stored_event(&catalog.manifest)?;
        let resume = stored.filter(|id| RESUMES && *id <= fs_events::current_id());
        let start_id = fs_events::current_id();
        self.shared.following.store(true, Ordering::SeqCst);
        fs_events::follow_index(Some(home.clone()), resume)?;
        self.open = Some(Open {
            catalog,
            home,
            asked_home,
            resumable: resume.is_some(),
        });
        if resume.is_none() {
            self.full_scan(start_id);
        }
        if disk_allowed() && self.open.is_some() {
            self.shared.set_state(IndexState::Ready);
        }
        Ok(())
    }

    fn full_scan(&mut self, start_id: u64) {
        let shared = self.shared.clone();
        let publish = move || shared.published();
        let Some(open) = self.open.as_mut() else {
            return;
        };
        self.shared.set_state(IndexState::Indexing);
        let _ = catalog::forget_event(&open.catalog.manifest);
        open.resumable = false;
        match scan::scan(&mut open.catalog, &open.home, &keep_going, &publish) {
            Ok(_) => {
                open.resumable = RESUMES;
                if RESUMES && start_id != 0 {
                    if let Err(error) = catalog::store_event(&open.catalog.manifest, start_id) {
                        eprintln!("{error}");
                    }
                }
            }
            Err(error) => {
                if disk_allowed() {
                    eprintln!("Files' search index couldn't walk the home folder: {error}");
                }
            }
        }
        self.publish();
        if disk_allowed() {
            self.shared.set_state(IndexState::Ready);
        }
    }

    fn real(open: &Open, path: PathBuf) -> PathBuf {
        match path.strip_prefix(&open.asked_home) {
            Ok(inside) if open.asked_home != open.home => open.home.join(inside),
            _ => path,
        }
    }

    fn apply(&mut self, batch: Batch) {
        if !disk_allowed() {
            return;
        }
        let Some(open) = self.open.as_mut() else {
            return;
        };
        let changed: BTreeSet<PathBuf> = batch
            .changed
            .into_iter()
            .map(|path| Self::real(open, path))
            .collect();
        let rescan: BTreeSet<PathBuf> = batch
            .rescan
            .into_iter()
            .map(|path| Self::real(open, path))
            .collect();
        if rescan.iter().any(|path| open.home.starts_with(path)) {
            self.full_scan(fs_events::current_id());
            return;
        }
        let shared = self.shared.clone();
        let publish = move || shared.published();
        match scan::apply(
            &mut open.catalog,
            &open.home,
            &changed,
            &rescan,
            &keep_going,
            &publish,
        ) {
            Ok(changes) => {
                if changes.any() {
                    self.shared.published();
                }
                if open.resumable && batch.last != 0 {
                    if let Err(error) = catalog::store_event(&open.catalog.manifest, batch.last) {
                        eprintln!("{error}");
                    }
                }
            }
            Err(error) => {
                if disk_allowed() {
                    eprintln!("Files' search index couldn't take a change: {error}");
                }
            }
        }
    }
}

fn shared(app: &AppHandle) -> Option<&'static Arc<Shared>> {
    if let Some(shared) = SHARED.get() {
        return Some(shared);
    }
    let root = catalog::root()?;
    let mut receiver = None;
    let shared = SHARED.get_or_init(|| {
        let (sender, taken) = mpsc::channel();
        receiver = Some(taken);
        Arc::new(Shared {
            app: app.clone(),
            sender,
            reader: RwLock::new(None),
            following: AtomicBool::new(false),
            state: AtomicU8::new(0),
            files: AtomicU64::new(0),
        })
    });
    if let Some(receiver) = receiver {
        let actor = Actor {
            shared: shared.clone(),
            root,
            open: None,
        };
        let spawned = std::thread::Builder::new()
            .name("misty-files-index".into())
            .spawn(move || actor.run(receiver));
        if let Err(error) = spawned {
            eprintln!("Files' search index couldn't start: {error}");
        }
    }
    Some(shared)
}

pub fn start_indexing(app: &AppHandle) {
    if let Some(shared) = shared(app) {
        shared.send(Message::Grant);
    }
}

pub fn grant_changed() {
    if let Some(shared) = SHARED.get() {
        shared.send(Message::Grant);
    }
}

pub(crate) fn take(events: Vec<Event>) {
    if let Some(shared) = SHARED.get() {
        if shared.following.load(Ordering::SeqCst) {
            shared.send(Message::Events(events));
        }
    }
}

fn note(path: &Path) {
    if let Some(shared) = SHARED.get() {
        if shared.following.load(Ordering::SeqCst) {
            shared.send(Message::Note(path.to_path_buf()));
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

fn gate(
    hits: Vec<query::Hit>,
    limit: usize,
    current: &dyn Fn() -> bool,
) -> Result<Vec<FileEntry>, String> {
    let mut found: Vec<FileEntry> = Vec::new();
    let mut rest = hits.as_slice();
    while found.len() < limit && !rest.is_empty() {
        if !current() {
            return Err(SUPERSEDED.into());
        }
        let take = (limit - found.len()).max(16).min(rest.len());
        let (chunk, after) = rest.split_at(take);
        rest = after;
        let mut by_folder: BTreeMap<&Path, Vec<usize>> = BTreeMap::new();
        for (index, hit) in chunk.iter().enumerate() {
            let path = Path::new(&hit.path);
            if let Some(parent) = path.parent() {
                by_folder.entry(parent).or_default().push(index);
            }
        }
        let mut shown: Vec<Option<FileEntry>> = vec![None; chunk.len()];
        for (parent, indexes) in by_folder {
            let Ok(dir) = CheckedDir::open(parent, Access::Read) else {
                continue;
            };
            let Ok(lister) = Lister::new(&dir, parent, false) else {
                continue;
            };
            for index in indexes {
                let Some(name) = Path::new(&chunk[index].path).file_name() else {
                    continue;
                };
                shown[index] = lister.one(name).ok().flatten();
            }
        }
        found.extend(shown.into_iter().flatten());
    }
    found.truncate(limit);
    Ok(found)
}

fn search(
    shared: &Shared,
    text: &str,
    scope: Option<PathBuf>,
    limit: usize,
    current: &dyn Fn() -> bool,
) -> Result<Vec<FileEntry>, String> {
    let Some((reader, fields)) = shared.reader() else {
        return Ok(Vec::new());
    };
    let scope = match scope {
        Some(scope) => Some(
            CheckedDir::open(&scope, Access::Read)
                .map(|dir| dir.path().to_path_buf())
                .map_err(|error| super::failed(&scope, error))?,
        ),
        None => None,
    };
    let hits = match query::matches(&reader, &fields, text, scope.as_deref(), limit, current)? {
        Ok(hits) => hits,
        Err(query::Superseded) => return Err(SUPERSEDED.into()),
    };
    gate(hits, limit, current)
}

fn next_turn(label: &str) -> u64 {
    let turn = TURNS.fetch_add(1, Ordering::SeqCst);
    LATEST
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(label.to_owned(), turn);
    turn
}

fn is_latest(label: &str, turn: u64) -> bool {
    LATEST
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(label)
        .is_none_or(|latest| *latest == turn)
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
    let label = format!(
        "{}\u{0}{}\u{0}{limit}",
        webview.label(),
        scope
            .as_deref()
            .map(|scope| scope.display().to_string())
            .unwrap_or_default()
    );
    let turn = next_turn(&label);
    if query.trim().is_empty() || !disk_allowed() {
        return Ok(Vec::new());
    }
    let Some(shared) = SHARED.get().cloned() else {
        return Ok(Vec::new());
    };
    blocking(move || {
        let current = || is_latest(&label, turn);
        search(
            &shared,
            &query,
            scope,
            limit.clamp(1, MOST_RESULTS),
            &current,
        )
    })
    .await
}

#[tauri::command]
pub async fn files_index_status(webview: tauri::Webview) -> Result<IndexStatus, String> {
    person_window(&webview)?;
    Ok(SHARED
        .get()
        .map(|shared| shared.status())
        .unwrap_or(IndexStatus {
            state: IndexState::Off,
            files: 0,
        }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_burst_keeps_rescans_apart_and_remembers_its_last_event() {
        let mut batch = Batch::default();
        batch.add(Message::Events(vec![
            Event {
                path: PathBuf::from("/home/a.txt"),
                rescan: false,
                id: 7,
            },
            Event {
                path: PathBuf::from("/home/deep"),
                rescan: true,
                id: 9,
            },
        ]));
        batch.add(Message::Note(PathBuf::from("/home/b.txt")));
        assert_eq!(batch.last, 9);
        assert_eq!(batch.changed.len(), 2);
        assert_eq!(batch.rescan.len(), 1);
        assert!(!batch.grant);
    }

    #[test]
    fn a_newer_search_from_the_same_window_replaces_the_older() {
        let first = next_turn("files-test-window");
        let second = next_turn("files-test-window");
        assert!(!is_latest("files-test-window", first));
        assert!(is_latest("files-test-window", second));
    }
}
