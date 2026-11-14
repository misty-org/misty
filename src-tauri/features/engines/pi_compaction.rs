//! How full pi's and omp's context is around a compaction, for the context bar.
//!
//! What each CLI says once it has compacted (both probed against a local fake provider):
//! - pi 1.5.2 ends a compaction with `compaction_end`, whose `result` carries
//!   `estimatedTokensAfter`, and its compact call answers with the same result. Its
//!   get_session_stats knows no size then (`contextUsage.tokens: null` until the next reply).
//! - omp 18.0.3's `auto_compaction_end` and compact answer carry only `tokensBefore`; the
//!   compacted size (`tokensAfter`) stays on the session entry. Its get_session_stats does count
//!   the compacted context, so `/compact` asks for it right after.
use super::EngineEvent;
use serde_json::{json, Value};

/// The get_session_stats call written after omp's `/compact`. omp runs rpc commands one at a
/// time, so its answer comes once the compaction is done.
pub(super) const COMPACT_STATS_ID: &str = "ccgui-compact-stats";

/// pi-ai's usage gives the context's size as `totalTokens`, a name the bar doesn't read, so it
/// is sent on as `used`. A failed call reports 0, which would read as "unknown", so that stays
/// out.
pub(super) fn with_context_size(mut usage: Value) -> Value {
    if usage.get("used").is_none() {
        if let Some(total) = usage
            .get("totalTokens")
            .and_then(Value::as_u64)
            .filter(|total| *total > 0)
        {
            usage["used"] = json!(total);
        }
    }
    usage
}

/// The report for a compacted context of `tokens`: the whole report, so the bar's breakdown
/// doesn't keep the old context's buckets.
fn sized(tokens: u64) -> Value {
    json!({ "input": tokens, "output": 0, "cacheRead": 0, "cacheWrite": 0, "used": tokens })
}

/// The bar's report after a compaction with this result: the size the CLI gives the compacted
/// context, or `used: 0` (unknown until the next reply) when it gives none.
pub(super) fn compacted_usage(result: &Value) -> Value {
    match ["estimatedTokensAfter", "tokensAfter"]
        .iter()
        .find_map(|name| result.get(*name).and_then(Value::as_u64))
        .filter(|tokens| *tokens > 0)
    {
        Some(tokens) => sized(tokens),
        None => json!({ "used": 0 }),
    }
}

/// The report a compaction's end event leaves, when the context changed. A cancelled or
/// skipped one, or one that failed (no result), left it as it was; omp's shake drops regions
/// without a result.
pub(super) fn compaction_end_usage(event: &Value) -> Option<Value> {
    let flag = |name: &str| event.get(name).and_then(Value::as_bool) == Some(true);
    if flag("aborted") || flag("skipped") {
        return None;
    }
    match event.get("result").filter(|result| result.is_object()) {
        Some(result) => Some(compacted_usage(result)),
        None if event.get("action").and_then(Value::as_str) == Some("shake") => {
            Some(json!({ "used": 0 }))
        }
        None => None,
    }
}

