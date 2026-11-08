//! Site permission choices as profile data: each persistent store's choices live in the
//! `site_permissions` collection of the profile whose pages use that store, and `misty.db` keeps
//! a copy keyed by store that the engines read synchronously. Private sessions stay on this
//! computer.
use super::{read_store, store::SitePermissions, write_store, Decision, Permissions};
use crate::browser::profiles::{self, hashed_id, ProfileRecords};
use browser_data::{
    collections::SITE_PERMISSIONS,
    document::{
        entities::{Kind, SiteDecision, SitePermission},
        ViewRecord,
    },
};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    sync::{Mutex, OnceLock},
};
use tauri::AppHandle;

type Changes = BTreeMap<String, Permissions>;

/// Choices that couldn't be saved yet because key storage didn't answer, by store key. They go
/// with the next save, before anything replaces the cache.
fn unsent() -> &'static Mutex<BTreeMap<String, Changes>> {
    static UNSENT: OnceLock<Mutex<BTreeMap<String, Changes>>> = OnceLock::new();
    UNSENT.get_or_init(Mutex::default)
}

fn record_id(origin: &str) -> String {
    hashed_id("site", origin)
}

fn site_decision(decision: &Decision) -> SiteDecision {
    match decision {
        Decision::Ask => SiteDecision::Ask,
        Decision::Allow => SiteDecision::Allow,
        Decision::Block => SiteDecision::Block,
    }
}

fn decision(value: SiteDecision) -> Decision {
    match value {
        SiteDecision::Ask => Decision::Ask,
        SiteDecision::Allow => Decision::Allow,
        SiteDecision::Block => Decision::Block,
    }
}

fn record(
    origin: &str,
    permissions: &Permissions,
    kept: Option<&SitePermission>,
) -> Option<ViewRecord> {
    let permission = SitePermission {
        origin: origin.to_owned(),
        camera: site_decision(&permissions.camera),
        microphone: site_decision(&permissions.microphone),
        location: site_decision(&permissions.location),
        // Choices this computer has no setting for yet keep what the profile says.
        notifications: kept.map_or_else(SiteDecision::default, |kept| kept.notifications),
        popups: kept.map_or_else(SiteDecision::default, |kept| kept.popups),
        updated_at: crate::browser::history_downloads::library::now_ms(),
    };
    let every_ask = [
        permission.camera,
        permission.microphone,
        permission.location,
        permission.notifications,
        permission.popups,
    ]
    .iter()
    .all(|decision| *decision == SiteDecision::Ask);
    if every_ask {
        return None;
    }
    let Ok(Value::Object(fields)) = serde_json::to_value(&permission) else {
        return None;
    };
    Some(ViewRecord {
        kind: Kind::SitePermission,
        id: record_id(origin),
        fields: fields.into_iter().collect(),
    })
}

fn parse(record: &ViewRecord) -> Option<SitePermission> {
    if record.kind != Kind::SitePermission {
        return None;
    }
    serde_json::from_value(Value::Object(record.fields.clone().into_iter().collect())).ok()
}

async fn write(profile: &ProfileRecords, changes: &Changes) -> Result<(), ()> {
    let records = profile
        .records_list(SITE_PERMISSIONS)
        .await
        .map_err(|_| ())?;
    let current: BTreeMap<String, SitePermission> = records
        .iter()
        .filter_map(|record| Some((record.id.clone(), parse(record)?)))
        .collect();
    let writes: Vec<(String, Option<ViewRecord>)> = changes
        .iter()
        .filter_map(|(origin, permissions)| {
            let id = record_id(origin);
            let next = record(origin, permissions, current.get(&id));
            (next.is_some() || current.contains_key(&id)).then_some((id, next))
        })
        .collect();
    if writes.is_empty() {
        return Ok(());
    }
    profile
        .records_write(SITE_PERMISSIONS, writes)
        .await
        .map_err(|_| ())
}

