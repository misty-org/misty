//! The queries running now, so the window that started one can stop it: Postgres's cancel request,
//! SQLite's interrupt.

use std::collections::HashMap;
use std::sync::LazyLock;

use parking_lot::Mutex;

pub(super) enum Stopper {
    Sqlite(rusqlite::InterruptHandle),
    Postgres(tokio_postgres::CancelToken),
}

struct Running {
    window: String,
    stopper: Stopper,
}

static RUNNING: LazyLock<Mutex<HashMap<String, Running>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub(super) fn running_key(account: &str, query_id: &str) -> String {
    format!("{account}\u{0}{query_id}")
}

/// Keeps a query stoppable while it runs.
pub(super) struct RunGuard(Option<String>);

impl RunGuard {
    pub(super) fn start(key: Option<String>, window: &str, stopper: Stopper) -> Self {
        if let Some(key) = &key {
            RUNNING.lock().insert(
                key.clone(),
                Running {
                    window: window.to_string(),
                    stopper,
                },
            );
        }
        Self(key)
    }
}

impl Drop for RunGuard {
    fn drop(&mut self) {
        if let Some(key) = self.0.take() {
            RUNNING.lock().remove(&key);
        }
    }
}

/// Stops a run that `window` started. SQLite's stops at once; a Postgres run gives back the token
/// its cancel request goes out with. Nothing for a run that has finished or isn't the window's.
pub(super) fn stop(key: &str, window: &str) -> Option<tokio_postgres::CancelToken> {
    let running = RUNNING.lock();
    let run = running.get(key).filter(|run| run.window == window)?;
    match &run.stopper {
        Stopper::Sqlite(handle) => {
            handle.interrupt();
            None
        }
        Stopper::Postgres(token) => Some(token.clone()),
    }
}
