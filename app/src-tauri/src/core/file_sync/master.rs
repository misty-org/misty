use std::{
    collections::HashMap,
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use tokio::sync::{watch, Mutex};

use crate::error::ApiResult;

pub type FileSyncMasterFuture = Pin<Box<dyn Future<Output = ApiResult<bool>> + Send>>;
pub type FileSyncMasterExecutor = Arc<dyn Fn(i64) -> FileSyncMasterFuture + Send + Sync>;

#[derive(Clone, Default)]
pub struct FileSyncMaster {
    jobs: Arc<Mutex<HashMap<i64, MasterJob>>>,
    next_generation: Arc<AtomicU64>,
}

struct MasterJob {
    generation: u64,
    stop: watch::Sender<bool>,
}

impl FileSyncMaster {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn start(
        &self,
        pair_id: i64,
        interval: Duration,
        executor: FileSyncMasterExecutor,
    ) -> bool {
        if pair_id <= 0 || interval.is_zero() {
            return false;
        }
        let mut jobs = self.jobs.lock().await;
        if jobs.contains_key(&pair_id) {
            return false;
        }
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed) + 1;
        let (stop_tx, mut stop_rx) = watch::channel(false);
        jobs.insert(
            pair_id,
            MasterJob {
                generation,
                stop: stop_tx,
            },
        );
        drop(jobs);

        let master = self.clone();
        tokio::spawn(async move {
            loop {
                match executor(pair_id).await {
                    Ok(true) => {}
                    Ok(false) => break,
                    Err(_) => {}
                }
                tokio::select! {
                    _ = tokio::time::sleep(interval) => {}
                    changed = stop_rx.changed() => {
                        if changed.is_err() || *stop_rx.borrow() { break; }
                    }
                }
            }
            master.remove_generation(pair_id, generation).await;
        });
        true
    }

    pub async fn stop(&self, pair_id: i64) -> bool {
        let Some(job) = self.jobs.lock().await.remove(&pair_id) else {
            return false;
        };
        let _ = job.stop.send(true);
        true
    }

    pub async fn stop_all(&self) {
        let jobs = std::mem::take(&mut *self.jobs.lock().await);
        for (_, job) in jobs {
            let _ = job.stop.send(true);
        }
    }

    pub async fn running(&self, pair_id: i64) -> bool {
        self.jobs.lock().await.contains_key(&pair_id)
    }

    pub async fn running_ids(&self) -> Vec<i64> {
        let mut ids: Vec<_> = self.jobs.lock().await.keys().copied().collect();
        ids.sort_unstable();
        ids
    }

    async fn remove_generation(&self, pair_id: i64, generation: u64) {
        let mut jobs = self.jobs.lock().await;
        if jobs
            .get(&pair_id)
            .is_some_and(|job| job.generation == generation)
        {
            jobs.remove(&pair_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    #[tokio::test]
    async fn master_deduplicates_and_stops_pair_jobs() {
        let master = FileSyncMaster::new();
        let calls = Arc::new(AtomicUsize::new(0));
        let target = calls.clone();
        let executor: FileSyncMasterExecutor = Arc::new(move |_| {
            let target = target.clone();
            Box::pin(async move {
                target.fetch_add(1, Ordering::Relaxed);
                Ok(true)
            })
        });
        assert!(
            master
                .start(7, Duration::from_millis(5), executor.clone())
                .await
        );
        assert!(!master.start(7, Duration::from_millis(5), executor).await);
        tokio::time::sleep(Duration::from_millis(12)).await;
        assert!(calls.load(Ordering::Relaxed) >= 1);
        assert!(master.stop(7).await);
        assert!(!master.running(7).await);
    }
}
