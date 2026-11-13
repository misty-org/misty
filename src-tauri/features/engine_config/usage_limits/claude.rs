// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

//! Claude subscription windows from Claude Code's own `rate_limit_event` lines (stream-json
//! output), which it sends when its limits change:
//!
//! ```json
//! { "type": "rate_limit_event", "session_id": "…", "uuid": "…",
//!   "rate_limit_info": { "status": "allowed_warning", "rateLimitType": "five_hour",
//!     "resetsAt": 1793188800, "utilization": 0.82, "isUsingOverage": false,
//!     "unifiedWindows": { "five_hour": { "utilization": 0.82, "resetsAt": 1793188800 },
//!                         "seven_day": { "utilization": 0.31, "resetsAt": 1793491200 } } } }
//! ```
//!
//! `utilization` is the fraction of the window used and `resetsAt` is in epoch seconds. The
//! window ids and labels match the ones desktop-cc-gui maps from Claude's usage endpoint.

use serde_json::Value;

use super::{
    clamp_f64, timestamp_ms, LimitWindow, KIND_SESSION, KIND_WEEKLY, SESSION_WINDOW_SECONDS,
    WEEKLY_WINDOW_SECONDS,
};

/// Claude's window names: (id, kind, window seconds, label).
const WINDOWS: [(&str, &str, i64, Option<&str>); 5] = [
    ("five_hour", KIND_SESSION, SESSION_WINDOW_SECONDS, None),
    ("seven_day", KIND_WEEKLY, WEEKLY_WINDOW_SECONDS, None),
    (
        "seven_day_opus",
        KIND_WEEKLY,
        WEEKLY_WINDOW_SECONDS,
        Some("Opus"),
    ),
    (
        "seven_day_sonnet",
        KIND_WEEKLY,
        WEEKLY_WINDOW_SECONDS,
        Some("Sonnet"),
    ),
    (
        "seven_day_overage_included",
        KIND_WEEKLY,
        WEEKLY_WINDOW_SECONDS,
        Some("Included"),
    ),
];

const STATUSES: [&str; 3] = ["allowed", "allowed_warning", "rejected"];

pub(crate) struct ClaudeUpdate {
    pub windows: Vec<LimitWindow>,
    pub using_overage: bool,
}

