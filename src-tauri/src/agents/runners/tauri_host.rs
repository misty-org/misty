//! The session host inside the app: a turn's events go to the app's window,
//! which mirrors them to the server, and a permission question waits for the
//! app to get the person's answer through the server's approval card. Nobody
//! answering in time, or the app going away, is a no.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::Duration,
};

use serde_json::json;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use super::{
    events::{PermissionRequest, RunnerEvent},
    session::{BoxFuture, SessionHost},
};

/// How long a coding tool waits for the person before treating it as a no.
const ASK_WAIT: Duration = Duration::from_secs(15 * 60);

fn pending() -> &'static Mutex<HashMap<String, oneshot::Sender<bool>>> {
    static PENDING: OnceLock<Mutex<HashMap<String, oneshot::Sender<bool>>>> = OnceLock::new();
    PENDING.get_or_init(Default::default)
}

/// The app's answer to one question. Returns whether it was still open.
pub fn answer(id: &str, allow: bool) -> bool {
    match pending().lock().ok().and_then(|mut map| map.remove(id)) {
        Some(sender) => sender.send(allow).is_ok(),
        None => false,
    }
}

pub struct TauriHost {
    pub app: AppHandle,
    pub run_id: String,
}

impl SessionHost for TauriHost {
    fn emit<'a>(&'a self, events: Vec<RunnerEvent>) -> BoxFuture<'a, ()> {
        let _ = self.app.emit(
            "misty://coding-events",
            json!({"runId": self.run_id, "events": events}),
        );
        Box::pin(async {})
    }

    fn ask<'a>(
        &'a self,
        request: &'a PermissionRequest,
        action: &'static str,
    ) -> BoxFuture<'a, bool> {
        let id = format!("{}:{}", self.run_id, uuid::Uuid::new_v4());
        let (send, receive) = oneshot::channel();
        if let Ok(mut map) = pending().lock() {
            map.insert(id.clone(), send);
        }
        let _ = self.app.emit(
            "misty://coding-ask",
            json!({"id": id, "runId": self.run_id, "action": action, "request": request}),
        );
        Box::pin(async move {
            let allowed = matches!(tokio::time::timeout(ASK_WAIT, receive).await, Ok(Ok(true)));
            if let Ok(mut map) = pending().lock() {
                map.remove(&id);
            }
            allowed
        })
    }

    fn now(&self) -> i64 {
        chrono::Utc::now().timestamp()
    }
}

/// The project's GitHub remote as owner/name, from its git config, for
/// remembered pushes. Anything else reads as no remote.
pub fn github_remote(root: &std::path::Path) -> Option<String> {
    let config = std::fs::read_to_string(root.join(".git").join("config")).ok()?;
    let mut in_origin = false;
    for line in config.lines().map(str::trim) {
        if line.starts_with('[') {
            in_origin = line == "[remote \"origin\"]";
        } else if in_origin {
            if let Some(url) = line
                .strip_prefix("url")
                .map(|rest| rest.trim_start_matches([' ', '=']).trim())
            {
                let path = url
                    .strip_prefix("https://github.com/")
                    .or_else(|| url.strip_prefix("git@github.com:"))?;
                let repo = path.trim_end_matches('/').trim_end_matches(".git");
                let valid = repo.split('/').count() == 2
                    && repo
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || "-_./".contains(c));
                return valid.then(|| repo.to_owned());
            }
        }
    }
    None
}
