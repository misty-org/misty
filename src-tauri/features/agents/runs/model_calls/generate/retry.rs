//! Trying a call again after a passing failure. Ported from the SDK's
//! `retryWithExponentialBackoffRespectingRetryHeaders`.
use std::future::Future;
use std::time::Duration;

use crate::model_calls::error::{ModelError, RetryReason};

const INITIAL_DELAY_MS: u64 = 2_000;
const BACKOFF_FACTOR: u64 = 2;
/// The SDK's default when a caller doesn't say.
pub const DEFAULT_MAX_RETRIES: u32 = 2;

/// How long to wait before the next try. A wait the provider asked for wins when it isn't negative
/// and is either under a minute or shorter than the backoff.
pub(crate) fn delay_in_ms(error: &ModelError, backoff_ms: u64) -> u64 {
    let asked = match error {
        ModelError::Api { retry_after_ms, .. } => *retry_after_ms,
        _ => None,
    };
    match asked {
        Some(ms) if ms < 60_000 || ms < backoff_ms => ms,
        _ => backoff_ms,
    }
}

/// Runs `attempt` until it works, retries run out or a failure can't be helped by trying again.
pub async fn with_retries<T, F, Fut>(max_retries: u32, mut attempt: F) -> Result<T, ModelError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, ModelError>>,
{
    let mut errors: Vec<ModelError> = Vec::new();
    let mut delay_ms = INITIAL_DELAY_MS;
    loop {
        let error = match attempt().await {
            Ok(value) => return Ok(value),
            Err(error) => error,
        };
        if max_retries == 0 {
            return Err(error);
        }
        let message = error.to_string();
        let retryable = error.is_retryable();
        let wait_ms = delay_in_ms(&error, delay_ms);
        errors.push(error);
        let tries = errors.len();
        if tries as u64 > u64::from(max_retries) {
            return Err(ModelError::Retry {
                reason: RetryReason::MaxRetriesExceeded,
                message: format!("Failed after {tries} attempts. Last error: {message}"),
                errors,
            });
        }
        if retryable {
            tokio::time::sleep(Duration::from_millis(wait_ms)).await;
            delay_ms *= BACKOFF_FACTOR;
            continue;
        }
        if tries == 1 {
            return Err(errors.remove(0));
        }
        return Err(ModelError::Retry {
            reason: RetryReason::ErrorNotRetryable,
            message: format!("Failed after {tries} attempts with non-retryable error: '{message}'"),
            errors,
        });
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::*;

    fn api(status: u16, retry_after_ms: Option<u64>) -> ModelError {
        ModelError::Api {
            status,
            message: format!("failed with {status}"),
            retryable: status == 429 || status >= 500,
            retry_after_ms,
        }
    }

    #[test]
    fn a_requested_wait_applies_within_limits() {
        assert_eq!(delay_in_ms(&api(429, None), 2_000), 2_000);
        assert_eq!(delay_in_ms(&api(429, Some(5_000)), 2_000), 5_000, "under a minute");
        assert_eq!(delay_in_ms(&api(429, Some(0)), 2_000), 0);
        assert_eq!(delay_in_ms(&api(429, Some(59_999)), 2_000), 59_999);
        assert_eq!(delay_in_ms(&api(429, Some(60_000)), 2_000), 2_000, "a minute or more is too long");
        assert_eq!(delay_in_ms(&api(429, Some(70_000)), 80_000), 70_000, "but not if the backoff is longer");
        assert_eq!(delay_in_ms(&ModelError::Network("down".into()), 4_000), 4_000);
    }

    async fn measured<T>(future: impl Future<Output = T>) -> (T, Duration) {
        let started = tokio::time::Instant::now();
        let value = future.await;
        (value, started.elapsed())
    }

    #[tokio::test(start_paused = true)]
    async fn backoff_doubles_from_two_seconds() {
        let calls = AtomicU32::new(0);
        let (result, took) = measured(with_retries(4, || {
            let call = calls.fetch_add(1, Ordering::SeqCst);
            async move {
                if call < 4 {
                    Err(api(503, None))
                } else {
                    Ok("done")
                }
            }
        }))
        .await;
        assert_eq!(result.unwrap(), "done");
        assert_eq!(calls.load(Ordering::SeqCst), 5);
        // 2, 4, 8 and 16 seconds, which the runtime counts on to ride out a short blip.
        assert_eq!(took, Duration::from_secs(30));
    }

    #[tokio::test(start_paused = true)]
    async fn running_out_of_retries_wraps_every_failure() {
        let calls = AtomicU32::new(0);
        let (result, took) = measured(with_retries(2, || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Err::<(), _>(api(500, None)) }
        }))
        .await;
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        assert_eq!(took, Duration::from_secs(6));
        let Err(ModelError::Retry { reason, message, errors }) = result else {
            panic!("expected a retry error");
        };
        assert_eq!(reason, RetryReason::MaxRetriesExceeded);
        assert_eq!(message, "Failed after 3 attempts. Last error: failed with 500");
        assert_eq!(errors.len(), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn a_failure_that_cant_retry_stops_at_once() {
        let calls = AtomicU32::new(0);
        let (result, took) = measured(with_retries(4, || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Err::<(), _>(api(400, None)) }
        }))
        .await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(took, Duration::ZERO);
        assert!(matches!(result, Err(ModelError::Api { status: 400, .. })), "the original error");
    }

    #[tokio::test(start_paused = true)]
    async fn a_later_failure_that_cant_retry_says_how_far_it_got() {
        let calls = AtomicU32::new(0);
        let result = with_retries(4, || {
            let call = calls.fetch_add(1, Ordering::SeqCst);
            async move { Err::<(), _>(api(if call == 0 { 503 } else { 401 }, None)) }
        })
        .await;
        let Err(ModelError::Retry { reason, message, errors }) = result else {
            panic!("expected a retry error");
        };
        assert_eq!(reason, RetryReason::ErrorNotRetryable);
        assert_eq!(message, "Failed after 2 attempts with non-retryable error: 'failed with 401'");
        assert_eq!(errors.len(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn no_retries_means_the_original_error() {
        let calls = AtomicU32::new(0);
        let result = with_retries(0, || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Err::<(), _>(api(503, None)) }
        })
        .await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert!(matches!(result, Err(ModelError::Api { status: 503, .. })));
    }

    #[tokio::test(start_paused = true)]
    async fn the_providers_wait_replaces_the_backoff_for_that_try() {
        let calls = AtomicU32::new(0);
        let (result, took) = measured(with_retries(4, || {
            let call = calls.fetch_add(1, Ordering::SeqCst);
            async move {
                match call {
                    0 => Err(api(429, Some(500))),
                    1 => Err(api(503, None)),
                    _ => Ok(()),
                }
            }
        }))
        .await;
        assert!(result.is_ok());
        // The first wait is the provider's half second, and the backoff still doubled behind it.
        assert_eq!(took, Duration::from_millis(500 + 4_000));
    }
}
