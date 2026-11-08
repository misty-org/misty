//! The records a renderer may read and write: the ones it shows and edits itself. Everything else
//! (passwords, permissions, search) stays native.
use super::*;
use browser_data::{
    collections::{BOOKMARKS, EXTENSIONS, SEARCH, TAB_GROUPS},
    document::{
        entities,
        renderer::{from_renderer, to_renderer},
    },
};
use serde::Deserialize;
use serde_json::Value;

/// Collections a renderer may touch.
fn renderer_collection(collection: &str) -> Result<(), String> {
    if matches!(collection, BOOKMARKS | TAB_GROUPS) {
        Ok(())
    } else {
        Err("This data is managed natively.".into())
    }
}

/// The calling window's profile. Incognito windows have no access to a profile's records.
fn records_for(webview: &tauri::Webview) -> Result<ProfileRecords, String> {
    let label = webview.window().label().to_owned();
    if !crate::browser::app_windows::is_person_window(&label) {
        return Err("Only a profile's own windows can read its records.".into());
    }
    window_records(&label).ok_or_else(|| "This computer's key storage is unavailable.".into())
}

#[tauri::command]
pub async fn profile_records_list(
    webview: tauri::Webview,
    collection: String,
) -> Result<Vec<Value>, String> {
    renderer_collection(&collection)?;
    let records = records_for(&webview)?.records_list(&collection).await?;
    Ok(records.iter().filter_map(renderer_record).collect())
}

/// A record under the names the renderer uses. Stored records keep the names they were written with.
fn renderer_record(record: &ViewRecord) -> Option<Value> {
    let mut value = serde_json::to_value(record).ok()?;
    to_renderer(&mut value);
    Some(value)
}

fn stored_record(mut value: Value) -> Option<ViewRecord> {
    from_renderer(&mut value);
    serde_json::from_value(value).ok()
}

#[derive(Deserialize)]
pub struct RecordWrite {
    id: String,
    record: Option<Value>,
}

/// Saves a window's edits. One record that doesn't validate is refused by itself and reported;
/// the rest are saved, so a bad record can never hold back the others.
#[tauri::command]
pub async fn profile_records_write(
    webview: tauri::Webview,
    collection: String,
    writes: Vec<RecordWrite>,
) -> Result<Vec<String>, String> {
    renderer_collection(&collection)?;
    if writes.len() > 5_000 {
        return Err("Too many changes at once.".into());
    }
    let records = records_for(&webview)?;
    let mut rejected = Vec::new();
    let mut valid = Vec::with_capacity(writes.len());
    for write in writes {
        let Some(value) = write.record else {
            valid.push((write.id, None));
            continue;
        };
        match stored_record(value).filter(|record| {
            record.id == write.id && entities::validate(record.kind, &record.fields).is_ok()
        }) {
            Some(record) => valid.push((write.id, Some(record))),
            None => rejected.push(write.id),
        }
    }
    records.records_write(&collection, valid).await?;
    Ok(rejected)
}

/// Pages and windows react to these. The rest stays native.
fn shown_in_windows(collection: &str) -> bool {
    matches!(
        collection,
        BOOKMARKS | EXTENSIONS | TAB_GROUPS | SEARCH | TABS
    )
}

/// Forwards record changes to the windows of the profile they belong to.
pub fn forward_changes(app: tauri::AppHandle) {
    let mut changes = subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            match changes.recv().await {
                Ok(change) if shown_in_windows(&change.collection) => {
                    crate::browser::app_windows::emit_to_profile(
                        &app,
                        &change.profile.clone(),
                        RECORDS_CHANGED_EVENT,
                        change,
                    )
                }
                Ok(_) => {}
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

#[cfg(test)]
mod boundary {
    use super::*;

    /// Written by `src/features/workspace/profileRecordsBoundary.test.ts` from the real renderer code.
    const RECORDS: &str = include_str!("testdata/renderer_records.json");

    fn collection(name: &str) -> Vec<Value> {
        let all: Value = serde_json::from_str(RECORDS).unwrap();
        all[name].as_array().unwrap().clone()
    }

    #[test]
    fn what_the_renderer_writes_is_accepted_and_reads_back_the_same() {
        for name in ["bookmarks", "tab_groups"] {
            let records = collection(name);
            assert!(!records.is_empty(), "{name} has nothing to check");
            for original in records {
                let record = stored_record(original.clone())
                    .unwrap_or_else(|| panic!("{name}: couldn't read {original}"));
                entities::validate(record.kind, &record.fields)
                    .unwrap_or_else(|_| panic!("{name}: the validator refused {original}"));
                assert_eq!(renderer_record(&record).unwrap(), original);
            }
        }
    }

    #[test]
    fn what_a_tab_publishes_is_accepted() {
        for tab in collection("tabs") {
            let tab: crate::browser::profiles::TabRecord = serde_json::from_value(tab).unwrap();
            let kind = entities::Kind::OpenTab;
            entities::validate(kind, &tab.fields).unwrap();
            assert!(tab.fields.contains_key("tree"));
        }
    }

    #[test]
    fn the_stored_names_stay_the_ones_older_records_use() {
        let bookmark = collection("bookmarks")
            .into_iter()
            .find(|record| record["kind"] == "bookmark")
            .unwrap();
        let stored = serde_json::to_value(stored_record(bookmark).unwrap()).unwrap();
        assert_eq!(stored["kind"], "website");
        assert!(stored["fields"]["group_id"].is_string());
    }
}
