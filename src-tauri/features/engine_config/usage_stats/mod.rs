// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

//! Read-only usage statistics built from each CLI's own session logs
//! (Claude Code, Codex, pi, oh-my-pi). Logs are read incrementally into a
//! private SQLite index (`~/.misty/engine-config/usage-stats.db`) of deduplicated model
//! responses; queries group them by local day/hour × engine × model × project
//! and price them from LiteLLM's public table. Nothing leaves the computer;
//! the only request is the optional price-table download.
//!
//! The approach is borrowed from TokenTracker (MIT, © 2026 xiufengsun); this
//! is an independent Rust implementation, with rules that mirror it marked
//! `Mirrors TokenTracker (MIT)`.

pub mod commands;
mod parsers;
mod pricing;
mod query;
mod scan;
mod sources;
mod store;
pub(crate) mod time;
mod types;

#[cfg(test)]
mod tests;

pub use types::{PriceInfo, QueryRequest, QueryResponse, ScanSummary, SourceStatus, UsageStatRow};

use scan::{ScanMode, ScanProgress};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

pub const SCAN_PROGRESS_EVENT: &str = "engine-usage://scan-progress";
pub const CHANGED_EVENT: &str = "engine-usage://changed";

const STARTUP_DELAY: Duration = Duration::from_secs(3);
const BACKGROUND_INTERVAL: Duration = Duration::from_secs(120);
/// The background loop stops once nothing has asked for usage this long
/// (Settings closed, the app idle); the next call restarts it.
const BACKGROUND_IDLE_STOP_MS: i64 = 10 * 60_000;
/// `query` refreshes in the background when the last scan is older.
const STALE_AFTER_MS: i64 = 60_000;
const PROGRESS_THROTTLE: Duration = Duration::from_millis(200);

/// One scan at a time; holders run the blocking scan to completion.
static SCAN_LOCK: LazyLock<Arc<tokio::sync::Mutex<()>>> =
    LazyLock::new(|| Arc::new(tokio::sync::Mutex::new(())));
static SCANNING: AtomicBool = AtomicBool::new(false);
static LAST_SCAN_MS: AtomicI64 = AtomicI64::new(0);
static BACKGROUND_STARTED: AtomicBool = AtomicBool::new(false);
/// Last time something asked for usage (epoch ms).
static LAST_DEMAND_MS: AtomicI64 = AtomicI64::new(0);

fn db_path() -> PathBuf {
    crate::engine_config::support::app_home().join("usage-stats.db")
}

/// Grouped usage for a local date range. Returns current data at once; if
/// the index is older than a minute an incremental scan starts in the
/// background and the response says `scanning: true`.
pub async fn query(req: QueryRequest) -> Result<QueryResponse, String> {
    let valid = query::validate(&req)?;
    let db = db_path();
    let mut response = tokio::task::spawn_blocking(move || {
        let conn = store::open(&db)?;
        let scanned_at = store::get_meta_i64(&conn, "last_scan_at").ok().flatten();
        let mut response = query::run(&conn, &valid, &pricing::current())?;
        response.scanned_at = scanned_at;
        Ok::<_, String>(response)
    })
    .await
    .map_err(|e| format!("usage query task: {e}"))??;
    if let Some(at) = response.scanned_at {
        LAST_SCAN_MS.fetch_max(at, Ordering::SeqCst);
    }
    refresh_if_stale();
    response.scanning = SCANNING.load(Ordering::SeqCst);
    Ok(response)
}

/// Each source's roots, file count and readability (readdir only).
pub async fn sources() -> Result<Vec<SourceStatus>, String> {
    let db = db_path();
    tokio::task::spawn_blocking(move || {
        let last_scans = last_scan_times(&db);
        sources::default_specs()
            .iter()
            .map(|spec| {
                let discovery = sources::discover(spec);
                let last = last_scans.get(spec.engine.id()).copied();
                sources::status_of(spec, &discovery, last)
            })
            .collect()
    })
    .await
    .map_err(|e| format!("usage sources task: {e}"))
}

/// Forget the index and rebuild it from the logs. Readers keep the old
/// numbers until the rebuild commits.
pub async fn rescan() -> Result<ScanSummary, String> {
    let permit = ScanPermit::acquire().await;
    run_scan(permit, ScanMode::Full).await
}

pub async fn prices() -> Result<PriceInfo, String> {
    tokio::task::spawn_blocking(|| pricing::current().info())
        .await
        .map_err(|e| format!("price table task: {e}"))
}

/// Download LiteLLM's public price table and switch to it.
pub async fn update_prices() -> Result<PriceInfo, String> {
    pricing::update().await
}

