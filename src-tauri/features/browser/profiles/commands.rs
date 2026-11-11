//! Record changes a profile's windows are told about. Nothing here lets a renderer read or write
//! a profile's records: those stay native.
use super::*;
use browser_data::collections::EXTENSIONS;

/// Pages and windows react to these. The rest stays native.
fn shown_in_windows(collection: &str) -> bool {
    matches!(collection, EXTENSIONS | TABS)
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
    use browser_data::document::entities;
    use serde_json::Value;

    /// Written by `src/features/app-windows/tabs/profileTabRecordBoundary.test.ts` from the real
    /// renderer code.
    const RECORDS: &str = include_str!("testdata/renderer_records.json");

    fn collection(name: &str) -> Vec<Value> {
        let all: Value = serde_json::from_str(RECORDS).unwrap();
        all[name].as_array().unwrap().clone()
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
}
