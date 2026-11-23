// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

//! The commands behind Settings › Engines › Usage. Adapted from
//! desktop-cc-gui's plugin_usage.rs, without its plugin grant: Misty's own windows call these.
//!
//! Background scanning starts on the first call, not at app startup, so Misty never walks the
//! CLIs' logs while nobody looks at usage.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::{PriceInfo, QueryRequest, QueryResponse, ScanSummary, SourceStatus};
use crate::engine_config::usage_limits::{self, LimitsResponse};

const PRICE_UPDATE_COOLDOWN: Duration = Duration::from_secs(10 * 60);
const RESCAN_COOLDOWN: Duration = Duration::from_secs(60);

static LAST_PRICE_UPDATE: Mutex<Option<Instant>> = Mutex::new(None);
static LAST_RESCAN: Mutex<Option<Instant>> = Mutex::new(None);

fn claim(slot: &Mutex<Option<Instant>>, every: Duration, now: Instant) -> Result<(), Duration> {
    let mut last = slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(at) = *last {
        let elapsed = now.saturating_duration_since(at);
        if elapsed < every {
            return Err(every - elapsed);
        }
    }
    *last = Some(now);
    Ok(())
}

#[tauri::command]
pub async fn engine_usage_query(query: QueryRequest) -> Result<QueryResponse, String> {
    super::start_background();
    super::query(query).await
}

#[tauri::command]
pub async fn engine_usage_sources() -> Result<Vec<SourceStatus>, String> {
    super::start_background();
    super::sources().await
}

#[tauri::command]
pub async fn engine_usage_rescan() -> Result<ScanSummary, String> {
    super::start_background();
    if let Err(remaining) = claim(&LAST_RESCAN, RESCAN_COOLDOWN, Instant::now()) {
        return Err(format!(
            "Usage was read again moments ago. Try again in {}s.",
            remaining.as_secs().max(1)
        ));
    }
    super::rescan().await
}

#[tauri::command]
pub async fn engine_usage_prices() -> Result<PriceInfo, String> {
    super::prices().await
}

#[tauri::command]
pub async fn engine_usage_update_prices() -> Result<PriceInfo, String> {
    if claim(&LAST_PRICE_UPDATE, PRICE_UPDATE_COOLDOWN, Instant::now()).is_err() {
        return super::prices().await;
    }
    super::update_prices().await
}

#[tauri::command]
pub async fn engine_usage_limits(
    providers: Option<Vec<String>>,
    refresh: Option<bool>,
) -> Result<LimitsResponse, String> {
    usage_limits::get(providers, refresh.unwrap_or(false)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cooldown_allows_one_claim_per_window() {
        let slot = Mutex::new(None);
        let t0 = Instant::now();
        let every = Duration::from_secs(60);
        assert!(claim(&slot, every, t0).is_ok());
        let remaining = claim(&slot, every, t0 + Duration::from_secs(20)).unwrap_err();
        assert_eq!(remaining, Duration::from_secs(40));
        assert!(claim(&slot, every, t0 + every).is_ok(), "window passed");
        assert!(claim(&slot, every, t0 + every + Duration::from_secs(1)).is_err());
    }
}
