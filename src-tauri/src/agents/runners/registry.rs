//! The coding tools running on this device, by run. Canceling a run, or
//! quitting Misty, stops its tool and everything the tool started.
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

use tokio::sync::oneshot;

/// A running tool: dropping or firing `stop` ends it.
pub struct RunningTool {
    stop: Option<oneshot::Sender<()>>,
}

fn running() -> &'static Mutex<HashMap<String, RunningTool>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, RunningTool>>> = OnceLock::new();
    RUNNING.get_or_init(Default::default)
}

/// Records a run's tool. Returns the receiver its session waits on to stop,
/// or None when this run already has a tool running.
pub fn register(run_id: &str) -> Option<oneshot::Receiver<()>> {
    let mut map = running().lock().ok()?;
    if map.contains_key(run_id) {
        return None;
    }
    let (send, receive) = oneshot::channel();
    map.insert(run_id.to_owned(), RunningTool { stop: Some(send) });
    Some(receive)
}

/// Forgets a finished run.
pub fn finish(run_id: &str) {
    if let Ok(mut map) = running().lock() {
        map.remove(run_id);
    }
}

/// Stops one run's tool. Returns whether it was running.
pub fn stop(run_id: &str) -> bool {
    let tool = running().lock().ok().and_then(|mut map| map.remove(run_id));
    match tool {
        Some(mut tool) => {
            if let Some(stop) = tool.stop.take() {
                let _ = stop.send(());
            }
            true
        }
        None => false,
    }
}

/// Stops every tool, when Misty quits.
pub fn stop_all() {
    let ids: Vec<String> = running()
        .lock()
        .map(|map| map.keys().cloned().collect())
        .unwrap_or_default();
    for id in ids {
        stop(&id);
    }
}
