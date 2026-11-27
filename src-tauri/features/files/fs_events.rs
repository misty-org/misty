//! The one stream of the system's file events that Files keeps: on macOS a single FSEvents stream
//! (item-level events, resumable from an event id), elsewhere `notify`'s own watcher. It follows
//! every folder open in a window (`watch`) and the home folder while the search index runs
//! (`search`), and hands each burst to both. When the set of followed places changes, the stream
//! is made again from the last event it saw, so nothing in between is missed. While the index runs,
//! the stream leaves out the busy areas the index never reads (Misty's own data, most of
//! `~/Library`, the Trash), unless a window shows a folder there.
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        LazyLock, Mutex,
    },
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Event {
    pub path: PathBuf,
    pub rescan: bool,
    pub id: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Root {
    pub path: PathBuf,
    pub recursive: bool,
}

pub(crate) const RESUMES: bool = cfg!(target_os = "macos");

#[derive(Default)]
struct Hub {
    folders: HashMap<PathBuf, usize>,
    index: Option<PathBuf>,
    resume: Option<u64>,
    watching: Vec<Root>,
    quieted: Vec<PathBuf>,
    stream: Option<backend::Stream>,
}

const QUIET_LIMIT: usize = 8;

fn quiet_areas(home: &Path) -> Vec<PathBuf> {
    let library = home.join("Library");
    let mut areas: Vec<PathBuf> = file_access::paths::misty_root_dir().into_iter().collect();
    areas.extend(
        [
            "Caches",
            "Application Support",
            "Containers",
            "Group Containers",
            "Logs",
            "Developer",
        ]
        .iter()
        .map(|name| library.join(name)),
    );
    areas.push(home.join(".Trash"));
    areas
}

static HUB: LazyLock<Mutex<Hub>> = LazyLock::new(Mutex::default);
static LAST: AtomicU64 = AtomicU64::new(0);

fn hub() -> std::sync::MutexGuard<'static, Hub> {
    HUB.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn minimal(roots: Vec<Root>) -> Vec<Root> {
    let mut merged: HashMap<PathBuf, bool> = HashMap::new();
    for root in roots {
        *merged.entry(root.path).or_default() |= root.recursive;
    }
    let mut all: Vec<Root> = merged
        .into_iter()
        .map(|(path, recursive)| Root { path, recursive })
        .collect();
    all.sort_by(|a, b| a.path.cmp(&b.path));
    let mut kept: Vec<Root> = Vec::new();
    for root in all {
        let covered = kept
            .iter()
            .any(|outer| (outer.recursive || RESUMES) && root.path.starts_with(&outer.path));
        if !covered {
            kept.push(root);
        }
    }
    kept
}

impl Hub {
    fn wanted(&self) -> Vec<Root> {
        let folders = self.folders.keys().map(|path| Root {
            path: path.clone(),
            recursive: false,
        });
        let index = self.index.iter().map(|path| Root {
            path: path.clone(),
            recursive: true,
        });
        minimal(folders.chain(index).collect())
    }

    fn quiet(&self) -> Vec<PathBuf> {
        let Some(home) = &self.index else {
            return Vec::new();
        };
        quiet_areas(home)
            .into_iter()
            .filter(|area| area.starts_with(home) && area != home)
            .filter(|area| {
                !self
                    .folders
                    .keys()
                    .any(|folder| folder.starts_with(area) || area.parent() == Some(folder.as_path()))
            })
            .take(QUIET_LIMIT)
            .collect()
    }

    fn refresh(&mut self) -> Result<(), String> {
        let wanted = self.wanted();
        let quiet = self.quiet();
        if wanted == self.watching
            && quiet == self.quieted
            && self.stream.is_some() != wanted.is_empty()
            && self.resume.is_none()
        {
            return Ok(());
        }
        self.stream = None;
        self.watching = wanted.clone();
        self.quieted = quiet.clone();
        if wanted.is_empty() {
            return Ok(());
        }
        let last = LAST.load(Ordering::SeqCst);
        let since = self.resume.take().or((last != 0).then_some(last));
        self.stream = Some(backend::Stream::start(&wanted, &quiet, since)?);
        Ok(())
    }
}

pub(crate) fn hold_folder(real: &Path) -> Result<(), String> {
    let mut hub = hub();
    *hub.folders.entry(real.to_path_buf()).or_default() += 1;
    hub.refresh()
}

pub(crate) fn release_folder(real: &Path) {
    let mut hub = hub();
    let last = hub.folders.get_mut(real).is_some_and(|count| {
        *count = count.saturating_sub(1);
        *count == 0
    });
    if last {
        hub.folders.remove(real);
        if let Err(error) = hub.refresh() {
            eprintln!("{error}");
        }
    }
}

pub(crate) fn follow_index(root: Option<PathBuf>, resume: Option<u64>) -> Result<(), String> {
    let mut hub = hub();
    hub.index = root;
    hub.resume = if hub.index.is_some() { resume } else { None };
    hub.refresh()
}

pub(crate) fn current_id() -> u64 {
    backend::current_id()
}

fn deliver(events: Vec<Event>) {
    super::watch::take(&events);
    super::search::take(events);
}

#[cfg(target_os = "macos")]
mod backend {
    use std::{
        ffi::{c_char, c_void, CStr, OsStr},
        os::unix::ffi::OsStrExt,
        path::PathBuf,
        ptr::NonNull,
        sync::atomic::Ordering,
    };

    use dispatch2::{DispatchQueue, DispatchRetained};
    use objc2_core_foundation::{CFArray, CFRetained, CFString};
    use objc2_core_services::{
        kFSEventStreamCreateFlagFileEvents, kFSEventStreamCreateFlagNoDefer,
        kFSEventStreamCreateFlagWatchRoot, kFSEventStreamEventFlagEventIdsWrapped,
        kFSEventStreamEventFlagHistoryDone, kFSEventStreamEventFlagKernelDropped,
        kFSEventStreamEventFlagMount, kFSEventStreamEventFlagMustScanSubDirs,
        kFSEventStreamEventFlagRootChanged, kFSEventStreamEventFlagUnmount,
        kFSEventStreamEventFlagUserDropped, kFSEventStreamEventIdSinceNow, ConstFSEventStreamRef,
        FSEventStreamContext, FSEventStreamCreate, FSEventStreamEventFlags, FSEventStreamEventId,
        FSEventStreamInvalidate, FSEventStreamRef, FSEventStreamRelease,
        FSEventStreamSetDispatchQueue, FSEventStreamSetExclusionPaths, FSEventStreamStart,
        FSEventStreamStop,
        FSEventsGetCurrentEventId,
    };

    use super::{deliver, Event, Root, LAST};

    const LATENCY: f64 = 0.05;
    const RESCAN: u32 = kFSEventStreamEventFlagMustScanSubDirs
        | kFSEventStreamEventFlagUserDropped
        | kFSEventStreamEventFlagKernelDropped
        | kFSEventStreamEventFlagEventIdsWrapped
        | kFSEventStreamEventFlagRootChanged
        | kFSEventStreamEventFlagMount
        | kFSEventStreamEventFlagUnmount;

    pub(super) fn current_id() -> u64 {
        // SAFETY: FSEventsGetCurrentEventId takes nothing and only reads the system's counter.
        unsafe { FSEventsGetCurrentEventId() }
    }

    unsafe extern "C-unwind" fn on_events(
        _stream: ConstFSEventStreamRef,
        _info: *mut c_void,
        count: usize,
        paths: NonNull<c_void>,
        flags: NonNull<FSEventStreamEventFlags>,
        ids: NonNull<FSEventStreamEventId>,
    ) {
        let paths = paths.as_ptr().cast::<*const c_char>();
        let mut events = Vec::with_capacity(count);
        for index in 0..count {
            // SAFETY: without kFSEventStreamCreateFlagUseCFTypes FSEvents hands `count` C strings,
            // flags and ids, all valid for the length of this call.
            let (path, flag, id) = unsafe {
                (
                    CStr::from_ptr(*paths.add(index)),
                    *flags.as_ptr().add(index),
                    *ids.as_ptr().add(index),
                )
            };
            if flag & kFSEventStreamEventFlagHistoryDone != 0 {
                continue;
            }
            LAST.fetch_max(id, Ordering::SeqCst);
            events.push(Event {
                path: PathBuf::from(OsStr::from_bytes(path.to_bytes())),
                rescan: flag & RESCAN != 0,
                id,
            });
        }
        if !events.is_empty() {
            deliver(events);
        }
    }

    pub(super) struct Stream {
        raw: FSEventStreamRef,
        _queue: DispatchRetained<DispatchQueue>,
    }

    // SAFETY: an FSEvents stream may be stopped and released from any thread, and this one is
    // only touched by its owner under the hub's lock.
    unsafe impl Send for Stream {}

    impl Stream {
        pub(super) fn start(
            roots: &[Root],
            quiet: &[PathBuf],
            since: Option<u64>,
        ) -> Result<Self, String> {
            let names: Vec<CFRetained<CFString>> = roots
                .iter()
                .map(|root| CFString::from_str(&root.path.to_string_lossy()))
                .collect();
            let array = CFArray::from_retained_objects(&names);
            let mut context = FSEventStreamContext {
                version: 0,
                info: std::ptr::null_mut(),
                retain: None,
                release: None,
                copyDescription: None,
            };
            let flags = kFSEventStreamCreateFlagFileEvents
                | kFSEventStreamCreateFlagNoDefer
                | kFSEventStreamCreateFlagWatchRoot;
            // SAFETY: the callback matches FSEventStreamCallback, the context outlives the call
            // (FSEvents copies it), and the array holds CFStrings as FSEvents expects.
            let raw = unsafe {
                FSEventStreamCreate(
                    None,
                    Some(on_events),
                    &mut context,
                    array.as_opaque(),
                    since.unwrap_or(kFSEventStreamEventIdSinceNow),
                    LATENCY,
                    flags,
                )
            };
            if raw.is_null() {
                return Err("Files couldn't follow changes on the disk.".into());
            }
            if !quiet.is_empty() {
                let excluded: Vec<CFRetained<CFString>> = quiet
                    .iter()
                    .map(|path| CFString::from_str(&path.to_string_lossy()))
                    .collect();
                let excluded = CFArray::from_retained_objects(&excluded);
                // SAFETY: raw is a stream just created and not yet started, and the array holds
                // CFStrings of absolute paths, as FSEventStreamSetExclusionPaths expects.
                unsafe { FSEventStreamSetExclusionPaths(raw, excluded.as_opaque()) };
            }
            let queue = DispatchQueue::new("com.misty.files.events", None);
            // SAFETY: raw is a stream just created and not yet started; the queue lives as long as
            // the stream, which is stopped and released in Drop before the queue goes.
            let started = unsafe {
                FSEventStreamSetDispatchQueue(raw, Some(&*queue));
                FSEventStreamStart(raw)
            };
            if !started {
                // SAFETY: raw is valid, never started, and released exactly once here.
                unsafe {
                    FSEventStreamInvalidate(raw);
                    FSEventStreamRelease(raw);
                }
                return Err("Files couldn't follow changes on the disk.".into());
            }
            Ok(Self { raw, _queue: queue })
        }
    }

    impl Drop for Stream {
        fn drop(&mut self) {
            // SAFETY: raw was started in `start` and is stopped, invalidated and released once.
            unsafe {
                FSEventStreamStop(self.raw);
                FSEventStreamInvalidate(self.raw);
                FSEventStreamRelease(self.raw);
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod backend {
    use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};

    use super::{deliver, Event, Root};

    pub(super) fn current_id() -> u64 {
        0
    }

    pub(super) struct Stream {
        _watcher: RecommendedWatcher,
    }

    impl Stream {
        pub(super) fn start(
            roots: &[Root],
            _quiet: &[std::path::PathBuf],
            _since: Option<u64>,
        ) -> Result<Self, String> {
            let failed = |error: notify::Error| {
                format!("Files couldn't follow changes on the disk: {error}")
            };
            let all: Vec<Root> = roots.to_vec();
            let rescan_all = move || {
                deliver(
                    all.iter()
                        .map(|root| Event {
                            path: root.path.clone(),
                            rescan: true,
                            id: 0,
                        })
                        .collect(),
                )
            };
            let mut watcher =
                notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                    let event = match event {
                        Ok(event) => event,
                        Err(_) => return rescan_all(),
                    };
                    if matches!(event.kind, EventKind::Access(_)) {
                        return;
                    }
                    let rescan = event.need_rescan();
                    if rescan && event.paths.is_empty() {
                        return rescan_all();
                    }
                    let events: Vec<Event> = event
                        .paths
                        .into_iter()
                        .map(|path| Event {
                            path,
                            rescan,
                            id: 0,
                        })
                        .collect();
                    if !events.is_empty() {
                        deliver(events);
                    }
                })
                .map_err(failed)?;
            for root in roots {
                let mode = if root.recursive {
                    RecursiveMode::Recursive
                } else {
                    RecursiveMode::NonRecursive
                };
                watcher.watch(&root.path, mode).map_err(failed)?;
            }
            Ok(Self { _watcher: watcher })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn root(path: &str, recursive: bool) -> Root {
        Root {
            path: PathBuf::from(path),
            recursive,
        }
    }

    #[test]
    fn places_inside_a_followed_tree_share_its_stream() {
        let kept = minimal(vec![
            root("/home/me/Documents", false),
            root("/home/me", true),
            root("/Volumes/Disk", false),
            root("/Volumes/Disk", false),
        ]);
        assert_eq!(
            kept,
            vec![root("/Volumes/Disk", false), root("/home/me", true)]
        );
    }

    #[test]
    fn the_index_skips_quiet_areas_unless_a_window_shows_one() {
        let mut hub = Hub {
            index: Some(PathBuf::from("/home/me")),
            ..Hub::default()
        };
        let caches = PathBuf::from("/home/me/Library/Caches");
        assert!(hub.quiet().contains(&caches));
        assert!(hub.quiet().len() <= QUIET_LIMIT);
        hub.folders.insert(caches.join("app"), 1);
        assert!(!hub.quiet().contains(&caches));
        hub.folders.clear();
        hub.folders.insert(PathBuf::from("/home/me/Library"), 1);
        assert!(!hub.quiet().contains(&caches));
        hub.index = None;
        assert!(hub.quiet().is_empty());
    }
}
