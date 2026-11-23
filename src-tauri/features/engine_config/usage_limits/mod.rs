// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

//! Plan limits for Claude Code and Codex, read through each CLI.
//!
//! desktop-cc-gui reads the person's sign-in from the Keychain and credential files and asks the
//! vendors' usage endpoints itself. Misty never does: Misty never reads, reuses or proxies a
//! person's subscription tokens. Instead:
//!
//! * Codex: Misty starts the person's own `codex app-server` and asks it
//!   `account/rateLimits/read`; the CLI answers from its own sign-in. While a run is going, the
//!   engine adapter hands over each `account/rateLimits/updated` notification
//!   ([`record_codex_rate_limits`]).
//! * Claude Code: it reports its limits in its own stream-json output as `rate_limit_event`
//!   lines, which the engine adapter hands over ([`record_claude_rate_limit`]). Claude Code has
//!   no command that only reads them, so they appear after its first turn.
//!
//! Callers see plan labels, window percentages and reset times only. Each provider has a 60 s
//! result cache, and its last good result is kept in `misty.db` on this computer.
//!
//! The approach to windows and plan labels is borrowed, through desktop-cc-gui, from
//! TokenTracker (MIT, © 2026 xiufengsun); rules taken from it are marked "Mirrors TokenTracker
//! (MIT)".

mod claude;
mod codex;
mod store;
#[cfg(test)]
mod tests;

use std::sync::LazyLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use codex::{CodexAppServer, CodexFailure, CodexSource};
use store::{GoodData, Store, CACHE_TTL_MS, REFRESH_MIN_INTERVAL_MS};

