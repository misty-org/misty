//! How long a model call may run, and how many turns a run gets.
use chrono::DateTime;
use serde::Deserialize;
use thiserror::Error;

use super::js_json::JsValue;
use crate::sdk::Usage;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub(crate) struct ExecutionBudget {
    pub(crate) version: u32,
    /// `None` when the control plane sent no number, which makes the budget invalid.
    pub(crate) remaining_ms: Option<f64>,
    pub(crate) active: bool,
    pub(crate) deadline: Option<String>,
}

#[derive(Clone, Copy, Debug, Error, PartialEq)]
pub(crate) enum BudgetError {
    #[error("invalid_execution_budget")]
    InvalidExecutionBudget,
    #[error("agent_execution_time_limit")]
    ExecutionTimeLimit,
    #[error("invalid_model_turn_limit")]
    InvalidModelTurnLimit,
}

/// The most execution Misty grants a run: four hours for a development eval, 30 minutes otherwise
/// (Go's evalExecutionLimitMS).
const MAX_EXECUTION_MS: f64 = (4 * 60 * 60_000) as f64;
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

fn is_safe_integer(value: f64) -> bool {
    value.fract() == 0.0 && value.abs() <= MAX_SAFE_INTEGER
}

/// `now_ms` is the current time in milliseconds since the epoch.
pub(crate) fn model_timeout(budget: &ExecutionBudget, now_ms: i64) -> Result<i64, BudgetError> {
    let deadline = budget.deadline.as_deref().and_then(|text| DateTime::parse_from_rfc3339(text).ok());
    let (Some(remaining_ms), Some(deadline)) = (budget.remaining_ms, deadline) else {
        return Err(BudgetError::InvalidExecutionBudget);
    };
    if budget.version != 1 || !budget.active || !is_safe_integer(remaining_ms) || remaining_ms > MAX_EXECUTION_MS {
        return Err(BudgetError::InvalidExecutionBudget);
    }
    let remaining = (remaining_ms as i64).min(deadline.timestamp_millis() - now_ms);
    if remaining <= 0 {
        return Err(BudgetError::ExecutionTimeLimit);
    }
    Ok(remaining)
}

/// A run's token use, as the AI SDK's `LanguageModelUsage` reports it. A field the provider didn't
/// report is `None`, which isn't the same as zero.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct ModelUsage {
    pub(crate) input_tokens: Option<u64>,
    pub(crate) output_tokens: Option<u64>,
    pub(crate) total_tokens: Option<u64>,
    pub(crate) no_cache_tokens: Option<u64>,
    pub(crate) cache_read_tokens: Option<u64>,
    pub(crate) cache_write_tokens: Option<u64>,
    pub(crate) text_tokens: Option<u64>,
    pub(crate) reasoning_tokens: Option<u64>,
}

impl From<&Usage> for ModelUsage {
    fn from(usage: &Usage) -> Self {
        let (input, output) = (usage.input_tokens.total, usage.output_tokens.total);
        Self {
            input_tokens: input,
            output_tokens: output,
            // A total exists when either side reported, as in the AI SDK's asLanguageModelUsage.
            total_tokens: (input.is_some() || output.is_some()).then(|| input.unwrap_or(0) + output.unwrap_or(0)),
            no_cache_tokens: usage.input_tokens.no_cache,
            cache_read_tokens: usage.input_tokens.cache_read,
            cache_write_tokens: usage.input_tokens.cache_write,
            text_tokens: usage.output_tokens.text,
            reasoning_tokens: usage.output_tokens.reasoning,
        }
    }
}

pub(crate) fn accumulate_model_usage(previous: Option<&ModelUsage>, next: &ModelUsage) -> ModelUsage {
    let Some(previous) = previous else {
        return next.clone();
    };
    // A total is authoritative only when every contributing call reported it. Root SDK aggregates
    // may omit details that nested visual calls do report; adding the known subset would falsely
    // contradict the per-call receipts.
    let sum = |left: Option<u64>, right: Option<u64>| Some(left? + right?);
    ModelUsage {
        input_tokens: sum(previous.input_tokens, next.input_tokens),
        output_tokens: sum(previous.output_tokens, next.output_tokens),
        total_tokens: sum(previous.total_tokens, next.total_tokens),
        no_cache_tokens: sum(previous.no_cache_tokens, next.no_cache_tokens),
        cache_read_tokens: sum(previous.cache_read_tokens, next.cache_read_tokens),
        cache_write_tokens: sum(previous.cache_write_tokens, next.cache_write_tokens),
        text_tokens: sum(previous.text_tokens, next.text_tokens),
        reasoning_tokens: sum(previous.reasoning_tokens, next.reasoning_tokens),
    }
}

