//! Site permission choices as Space data: each persistent store's choices live in
//! the `site_permissions` collection of the Space whose pages use that store, and
//! `misty.db` keeps a copy keyed by store that the engines read synchronously.
//! Private sessions and stores of no open Space stay on this device.
use super::{read_store, store::SitePermissions, write_store, Decision, Permissions};
use crate::infra::browser_sync::{hashed_id, store_vault, SpaceVault};
use misty_browser_sync::{
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

/// Choices made while their Space's vault was locked, by store key. They go up
/// when the vault opens, before its copy replaces the cache.
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
        // Choices this device has no setting for yet keep what the Space says.
        notifications: kept.map_or_else(SiteDecision::default, |kept| kept.notifications),
        popups: kept.map_or_else(SiteDecision::default, |kept| kept.popups),
        updated_at: crate::infra::browser_library::now_ms(),
    };
    let every_ask = [
        permission.camera,
        permission.microphone,
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

async fn write(vault: &SpaceVault, changes: &Changes) -> Result<(), ()> {
    let (_, records) = vault
        .handle
        .records_list(SITE_PERMISSIONS.into())
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
    vault
        .handle
        .records_write(SITE_PERMISSIONS.into(), writes)
        .await
        .map_err(|_| ())
}

/// Sends choices just saved to the cache for `store_key` to its Space. A
/// private store's key never names a Space, so its choices stay put.
pub(crate) fn publish(store_key: String, changes: Changes) {
    if changes.is_empty() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let sent = match store_vault(&store_key).await {
            Some(vault) => write(&vault, &changes).await.is_ok(),
            None => false,
        };
        if !sent {
            if let Ok(mut unsent) = unsent().lock() {
                unsent.entry(store_key).or_default().extend(changes);
            }
        }
    });
}

/// The Space's choices changed on another device, or its vault opened: its
/// copy replaces the cache for the store its pages use.
pub(crate) async fn space_changed(
    app: &AppHandle,
    vault: &SpaceVault,
    store_key: String,
    opened: bool,
) {
    if opened {
        let held = unsent()
            .lock()
            .ok()
            .and_then(|mut unsent| unsent.remove(&store_key));
        if let Some(held) = held {
            if write(vault, &held).await.is_err() {
                if let Ok(mut unsent) = unsent().lock() {
                    unsent.entry(store_key.clone()).or_default().extend(held);
                }
            }
        }
    }
    // Until the first pull completes, the vault's copy may be partial.
    if !vault
        .handle
        .records_ready(SITE_PERMISSIONS.into())
        .await
        .unwrap_or(false)
    {
        return;
    }
    let Ok((_, records)) = vault.handle.records_list(SITE_PERMISSIONS.into()).await else {
        return;
    };
    let sites: SitePermissions = records
        .iter()
        .filter_map(parse)
        .filter_map(|site| {
            let permissions = Permissions {
                camera: decision(site.camera),
                microphone: decision(site.microphone),
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

/// This device's choices for the personal Space's store, for its first seed.
pub(crate) fn seed_records(
    connection: &rusqlite::Connection,
    store_key: &str,
    legacy_key: Option<&str>,
) -> Vec<ViewRecord> {
    let mut sites: BTreeMap<String, Permissions> = BTreeMap::new();
    // The legacy store's choices first, so the selected store's win.
    for key in legacy_key.into_iter().chain([store_key]) {
        let Ok(mut statement) = connection
            .prepare("SELECT origin, permissions FROM site_permissions WHERE profile = ?1")
        else {
            return Vec::new();
        };
        let rows = statement.query_map([key], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        });
        for (origin, raw) in rows.into_iter().flatten().flatten() {
            if let Ok(permissions) = serde_json::from_str::<Permissions>(&raw) {
                sites.insert(origin, permissions);
            }
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
            microphone: Decision::Ask,
        };
        let written = record("https://meet.example", &blocked, None).unwrap();
        misty_browser_sync::document::entities::validate(written.kind, &written.fields).unwrap();
        let site = parse(&written).unwrap();
        assert_eq!(site.camera, SiteDecision::Block);
        assert_eq!(written.id, record_id("https://meet.example"));
        assert!(record("https://meet.example", &Permissions::default(), None).is_none());
        // A pop-up choice from the Space keeps the record alive.
        let kept = SitePermission {
            popups: SiteDecision::Allow,
            ..site
        };
        assert!(record("https://meet.example", &Permissions::default(), Some(&kept)).is_some());
    }
}
