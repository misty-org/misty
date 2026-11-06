//! A run owns one durable wait at a time. Hold its tool turn through the entire approval or device
//! continuation, including checkpoints, before starting another tool proposed in the same model
//! response. Replaying a run recreates this order.
//!
//! A stop ends the run. A pause only declines the rest of the current model response so the model
//! can plan again from what it saw. Declined calls never execute: their tool reports the declined
//! reason to the model instead. Start never fails for a declined call, because the adapter would
//! reject the whole response instead of reporting that one call.
//!
//! Concurrent calls (read-only server and provider tools, which hold no durable wait) run alongside
//! each other: each waits only for the calls before it that were not concurrent, and the next other
//! call waits for all of them.
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
    // Settles when every call before the latest non-concurrent call has finished.
    tail: Settled,
    // Concurrent calls started since the latest non-concurrent call.
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
        // The lock is never held across anything that can panic mid-update.
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
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

    /// Clears a pause once its model response has drained, before the next turn.
    pub(crate) fn resume(&self) -> bool {
        let mut state = self.state();
        if state.paused_reason.is_empty() || !state.stopped_reason.is_empty() || !state.releases.is_empty() {
            return false;
        }
        state.paused_reason.clear();
        state.declined.clear();
        true
    }

    /// The error a declined call reports instead of executing.
    pub(crate) fn declined(&self, id: &str) -> Option<String> {
        self.state().declined.get(id).cloned()
    }

    fn release(&self, id: &str) {
        if let Some(release) = self.state().releases.remove(id) {
            let _ = release.send(());
        }
    }

    /// Takes the call's place in line now, and waits for its turn when polled. A promise runs by
    /// itself and a future doesn't, so the caller has to spawn or join what this returns: whether
    /// the call was declined is only known once it has run.
    pub(crate) fn start<F, Fut>(&self, id: &str, checkpoint: F, concurrent: bool) -> impl Future<Output = Result<(), RuntimeError>> + Send + 'static
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
