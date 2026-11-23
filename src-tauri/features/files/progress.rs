use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, LazyLock, Mutex,
    },
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::person_window;

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

static RUNNING: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = LazyLock::new(Mutex::default);

pub struct Op {
    app: AppHandle,
    id: String,
    label: &'static str,
    stopped: Arc<AtomicBool>,
    total: u64,
    done: u64,
    last: Instant,
}

impl Op {
    pub fn start(app: &AppHandle, id: &str, label: &'static str, total: u64) -> Self {
        let stopped = Arc::new(AtomicBool::new(false));
        RUNNING
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(id.to_owned(), stopped.clone());
        let op = Self {
            app: app.clone(),
            id: id.to_owned(),
            label,
            stopped,
            total,
            done: 0,
            last: Instant::now() - Duration::from_secs(1),
        };
        op.emit(None);
        op
    }

    pub fn cancelled(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
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
        let _ = self.app.emit(
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

#[tauri::command]
pub fn files_cancel(webview: tauri::Webview, op_id: String) -> Result<(), String> {
    person_window(&webview)?;
    if let Some(stopped) = RUNNING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(&op_id)
    {
        stopped.store(true, Ordering::SeqCst);
    }
    Ok(())
}
