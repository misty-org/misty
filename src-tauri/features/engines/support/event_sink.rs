// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// src-tauri/src/event_sink.rs: engine events are batched here and handed to one emitter. In
// Misty that emitter is the run bridge, not a webview.

use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const FLUSH_INTERVAL: Duration = Duration::from_millis(32);
// Chat already coalesces updates per animation frame and budgets Markdown
// parsing separately. Keep IPC batching, but don't add two frames of waiting.
const CHAT_FLUSH_INTERVAL: Duration = Duration::from_millis(16);
const FLUSH_BYTES: usize = 64 * 1024;

pub const ENGINE_EVENT_NAME: &str = "engine://event";

pub const SESSIONS_CHANGED_EVENT: &str = "sessions://changed";
pub const SCAN_PROGRESS_EVENT: &str = "scan://progress";

/// History-scan progress for the status bar; `finished` marks the last event
/// of a scan run.
#[derive(serde::Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub done: usize,
    pub total: usize,
    pub finished: bool,
}

/// Events are serialized once at push time; flush then only joins the cached
/// byte strings into a JSON array (previously every event serialized twice).
struct Pending {
    events: Vec<String>,
    bytes: usize,
    scheduled: bool,
}

/// Runtime-agnostic event emitter so tests can drive the mock runtime.
/// Payloads arrive as pre-serialized JSON text.
pub trait Emit: Send + Sync {
    fn emit_json(&self, name: &str, raw_json: &str);
}

pub struct EventSink {
    emitter: Arc<dyn Emit>,
    name: &'static str,
    inner: Mutex<Pending>,
    flush_interval: Duration,
}

impl EventSink {
    pub fn new(emitter: Arc<dyn Emit>) -> Arc<Self> {
        Self::with_interval(emitter, ENGINE_EVENT_NAME, CHAT_FLUSH_INTERVAL)
    }

    /// Batched sink emitting under a custom event name (e.g. terminal output).
    pub fn with_name(emitter: Arc<dyn Emit>, name: &'static str) -> Arc<Self> {
        Self::with_interval(emitter, name, FLUSH_INTERVAL)
    }

    fn with_interval(
        emitter: Arc<dyn Emit>,
        name: &'static str,
        flush_interval: Duration,
    ) -> Arc<Self> {
        Arc::new(Self {
            emitter,
            name,
            flush_interval,
            inner: Mutex::new(Pending {
                events: Vec::new(),
                bytes: 0,
                scheduled: false,
            }),
        })
    }

    pub fn push(self: &Arc<Self>, event: Value) {
        let Ok(json) = serde_json::to_string(&event) else {
            return;
        };
        let mut flush_now = false;
        {
            let mut pending = match self.inner.lock() {
                Ok(p) => p,
                Err(poisoned) => poisoned.into_inner(),
            };
            pending.bytes += json.len();
            pending.events.push(json);
            if pending.bytes >= FLUSH_BYTES {
                flush_now = true;
            } else if !pending.scheduled {
                pending.scheduled = true;
                let this = Arc::clone(self);
                tokio::spawn(async move {
                    tokio::time::sleep(this.flush_interval).await;
                    this.flush();
                });
            }
        }
        if flush_now {
            self.flush();
        }
    }

    pub fn flush(&self) {
        let events: Vec<String> = {
            let mut pending = match self.inner.lock() {
                Ok(p) => p,
                Err(poisoned) => poisoned.into_inner(),
            };
            if pending.events.is_empty() {
                pending.scheduled = false;
                return;
            }
            pending.bytes = 0;
            pending.scheduled = false;
            std::mem::take(&mut pending.events)
        };
        let payload = format!("[{}]", events.join(","));
        self.emitter.emit_json(self.name, &payload);
    }

    /// Non-batched immediate emit for low-frequency signals.
    pub fn emit_sessions_changed(&self) {
        self.emitter.emit_json(SESSIONS_CHANGED_EVENT, "null");
    }
    /// Non-batched immediate emit; the scan loop self-throttles.
    pub fn emit_scan_progress(&self, progress: ScanProgress) {
        if let Ok(json) = serde_json::to_string(&progress) {
            self.emitter.emit_json(SCAN_PROGRESS_EVENT, &json);
        }
    }
}