/// Sends choices just saved to the cache for `store_key` to its profile. A private store's key
/// names no profile, so its choices stay put.
pub(crate) fn publish(store_key: String, changes: Changes) {
    if changes.is_empty() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let mut changes = changes;
        let held = unsent()
            .lock()
            .ok()
            .and_then(|mut unsent| unsent.remove(&store_key));
        if let Some(mut held) = held {
            held.extend(changes);
            changes = held;
        }
        let sent = match profiles::store_records(&store_key) {
            Some(profile) => write(&profile, &changes).await.is_ok(),
            None => false,
        };
        if !sent {
            if let Ok(mut unsent) = unsent().lock() {
                unsent.entry(store_key).or_default().extend(changes);
            }
        }
    });
}

/// Follows other signed-in sessions' changes to site choices into the cache.
pub(crate) fn follow_remote_changes(app: AppHandle) {
    let mut changes = profiles::subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            match changes.recv().await {
                Ok(change) if change.remote && change.collection == SITE_PERMISSIONS => {
                    let store_key = crate::browser::app_windows::store_for_profile(&change.profile)
                        .and_then(|store| super::store_key(store.as_deref()));
                    if let (Ok(store_key), Some(profile)) =
                        (store_key, profiles::profile_records(&change.profile))
                    {
                        profile_changed(&app, &profile, store_key).await;
                    }
                }
                Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

/// The profile's choices changed in another signed-in session: its copy replaces the cache for
/// the store its pages use.
async fn profile_changed(app: &AppHandle, profile: &ProfileRecords, store_key: String) {
    let Ok(records) = profile.records_list(SITE_PERMISSIONS).await else {
        return;
    };
    let sites: SitePermissions = records
        .iter()
        .filter_map(parse)
        .filter_map(|site| {
            let permissions = Permissions {
                camera: decision(site.camera),
                microphone: decision(site.microphone),
                location: decision(site.location),
            };
            (permissions != Permissions::default()).then_some((site.origin, permissions))
        })
        .collect();
    // Store read/modify/write runs on the main thread, like every other edit.
    let _ = app.run_on_main_thread(move || {
        let mut store = read_store();
        let unchanged = match store.get(&store_key) {
            Some(cached) => *cached == sites,
            None => sites.is_empty(),
        };
        if unchanged {
            return;
        }
        if sites.is_empty() {
            store.remove(&store_key);
        } else {
            store.insert(store_key, sites);
        }
        let _ = write_store(&store);
    });
}

/// This computer's choices for the first profile's store, for its seed.
pub(crate) fn seed_records(connection: &rusqlite::Connection, store_key: &str) -> Vec<ViewRecord> {
    let mut sites: BTreeMap<String, Permissions> = BTreeMap::new();
    let Ok(mut statement) =
        connection.prepare("SELECT origin, permissions FROM site_permissions WHERE profile = ?1")
    else {
        return Vec::new();
    };
    let rows = statement.query_map([store_key], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    });
    for (origin, raw) in rows.into_iter().flatten().flatten() {
        if let Ok(permissions) = serde_json::from_str::<Permissions>(&raw) {
            sites.insert(origin, permissions);
        }
    }
    sites
        .iter()
        .filter_map(|(origin, permissions)| record(origin, permissions, None))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_site_with_every_choice_at_ask_has_no_record() {
        let blocked = Permissions {
            camera: Decision::Block,
            ..Permissions::default()
        };
        let written = record("https://meet.example", &blocked, None).unwrap();
        browser_data::document::entities::validate(written.kind, &written.fields).unwrap();
        let site = parse(&written).unwrap();
        assert_eq!(site.camera, SiteDecision::Block);
        assert_eq!(written.id, record_id("https://meet.example"));
        assert!(!written.fields.contains_key("location"));
        assert!(record("https://meet.example", &Permissions::default(), None).is_none());
        let located = Permissions {
            location: Decision::Allow,
            ..Permissions::default()
        };
        let written = record("https://maps.example", &located, None).unwrap();
        assert_eq!(parse(&written).unwrap().location, SiteDecision::Allow);
        // A pop-up choice from the profile keeps the record alive.
        let kept = SitePermission {
            popups: SiteDecision::Allow,
            ..site
        };
        assert!(record("https://meet.example", &Permissions::default(), Some(&kept)).is_some());
    }
}
