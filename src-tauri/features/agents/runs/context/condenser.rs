//! One condenser interface: every way the runtime keeps a
//! transcript inside the model's window is a step with the same shape, run in order from the
//! cheapest and most cache-friendly to the most lossy. Adding a step means adding it here, not in the
//! agent loop.
use std::borrow::Cow;

use futures_util::future::{ready, BoxFuture, FutureExt};

use super::{
    context_compaction::{apply_compaction, clear_old_tool_results, estimate_input_tokens, message_bytes, plan_compaction, CLEAR_AT, COMPACT_AT, KEEP_RECENT_MESSAGES, KEEP_TOOL_RESULTS},
    prompt_cache::prune_stale_page_snapshots,
    working_set::{cut_old_results, CUT_BATCH_CHARS, KEEP_RESULTS, WORKING_TOKENS},
};
use crate::logger::process_log;
use crate::model_calls::Message;

#[derive(Clone, Copy, Debug)]
pub(crate) struct ContextPressure {
    /// Estimated input tokens for the next call.
    pub(crate) estimate: f64,
    /// The model's context window in tokens.
    pub(crate) window: f64,
}

/// The new transcript and the estimate after it.
#[derive(Debug)]
pub(crate) struct Condensed {
    pub(crate) messages: Vec<Message>,
    pub(crate) estimate: f64,
}

pub(crate) trait Condenser: Send + Sync {
    fn name(&self) -> &str;
    /// `None` leaves the transcript as it was.
    fn condense<'a>(&'a self, messages: &'a [Message], pressure: ContextPressure) -> BoxFuture<'a, Option<Condensed>>;
}

/// Writes a summary of older steps.
pub(crate) type Summarize<'s> = Box<dyn Fn(Vec<Message>) -> BoxFuture<'s, Result<String, String>> + Send + Sync + 's>;

/// Scale an estimate by how much a step shrank the transcript.
fn shrink(before: &[Message], after: &[Message], estimate: f64) -> f64 {
    estimate * (message_bytes(after) as f64 / message_bytes(before).max(1) as f64)
}

fn condensed(before: &[Message], after: Vec<Message>, estimate: f64) -> Option<Condensed> {
    let estimate = shrink(before, &after, estimate);
    Some(Condensed { messages: after, estimate })
}

/// Stale page snapshots, in batches that keep most turns cached.
pub(crate) struct StaleSnapshots;

impl Condenser for StaleSnapshots {
    fn name(&self) -> &str {
        "stale_snapshots"
    }

    fn condense<'a>(&'a self, messages: &'a [Message], pressure: ContextPressure) -> BoxFuture<'a, Option<Condensed>> {
        let (pruned, dropped) = prune_stale_page_snapshots(messages);
        let result = if dropped > 0 { condensed(messages, pruned.into_owned(), pressure.estimate) } else { None };
        ready(result).boxed()
    }
}

/// The working set (`working_set.rs`): above a fixed budget, not a share of the window, old results
/// are cut to digests and notes, so every turn stays small and fast.
pub(crate) struct WorkingSet;

impl Condenser for WorkingSet {
    fn name(&self) -> &str {
        "working_set"
    }

    fn condense<'a>(&'a self, messages: &'a [Message], pressure: ContextPressure) -> BoxFuture<'a, Option<Condensed>> {
        let result = (|| {
            if pressure.estimate <= WORKING_TOKENS {
                return None;
            }
            let (trimmed, cut) = cut_old_results(messages, KEEP_RESULTS);
            if cut == 0 || message_bytes(messages).saturating_sub(message_bytes(&trimmed)) < CUT_BATCH_CHARS {
                return None;
            }
            condensed(messages, trimmed.into_owned(), pressure.estimate)
        })();
        ready(result).boxed()
    }
}

/// Old tool results, once the transcript nears the window.
pub(crate) struct OldToolResults;

impl Condenser for OldToolResults {
    fn name(&self) -> &str {
        "old_tool_results"
    }

