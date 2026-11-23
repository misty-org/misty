use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
};

use futures_util::{
    future::{join_all, ready, BoxFuture, Shared},
    FutureExt,
};
use tokio::sync::oneshot;

use super::runtime_errors::RuntimeError;

type Settled = Shared<BoxFuture<'static, ()>>;

struct State {
    tail: Settled,
    reads: Vec<Settled>,
    stopped_reason: String,
    paused_reason: String,
    releases: HashMap<String, oneshot::Sender<()>>,
    declined: HashMap<String, String>,
}

#[derive(Clone)]
pub(crate) struct SerialToolLifecycle {
    state: Arc<Mutex<State>>,
}

impl Default for SerialToolLifecycle {
    fn default() -> Self {
        Self {
            state: Arc::new(Mutex::new(State {
                tail: ready(()).boxed().shared(),
                reads: Vec::new(),
                stopped_reason: String::new(),
                paused_reason: String::new(),
                releases: HashMap::new(),
                declined: HashMap::new(),
            })),
        }
    }
}

impl SerialToolLifecycle {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn saved(&self) -> (String, String, HashMap<String, String>) {
        let state = self.state();
        (
            state.stopped_reason.clone(),
            state.paused_reason.clone(),
            state.declined.clone(),
        )
    }

    pub(crate) fn restored(
        stopped_reason: String,
        paused_reason: String,
        declined: HashMap<String, String>,
    ) -> Self {
        let this = Self::default();
        {
            let mut state = this.state();
            state.stopped_reason = stopped_reason;
            state.paused_reason = paused_reason;
            state.declined = declined;
        }
        this
    }

    pub(crate) fn stop(&self, reason: &str) {
        let mut state = self.state();
        if state.stopped_reason.is_empty() {
            state.stopped_reason = reason.to_owned();
        }
    }

    pub(crate) fn pause(&self, reason: &str) {
        let mut state = self.state();
        if state.stopped_reason.is_empty() && state.paused_reason.is_empty() {
            state.paused_reason = reason.to_owned();
        }
    }

    pub(crate) fn stopped_reason(&self) -> String {
        self.state().stopped_reason.clone()
    }

    pub(crate) fn resume(&self) -> bool {
        let mut state = self.state();
        if state.paused_reason.is_empty()
            || !state.stopped_reason.is_empty()
            || !state.releases.is_empty()
        {
            return false;
        }
        state.paused_reason.clear();
        state.declined.clear();
        true
    }

    pub(crate) fn declined(&self, id: &str) -> Option<String> {
        self.state().declined.get(id).cloned()
    }

    fn release(&self, id: &str) {
        if let Some(release) = self.state().releases.remove(id) {
            let _ = release.send(());
        }
    }

    pub(crate) fn start<F, Fut>(
        &self,
        id: &str,
        checkpoint: F,
        concurrent: bool,
    ) -> impl Future<Output = Result<(), RuntimeError>> + Send + 'static
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<(), RuntimeError>> + Send + 'static,
    {
        let previous = self.take_place(id, concurrent);
        let this = self.clone();
        let id = id.to_owned();
        async move {
            join_all(previous?).await;
            {
                let mut state = this.state();
                if !state.stopped_reason.is_empty() || !state.paused_reason.is_empty() {
                    let reason = if state.stopped_reason.is_empty() {
                        format!("tool_not_attempted: {}", state.paused_reason)
                    } else {
                        format!("tool_sequence_stopped: {}", state.stopped_reason)
                    };
                    state.declined.insert(id, reason);
                    return Ok(());
                }
            }
            if let Err(error) = checkpoint().await {
                this.stop("The preceding action or its checkpoint did not complete.");
                this.release(&id);
                return Err(error);
            }
            Ok(())
        }
    }

    fn take_place(&self, id: &str, concurrent: bool) -> Result<Vec<Settled>, RuntimeError> {
        let mut state = self.state();
        if state.releases.contains_key(id) {
            return Err(RuntimeError::error("duplicate_tool_call_id"));
        }
        let (release, released) = oneshot::channel::<()>();
        state.releases.insert(id.to_owned(), release);
        let done: Settled = released.map(|_| ()).boxed().shared();
        if concurrent {
            state.reads.push(done);
            return Ok(vec![state.tail.clone()]);
        }
        let mut previous = vec![state.tail.clone()];
        previous.append(&mut state.reads);
        state.tail = done;
        Ok(previous)
    }

    pub(crate) async fn finish<Fut>(&self, id: &str, checkpoint: Fut) -> Result<(), RuntimeError>
    where
        Fut: Future<Output = Result<(), RuntimeError>>,
    {
        let result = checkpoint.await;
        if result.is_err() {
            self.stop("The preceding action checkpoint could not be confirmed.");
        }
        self.release(id);
        result
    }
}

#[cfg(test)]
#[path = "serial_tool_lifecycle_tests.rs"]
mod tests;
