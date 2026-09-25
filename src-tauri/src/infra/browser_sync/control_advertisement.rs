use misty_browser_sync::worker::{Phase, Status};
use std::{future::Future, time::Duration};
use tokio::sync::watch;

/// Control metadata is optional, but must not race enrollment. The caller owns
/// this future so locking or changing accounts cancels requests and retries.
pub(super) async fn advertise<F, E>(
    mut status: watch::Receiver<Status>,
    mut register: impl FnMut() -> F,
    retry_delay: Duration,
) where
    F: Future<Output = Result<(), E>>,
{
    loop {
        let phase = status.borrow_and_update().phase;
        match phase {
            Phase::Stopped | Phase::Attention => return,
            Phase::Ready | Phase::CatchingUp => {
                if register().await.is_ok() {
                    return;
                }
                // This does not block workspace traffic or status notifications.
                tokio::time::sleep(retry_delay).await;
            }
            _ => {
                if status.changed().await.is_err() {
                    return;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    fn status(phase: Phase) -> Status {
        Status {
            phase,
            applied_sequence: 0,
            head_sequence: 0,
            pending_changes: 0,
            issue: None,
        }
    }

    #[tokio::test]
    async fn waits_for_enrollment_and_retries_failed_advertisements() {
        let (tx, rx) = watch::channel(status(Phase::Connecting));
        let attempts = Arc::new(AtomicUsize::new(0));
        let calls = attempts.clone();
        let task = tokio::spawn(advertise(
            rx,
            move || {
                let first = calls.fetch_add(1, Ordering::SeqCst) == 0;
                async move {
                    if first {
                        Err(())
                    } else {
                        Ok(())
                    }
                }
            },
            Duration::ZERO,
        ));
        tokio::task::yield_now().await;
        assert_eq!(attempts.load(Ordering::SeqCst), 0);
        tx.send_replace(status(Phase::CatchingUp));
        tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn stopped_sessions_do_not_advertise() {
        let (_, rx) = watch::channel(status(Phase::Stopped));
        advertise(
            rx,
            || async {
                panic!("a stopped session must not register");
                #[allow(unreachable_code)]
                Ok::<_, ()>(())
            },
            Duration::ZERO,
        )
        .await;
    }
}
