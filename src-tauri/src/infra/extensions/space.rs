// SPDX-License-Identifier: MIT
//! A Space's extensions as Space data: which are installed and whether each is
//! on live in the `extensions` collection of the Space's vault. Packages never
//! travel; every device fetches them from the store.
use super::{Installation, InstalledState};
use crate::infra::browser_sync::{space_vault, SpaceVault};
use misty_browser_sync::{
    collections::EXTENSIONS,
    document::{
        entities::{Extension, Kind},
        ViewRecord,
    },
};
use serde_json::Value;
use std::collections::BTreeMap;

fn record_id(store_id: &str) -> String {
    format!("ext:{store_id}")
}

fn parse(record: &ViewRecord) -> Option<Extension> {
    if record.kind != Kind::Extension {
        return None;
    }
    serde_json::from_value(Value::Object(record.fields.clone().into_iter().collect())).ok()
}

fn record(extension: &Extension) -> Option<ViewRecord> {
    let Ok(Value::Object(fields)) = serde_json::to_value(extension) else {
        return None;
    };
    let fields = fields.into_iter().collect();
    misty_browser_sync::document::entities::validate(Kind::Extension, &fields).ok()?;
    Some(ViewRecord {
        kind: Kind::Extension,
        id: record_id(&extension.store_id),
        fields,
    })
}

/// The writes that make the Space's list match what this device just
/// reconciled. Unchanged extensions write nothing.
fn writes(
    current: &BTreeMap<String, Extension>,
    installations: &[Installation],
    states: &BTreeMap<String, InstalledState>,
    now: i64,
) -> Vec<(String, Option<ViewRecord>)> {
    installations
        .iter()
        .filter_map(|installation| {
            let id = record_id(&installation.id);
            let existing = current.get(&id);
            if !installation.installed {
                return existing.map(|_| (id, None));
            }
            let version = states
                .get(&installation.id)
                .and_then(|state| state.version.clone())
                .or_else(|| existing.map(|e| e.version.clone()))
                .unwrap_or_default();
            let unchanged = existing.is_some_and(|e| {
                e.enabled == installation.enabled
                    && e.version == version
                    && e.name == installation.name
            });
            if unchanged {
                return None;
            }
            let next = record(&Extension {
                store_id: installation.id.clone(),
                name: installation.name.clone(),
                version,
                enabled: installation.enabled,
                updated_at: now,
            })?;
            Some((id, Some(next)))
        })
        .collect()
}

/// Records an install, removal or on/off change into the Space's list after
/// this device reconciled it.
pub(crate) fn reconciled(
    space_id: Option<String>,
    installations: Vec<Installation>,
    states: Vec<InstalledState>,
) {
    tauri::async_runtime::spawn(async move {
        let Some(vault) = space_vault(space_id.as_deref()).await else {
            return;
        };
        let Ok((_, records)) = vault.handle.records_list(EXTENSIONS.into()).await else {
            return;
        };
        let current = records
            .iter()
            .filter_map(|record| Some((record.id.clone(), parse(record)?)))
            .collect();
        let states = states
            .into_iter()
            .map(|state| (state.id.clone(), state))
            .collect();
        let writes = writes(
            &current,
            &installations,
            &states,
            crate::infra::browser_library::now_ms(),
        );
        if !writes.is_empty() {
            let _ = vault.handle.records_write(EXTENSIONS.into(), writes).await;
        }
    });
}

/// Another device changed the Space's extensions.
///
/// Applying waits for an extension host per Space (phase 4 of
/// docs/plans/spaces-as-profiles.md): it will install or remove packages to
/// match the collection, turn each on or off, and ask before installing on a
/// device that has never had the extension. Until then this device keeps the
/// list it reconciles and the Space's copy only travels.
pub(crate) async fn changed(_vault: &SpaceVault) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn installation(id: &str, installed: bool, enabled: bool) -> Installation {
        Installation {
            id: id.into(),
            guid: id.into(),
            generation: "01951d32-40ac-7000-8000-000000000001".into(),
            name: "uBlock Origin Lite".into(),
            installed,
            enabled,
            private_access: false,
            agent_access: false,
            permissions: Vec::new(),
            hosts: Vec::new(),
        }
    }

    #[test]
    fn turning_an_extension_off_or_removing_it_writes_the_space() {
        let id = "ddkjiahejlhfcafbddmgiahcphecmpfh";
        let first = writes(
            &BTreeMap::new(),
            &[installation(id, true, true)],
            &BTreeMap::new(),
            1,
        );
        let (key, Some(on)) = &first[0] else { panic!() };
        assert_eq!(key, &record_id(id));
        let current = BTreeMap::from([(key.clone(), parse(on).unwrap())]);
        // Reconciling the same state again writes nothing.
        assert!(writes(
            &current,
            &[installation(id, true, true)],
            &BTreeMap::new(),
            2
        )
        .is_empty());
        let off = writes(
            &current,
            &[installation(id, true, false)],
            &BTreeMap::new(),
            3,
        );
        assert!(!parse(off[0].1.as_ref().unwrap()).unwrap().enabled);
        let removed = writes(
            &current,
            &[installation(id, false, false)],
            &BTreeMap::new(),
            4,
        );
        assert!(removed[0].1.is_none());
    }
}