/// omp's get_session_stats answer after `/compact`: the compacted context's size, then the
/// turn's end. Live runs make no other stats call, so it's found by its command (a CLI that
/// doesn't know the command may answer without the id); a failed call still ends the turn.
pub(super) fn parse_compact_stats(line: &str, out: &mut Vec<EngineEvent>) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return false;
    };
    if value.get("type").and_then(Value::as_str) != Some("response")
        || value.get("command").and_then(Value::as_str) != Some("get_session_stats")
    {
        return false;
    }
    let context = value.pointer("/data/contextUsage");
    if let Some(tokens) = context
        .and_then(|context| context.get("tokens"))
        .and_then(Value::as_u64)
        .filter(|tokens| *tokens > 0)
    {
        let mut usage = sized(tokens);
        if let Some(window) = context
            .and_then(|context| context.get("contextWindow"))
            .and_then(Value::as_u64)
            .filter(|window| *window > 0)
        {
            usage["model_context_window"] = json!(window);
        }
        out.push(EngineEvent::Usage(usage));
    }
    out.push(EngineEvent::Done {
        session_id: None,
        usage: None,
    });
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engines::bridge::context_usage;

    fn usage_of(event: &EngineEvent) -> &Value {
        match event {
            EngineEvent::Usage(usage) => usage,
            other => panic!("not usage: {other:?}"),
        }
    }

    #[test]
    fn a_reply_reports_its_total_as_the_context_size() {
        // pi 1.5.2's message_end usage.
        let usage = json!({"input": 40000, "output": 300, "cacheRead": 0, "cacheWrite": 0,
            "reasoning": 0, "totalTokens": 40300, "cost": {"total": 0}});
        assert_eq!(context_usage(&with_context_size(usage)).0, Some(40300));
        // omp's failed attempt before a retry reports zeros; that's not an unknown size.
        let failed = json!({"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0,
            "totalTokens": 0});
        assert!(with_context_size(failed).get("used").is_none());
    }

    #[test]
    fn pi_says_how_big_the_compacted_context_is() {
        // pi 1.5.2's frame, its summary shortened.
        let end = json!({"type": "compaction_end", "reason": "manual", "result": {
            "summary": "## Goal\nSay hello.", "firstKeptEntryId": "cdf13b2b",
            "tokensBefore": 40300, "estimatedTokensAfter": 1861,
            "usage": {"input": 80000, "output": 600, "cacheRead": 0, "cacheWrite": 0,
                "totalTokens": 80600},
            "details": {"readFiles": [], "modifiedFiles": []}},
            "aborted": false, "willRetry": false});
        let usage = compaction_end_usage(&end).expect("a size");
        assert_eq!(context_usage(&usage).0, Some(1861));
        // The breakdown is the new context alone, not the summarizing call's.
        assert_eq!(usage["input"], 1861);
        assert_eq!(usage["output"], 0);

        // A failed or cancelled compaction left the context as it was.
        let failed = json!({"type": "compaction_end", "reason": "manual", "aborted": false,
            "willRetry": false, "errorMessage": "Compaction failed: Nothing to compact"});
        assert_eq!(compaction_end_usage(&failed), None);
        let mut aborted = end.clone();
        aborted["aborted"] = json!(true);
        assert_eq!(compaction_end_usage(&aborted), None);
    }

    #[test]
    fn omp_leaves_the_compacted_size_unknown() {
        // omp 18.0.3's compact answer: only the size before.
        let answer = json!({"summary": "## Goal\nSay hello.", "firstKeptEntryId": "a7bc1760",
            "tokensBefore": 40300, "details": {"readFiles": [], "modifiedFiles": []}});
        assert_eq!(context_usage(&compacted_usage(&answer)).0, Some(0));
        let end = json!({"type": "auto_compaction_end", "action": "context-full",
            "result": answer, "aborted": false, "willRetry": true});
        assert_eq!(compaction_end_usage(&end), Some(json!({"used": 0})));
        // Shake rewrites the context with no result; a skipped pass changed nothing.
        let shake = json!({"type": "auto_compaction_end", "action": "shake", "aborted": false,
            "willRetry": false});
        assert_eq!(compaction_end_usage(&shake), Some(json!({"used": 0})));
        let mut skipped = shake.clone();
        skipped["skipped"] = json!(true);
        assert_eq!(compaction_end_usage(&skipped), None);
    }

    #[test]
    fn omps_stats_after_compact_size_the_context_and_end_the_turn() {
        // omp 18.0.3's answer, the session file left out.
        let stats = json!({"id": COMPACT_STATS_ID, "type": "response",
            "command": "get_session_stats", "success": true, "data": {
            "sessionId": "01a1d92c-1cae-76f2-b13b-33e05d671e92", "userMessages": 0,
            "assistantMessages": 1, "toolCalls": 0, "toolResults": 0, "totalMessages": 3,
            "tokens": {"input": 40000, "output": 300, "reasoning": 0, "cacheRead": 0,
                "cacheWrite": 0, "total": 40300},
            "cost": 0, "premiumRequests": 0,
            "contextUsage": {"tokens": 14777, "contextWindow": 128000,
                "percent": 11.544531249999999}}});
        let mut out = Vec::new();
        assert!(parse_compact_stats(&stats.to_string(), &mut out));
        assert_eq!(
            context_usage(usage_of(&out[0])),
            (Some(14777), Some(128000))
        );
        assert!(matches!(out[1], EngineEvent::Done { .. }), "got {out:?}");

        // pi-style unknown size, or a CLI without the command: the turn still ends.
        let unknown = json!({"type": "response", "command": "get_session_stats",
            "success": false, "error": "Unknown command: get_session_stats"});
        let mut out = Vec::new();
        assert!(parse_compact_stats(&unknown.to_string(), &mut out));
        assert!(
            matches!(&out[..], [EngineEvent::Done { .. }]),
            "got {out:?}"
        );

        let other = json!({"type": "response", "command": "get_state", "success": true});
        assert!(!parse_compact_stats(&other.to_string(), &mut Vec::new()));
    }
}
