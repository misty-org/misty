// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

#![allow(clippy::disallowed_methods)] // Fixtures are built with the standard library.

use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};
use std::sync::Mutex;

use serde_json::{json, Value};

use super::codex::{BoxFuture, CodexFailure, CodexSource};
use super::store::Store;
use super::*;

/// Answers queued in order; the last one repeats.
struct FakeCodex {
    answers: Mutex<Vec<Result<Value, CodexFailure>>>,
    calls: AtomicUsize,
}

impl FakeCodex {
    fn new(answers: Vec<Result<Value, CodexFailure>>) -> Self {
        Self {
            answers: Mutex::new(answers),
            calls: AtomicUsize::new(0),
        }
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl CodexSource for FakeCodex {
    fn read_rate_limits(&self) -> BoxFuture<'_, Result<Value, CodexFailure>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let mut answers = self.answers.lock().unwrap();
        let answer = if answers.len() > 1 {
            answers.remove(0)
        } else {
            answers[0].clone()
        };
        Box::pin(async move {
            tokio::task::yield_now().await;
            answer
        })
    }
}

struct Harness {
    codex: FakeCodex,
    store: Store,
    clock: AtomicI64,
}

const T0: i64 = 1_790_000_000_000;

impl Harness {
    fn new(answers: Vec<Result<Value, CodexFailure>>) -> Self {
        Self {
            codex: FakeCodex::new(answers),
            store: Store::new(false),
            clock: AtomicI64::new(T0),
        }
    }

    fn at(&self, now: i64) -> &Self {
        self.clock.store(now, Ordering::SeqCst);
        self
    }

    async fn get(&self, ids: &[ProviderId], refresh: bool) -> LimitsResponse {
        let now = || self.clock.load(Ordering::SeqCst);
        let env = Env {
            codex: &self.codex,
            now: &now,
        };
        lookup(&env, &self.store, ids, refresh).await
    }

