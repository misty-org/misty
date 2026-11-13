// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

//! Per-provider state: the TTL cache for Codex lookups, and each provider's last good result,
//! kept in `misty.db` on this computer (`engine_config_values`, key `usage_limits.snapshot`; no
//! secrets, only plan, windows, credits and when they were seen).

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

use super::{clamp_f64, Credits, LimitWindow, ProviderId};

/// Serve the previous result for this long unless the caller asks for a refresh.
pub(crate) const CACHE_TTL_MS: i64 = 60_000;
/// Floor for explicit refreshes (`refresh: true`): repeated calls inside this window reuse the
/// last answer instead of starting the CLI again.
pub(crate) const REFRESH_MIN_INTERVAL_MS: i64 = 20_000;
const SNAPSHOT_KEY: &str = "usage_limits.snapshot";
const SNAPSHOT_VERSION: u32 = 1;
/// Bounds applied to the stored copy so a corrupted row cannot inflate what the UI receives.
const MAX_PERSISTED_WINDOWS: usize = 16;
const MAX_PERSISTED_TEXT: usize = 64;

/// The last good read. Exactly what is stored.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GoodData {
    pub plan: Option<String>,
    pub windows: Vec<LimitWindow>,
    #[serde(default)]
    pub credits: Option<Credits>,
    #[serde(default)]
    pub using_overage: Option<bool>,
    pub fetched_at: i64,
}

#[derive(Debug, Default)]
pub(crate) struct LookupState {
    /// The last result handed out and when it was computed (TTL cache).
    pub last_result: Option<(super::ProviderLimits, i64)>,
}

pub(crate) struct Slot {
    pub state: tokio::sync::Mutex<LookupState>,
    /// Bumped whenever a lookup finishes, so a caller that queued behind an in-flight lookup can
    /// reuse its result instead of starting the CLI again.
    pub generation: AtomicU64,
}

impl Slot {
    fn new() -> Self {
        Self {
            state: tokio::sync::Mutex::new(LookupState::default()),
            generation: AtomicU64::new(0),
        }
    }

    pub(crate) fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }

    pub(crate) fn bump(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
    }
}

pub(crate) struct Store {
    codex: Slot,
    snapshot: parking_lot::Mutex<Snapshot>,
}

impl Store {
    /// `persist: false` keeps everything in memory (tests).
    pub(crate) fn new(persist: bool) -> Self {
        Self {
            codex: Slot::new(),
            snapshot: parking_lot::Mutex::new(Snapshot {
                persist,
                loaded: !persist,
                entries: BTreeMap::new(),
            }),
        }
    }

    /// The lookup slot; only Codex is looked up, Claude's limits arrive with its runs.
    pub(crate) fn slot(&self) -> &Slot {
        &self.codex
    }

    pub(crate) fn last_good(&self, provider: ProviderId) -> Option<GoodData> {
        self.snapshot.lock().get(provider.as_str())
    }

    /// A complete read replaces what was known.
    pub(crate) fn replace(&self, provider: ProviderId, good: &GoodData) {
        self.snapshot.lock().put(provider.as_str(), good.clone());
    }

    /// A partial update: windows with the same id are replaced, the others kept, and fields the
    /// update lacks keep their last value.
    pub(crate) fn merge(
        &self,
        provider: ProviderId,
        windows: Vec<LimitWindow>,
        plan: Option<String>,
        credits: Option<Credits>,
        using_overage: Option<bool>,
        now: i64,
    ) {
        let mut snapshot = self.snapshot.lock();
        let mut good = snapshot.get(provider.as_str()).unwrap_or(GoodData {
            plan: None,
            windows: Vec::new(),
            credits: None,
            using_overage: None,
            fetched_at: now,
        });
        for window in windows {
            match good.windows.iter_mut().find(|w| w.id == window.id) {
                Some(existing) => *existing = window,
                None => good.windows.push(window),
            }
        }
        good.windows
            .sort_by_key(|w| super::codex::kind_rank(&w.kind));
        good.plan = plan.or(good.plan);
        good.credits = credits.or(good.credits);
        good.using_overage = using_overage.or(good.using_overage);
        good.fetched_at = now;
        snapshot.put(provider.as_str(), good);
    }
}

#[derive(Serialize, Deserialize)]
struct SnapshotRow {
    version: u32,
    #[serde(default)]
    providers: BTreeMap<String, GoodData>,
}

struct Snapshot {
    persist: bool,
    loaded: bool,
    entries: BTreeMap<String, GoodData>,
}

impl Snapshot {
    fn get(&mut self, id: &str) -> Option<GoodData> {
        self.ensure_loaded();
        self.entries.get(id).cloned()
    }

    fn put(&mut self, id: &str, good: GoodData) {
        self.ensure_loaded();
        self.entries.insert(id.to_string(), sanitize(good));
        if !self.persist {
            return;
        }
        let row = SnapshotRow {
            version: SNAPSHOT_VERSION,
            providers: self.entries.clone(),
        };
        if let Err(error) = crate::engine_config::support::save_value(SNAPSHOT_KEY, &row) {
            eprintln!("[usage-limits] failed to keep the limits: {error}");
        }
    }

    fn ensure_loaded(&mut self) {
        if self.loaded {
            return;
        }
        self.loaded = true;
        let Ok(Some(row)) = crate::engine_config::support::load_value::<SnapshotRow>(SNAPSHOT_KEY)
        else {
            return;
        };
        if row.version != SNAPSHOT_VERSION {
            return;
        }
        self.entries = row
            .providers
            .into_iter()
            .filter(|(id, _)| ProviderId::parse(id).is_some())
            .map(|(id, good)| (id, sanitize(good)))
            .collect();
    }
}

fn sanitize(good: GoodData) -> GoodData {
    let windows = good
        .windows
        .into_iter()
        .take(MAX_PERSISTED_WINDOWS)
        .map(|w| LimitWindow {
            id: truncate(w.id),
            kind: truncate(w.kind),
            label: w.label.map(truncate),
            used_percent: clamp_f64(w.used_percent),
            status: w.status.map(truncate),
            ..w
        })
        .collect();
    GoodData {
        plan: good.plan.map(truncate),
        windows,
        credits: good.credits.map(|c| Credits {
            balance: c.balance.map(truncate),
            ..c
        }),
        using_overage: good.using_overage,
        fetched_at: good.fetched_at,
    }
}

fn truncate(text: String) -> String {
    if text.chars().count() <= MAX_PERSISTED_TEXT {
        return text;
    }
    text.chars().take(MAX_PERSISTED_TEXT).collect()
}
