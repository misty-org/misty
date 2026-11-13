//! One model turn. A provider outage (`runtime_errors.rs`) is waited out, 30 s doubling to 4 min, and
//! the same turn tried again; the wait doesn't spend the run's time. Anything else still fails. The
//! wait is in the run's file with the time it ends, so a restart sleeps only what's left.
use std::time::Duration;

use crate::js_json::JsValue;
use crate::model_budget::{model_timeout, ExecutionBudget};
use crate::runtime_errors::{provider_outage, RuntimeError};
use crate::tool_transport::{object, string};
use crate::model_calls::Message;

use super::{
    model_call::{call_model, ModelReply},
    space_task_agent::RunLoop,
    state::{SavedBudget, Stage},
};

/// How long a run waits out each provider outage before trying the same turn again, in seconds.
const OUTAGE_WAITS: [u64; 4] = [30, 60, 120, 240];
const OUTAGE_LABELS: [&str; 4] = ["30s", "60s", "120s", "240s"];

/// Sleeps until the wall clock reaches `wake_at_ms`, however little is left.
pub(super) async fn sleep_until_ms(run: &RunLoop, wake_at_ms: i64) {
    let left = wake_at_ms - (run.shared.deps.clock)();
    if left > 0 {
        tokio::time::sleep(Duration::from_millis(left as u64)).await;
    }
}

/// `stream_turn` for a run restarted in the middle of an outage's wait.
pub(super) async fn resume_outage(run: &mut RunLoop, messages: &[Message], budget: &SavedBudget, outage: usize, wait_started_ms: i64, wake_at_ms: i64) -> Result<ModelReply, RuntimeError> {
    sleep_until_ms(run, wake_at_ms).await;
    run.state.pacing.paused_ms += (run.shared.deps.clock)() - wait_started_ms;
    stream_turn(run, messages, &budget.budget(), outage + 1).await
}

pub(super) async fn stream_turn(run: &mut RunLoop, messages: &[Message], budget: &ExecutionBudget, first_outage: usize) -> Result<ModelReply, RuntimeError> {
    let clock = run.shared.deps.clock.clone();
    let mut outage = first_outage;
    loop {
        let timeout = model_timeout(budget, clock()).map_err(|error| RuntimeError::error(error.to_string()))?;
        let error = match call_model(run, messages, timeout).await {
            Ok(reply) => return Ok(reply),
            Err(error) => error,
        };
        if outage >= OUTAGE_WAITS.len() || run.hook_failure.is_some() || !provider_outage(&error) {
            return Err(error);
        }
        run.shared.deps.logger.line(
            "provider_outage",
            &object([
                ("run", string(run.shared.identity.misty_run_id.as_str())),
                ("turn", JsValue::Number(run.state.model_turn as f64)),
                ("wait", string(OUTAGE_LABELS[outage])),
            ]),
        );
        let wait_started_ms = clock();
        let wake_at_ms = wait_started_ms + OUTAGE_WAITS[outage] as i64 * 1000;
        run.state.messages = messages.to_vec();
        run.save(Stage::Outage { outage, wait_started_ms, wake_at_ms, budget: SavedBudget::of(budget) }).await?;
        sleep_until_ms(run, wake_at_ms).await;
        run.state.pacing.paused_ms += clock() - wait_started_ms;
        outage += 1;
    }
}
