use std::{future::Future, pin::Pin, sync::Arc};

use tokio::{sync::mpsc, task::JoinHandle};

use crate::error::ApiResult;

use super::FileSyncFinalEvent;

pub type FileSyncRunFuture = Pin<Box<dyn Future<Output = ApiResult<bool>> + Send>>;
pub type FileSyncExecutor = Arc<dyn Fn(FileSyncFinalEvent) -> FileSyncRunFuture + Send + Sync>;

/// Serial background executor for policy-resolved sync events.
pub struct FileSyncRunner {
    sender: Option<mpsc::Sender<FileSyncFinalEvent>>,
    task: Option<JoinHandle<()>>,
}

impl FileSyncRunner {
    pub fn new() -> Self {
        Self {
            sender: None,
            task: None,
        }
    }

    pub fn running(&self) -> bool {
        self.task.as_ref().is_some_and(|task| !task.is_finished())
    }

    pub fn start(&mut self, executor: FileSyncExecutor) {
        self.stop();
        let (sender, mut receiver) = mpsc::channel::<FileSyncFinalEvent>(128);
        self.sender = Some(sender);
        self.task = Some(tokio::spawn(async move {
            while let Some(event) = receiver.recv().await {
                let _ = executor(event).await;
            }
        }));
    }

    pub async fn enqueue(&self, event: FileSyncFinalEvent) -> bool {
        let Some(sender) = &self.sender else {
            return false;
        };
        sender.send(event).await.is_ok()
    }

    pub fn try_enqueue(&self, event: FileSyncFinalEvent) -> bool {
        self.sender
            .as_ref()
            .is_some_and(|sender| sender.try_send(event).is_ok())
    }

    pub fn stop(&mut self) {
        self.sender.take();
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

impl Drop for FileSyncRunner {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    #[tokio::test]
    async fn runner_executes_events_in_queue_order() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let target = seen.clone();
        let executor: FileSyncExecutor = Arc::new(move |event| {
            let target = target.clone();
            Box::pin(async move {
                target
                    .lock()
                    .expect("seen lock")
                    .push(event.pending_event.key);
                Ok(true)
            })
        });
        let mut runner = FileSyncRunner::new();
        runner.start(executor);
        for key in ["one", "two", "three"] {
            let mut event = FileSyncFinalEvent::default();
            event.pending_event.key = key.into();
            assert!(runner.enqueue(event).await);
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert_eq!(
            *seen.lock().expect("seen lock"),
            vec!["one", "two", "three"]
        );
        runner.stop();
    }
}
