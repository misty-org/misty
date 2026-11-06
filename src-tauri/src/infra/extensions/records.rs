// SPDX-License-Identifier: MIT
//! A profile's extensions as profile data: which are installed and whether each is
//! on live in the profile's `extensions` collection. Packages never
//! travel; every computer fetches them from the store.
use super::{Installation, InstalledState};
use crate::infra::profile_data;
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

/// The writes that make the profile's list match what this device just
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
            // Computers update on their own schedules, so a version alone isn't a change.
            let unchanged = existing
                .is_some_and(|e| e.enabled == installation.enabled && e.name == installation.name);
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

/// Records an install, removal or on/off change into the profile's list after
/// this device reconciled it.
pub(crate) fn reconciled(
    profile: String,
    installations: Vec<Installation>,
    states: Vec<InstalledState>,
) {
    tauri::async_runtime::spawn(async move {
        let Some(profile) = profile_data::profile_records(&profile) else {
            return;
        };
        let Ok(records) = profile.records_list(EXTENSIONS).await else {
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
            let _ = profile.records_write(EXTENSIONS, writes).await;
        }
    });
}

#[derive(serde::Serialize)]
pub struct ListedExtension {
    id: String,
    enabled: bool,
}

/// What this window's profile should have, for following changes made elsewhere.
#[derive(serde::Serialize)]
pub struct ProfileExtensions {
    present: Vec<ListedExtension>,
    removed: Vec<String>,
}

#[tauri::command]
pub async fn profile_extensions_list(webview: tauri::Webview) -> Result<ProfileExtensions, String> {
    let label = webview.window().label().to_owned();
    if !crate::infra::profile_windows::is_person_window(&label) {
        return Err("Only a profile's own windows follow its extensions.".into());
    }
    let profile = crate::infra::profile_windows::profile_for_window(&label)
        .ok_or("This window has no profile.")?;
    let records = profile_data::profile_records(&profile).ok_or("Local storage is unavailable.")?;
    let present = records
        .records_list(EXTENSIONS)
        .await?
        .iter()
        .filter_map(parse)
        .map(|extension| ListedExtension {
            id: extension.store_id,
            enabled: extension.enabled,
        })
        .collect();
    let removed = records
        .deleted_ids(EXTENSIONS)
        .await?
        .into_iter()
        .filter_map(|id| id.strip_prefix("ext:").map(str::to_owned))
        .collect();
    Ok(ProfileExtensions { present, removed })
}

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
    fn turning_an_extension_off_or_removing_it_writes_the_profile() {
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
