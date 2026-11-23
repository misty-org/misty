use std::{
    collections::HashMap,
    future::Future,
    sync::{Mutex, MutexGuard, PoisonError},
};

use tokio::sync::oneshot;

#[derive(Default)]
struct Hooks {
    waiting: HashMap<String, oneshot::Sender<bool>>,
    early: HashMap<String, bool>,
}

#[derive(Default)]
pub(crate) struct DeviceHooks(Mutex<Hooks>);

fn run_of(token: &str) -> Option<&str> {
    token.strip_prefix("misty-device:")?.split(':').next()
}

impl DeviceHooks {
    fn hooks(&self) -> MutexGuard<'_, Hooks> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn create(&self, token: &str) -> impl Future<Output = bool> + Send + 'static {
        let mut hooks = self.hooks();
        let early = hooks.early.remove(token);
        let (sender, receiver) = oneshot::channel();
        if early.is_none() {
            hooks.waiting.insert(token.to_owned(), sender);
        }
        async move {
            match early {
                Some(available) => available,
                None => receiver.await.unwrap_or(false),
            }
        }
    }

    pub(crate) fn resume(
        &self,
        token: &str,
        available: bool,
        run_live: impl Fn(&str) -> bool,
    ) -> bool {
        let mut hooks = self.hooks();
        if let Some(waiter) = hooks.waiting.remove(token) {
            return waiter.send(available).is_ok();
        }
        if run_of(token).is_some_and(run_live) {
            hooks.early.insert(token.to_owned(), available);
            return true;
        }
        false
    }

    pub(crate) fn forget_run(&self, run_id: &str) {
        let mut hooks = self.hooks();
        hooks
            .waiting
            .retain(|token, _| run_of(token) != Some(run_id));
        hooks.early.retain(|token, _| run_of(token) != Some(run_id));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "misty-device:run_1:call:wait:0";

    #[tokio::test]
    async fn answers_a_waiter() {
        let hooks = DeviceHooks::default();
        let wait = hooks.create(TOKEN);
        assert!(hooks.resume(TOKEN, true, |_| false));
        assert!(wait.await);
        assert!(!hooks.resume(TOKEN, true, |_| false));
    }

    #[tokio::test]
    async fn keeps_an_early_answer_for_a_live_run_and_refuses_others() {
        let hooks = DeviceHooks::default();
        assert!(!hooks.resume(TOKEN, false, |_| false));
        assert!(hooks.resume(TOKEN, false, |run| run == "run_1"));
        assert!(!hooks.create(TOKEN).await);
    }

    #[tokio::test]
    async fn a_forgotten_wait_reads_as_unavailable() {
        let hooks = DeviceHooks::default();
        let wait = hooks.create(TOKEN);
        hooks.forget_run("run_1");
        assert!(!wait.await);
    }
}
