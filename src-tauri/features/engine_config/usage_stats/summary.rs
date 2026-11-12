// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

//! A short summary of usage for the composer and the Space home: today and the last seven days,
//! by engine, and the plan limits last seen. Never reaches the network: limits come from the
//! cache the CLIs filled.

use serde::Serialize;

use super::time::{format_day, local_day, now_ms};
use super::types::{QueryRequest, UsageStatRow};
use crate::engine_config::usage_limits::{self, ProviderLimits};

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTotals {
    pub requests: i64,
    pub input: i64,
    pub output: i64,
    pub cache_read: i64,
    pub cache_write: i64,
    /// Every token counted: input, output and both cache kinds.
    pub tokens: i64,
    /// Estimated USD for the rows with a known price.
    pub cost: f64,
    /// Some rows had no known price, so `cost` is a lower bound.
    pub unpriced: bool,
}

impl UsageTotals {
    fn add(&mut self, row: &UsageStatRow) {
        self.requests += row.requests;
        self.input += row.input;
        self.output += row.output;
        self.cache_read += row.cache_read;
        self.cache_write += row.cache_write;
        self.tokens += row.input + row.output + row.cache_read + row.cache_write;
        match row.cost {
            Some(cost) => self.cost += cost,
            None => self.unpriced = true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineTotals {
    pub engine: String,
    pub totals: UsageTotals,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    /// Local `YYYY-MM-DD`.
    pub today_date: String,
    pub today: UsageTotals,
    /// Today and the six days before it.
    pub week: UsageTotals,
    /// The week by engine, most tokens first.
    pub engines: Vec<EngineTotals>,
    /// Plan limits with reset times, as last read through each CLI.
    pub limits: Vec<ProviderLimits>,
    pub scanned_at: Option<i64>,
    pub scanning: bool,
}

/// Totals for `rows`, with `today` the local bucket of the current day.
pub(crate) fn summarize(
    rows: &[UsageStatRow],
    today: &str,
) -> (UsageTotals, UsageTotals, Vec<EngineTotals>) {
    let mut day = UsageTotals::default();
    let mut week = UsageTotals::default();
    let mut engines: Vec<EngineTotals> = Vec::new();
    for row in rows {
        week.add(row);
        if row.bucket == today {
            day.add(row);
        }
        match engines.iter_mut().find(|e| e.engine == row.engine) {
            Some(entry) => entry.totals.add(row),
            None => {
                let mut totals = UsageTotals::default();
                totals.add(row);
                engines.push(EngineTotals {
                    engine: row.engine.clone(),
                    totals,
                });
            }
        }
    }
    engines.sort_by(|a, b| {
        b.totals
            .tokens
            .cmp(&a.totals.tokens)
            .then_with(|| a.engine.cmp(&b.engine))
    });
    (day, week, engines)
}

/// The summary for the person's time zone, given as minutes east of UTC.
pub async fn usage_summary(tz_offset_minutes: i32) -> Result<UsageSummary, String> {
    let today = local_day(now_ms(), tz_offset_minutes);
    let today_date = format_day(today);
    let response = super::query(QueryRequest {
        from: format_day(today - 6),
        to: today_date.clone(),
        bucket: None,
        tz_offset_minutes,
    })
    .await?;
    let (day, week, engines) = summarize(&response.rows, &today_date);
    Ok(UsageSummary {
        today_date,
        today: day,
        week,
        engines,
        limits: usage_limits::cached().providers,
        scanned_at: response.scanned_at,
        scanning: response.scanning,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(bucket: &str, engine: &str, input: i64, cost: Option<f64>) -> UsageStatRow {
        UsageStatRow {
            bucket: bucket.into(),
            engine: engine.into(),
            model: "m".into(),
            project: None,
            sessions: 1,
            requests: 2,
            input,
            output: 10,
            cache_read: 5,
            cache_write: 0,
            reasoning: 0,
            cost,
        }
    }

    #[test]
    fn sums_today_week_and_engines() {
        let rows = [
            row("2026-11-10", "codex", 100, Some(1.0)),
            row("2026-11-11", "claude", 50, Some(0.5)),
            row("2026-11-11", "codex", 1000, None),
        ];
        let (today, week, engines) = summarize(&rows, "2026-11-11");
        assert_eq!(today.input, 1050);
        assert_eq!(today.tokens, 1050 + 20 + 10);
        assert!(today.unpriced);
        assert_eq!(week.requests, 6);
        assert!((week.cost - 1.5).abs() < 1e-9);
        assert_eq!(engines[0].engine, "codex");
        assert_eq!(engines[0].totals.input, 1100);
        assert_eq!(engines[1].engine, "claude");
        assert!(!engines[1].totals.unpriced);
    }
}
