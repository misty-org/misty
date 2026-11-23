use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, LazyLock, Mutex,
    },
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, EventTarget};

use super::{blocking, person_window};

pub const EVENT: &str = "files://progress";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Payload {
    op_id: String,
    label: String,
    done_bytes: u64,
    total_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    item: Option<String>,
}

#[derive(Default)]
pub struct Stop {
    stopped: AtomicBool,
    told: Mutex<Vec<mpsc::Sender<()>>>,
}

impl Stop {
    pub fn stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }

    fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        for sender in self
            .told
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .drain(..)
        {
            let _ = sender.send(());
        }
    }

    pub fn tell(&self, sender: mpsc::Sender<()>) {
        let mut told = self
            .told
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if self.stopped() {
            let _ = sender.send(());
        } else {
            told.push(sender);
        }
    }
}

static RUNNING: LazyLock<Mutex<HashMap<String, Arc<Stop>>>> = LazyLock::new(Mutex::default);
static STOPPED_EARLY: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Mutex::default);
const STOPPED_EARLY_KEPT: usize = 64;

pub struct Op {
    app: AppHandle,
    window: String,
    id: String,
    label: &'static str,
    stop: Arc<Stop>,
    total: u64,
    done: u64,
    last: Instant,
}

impl Op {
    pub fn start(app: &AppHandle, window: &str, id: &str, label: &'static str, total: u64) -> Self {
        let mut running = RUNNING
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let early = STOPPED_EARLY
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(id);
        let stop = Arc::new(Stop::default());
        if early {
            stop.stop();
        }
        running.insert(id.to_owned(), stop.clone());
        drop(running);
        let op = Self {
            app: app.clone(),
            window: window.to_owned(),
            id: id.to_owned(),
            label,
            stop,
            total,
            done: 0,
            last: Instant::now() - Duration::from_secs(1),
        };
        op.emit(None);
        op
    }

    pub fn cancelled(&self) -> bool {
        self.stop.stopped()
    }

    pub fn stop(&self) -> Arc<Stop> {
        self.stop.clone()
    }

    pub fn window(&self) -> &str {
        &self.window
    }

    pub fn set_total(&mut self, total: u64) {
        self.total = total;
    }

    pub fn advance(&mut self, bytes: u64, item: &str) {
        self.done = self.done.saturating_add(bytes);
        if self.last.elapsed() >= Duration::from_millis(100) {
            self.last = Instant::now();
            self.emit(Some(item.to_owned()));
        }
    }

    fn emit(&self, item: Option<String>) {
        let _ = self.app.emit_to(
            EventTarget::labeled(self.window.clone()),
            EVENT,
            Payload {
                op_id: self.id.clone(),
                label: self.label.to_owned(),
                done_bytes: self.done,
                total_bytes: self.total.max(self.done),
                item,
            },
        );
    }
}

impl Drop for Op {
    fn drop(&mut self) {
        self.total = self.total.max(self.done);
        self.done = self.total;
        self.emit(None);
        RUNNING
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&self.id);
    }
}

fn cancel(op_id: String) {
    let running = RUNNING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(stop) = running.get(&op_id) {
        stop.stop();
        return;
    }
    let mut early = STOPPED_EARLY
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if early.len() >= STOPPED_EARLY_KEPT {
        early.clear();
    }
    early.insert(op_id);
}

#[tauri::command]
pub async fn files_cancel(webview: tauri::Webview, op_id: String) -> Result<(), String> {
    person_window(&webview)?;
    blocking(move || {
        cancel(op_id);
        Ok(())
    })
    .await
}