/// Misty sends each run's turn limit (agent_runtime_internal.go); a context without one gets 20
/// turns. `None` is a missing field; any other value must be a whole number in range.
pub(crate) fn model_turn_limit(value: Option<&JsValue>) -> Result<i64, BudgetError> {
    match value {
        None => Ok(20),
        Some(JsValue::Number(number)) => turn_limit_number(*number),
        Some(_) => Err(BudgetError::InvalidModelTurnLimit),
    }
}

fn turn_limit_number(value: f64) -> Result<i64, BudgetError> {
    // 200 is a development eval's most (docs/agents/harness.md, Errors and budget); other runs stay below.
    if !is_safe_integer(value) || !(1.0..=200.0).contains(&value) {
        return Err(BudgetError::InvalidModelTurnLimit);
    }
    Ok(value as i64)
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, TimeZone, Utc};

    use super::*;

    fn budget(remaining_ms: f64, active: bool, deadline: Option<String>) -> ExecutionBudget {
        ExecutionBudget { version: 1, remaining_ms: Some(remaining_ms), active, deadline }
    }

    fn at(now: i64, offset_ms: i64) -> Option<String> {
        let time = Utc.timestamp_millis_opt(now).single().unwrap() + Duration::milliseconds(offset_ms);
        Some(time.to_rfc3339())
    }

    #[test]
    fn uses_the_smaller_authoritative_deadline_and_remaining_allowance() {
        let now = DateTime::parse_from_rfc3339("2026-09-07T12:00:00Z").unwrap().timestamp_millis();
        assert_eq!(model_timeout(&budget(2000.0, true, at(now, 1000)), now), Ok(1000));
        assert_eq!(model_timeout(&budget(500.0, true, at(now, 1000)), now), Ok(500));
        assert_eq!(model_timeout(&budget(500.0, true, at(now, -1)), now), Err(BudgetError::ExecutionTimeLimit));
    }

    #[test]
    fn does_not_replace_missing_or_invalid_new_budget_responses_with_an_unlimited_model_call() {
        let now = 1_788_000_000_000;
        let missing: ExecutionBudget = serde_json::from_str("{}").unwrap();
        for value in [missing, budget(10.0, false, None), budget(14_400_001.0, true, at(now, 2000))] {
            assert_eq!(model_timeout(&value, now), Err(BudgetError::InvalidExecutionBudget));
        }
    }

    #[test]
    fn rejects_invalid_turn_budgets_and_preserves_legacy_default() {
        assert_eq!(model_turn_limit(None), Ok(20));
        assert_eq!(model_turn_limit(Some(&JsValue::Number(200.0))), Ok(200));
        for value in [0.0, -1.0, 201.0, 1.5, f64::NAN, f64::INFINITY] {
            assert_eq!(model_turn_limit(Some(&JsValue::Number(value))), Err(BudgetError::InvalidModelTurnLimit));
        }
        for value in [JsValue::Null, JsValue::String("120".to_owned())] {
            assert_eq!(model_turn_limit(Some(&value)), Err(BudgetError::InvalidModelTurnLimit));
        }
    }

    fn root() -> ModelUsage {
        ModelUsage { input_tokens: Some(100), output_tokens: Some(10), total_tokens: Some(110), ..ModelUsage::default() }
    }

    fn visual() -> ModelUsage {
        ModelUsage { input_tokens: Some(200), output_tokens: Some(20), total_tokens: Some(220), cache_read_tokens: Some(150), reasoning_tokens: Some(5), ..ModelUsage::default() }
    }

    #[test]
    fn preserves_unknown_aggregate_details_across_root_and_nested_visual_calls() {
        for (first, second) in [(root(), visual()), (visual(), root())] {
            let combined = accumulate_model_usage(Some(&first), &second);
            assert_eq!(combined.input_tokens, Some(300));
            assert_eq!(combined.output_tokens, Some(30));
            assert_eq!(combined.cache_read_tokens, None);
            assert_eq!(combined.reasoning_tokens, None);
            let next = accumulate_model_usage(Some(&combined), &visual());
            assert_eq!(next.input_tokens, Some(500));
            assert_eq!(next.cache_read_tokens, None);
        }
    }

    #[test]
    fn sums_complete_usage_exactly_including_explicit_zero_detail_counters() {
        let first = ModelUsage { cache_read_tokens: Some(0), reasoning_tokens: Some(0), ..root() };
        let combined = accumulate_model_usage(Some(&first), &visual());
        assert_eq!(combined.cache_read_tokens, Some(150));
        assert_eq!(combined.reasoning_tokens, Some(5));
        assert_eq!(combined.total_tokens, Some(330));
        assert_eq!(accumulate_model_usage(None, &visual()), visual());
    }

    #[test]
    fn usage_converts_as_the_ai_sdk_does() {
        let mut usage = Usage::default();
        assert_eq!(ModelUsage::from(&usage).total_tokens, None);
        usage.input_tokens.total = Some(5);
        assert_eq!(ModelUsage::from(&usage).total_tokens, Some(5));
    }
}
