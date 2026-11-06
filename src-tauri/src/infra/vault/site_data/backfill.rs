//! Once per profile after a vault opens: sites in its open tabs and recent history have
//! localStorage from before anyone was watching. Read a few at a time, in the background, through
//! inert documents, and never while the person is moving around the web.
use super::engine;
use super::scope::{Stored, Unavailable};
use super::storage_sync::StorageSync;
use crate::infra::vault::META_VAULT;
use crate::infra::website_data::storage::{self, InertOrigin};
use rusqlite::params;
use std::collections::{BTreeSet, VecDeque};
use std::time::Duration;

/// How long between batches, and how many sites in one.
pub(super) const GAP: Duration = Duration::from_secs(5);
const AT_ONCE: usize = 3;
const MAX_ORIGINS: usize = 200;
const VISITS_LOOKED_AT: i64 = 5_000;
/// Pages have loaded this recently: the person is browsing, so this waits.
const BUSY_MS: u64 = 15_000;

fn done_key(profile: &str) -> String {
    format!("vault.site_backfill.{profile}")
}

/// Starts it for an open profile, if a vault is open and this hasn't run for it.
pub(super) async fn begin_if_due(sync: &mut StorageSync, name: &str) -> Stored<()> {
    let scope = sync.scope;
    let Some(profile) = sync.profiles.get(name) else {
        return Ok(());
    };
    if profile.backfill.is_some()
        || scope.meta(META_VAULT).await?.is_none()
        || scope.meta(&done_key(name)).await?.is_some()
    {
        return Ok(());
    }
    let store = profile.store.clone();
    let mut origins: Vec<String> = engine::tabs(&sync.app, &store)
        .iter()
        .filter_map(|view| view.url().ok())
        .filter(|url| matches!(url.scheme(), "http" | "https"))
        .map(|url| url.origin().ascii_serialization())
        .collect();
    let app = sync.app.clone();
    let key = crate::infra::browser_library::history::profile_key(
        crate::infra::profile_windows::store_for_profile(name).map_err(|_| Unavailable)?,
    );
    let visited = tokio::task::spawn_blocking(move || recent_origins(&app, &key))
        .await
        .map_err(|_| Unavailable)?;
    origins.extend(visited);
    let profile = sync.profiles.get_mut(name).ok_or(Unavailable)?;
    let mut seen = BTreeSet::new();
    let queue: VecDeque<String> = origins
        .into_iter()
        .filter(|origin| seen.insert(origin.clone()))
        .filter(|origin| !profile.known.contains_key(origin))
        .take(MAX_ORIGINS)
        .collect();
    profile.backfill = Some(queue);
    Ok(())
}

/// The sites this computer visited in a profile, the most recent first.
fn recent_origins(app: &tauri::AppHandle, key: &str) -> Vec<String> {
    let Ok(connection) = crate::infra::browser_library::library(app) else {
        return Vec::new();
    };
    let Ok(mut statement) = connection.prepare(
        "SELECT url FROM visits WHERE profile_id = ?1 AND origin = ''
         ORDER BY visited_at DESC LIMIT ?2",
    ) else {
        return Vec::new();
    };
    let Ok(rows) = statement.query_map(params![key, VISITS_LOOKED_AT], |row| {
        row.get::<_, String>(0)
    }) else {
        return Vec::new();
    };
    rows.filter_map(Result::ok)
        .filter_map(|url| url::Url::parse(&url).ok())
        .filter(|url| matches!(url.scheme(), "http" | "https"))
        .map(|url| url.origin().ascii_serialization())
        .collect()
}

/// Reads the next few sites, unless the person is busy. Marks it done when none are left.
pub(super) async fn step(sync: &mut StorageSync, name: &str) -> Stored<()> {
    let Some(profile) = sync.profiles.get_mut(name) else {
        return Ok(());
    };
    let Some(queue) = profile.backfill.as_mut() else {
        return Ok(());
    };
    if queue.is_empty() {
        profile.backfill = None;
        return sync.scope.set_meta(&done_key(name), "1").await;
    }
    if super::recently_loaded(BUSY_MS) || !super::backfill_due(GAP) {
        return Ok(());
    }
    let Some(owner) = crate::infra::profile_windows::windows_for_profile(&sync.app, name)
        .into_iter()
        .find(|window| crate::infra::profile_windows::is_person_window(window.label()))
    else {
        return Ok(());
    };
    let batch: Vec<String> = (0..AT_ONCE).filter_map(|_| queue.pop_front()).collect();
    let store = profile.store.clone();
    for origin in batch {
        // A site that won't open is passed over: this runs once, and modestly.
        let Ok(inert) = InertOrigin::open(&owner, &store.identity, &origin).await else {
            continue;
        };
        let Ok(page) = storage::read_page(inert.view(), &store.identity, &origin, None).await
        else {
            continue;
        };
        drop(inert);
        sync.captured(name, &origin, page).await?;
    }
    Ok(())
}
