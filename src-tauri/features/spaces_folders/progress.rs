//! How far a folder's reading, upload or download has got, sent to the window that asked.

use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub(crate) const PROGRESS_EVENT: &str = "misty://space-folder-progress";
const EVERY: Duration = Duration::from_millis(150);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent<'a> {
    /// The local folder being read or uploaded, or the shared folder's id being downloaded.
    folder: &'a str,
    done: usize,
    total: usize,
    bytes_done: u64,
    bytes_total: u64,
}

pub(crate) struct Progress {
    app: AppHandle,
    window: String,
    folder: String,
    total: usize,
    bytes_total: u64,
    done: AtomicUsize,
    bytes_done: AtomicU64,
    last: Mutex<Option<Instant>>,
}

impl Progress {
    pub(crate) fn new(
        app: AppHandle,
        window: String,
        folder: String,
        total: usize,
        bytes_total: u64,
    ) -> Self {
        Self {
            app,
            window,
            folder,
            total,
            bytes_total,
            done: AtomicUsize::new(0),
            bytes_done: AtomicU64::new(0),
            last: Mutex::new(None),
        }
    }

    pub(crate) fn bytes(&self, count: u64) {
        self.bytes_done.fetch_add(count, Ordering::Relaxed);
        self.send(false);
    }

    pub(crate) fn file_done(&self) {
        self.done.fetch_add(1, Ordering::Relaxed);
        self.send(false);
    }

    /// The first and last word always go out; the ones between at most every 150 ms.
    pub(crate) fn send(&self, now: bool) {
        {
            let mut last = self.last.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if !now && last.is_some_and(|at| at.elapsed() < EVERY) {
                return;
            }
            *last = Some(Instant::now());
        }
        let event = ProgressEvent {
            folder: &self.folder,
            done: self.done.load(Ordering::Relaxed).min(self.total),
            total: self.total,
            bytes_done: self.bytes_done.load(Ordering::Relaxed).min(self.bytes_total),
            bytes_total: self.bytes_total,
        };
        let _ = self.app.emit_to(self.window.as_str(), PROGRESS_EVENT, event);
    }
}
