//! What the Workflow library did around one step: a failed step tries again a second or so later, a
//! `FatalError` doesn't, and when tries run out the run sees one fatal error that names the step.
use std::{future::Future, time::Duration};

use crate::runtime::runtime_errors::{RuntimeError, StepFailure};

/// `DEFAULT_STEP_MAX_RETRIES` in `@workflow/core`.
pub(crate) const DEFAULT_STEP_RETRIES: u32 = 3;

fn fatal(message: impl Into<String>) -> RuntimeError {
    RuntimeError::named("FatalError", message)
}

/// Runs a step until it works, it fails for good, or its tries run out.
pub(crate) async fn step<T, F, Fut>(name: &str, max_retries: u32, mut attempt: F) -> Result<T, RuntimeError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, StepFailure>>,
{
    let mut tries = 0;
    loop {
        tries += 1;
        let (message, wait_ms) = match attempt().await {
            Ok(value) => return Ok(value),
            Err(StepFailure::Fatal(message)) => return Err(fatal(message)),
            Err(StepFailure::Retryable { message, retry_after_ms }) => (message, retry_after_ms.max(1_000)),
            Err(StepFailure::Unrecognized(error)) => (error.to_string(), 1_000),
        };
        if tries > max_retries {
            let plural = if max_retries == 1 { "retry" } else { "retries" };
            return Err(fatal(format!("Step \"{name}\" failed after {max_retries} {plural}: {message}")));
        }
        tokio::time::sleep(Duration::from_millis(wait_ms)).await;
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};

    use super::*;

    #[tokio::test(start_paused = true)]
    async fn tries_again_then_names_the_step() {
        let calls = AtomicU32::new(0);
        let result: Result<(), _> = step("doStreamStep", 3, || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Err(StepFailure::Unrecognized(RuntimeError::error("Bad Gateway"))) }
        })
        .await;
        assert_eq!(calls.load(Ordering::SeqCst), 4);
        let error = result.unwrap_err();
        assert_eq!(error.name(), "FatalError");
        assert_eq!(error.to_string(), "Step \"doStreamStep\" failed after 3 retries: Bad Gateway");
    }

    #[tokio::test(start_paused = true)]
    async fn a_fatal_failure_does_not_try_again() {
        let calls = AtomicU32::new(0);
        let result: Result<(), _> = step("s", 3, || {
            calls.fetch_add(1, Ordering::SeqCst);
            async { Err(StepFailure::Fatal("agent_model_turn_limit".to_owned())) }
        })
        .await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(result.unwrap_err().to_string(), "agent_model_turn_limit");
    }

    #[tokio::test(start_paused = true)]
    async fn a_passing_failure_recovers() {
        let calls = AtomicU32::new(0);
        let result = step("s", 2, || {
            let attempt = calls.fetch_add(1, Ordering::SeqCst);
            async move {
                if attempt == 0 {
                    Err(StepFailure::Retryable { message: "busy".to_owned(), retry_after_ms: 5_000 })
                } else {
                    Ok(7)
                }
            }
        })
        .await;
        assert_eq!(result.unwrap(), 7);
    }
}
