// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Keeps the index current from the system's file events, so a created, renamed or deleted file
//! is found (or not) right away instead of at the next walk, which stays the safety net for
//! anything the events miss. Files' own changes come in the same way (`note_*`), without waiting
//! for the system to report them.
//!
//! The home folder is watched recursively. Events are gathered until they go quiet and applied as
//! one update, so a large copy costs a few commits, not one per file.
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    sync::{mpsc, Weak},
    time::{Duration, Instant},
};

use file_access::{
    disk::{check_disk, fs_disk},
    Access,
};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use super::filter::ScanFilter;
use super::Service;

const DEBOUNCE: Duration = Duration::from_millis(100);
const MAX_DELAY: Duration = Duration::from_secs(1);
const RETRY: Duration = Duration::from_millis(500);

pub(super) enum Signal {
    Changed(PathBuf),
    Rescan(PathBuf),
}

pub(super) struct IndexWatch {
    _watcher: RecommendedWatcher,
    sender: mpsc::Sender<Signal>,
}

impl IndexWatch {
    pub(super) fn start(service: Weak<Service>, home: &Path) -> Result<Self, String> {
        let failed = |error: &dyn std::fmt::Display| {
            format!("The search index can't follow changes: {error}")
        };
        check_disk(home, Access::Read).map_err(|error| failed(&error))?;
        let paths = PathMap::new(home);
        let filter = ScanFilter::new(home);
        let (sender, receiver) = mpsc::channel::<Signal>();
        let events = sender.clone();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                let Ok(event) = event else { return };
                if matches!(event.kind, EventKind::Access(_)) {
                    return;
                }
                let rescan = event.need_rescan();
                if rescan && event.paths.is_empty() {
                    let _ = events.send(Signal::Rescan(paths.home.clone()));
                }
                for path in event.paths.iter().filter_map(|path| paths.indexed(path)) {
                    if filter.reach(&path).is_none() {
                        continue;
                    }
                    let _ = events.send(if rescan {
                        Signal::Rescan(path)
                    } else {
                        Signal::Changed(path)
                    });
                }
            })
            .map_err(|error| failed(&error))?;
        watcher
            .watch(home, RecursiveMode::Recursive)
            .map_err(|error| failed(&error))?;
        std::thread::Builder::new()
            .name("misty-files-index-watch".into())
            .spawn(move || apply_batches(receiver, service))
            .map_err(|error| failed(&error))?;
        Ok(Self {
            _watcher: watcher,
            sender,
        })
    }

    pub(super) fn note(&self, path: &Path) {
        let _ = self.sender.send(Signal::Changed(path.to_path_buf()));
    }
}

fn apply_batches(receiver: mpsc::Receiver<Signal>, service: Weak<Service>) {
    let mut changed = BTreeSet::new();
    let mut rescan = BTreeSet::new();
    loop {
        let waiting = changed.is_empty() && rescan.is_empty();
        let first = if waiting {
            match receiver.recv() {
                Ok(signal) => Some(signal),
                Err(_) => return,
            }
        } else {
            match receiver.recv_timeout(RETRY) {
                Ok(signal) => Some(signal),
                Err(mpsc::RecvTimeoutError::Timeout) => None,
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
        };
        if let Some(signal) = first {
            let started = Instant::now();
            let mut add = |signal| match signal {
                Signal::Changed(path) => changed.insert(path),
                Signal::Rescan(path) => rescan.insert(path),
            };
            add(signal);
            loop {
                let remaining = MAX_DELAY.saturating_sub(started.elapsed());
                if remaining.is_zero() {
                    break;
                }
                match receiver.recv_timeout(DEBOUNCE.min(remaining)) {
                    Ok(signal) => {
                        add(signal);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
        }
        let Some(service) = service.upgrade() else {
            return;
        };
        let paths: Vec<PathBuf> = changed.iter().cloned().collect();
        let folders: Vec<PathBuf> = rescan.iter().cloned().collect();
        match service.apply(&paths, &folders) {
            None => continue,
            Some(Err(error)) => eprintln!("Files' search index couldn't take a change: {error}"),
            Some(Ok(())) => {}
        }
        changed.clear();
        rescan.clear();
    }
}

struct PathMap {
    real: PathBuf,
    home: PathBuf,
}

impl PathMap {
    fn new(home: &Path) -> Self {
        Self {
            real: fs_disk::canonicalize(home).unwrap_or_else(|_| home.to_path_buf()),
            home: home.to_path_buf(),
        }
    }

    fn indexed(&self, path: &Path) -> Option<PathBuf> {
        if let Ok(relative) = path.strip_prefix(&self.real) {
            Some(self.home.join(relative))
        } else if path.starts_with(&self.home) {
            Some(path.to_path_buf())
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_paths_map_back_to_the_indexed_home() {
        let map = PathMap {
            real: PathBuf::from("/private/var/home"),
            home: PathBuf::from("/var/home"),
        };
        assert_eq!(
            map.indexed(Path::new("/private/var/home/a/b.txt")),
            Some(PathBuf::from("/var/home/a/b.txt"))
        );
        assert_eq!(
            map.indexed(Path::new("/var/home/c.txt")),
            Some(PathBuf::from("/var/home/c.txt"))
        );
        assert_eq!(map.indexed(Path::new("/private/var/other")), None);
    }
}