/// The windows one event reports. `None` when it is not a rate-limit event.
pub(crate) fn parse_event(event: &Value) -> Option<ClaudeUpdate> {
    let info = match event.get("rate_limit_info") {
        Some(info) => info,
        None if event.get("type").and_then(Value::as_str) == Some("rate_limit_event") => {
            return None
        }
        None => event,
    };
    let info_value = info;
    let info = info.as_object()?;
    let status = info.get("status").and_then(Value::as_str);
    if !status.is_some_and(|s| STATUSES.contains(&s)) {
        return None;
    }
    let mut windows: Vec<LimitWindow> = Vec::new();
    if let Some(unified) = info.get("unifiedWindows").and_then(Value::as_object) {
        for (id, value) in unified {
            if let Some(window) = window(id, value, None) {
                windows.push(window);
            }
        }
    }
    if let Some(id) = info.get("rateLimitType").and_then(Value::as_str) {
        if !windows.iter().any(|w| w.id == id) {
            // The top level carries the same field names as a unified window.
            if let Some(window) = window(id, info_value, status) {
                windows.push(window);
            }
        }
    }
    windows.sort_by_key(|w| WINDOWS.iter().position(|(id, ..)| *id == w.id));
    Some(ClaudeUpdate {
        windows,
        using_overage: info
            .get("isUsingOverage")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

fn window(id: &str, value: &Value, top_status: Option<&str>) -> Option<LimitWindow> {
    let (id, kind, seconds, label) = WINDOWS.iter().find(|(known, ..)| *known == id)?;
    let fields = value.as_object();
    let get = |name: &str| fields.and_then(|f| f.get(name));
    let status = get("status")
        .and_then(Value::as_str)
        .or(top_status)
        .filter(|s| STATUSES.contains(s));
    let used_percent = get("utilization")
        .and_then(Value::as_f64)
        .filter(|u| u.is_finite())
        .map(|u| clamp_f64(u * 100.0))
        .or_else(|| (status == Some("rejected")).then_some(100.0))
        .or_else(|| {
            get("surpassedThreshold")
                .and_then(Value::as_f64)
                .filter(|t| t.is_finite())
                .map(|t| clamp_f64(t * 100.0))
        })?;
    Some(LimitWindow {
        id: (*id).to_string(),
        kind: (*kind).to_string(),
        label: label.map(str::to_string),
        used_percent,
        window_seconds: Some(*seconds),
        resets_at: get("resetsAt").and_then(timestamp_ms),
        status: status.map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_unified_windows() {
        let event = json!({
            "type": "rate_limit_event",
            "uuid": "u", "session_id": "s",
            "rate_limit_info": {
                "status": "allowed_warning",
                "rateLimitType": "five_hour",
                "resetsAt": 1_793_188_800,
                "utilization": 0.82,
                "isUsingOverage": true,
                "unifiedWindows": {
                    "seven_day": { "utilization": 0.31, "resetsAt": 1_793_491_200 },
                    "five_hour": { "utilization": 0.82, "resetsAt": 1_793_188_800, "status": "allowed_warning" },
                    "something_new": { "utilization": 0.5, "resetsAt": 1 }
                }
            }
        });
        let update = parse_event(&event).expect("parses");
        let ids: Vec<&str> = update.windows.iter().map(|w| w.id.as_str()).collect();
        assert_eq!(ids, ["five_hour", "seven_day"]);
        let five = &update.windows[0];
        assert_eq!(five.kind, "session");
        assert!((five.used_percent - 82.0).abs() < 1e-9);
        assert_eq!(five.window_seconds, Some(18_000));
        assert_eq!(five.resets_at, Some(1_793_188_800_000));
        assert_eq!(five.status.as_deref(), Some("allowed_warning"));
        assert_eq!(update.windows[1].kind, "weekly");
        assert!(update.using_overage);
    }

    #[test]
    fn maps_the_named_window_and_a_rejection() {
        let info = json!({
            "status": "rejected",
            "rateLimitType": "seven_day_opus",
            "resetsAt": 1_793_491_200
        });
        let update = parse_event(&json!({ "rate_limit_info": info })).expect("parses");
        assert_eq!(update.windows.len(), 1);
        let opus = &update.windows[0];
        assert_eq!(opus.id, "seven_day_opus");
        assert_eq!(opus.label.as_deref(), Some("Opus"));
        assert_eq!(opus.used_percent, 100.0);
        assert_eq!(opus.resets_at, Some(1_793_491_200_000));
        // The bare info object is accepted too.
        assert!(parse_event(&info).is_some());
    }

    #[test]
    fn an_allowed_window_without_a_number_is_not_guessed() {
        let update = parse_event(&json!({
            "rate_limit_info": { "status": "allowed", "rateLimitType": "five_hour", "resetsAt": 1 }
        }))
        .expect("parses");
        assert!(update.windows.is_empty());
        let threshold = parse_event(&json!({
            "rate_limit_info": { "status": "allowed_warning", "rateLimitType": "seven_day",
                                 "surpassedThreshold": 0.75 }
        }))
        .expect("parses");
        assert_eq!(threshold.windows[0].used_percent, 75.0);
    }

    #[test]
    fn ignores_other_lines() {
        assert!(parse_event(&json!({ "type": "assistant", "message": {} })).is_none());
        assert!(parse_event(&json!({ "type": "rate_limit_event" })).is_none());
        assert!(parse_event(&json!({ "rate_limit_info": { "status": "weird" } })).is_none());
        assert!(parse_event(&json!(null)).is_none());
    }
}
