// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! The folders open in Files, kept live: each window subscribes to a folder with
//! `files_watch_open`, which returns its items and keeps them in a cache shared by every
//! subscription to the same folder (by its real path, and whether hidden items show). The shared
//! file event stream (`fs_events`) names the items that changed; a burst is gathered for a moment,
//! only those names are read again, and each subscriber hears what was added, changed or removed
//! on `files://folder`, sent to its own window alone. A subscription lasts until
//! `files_watch_close`, or until its window goes.
use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    ffi::OsString,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, LazyLock, Mutex, OnceLock, RwLock,
    },
    time::{Duration, Instant},
};

use file_access::{
    disk::{normalize_asked, CheckedDir},
    Access,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::entry::FileEntry;
use super::fs_events::{self, Event};
use super::listing::{io_text, sort_entries, Lister};
use super::{asked_path, blocking, failed, person_window};

pub const EVENT: &str = "files://folder";

const DEBOUNCE: Duration = Duration::from_millis(100);
const MAX_DELAY: Duration = Duration::from_millis(500);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderChange {
    pub id: String,
    pub added: Vec<FileEntry>,
    pub changed: Vec<FileEntry>,
    pub removed: Vec<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub reset: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFolder {
    pub id: String,
    pub path: String,
    pub entries: Vec<FileEntry>,
}

type Key = (PathBuf, bool);

struct Folder {
    shown: PathBuf,
    entries: HashMap<OsString, FileEntry>,
    ready: bool,
    dirty: BTreeSet<OsString>,
    stale: bool,
    subs: Vec<String>,
}

struct Sub {
    key: Key,
    webview: String,
    window: String,
    shown: PathBuf,
}

#[derive(Default)]
struct State {
    folders: HashMap<Key, Folder>,
    subs: HashMap<String, Sub>,
    hooked: HashSet<String>,
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(Mutex::default);
static WATCHED: LazyLock<RwLock<HashSet<PathBuf>>> = LazyLock::new(RwLock::default);
static SENDER: OnceLock<mpsc::Sender<Vec<Event>>> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn state() -> std::sync::MutexGuard<'static, State> {
    STATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn fold(path: &Path) -> PathBuf {
    if cfg!(target_os = "macos") {
        PathBuf::from(path.to_string_lossy().to_lowercase())
    } else {
        path.to_path_buf()
    }
}

fn watched_add(real: &Path) {
    WATCHED
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(fold(real));
}

fn watched_remove(real: &Path) {
    WATCHED
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&fold(real));
}

pub(crate) fn take(events: &[Event]) {
    let Some(sender) = SENDER.get() else { return };
    let wanted: Vec<Event> = {
        let watched = WATCHED
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if watched.is_empty() {
            return;
        }
        events
            .iter()
            .filter(|event| {
                event.rescan
                    || watched.contains(&fold(&event.path))
                    || event
                        .path
                        .parent()
                        .is_some_and(|parent| watched.contains(&fold(parent)))
            })
            .cloned()
            .collect()
    };
    if !wanted.is_empty() {
        let _ = sender.send(wanted);
    }
}

fn started(app: &AppHandle) -> Result<(), String> {
    if SENDER.get().is_some() {
        return Ok(());
    }
    let (sender, receiver) = mpsc::channel::<Vec<Event>>();
    if SENDER.set(sender).is_err() {
        return Ok(());
    }
    let app = app.clone();
    std::thread::Builder::new()
        .name("misty-files-folders".into())
        .spawn(move || gather(receiver, &app))
        .map(drop)
        .map_err(|error| format!("Files couldn't follow folders: {error}"))
}

fn gather(receiver: mpsc::Receiver<Vec<Event>>, app: &AppHandle) {
    while let Ok(first) = receiver.recv() {
        let started = Instant::now();
        let mut batch = first;
        loop {
            let left = MAX_DELAY.saturating_sub(started.elapsed());
            if left.is_zero() {
                break;
            }
            match receiver.recv_timeout(DEBOUNCE.min(left)) {
                Ok(more) => batch.extend(more),
                Err(mpsc::RecvTimeoutError::Timeout) => break,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        }
        apply(app, &batch);
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Work {
    pub names: BTreeSet<OsString>,
    pub reset: bool,
    pub check: bool,
}

pub(crate) fn plan<'a>(
    folders: impl IntoIterator<Item = &'a PathBuf>,
    events: &[Event],
) -> BTreeMap<PathBuf, Work> {
    let mut plans = BTreeMap::new();
    for real in folders {
        let folded = fold(real);
        let mut work = Work::default();
        for event in events {
            let path = fold(&event.path);
            if folded.starts_with(&path) {
                if event.rescan {
                    work.reset = true;
                } else {
                    work.check = true;
                }
            } else if path.parent() == Some(folded.as_path()) {
                if let Some(name) = event.path.file_name() {
                    work.names.insert(name.to_owned());
                }
            }
        }
        if work != Work::default() {
            plans.insert(real.clone(), work);
        }
    }
    plans
}

#[derive(Debug, Default, PartialEq)]
pub(crate) struct Delta {
    pub added: Vec<FileEntry>,
    pub changed: Vec<FileEntry>,
    pub removed: Vec<OsString>,
}

impl Delta {
    fn is_empty(&self) -> bool {
        self.added.is_empty() && self.changed.is_empty() && self.removed.is_empty()
    }
}

pub(crate) fn diff(
    cache: &mut HashMap<OsString, FileEntry>,
    fresh: Vec<(OsString, Option<FileEntry>)>,
) -> Delta {
    let mut delta = Delta::default();
    for (name, now) in fresh {
        match (cache.get(&name), now) {
            (None, Some(entry)) => {
                delta.added.push(entry.clone());
                cache.insert(name, entry);
            }
            (Some(old), Some(entry)) => {
                if *old != entry {
                    delta.changed.push(entry.clone());
                    cache.insert(name, entry);
                }
            }
            (Some(_), None) => {
                cache.remove(&name);
                delta.removed.push(name);
            }
            (None, None) => {}
        }
    }
    delta
}

fn rebase(entry: &FileEntry, from: &Path, to: &Path) -> FileEntry {
    let mut entry = entry.clone();
    if from != to {
        entry.path = to.join(&entry.name).display().to_string();
    }
    entry
}

fn tell(app: &AppHandle, state: &State, key: &Key, delta: &Delta, reset: bool) {
    let Some(folder) = state.folders.get(key) else {
        return;
    };
    for id in &folder.subs {
        let Some(sub) = state.subs.get(id) else {
            continue;
        };
        let change = FolderChange {
            id: id.clone(),
            added: delta
                .added
                .iter()
                .map(|entry| rebase(entry, &folder.shown, &sub.shown))
                .collect(),
            changed: delta
                .changed
                .iter()
                .map(|entry| rebase(entry, &folder.shown, &sub.shown))
                .collect(),
            removed: delta
                .removed
                .iter()
                .map(|name| sub.shown.join(name).display().to_string())
                .collect(),
            reset,
        };
        let _ = app.emit_to(sub.webview.as_str(), EVENT, change);
    }
}

fn apply(app: &AppHandle, events: &[Event]) {
    let keys: Vec<Key> = state().folders.keys().cloned().collect();
    let reals: BTreeSet<PathBuf> = keys.iter().map(|(real, _)| real.clone()).collect();
    let plans = plan(reals.iter(), events);
    for key in keys {
        if let Some(work) = plans.get(&key.0) {
            refresh(app, &key, work);
        }
    }
}

fn refresh(app: &AppHandle, key: &Key, work: &Work) {
    let shown = {
        let mut state = state();
        let Some(folder) = state.folders.get_mut(key) else {
            return;
        };
        if !folder.ready {
            folder.dirty.extend(work.names.iter().cloned());
            folder.stale |= work.reset || work.check;
            return;
        }
        folder.shown.clone()
    };
    let read = CheckedDir::open(&key.0, Access::Read).and_then(|dir| {
        let lister = Lister::new(&dir, &shown, key.1)?;
        if work.reset {
            return lister.all().map(Fresh::All);
        }
        let names = work
            .names
            .iter()
            .map(|name| {
                let now = lister.one(name).ok().flatten();
                (name.clone(), now)
            })
            .collect();
        Ok(Fresh::Names(names))
    });
    let mut state = state();
    let Some(folder) = state.folders.get_mut(key) else {
        return;
    };
    match read {
        Ok(Fresh::Names(names)) => {
            let delta = diff(&mut folder.entries, names);
            if !delta.is_empty() {
                tell(app, &state, key, &delta, false);
            }
        }
        Ok(Fresh::All(all)) => {
            folder.entries = all.into_iter().collect();
            tell(app, &state, key, &Delta::default(), true);
        }
        Err(_) => {
            folder.entries.clear();
            tell(app, &state, key, &Delta::default(), true);
        }
    }
}

enum Fresh {
    Names(Vec<(OsString, Option<FileEntry>)>),
    All(Vec<(OsString, FileEntry)>),
}

fn hook(window: &tauri::Window) {
    let label = window.label().to_owned();
    if !state().hooked.insert(label.clone()) {
        return;
    }
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            close_window(&label);
        }
    });
}

fn close_window(label: &str) {
    let ids: Vec<String> = {
        let mut state = state();
        state.hooked.remove(label);
        state
            .subs
            .iter()
            .filter(|(_, sub)| sub.window == label)
            .map(|(id, _)| id.clone())
            .collect()
    };
    for id in ids {
        close(&id, None);
    }
}

fn close(id: &str, webview: Option<&str>) {
    let released = {
        let mut state = state();
        let owned = state
            .subs
            .get(id)
            .is_some_and(|sub| webview.is_none_or(|label| sub.webview == label));
        if !owned {
            return;
        }
        let Some(sub) = state.subs.remove(id) else {
            return;
        };
        let empty = state.folders.get_mut(&sub.key).is_some_and(|folder| {
            folder.subs.retain(|held| held != id);
            folder.subs.is_empty()
        });
        if empty {
            state.folders.remove(&sub.key);
        }
        let real = sub.key.0;
        let still = state.folders.keys().any(|(other, _)| *other == real);
        (!still).then_some(real)
    };
    if let Some(real) = released {
        watched_remove(&real);
        fs_events::release_folder(&real);
    }
}

fn resend(real: &Path, names: BTreeSet<OsString>, stale: bool) {
    let Some(sender) = SENDER.get() else { return };
    let mut events: Vec<Event> = names
        .into_iter()
        .map(|name| Event {
            path: real.join(name),
            rescan: false,
            id: 0,
        })
        .collect();
    if stale {
        events.push(Event {
            path: real.to_path_buf(),
            rescan: true,
            id: 0,
        });
    }
    if !events.is_empty() {
        let _ = sender.send(events);
    }
}

fn open(
    app: &AppHandle,
    asked: &Path,
    hidden: bool,
    webview: String,
    window: String,
) -> Result<(String, Vec<FileEntry>), String> {
    let shown = normalize_asked(asked).map_err(|error| failed(asked, io_text(&error)))?;
    let dir =
        CheckedDir::open(&shown, Access::Read).map_err(|error| failed(asked, io_text(&error)))?;
    let real = dir.path().to_path_buf();
    let key: Key = (real.clone(), hidden);
    started(app)?;
    let id = format!("folder-{}", NEXT_ID.fetch_add(1, Ordering::SeqCst));
    let (first, fresh_real) = {
        let mut state = state();
        let fresh_real = !state.folders.keys().any(|(other, _)| *other == real);
        let folder = state.folders.entry(key.clone()).or_insert_with(|| Folder {
            shown: shown.clone(),
            entries: HashMap::new(),
            ready: false,
            dirty: BTreeSet::new(),
            stale: false,
            subs: Vec::new(),
        });
        folder.subs.push(id.clone());
        let first = folder.ready.then(|| {
            folder
                .entries
                .values()
                .map(|entry| rebase(entry, &folder.shown, &shown))
                .collect::<Vec<_>>()
        });
        state.subs.insert(
            id.clone(),
            Sub {
                key: key.clone(),
                webview,
                window,
                shown: shown.clone(),
            },
        );
        (first, fresh_real)
    };
    if fresh_real {
        watched_add(&real);
        if let Err(error) = fs_events::hold_folder(&real) {
            eprintln!("{error}");
        }
    }
    let mut entries = match first {
        Some(entries) => entries,
        None => {
            let listed = Lister::new(&dir, &shown, hidden).and_then(|lister| lister.all());
            let listed = match listed {
                Ok(listed) => listed,
                Err(error) => {
                    close(&id, None);
                    return Err(failed(asked, io_text(&error)));
                }
            };
            let mut guard = state();
            let (entries, pending) = match guard.folders.get_mut(&key) {
                Some(folder) if !folder.ready => {
                    folder.entries = listed.iter().cloned().collect();
                    folder.ready = true;
                    let dirty = std::mem::take(&mut folder.dirty);
                    let stale = std::mem::take(&mut folder.stale);
                    let entries: Vec<FileEntry> =
                        listed.into_iter().map(|(_, entry)| entry).collect();
                    (entries, Some((dirty, stale)))
                }
                Some(folder) => {
                    let entries: Vec<FileEntry> = folder
                        .entries
                        .values()
                        .map(|entry| rebase(entry, &folder.shown, &shown))
                        .collect();
                    (entries, None)
                }
                None => (listed.into_iter().map(|(_, entry)| entry).collect(), None),
            };
            drop(guard);
            if let Some((dirty, stale)) = pending {
                resend(&real, dirty, stale);
            }
            entries
        }
    };
    sort_entries(&mut entries);
    Ok((id, entries))
}

#[tauri::command]
pub async fn files_watch_open(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    path: String,
    hidden: bool,
) -> Result<OpenedFolder, String> {
    person_window(&webview)?;
    let asked = asked_path(&path)?;
    let window = webview.window();
    hook(&window);
    let webview_label = webview.label().to_owned();
    let window_label = window.label().to_owned();
    blocking(move || {
        super::trash::attach(&app);
        let (id, entries) = open(&app, &asked, hidden, webview_label, window_label)?;
        Ok(OpenedFolder { id, path, entries })
    })
    .await
}

#[tauri::command]
pub async fn files_watch_close(webview: tauri::Webview, id: String) -> Result<(), String> {
    person_window(&webview)?;
    let label = webview.label().to_owned();
    blocking(move || {
        close(&id, Some(&label));
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::files::entry::FileKind;

    fn entry(name: &str, size: u64) -> FileEntry {
        FileEntry {
            name: name.to_owned(),
            path: format!("/x/{name}"),
            kind: FileKind::File,
            size,
            modified_ms: 0,
            created_ms: 0,
            hidden: false,
            ext: None,
            link_target: None,
            tags: Vec::new(),
        }
    }

    fn event(path: &str, rescan: bool) -> Event {
        Event {
            path: PathBuf::from(path),
            rescan,
            id: 1,
        }
    }

    #[test]
    fn a_burst_names_each_changed_item_of_each_open_folder_once() {
        let folders = [PathBuf::from("/x"), PathBuf::from("/y")];
        let plans = plan(
            folders.iter(),
            &[
                event("/x/a.txt", false),
                event("/x/a.txt", false),
                event("/x/b.txt", false),
                event("/x/deep/c.txt", false),
                event("/z/d.txt", false),
            ],
        );
        assert_eq!(plans.len(), 1);
        let work = &plans[&PathBuf::from("/x")];
        assert_eq!(
            work.names.iter().collect::<Vec<_>>(),
            [&OsString::from("a.txt"), &OsString::from("b.txt")]
        );
        assert!(!work.reset && !work.check);
    }

    #[test]
    fn a_rescan_above_a_folder_resets_it_and_a_change_to_it_checks_it() {
        let folders = [PathBuf::from("/x/y"), PathBuf::from("/q")];
        let plans = plan(folders.iter(), &[event("/x", true), event("/q", false)]);
        assert!(plans[&PathBuf::from("/x/y")].reset);
        assert!(plans[&PathBuf::from("/q")].check);
        assert!(!plans[&PathBuf::from("/q")].reset);
    }

    #[test]
    fn read_again_names_become_added_changed_and_removed() {
        let mut cache: HashMap<OsString, FileEntry> = [
            (OsString::from("same"), entry("same", 1)),
            (OsString::from("grew"), entry("grew", 1)),
            (OsString::from("gone"), entry("gone", 1)),
        ]
        .into_iter()
        .collect();
        let delta = diff(
            &mut cache,
            vec![
                (OsString::from("same"), Some(entry("same", 1))),
                (OsString::from("grew"), Some(entry("grew", 2))),
                (OsString::from("gone"), None),
                (OsString::from("new"), Some(entry("new", 3))),
                (OsString::from("never"), None),
            ],
        );
        assert_eq!(delta.added, vec![entry("new", 3)]);
        assert_eq!(delta.changed, vec![entry("grew", 2)]);
        assert_eq!(delta.removed, vec![OsString::from("gone")]);
        assert_eq!(cache.len(), 3);
        assert_eq!(cache[&OsString::from("grew")].size, 2);
    }

    #[test]
    fn a_change_with_nothing_new_says_nothing() {
        let mut cache: HashMap<OsString, FileEntry> =
            [(OsString::from("a"), entry("a", 1))].into_iter().collect();
        let delta = diff(&mut cache, vec![(OsString::from("a"), Some(entry("a", 1)))]);
        assert!(delta.is_empty());
    }
}