/// Called whenever usage is asked for: scan ~3 s after the first call, then
/// every 2 minutes while something keeps asking. Stops after
/// `BACKGROUND_IDLE_STOP_MS` without a call, so Misty does not keep walking
/// the CLIs' logs when nobody looks. Never panics the app; failures are
/// logged with context only.
pub fn start_background() {
    LAST_DEMAND_MS.store(time::now_ms(), Ordering::SeqCst);
    if BACKGROUND_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_DELAY).await;
        loop {
            if let Some(permit) = ScanPermit::try_acquire() {
                if let Err(error) = run_scan(permit, ScanMode::Incremental).await {
                    eprintln!("[usage-stats] background scan failed: {error}");
                }
            }
            tokio::time::sleep(BACKGROUND_INTERVAL).await;
            if background_idle(time::now_ms(), LAST_DEMAND_MS.load(Ordering::SeqCst)) {
                BACKGROUND_STARTED.store(false, Ordering::SeqCst);
                // A call that raced the decision restarts the loop itself.
                if !background_idle(time::now_ms(), LAST_DEMAND_MS.load(Ordering::SeqCst))
                    && !BACKGROUND_STARTED.swap(true, Ordering::SeqCst)
                {
                    continue;
                }
                break;
            }
        }
    });
}

fn background_idle(now_ms: i64, last_demand_ms: i64) -> bool {
    now_ms - last_demand_ms > BACKGROUND_IDLE_STOP_MS
}

fn refresh_if_stale() {
    if time::now_ms() - LAST_SCAN_MS.load(Ordering::SeqCst) < STALE_AFTER_MS {
        return;
    }
    let Some(permit) = ScanPermit::try_acquire() else {
        return; // already scanning
    };
    tauri::async_runtime::spawn(async move {
        if let Err(error) = run_scan(permit, ScanMode::Incremental).await {
            eprintln!("[usage-stats] refresh scan failed: {error}");
        }
    });
}

/// Held for the whole scan; `SCANNING` mirrors it.
struct ScanPermit {
    _guard: tokio::sync::OwnedMutexGuard<()>,
}

impl ScanPermit {
    fn new(guard: tokio::sync::OwnedMutexGuard<()>) -> Self {
        SCANNING.store(true, Ordering::SeqCst);
        Self { _guard: guard }
    }

    fn try_acquire() -> Option<Self> {
        Arc::clone(&SCAN_LOCK).try_lock_owned().ok().map(Self::new)
    }

    async fn acquire() -> Self {
        Self::new(Arc::clone(&SCAN_LOCK).lock_owned().await)
    }
}

impl Drop for ScanPermit {
    fn drop(&mut self) {
        SCANNING.store(false, Ordering::SeqCst);
    }
}

async fn run_scan(permit: ScanPermit, mode: ScanMode) -> Result<ScanSummary, String> {
    let db = db_path();
    // The permit moves into the blocking task: a caller that stops waiting
    // does not release the lock while the scan is still writing.
    let summary = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let mut conn = store::open(&db)?;
        let mut reporter = ProgressReporter::new();
        let summary = scan::run(&mut conn, &sources::default_specs(), mode, &mut |p| {
            reporter.report(p)
        })?;
        LAST_SCAN_MS.fetch_max(summary.scanned_at, Ordering::SeqCst);
        Ok::<_, String>(summary)
    })
    .await
    .map_err(|e| format!("usage scan task: {e}"))??;
    if summary.events_added > 0 || mode == ScanMode::Full {
        crate::engine_config::support::emit(
            CHANGED_EVENT,
            ChangedPayload {
                scanned_at: summary.scanned_at,
            },
        );
    }
    Ok(summary)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangedPayload {
    scanned_at: i64,
}

/// Progress events at most every 200 ms; the final event always goes out.
struct ProgressReporter {
    last: Option<Instant>,
}

impl ProgressReporter {
    fn new() -> Self {
        Self { last: None }
    }

    fn report(&mut self, progress: &ScanProgress) {
        let due = self.last.is_none_or(|at| at.elapsed() >= PROGRESS_THROTTLE);
        if due || progress.finished {
            self.last = Some(Instant::now());
            crate::engine_config::support::emit(SCAN_PROGRESS_EVENT, progress.clone());
        }
    }
}

fn last_scan_times(db: &std::path::Path) -> HashMap<String, i64> {
    let Ok(conn) = store::open(db) else {
        return HashMap::new();
    };
    types::Engine::ALL
        .iter()
        .filter_map(|engine| {
            let key = format!("last_scan_at:{}", engine.id());
            let at = store::get_meta_i64(&conn, &key).ok().flatten()?;
            Some((engine.id().to_string(), at))
        })
        .collect()
}
