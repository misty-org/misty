//! Reads every open (and previously synced) origin's website storage. A site
//! that cannot be read, or an area that cannot be stored, is skipped and
//! reported; the rest of the profile still syncs.
use super::budget::{carry_databases, Candidate, Held};
use super::coverage::{area_site, site, Coverage, DataKind, SkipReason};
use super::storage::{evaluate, evaluate_read, WebsiteStorage, PROFILE_UNVERIFIED};
use misty_browser_sync::document::{credentials::Area, CredentialRecord};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Webview;

mod observed;
use observed::*;

pub(in crate::infra) struct Captured {
    pub candidates: Vec<Candidate>,
    /// IndexedDB databases per origin that could not be exported locally.
    pub held_databases: BTreeMap<String, BTreeSet<String>>,
}

#[derive(Deserialize)]
struct PageSkip {
    kind: DataKind,
    reason: SkipReason,
    count: u32,
}

#[derive(Default)]
struct Slots {
    candidates: BTreeMap<String, Candidate>,
    held_databases: BTreeMap<String, BTreeSet<String>>,
}

impl Slots {
    fn previous(&self, area: &Area) -> Option<Value> {
        self.candidates
            .get(&Held::key(area))
            .and_then(|candidate| candidate.previous.clone())
    }
    fn set(&mut self, area: Area, fresh: Option<Value>) {
        let previous = self.previous(&area);
        self.candidates.insert(
            Held::key(&area),
            Candidate {
                area,
                fresh,
                previous,
            },
        );
    }

    /// One origin's report: its local storage and IndexedDB.
    fn absorb(&mut self, value: &Value, origin: &str, coverage: &mut Coverage) {
        let host = site(origin);
        let skips: Vec<PageSkip> =
            serde_json::from_value(value["skipped"].clone()).unwrap_or_default();
        for skip in skips {
            coverage.skipped(&host, skip.kind, skip.reason, skip.count);
        }
        let fields = [
            (
                Area::LocalStorage {
                    origin: origin.into(),
                },
                "local",
            ),
            (
                Area::IndexedDb {
                    origin: origin.into(),
                },
                "indexed",
            ),
        ];
        for (area, field) in fields {
            let mut payload = value[field].clone();
            // Skipped by the page and reported above: its synced copy stands in.
            if payload.is_null() {
                self.set(area, None);
                continue;
            }
            if field == "indexed" {
                let skipped =
                    serde_json::from_value(value["skipped_databases"].clone()).unwrap_or_default();
                let held = carry_databases(&mut payload, self.previous(&area).as_ref(), &skipped);
                if !held.is_empty() {
                    self.held_databases.insert(origin.into(), held);
                }
            }
            // A fixed valid profile is sufficient to canonicalize this area key.
            if area.key(&"a".repeat(64)).is_err() || area.validate_payload(&payload).is_err() {
                if let Some((host, kind)) = area_site(&area) {
                    coverage.skipped(&host, kind, SkipReason::Malformed, 1);
                }
                self.set(area, None);
                continue;
            }
            self.set(area, Some(payload));
        }
    }
}

fn unreadable(origin: &str, coverage: &mut Coverage) {
    let host = site(origin);
    coverage.skipped(&host, DataKind::LocalStorage, SkipReason::Unreadable, 1);
    coverage.skipped(&host, DataKind::IndexedDb, SkipReason::Unreadable, 1);
}

pub(in crate::infra) async fn capture(
    app: &tauri::AppHandle,
    physical: &str,
    previous: &[CredentialRecord],
    extra: Option<(Webview, Vec<String>)>,
    coverage: &mut Coverage,
) -> Result<Captured, String> {
    // Keep already captured, closed origins in the complete observation. They
    // cannot be mistaken for deletions merely because their tab isn't mounted.
    let mut slots = Slots::default();
    for record in previous
        .iter()
        .filter(|record| !matches!(record.area, Area::Cookies | Area::SessionStorage { .. }))
    {
        slots.candidates.insert(
            Held::key(&record.area),
            Candidate {
                area: record.area.clone(),
                fresh: Some(record.payload.clone()),
                previous: Some(record.payload.clone()),
            },
        );
    }
    let mut origins = BTreeSet::new();
    let mut live_keys = BTreeSet::new();
    for (_, view) in super::super::browser::sync_storage_views(app, physical)? {
        let Ok(url) = view.url() else { continue };
        if !matches!(url.scheme(), "http" | "https") {
            continue;
        }
        let origin = url.origin().ascii_serialization();
        // Local storage and IndexedDB are per origin: read them from one tab.
        if !origins.insert(origin.clone()) {
            continue;
        }
        let now = Instant::now();
        let (read, known) = {
            let mut cache = observed()
                .lock()
                .map_err(|_| "Website storage cache is unavailable")?;
            if cache.physical != physical {
                *cache = ObservedCache {
                    physical: physical.into(),
                    ..Default::default()
                };
            }
            read_request(&cache, &origin, now)
        };
        for (field, _) in FIELDS {
            live_keys.insert(cache_key(&origin, field));
        }
        match evaluate_read(&view, physical, &origin, read, known).await {
            Ok(mut value) => {
                if let Ok(mut cache) = observed().lock() {
                    if cache.physical == physical {
                        merge_observed(&mut cache, &mut value, &origin, now);
                    }
                }
                slots.absorb(&value, &origin, coverage)
            }
            Err(error) if error == PROFILE_UNVERIFIED => return Err(error),
            // Navigation or a busy page: its last synced copy stays; retried next pass.
            Err(_) => unreadable(&origin, coverage),
        }
    }
    // Forget pages that closed, so the cache stays bounded by what is open.
    if let Ok(mut cache) = observed().lock() {
        if cache.physical == physical {
            cache.areas.retain(|key, _| live_keys.contains(key));
        }
    }
    if let Some((owner, extra)) = extra {
        let mut storage = WebsiteStorage::new(owner, physical.into());
        for origin in extra {
            if !origins.insert(origin.clone()) {
                continue;
            }
            let value = match storage.origin_view(&origin).await {
                Ok(view) => evaluate(view, physical, &origin, None).await,
                Err(error) => Err(error),
            };
            match value {
                Ok(value) => slots.absorb(&value, &origin, coverage),
                Err(error) if error == PROFILE_UNVERIFIED => return Err(error),
                Err(_) => unreadable(&origin, coverage),
            }
        }
    }
    Ok(Captured {
        candidates: slots.candidates.into_values().collect(),
        held_databases: slots.held_databases,
    })
}

#[cfg(test)]
mod observed_tests;