    async fn codex(&self, refresh: bool) -> ProviderLimits {
        self.get(&[ProviderId::Codex], refresh)
            .await
            .providers
            .remove(0)
    }
}

fn codex_body() -> Value {
    json!({ "rateLimits": {
        "limitId": "codex", "planType": "plus",
        "primary": { "usedPercent": 30, "windowDurationMins": 300, "resetsAt": 1_790_010_000 },
        "secondary": { "usedPercent": 60, "windowDurationMins": 10080, "resetsAt": 1_790_500_000 }
    }})
}

fn window_ids(result: &ProviderLimits) -> Vec<&str> {
    result.windows.iter().map(|w| w.id.as_str()).collect()
}

#[tokio::test]
async fn codex_ok_maps_plan_and_windows() {
    let harness = Harness::new(vec![Ok(codex_body())]);
    let result = harness.codex(false).await;
    assert_eq!(result.status, "ok");
    assert_eq!(result.plan.as_deref(), Some("Plus"));
    assert_eq!(window_ids(&result), ["session", "weekly"]);
    assert_eq!(result.fetched_at, Some(T0));
    assert_eq!(result.source, "codex app-server");
}

#[tokio::test]
async fn codex_failures_map_to_statuses() {
    for (failure, status) in [
        (CodexFailure::NotInstalled, "notInstalled"),
        (CodexFailure::SignedOut, "signedOut"),
        (CodexFailure::Offline, "offline"),
        (CodexFailure::Error("boom".into()), "error"),
    ] {
        let harness = Harness::new(vec![Err(failure)]);
        let result = harness.codex(false).await;
        assert_eq!(result.status, status);
        assert!(result.windows.is_empty());
    }
    let harness = Harness::new(vec![Ok(json!({ "nothing": true }))]);
    let result = harness.codex(false).await;
    assert_eq!(
        (result.status.as_str(), result.error.as_deref()),
        ("error", Some("unexpected answer"))
    );
}

#[tokio::test]
async fn failures_keep_last_good_data() {
    let harness = Harness::new(vec![
        Ok(codex_body()),
        Err(CodexFailure::Offline),
        Err(CodexFailure::Error("bad".into())),
    ]);
    assert_eq!(harness.codex(false).await.status, "ok");
    let offline = harness.at(T0 + CACHE_TTL_MS).codex(false).await;
    assert_eq!(offline.status, "offline");
    assert_eq!(window_ids(&offline), ["session", "weekly"]);
    assert_eq!(
        offline.fetched_at,
        Some(T0),
        "stale data keeps its own time"
    );
    let error = harness.at(T0 + 2 * CACHE_TTL_MS).codex(false).await;
    assert_eq!(error.status, "error");
    assert_eq!(error.error.as_deref(), Some("bad"));
    assert_eq!(error.plan.as_deref(), Some("Plus"));
}

#[tokio::test]
async fn cache_ttl_and_refresh() {
    let harness = Harness::new(vec![Ok(codex_body())]);
    harness.codex(false).await;
    harness.at(T0 + CACHE_TTL_MS - 1).codex(false).await;
    assert_eq!(harness.codex.calls(), 1, "inside the TTL");
    harness
        .at(T0 + REFRESH_MIN_INTERVAL_MS - 1)
        .codex(true)
        .await;
    assert_eq!(
        harness.codex.calls(),
        1,
        "refresh reuses a very fresh answer"
    );
    harness.at(T0 + REFRESH_MIN_INTERVAL_MS).codex(true).await;
    assert_eq!(harness.codex.calls(), 2);
    harness
        .at(T0 + REFRESH_MIN_INTERVAL_MS + CACHE_TTL_MS)
        .codex(false)
        .await;
    assert_eq!(harness.codex.calls(), 3, "TTL passed");
}

#[tokio::test]
async fn concurrent_callers_share_one_start() {
    let harness = Harness::new(vec![Ok(codex_body())]);
    let (a, b) = tokio::join!(harness.codex(false), harness.codex(false));
    assert_eq!(a, b);
    assert_eq!(harness.codex.calls(), 1);
}

#[tokio::test]
async fn claude_comes_from_its_runs_without_starting_anything() {
    let harness = Harness::new(vec![Err(CodexFailure::NotInstalled)]);
    let before = harness
        .get(&[ProviderId::Claude], false)
        .await
        .providers
        .remove(0);
    assert_eq!(before.status, "noData");
    record_claude_into(
        &harness.store,
        &json!({ "type": "rate_limit_event", "rate_limit_info": {
            "status": "allowed", "rateLimitType": "five_hour", "utilization": 0.4,
            "resetsAt": 1_790_010_000 } }),
        T0,
    );
    record_claude_into(
        &harness.store,
        &json!({ "type": "rate_limit_event", "rate_limit_info": {
            "status": "allowed_warning", "rateLimitType": "seven_day", "utilization": 0.9,
            "resetsAt": 1_790_500_000, "isUsingOverage": false } }),
        T0 + 5,
    );
    let after = harness
        .get(&[ProviderId::Claude], false)
        .await
        .providers
        .remove(0);
    assert_eq!(after.status, "ok");
    assert_eq!(window_ids(&after), ["five_hour", "seven_day"]);
    assert_eq!(after.windows[0].used_percent, 40.0);
    assert_eq!(after.fetched_at, Some(T0 + 5));
    assert_eq!(after.source, "Claude Code runs");
    assert_eq!(harness.codex.calls(), 0);
}

#[tokio::test]
async fn codex_updates_merge_into_the_last_read() {
    let harness = Harness::new(vec![Ok(codex_body())]);
    harness.codex(false).await;
    record_codex_into(
        &harness.store,
        &json!({ "rateLimits": { "planType": null,
            "primary": { "usedPercent": 35, "windowDurationMins": 300, "resetsAt": 1_790_010_000 },
            "secondary": null } }),
        T0 + 10,
    );
    let cached = cached_from(&harness.store);
    let codex = cached.providers.iter().find(|p| p.id == "codex").unwrap();
    assert_eq!(window_ids(codex), ["session", "weekly"]);
    assert_eq!(codex.windows[0].used_percent, 35.0);
    assert_eq!(
        codex.windows[1].used_percent, 60.0,
        "the other window is kept"
    );
    assert_eq!(
        codex.plan.as_deref(),
        Some("Plus"),
        "a missing plan keeps the last one"
    );
}

#[tokio::test]
async fn providers_keep_order_and_fail_independently() {
    let harness = Harness::new(vec![Err(CodexFailure::Offline)]);
    let response = harness
        .get(&[ProviderId::Codex, ProviderId::Claude], false)
        .await;
    let ids: Vec<&str> = response.providers.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(ids, ["codex", "claude"]);
    assert_eq!(response.providers[0].status, "offline");
    assert_eq!(response.providers[1].status, "noData");
}

#[tokio::test]
async fn persists_last_good_and_serves_it_after_restart() {
    let home = std::env::temp_dir().join(format!("misty-usage-limits-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(&home).unwrap();
    let _guard = crate::engine_config::support::TestHome::set(&home);
    let first = Store::new(true);
    record_claude_into(
        &first,
        &json!({ "rate_limit_info": { "status": "rejected", "rateLimitType": "five_hour",
                                      "resetsAt": 1_790_010_000 } }),
        T0,
    );
    let restarted = Store::new(true);
    let good = restarted.last_good(ProviderId::Claude).expect("kept");
    assert_eq!(good.windows[0].used_percent, 100.0);
    assert_eq!(good.windows[0].status.as_deref(), Some("rejected"));
    drop(_guard);
    let _ = std::fs::remove_dir_all(&home);
}

#[tokio::test]
async fn serialized_output_carries_no_account_details() {
    let harness = Harness::new(vec![Ok(json!({ "rateLimits": {
        "planType": "pro", "email": "person@example.com", "accessToken": "tok",
        "primary": { "usedPercent": 1, "windowDurationMins": 300 }
    }}))]);
    let text = serde_json::to_string(&harness.codex(false).await).unwrap();
    assert!(!text.contains("person@example.com"));
    assert!(!text.contains("tok\""));
}

#[test]
fn resolve_ids_defaults_dedupes_and_rejects_unknown() {
    assert_eq!(
        resolve_ids(None).unwrap(),
        vec![ProviderId::Claude, ProviderId::Codex]
    );
    assert_eq!(
        resolve_ids(Some(vec![
            "codex".into(),
            " codex ".into(),
            "claude".into()
        ]))
        .unwrap(),
        vec![ProviderId::Codex, ProviderId::Claude]
    );
    let error = resolve_ids(Some(vec!["x".repeat(100)])).unwrap_err();
    assert!(error.len() < 100);
}

#[test]
fn title_case_labels() {
    assert_eq!(title_case("plus").as_deref(), Some("Plus"));
    assert_eq!(title_case("pro_lite").as_deref(), Some("Pro Lite"));
    assert_eq!(title_case("free").as_deref(), Some("Free"));
    assert_eq!(title_case("unknown"), None);
    assert_eq!(title_case(""), None);
}

#[test]
fn public_get_future_is_send() {
    fn assert_send<T: Send>(_: &T) {}
    let future = get(None, false);
    assert_send(&future);
}