    fn condense<'a>(&'a self, messages: &'a [Message], pressure: ContextPressure) -> BoxFuture<'a, Option<Condensed>> {
        let result = (|| {
            if pressure.estimate <= pressure.window * CLEAR_AT {
                return None;
            }
            let (out, cleared) = clear_old_tool_results(messages, KEEP_TOOL_RESULTS);
            if cleared == 0 {
                return None;
            }
            condensed(messages, out.into_owned(), pressure.estimate)
        })();
        ready(result).boxed()
    }
}

/// How many turns pass between summaries of older steps (Webwright compacts every 20 steps).
pub(crate) const SUMMARY_EVERY_TURNS: u32 = 20;

/// A summary of older steps every [`SUMMARY_EVERY_TURNS`] turns once the transcript is past the
/// working budget: one rewrite on a schedule, then twenty turns
/// that only append, so the prompt cache holds between summaries.
pub(crate) struct PeriodicSummary<'s> {
    pub(crate) summarize: Summarize<'s>,
    pub(crate) due: Box<dyn Fn() -> bool + Send + Sync + 's>,
    pub(crate) done: Box<dyn Fn() + Send + Sync + 's>,
}

impl Condenser for PeriodicSummary<'_> {
    fn name(&self) -> &str {
        "periodic_summary"
    }

    fn condense<'a>(&'a self, messages: &'a [Message], pressure: ContextPressure) -> BoxFuture<'a, Option<Condensed>> {
        async move {
            if !(self.due)() || pressure.estimate <= WORKING_TOKENS {
                return None;
            }
            let plan = plan_compaction(messages, KEEP_RECENT_MESSAGES)?;
            match (self.summarize)(plan.older.clone()).await {
                Ok(summary) => {
                    let after = apply_compaction(&plan, &summary);
                    (self.done)();
                    condensed(messages, after, pressure.estimate)
                }
                Err(error) => {
                    process_log(&format!("periodic summary failed {error}"));
                    None
                }
            }
        }
        .boxed()
    }
}

/// A model-written summary of older steps, the last resort. A failed summary leaves the transcript
/// as it was.
pub(crate) struct SummarizedSteps<'s> {
    pub(crate) summarize: Summarize<'s>,
}

impl Condenser for SummarizedSteps<'_> {
    fn name(&self) -> &str {
        "summarized_steps"
    }

    fn condense<'a>(&'a self, messages: &'a [Message], pressure: ContextPressure) -> BoxFuture<'a, Option<Condensed>> {
        async move {
            if pressure.estimate <= pressure.window * COMPACT_AT {
                return None;
            }
            let plan = plan_compaction(messages, KEEP_RECENT_MESSAGES)?;
            match (self.summarize)(plan.older.clone()).await {
                Ok(summary) => condensed(messages, apply_compaction(&plan, &summary), pressure.estimate),
                Err(error) => {
                    process_log(&format!("context compaction failed {error}"));
                    None
                }
            }
        }
        .boxed()
    }
}

/// What the last model call measured.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Measured {
    pub(crate) input_tokens: f64,
    pub(crate) sent_bytes: usize,
    pub(crate) window: f64,
}

/// Runs the condensers in order. The estimate starts from the last call's measured input.
pub(crate) async fn condense<'a>(messages: &'a [Message], measured: Measured, condensers: &[&dyn Condenser]) -> Cow<'a, [Message]> {
    // Never below the transcript's own size: with prompt caching a provider may report only the
    // uncached part of the last input, which left every budget below its threshold and let a run's
    // context grow past 100,000 tokens.
    let floor = message_bytes(messages) as f64 / 4.0;
    let mut estimate = if measured.input_tokens > 0.0 {
        floor.max(estimate_input_tokens(measured.input_tokens, measured.sent_bytes, messages))
    } else {
        floor
    };
    let mut current = Cow::Borrowed(messages);
    for step in condensers {
        let result = step.condense(&current, ContextPressure { estimate, window: measured.window }).await;
        let Some(result) = result else {
            continue;
        };
        // Each condenser that changes the transcript costs the next call its cached prefix.
        process_log(&format!(
            "condensed {{\"step\":\"{}\",\"beforeChars\":{},\"afterChars\":{}}}",
            step.name(),
            message_bytes(&current),
            message_bytes(&result.messages)
        ));
        estimate = result.estimate;
        current = Cow::Owned(result.messages);
    }
    current
}

#[cfg(test)]
mod tests;