pub(crate) const KIND_SESSION: &str = "session";
pub(crate) const KIND_WEEKLY: &str = "weekly";
pub(crate) const KIND_OTHER: &str = "other";
pub(crate) const SESSION_WINDOW_SECONDS: i64 = 18_000;
pub(crate) const WEEKLY_WINDOW_SECONDS: i64 = 604_800;
const MAX_ECHOED_ID_CHARS: usize = 32;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitWindow {
    pub id: String,
    pub kind: String,
    pub label: Option<String>,
    pub used_percent: f64,
    pub window_seconds: Option<i64>,
    pub resets_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credits {
    pub has_credits: bool,
    pub unlimited: bool,
    pub balance: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderLimits {
    pub id: String,
    pub status: String,
    pub plan: Option<String>,
    pub windows: Vec<LimitWindow>,
    pub credits: Option<Credits>,
    pub using_overage: Option<bool>,
    pub fetched_at: Option<i64>,
    pub error: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitsResponse {
    pub providers: Vec<ProviderLimits>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProviderId {
    Claude,
    Codex,
}

impl ProviderId {
    const ALL: [ProviderId; 2] = [ProviderId::Claude, ProviderId::Codex];

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            ProviderId::Claude => "claude",
            ProviderId::Codex => "codex",
        }
    }

    pub(crate) fn parse(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.as_str() == id)
    }

    fn source(self) -> &'static str {
        match self {
            ProviderId::Claude => "Claude Code runs",
            ProviderId::Codex => "codex app-server",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Status {
    Ok,
    NoData,
    NotInstalled,
    SignedOut,
    Offline,
    Error,
}

impl Status {
    fn as_str(self) -> &'static str {
        match self {
            Status::Ok => "ok",
            Status::NoData => "noData",
            Status::NotInstalled => "notInstalled",
            Status::SignedOut => "signedOut",
            Status::Offline => "offline",
            Status::Error => "error",
        }
    }
}

pub(crate) struct Env<'a> {
    pub codex: &'a dyn CodexSource,
    pub now: &'a (dyn Fn() -> i64 + Send + Sync),
}

static STORE: LazyLock<Store> = LazyLock::new(|| Store::new(true));

pub async fn get(providers: Option<Vec<String>>, refresh: bool) -> Result<LimitsResponse, String> {
    let ids = resolve_ids(providers)?;
    let env = Env {
        codex: &CodexAppServer,
        now: &system_now_ms,
    };
    Ok(lookup(&env, &STORE, &ids, refresh).await)
}

#[cfg(test)]
fn cached_from(store: &Store) -> LimitsResponse {
    LimitsResponse {
        providers: ProviderId::ALL
            .into_iter()
            .map(|provider| match store.last_good(provider) {
                Some(good) => View::new(provider, Status::Ok).data(Some(&good)).build(),
                None => View::new(provider, Status::NoData).build(),
            })
            .collect(),
    }
}

pub fn record_claude_rate_limit(event: &Value) {
    record_claude_into(&STORE, event, system_now_ms());
}

pub fn record_codex_rate_limits(params: &Value) {
    record_codex_into(&STORE, params, system_now_ms());
}

pub(crate) fn record_claude_into(store: &Store, event: &Value, now: i64) {
    let Some(update) = claude::parse_event(event) else {
        return;
    };
    store.merge(
        ProviderId::Claude,
        update.windows,
        None,
        None,
        Some(update.using_overage),
        now,
    );
}

pub(crate) fn record_codex_into(store: &Store, params: &Value, now: i64) {
    let Some(parsed) = codex::parse_update(params, now) else {
        return;
    };
    store.merge(
        ProviderId::Codex,
        parsed.windows,
        parsed.plan,
        parsed.credits,
        None,
        now,
    );
}

fn resolve_ids(requested: Option<Vec<String>>) -> Result<Vec<ProviderId>, String> {
    let Some(requested) = requested else {
        return Ok(ProviderId::ALL.to_vec());
    };
    let mut ids: Vec<ProviderId> = Vec::new();
    for raw in &requested {
        let Some(id) = ProviderId::parse(raw.trim()) else {
            let shown: String = raw.chars().take(MAX_ECHOED_ID_CHARS).collect();
            return Err(format!("Misty has no plan limits for {shown:?}."));
        };
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    Ok(ids)
}

fn system_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

async fn lookup(env: &Env<'_>, store: &Store, ids: &[ProviderId], refresh: bool) -> LimitsResponse {
    let lookups = ids.iter().map(|id| resolve(env, store, *id, refresh));
    LimitsResponse {
        providers: futures_util::future::join_all(lookups).await,
    }
}

async fn resolve(
    env: &Env<'_>,
    store: &Store,
    provider: ProviderId,
    refresh: bool,
) -> ProviderLimits {
    if provider == ProviderId::Claude {
        return match store.last_good(provider) {
            Some(good) => View::new(provider, Status::Ok).data(Some(&good)).build(),
            None => View::new(provider, Status::NoData).build(),
        };
    }
    let slot = store.slot();
    let seen_generation = slot.generation();
    let mut state = slot.state.lock().await;
    let now = (env.now)();
    if slot.generation() != seen_generation {
        if let Some((result, _)) = &state.last_result {
            return result.clone();
        }
    }
    let max_age = if refresh {
        REFRESH_MIN_INTERVAL_MS
    } else {
        CACHE_TTL_MS
    };
    if let Some(cached) = cached_result(store, provider, &state.last_result, now, max_age) {
        return cached;
    }
    let result = fetch_codex(env, store).await;
    state.last_result = Some((result.clone(), (env.now)()));
    slot.bump();
    result
}

fn cached_result(
    store: &Store,
    provider: ProviderId,
    last_result: &Option<(ProviderLimits, i64)>,
    now: i64,
    max_age_ms: i64,
) -> Option<ProviderLimits> {
    let fresh = |at: i64| now >= at && now - at < max_age_ms;
    match last_result {
        Some((result, at)) => fresh(*at).then(|| result.clone()),
        None => store
            .last_good(provider)
            .filter(|good| fresh(good.fetched_at))
            .map(|good| View::new(provider, Status::Ok).data(Some(&good)).build()),
    }
}

async fn fetch_codex(env: &Env<'_>, store: &Store) -> ProviderLimits {
    let provider = ProviderId::Codex;
    let last_good = store.last_good(provider);
    let stale = |status: Status| View::new(provider, status).data(last_good.as_ref());
    let body = match env.codex.read_rate_limits().await {
        Ok(body) => body,
        Err(CodexFailure::NotInstalled) => {
            return View::new(provider, Status::NotInstalled).build()
        }
        Err(CodexFailure::SignedOut) => return View::new(provider, Status::SignedOut).build(),
        Err(CodexFailure::Offline) => return stale(Status::Offline).build(),
        Err(CodexFailure::Error(reason)) => return stale(Status::Error).error(&reason).build(),
    };
    let now = (env.now)();
    let Some(parsed) = codex::parse_read(&body, now) else {
        return stale(Status::Error).error("unexpected answer").build();
    };
    let good = GoodData {
        plan: parsed.plan,
        windows: parsed.windows,
        credits: parsed.credits,
        using_overage: None,
        fetched_at: now,
    };
    store.replace(provider, &good);
    View::new(provider, Status::Ok).data(Some(&good)).build()
}

struct View<'a> {
    provider: ProviderId,
    status: Status,
    data: Option<&'a GoodData>,
    error: Option<String>,
}

impl<'a> View<'a> {
    fn new(provider: ProviderId, status: Status) -> Self {
        Self {
            provider,
            status,
            data: None,
            error: None,
        }
    }

    fn data(self, data: Option<&'a GoodData>) -> Self {
        Self { data, ..self }
    }

    fn error(self, reason: &str) -> Self {
        Self {
            error: Some(reason.to_string()),
            ..self
        }
    }

    fn build(self) -> ProviderLimits {
        ProviderLimits {
            id: self.provider.as_str().to_string(),
            status: self.status.as_str().to_string(),
            plan: self.data.and_then(|d| d.plan.clone()),
            windows: self.data.map(|d| d.windows.clone()).unwrap_or_default(),
            credits: self.data.and_then(|d| d.credits.clone()),
            using_overage: self.data.and_then(|d| d.using_overage),
            fetched_at: self.data.map(|d| d.fetched_at),
            error: self.error,
            source: self.provider.source().to_string(),
        }
    }
}

/// Percent from a JSON number (or numeric string), clamped to 0..=100.
// Mirrors TokenTracker (MIT): clampPercent.
pub(crate) fn clamp_percent(value: &Value) -> Option<f64> {
    let raw = match value {
        Value::Number(n) => n.as_f64()?,
        Value::String(text) => text.trim().parse::<f64>().ok()?,
        _ => return None,
    };
    raw.is_finite().then(|| clamp_f64(raw))
}

pub(crate) fn clamp_f64(value: f64) -> f64 {
    if value.is_nan() {
        0.0
    } else {
        value.clamp(0.0, 100.0)
    }
}

/// `plus` → "Plus", `pro_lite` → "Pro Lite"; placeholders → `None`.
// Mirrors TokenTracker (MIT): normalizePlanLabel drops "none"/"unknown"
// (but "free" is kept: the limits page labels free plans).
pub(crate) fn title_case(raw: &str) -> Option<String> {
    let words: Vec<String> = raw
        .split(|c: char| c == '_' || c == '-' || c.is_whitespace())
        .filter(|w| !w.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            let first = chars.next().map(|c| c.to_uppercase().collect::<String>());
            first.unwrap_or_default() + &chars.as_str().to_lowercase()
        })
        .collect();
    let label = words.join(" ");
    let lower = label.to_ascii_lowercase();
    if label.is_empty() || lower == "none" || lower == "unknown" {
        return None;
    }
    Some(label)
}

pub(crate) fn timestamp_ms(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => {
            let raw = n.as_f64().filter(|v| v.is_finite() && *v > 0.0)?;
            let ms = if raw < 1e12 { raw * 1000.0 } else { raw };
            Some(ms as i64)
        }
        Value::String(text) => crate::engine_config::usage_stats::time::parse_iso_ms(text),
        _ => None,
    }
}
