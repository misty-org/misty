//! The list of profiles travels in the vault: a name, color, order and claimed sites for each. The
//! store a profile opens in never does; that belongs to this computer.
use super::*;
use misty_browser_sync::document::{entities::Kind, ViewRecord};
use profile_windows::ProfileEntry;

/// The list isn't any one profile's, so it lives under this empty name.
pub(super) const LIST_OWNER: &str = "";
pub(super) const COLLECTION: &str = "profiles";

fn record(entry: &ProfileEntry) -> Option<ViewRecord> {
    let serde_json::Value::Object(fields) = serde_json::to_value(entry).ok()? else {
        return None;
    };
    Some(ViewRecord {
        kind: Kind::Profile,
        id: entry.id.clone(),
        fields: fields.into_iter().collect(),
    })
}

/// Saves the current list, so a new vault or a change here goes out.
pub(super) fn publish_all(app: &AppHandle) {
    let Some(records) = profile_data::profile_records(LIST_OWNER) else {
        return;
    };
    let writes: Vec<_> = profile_windows::listed_profiles()
        .iter()
        .filter_map(|entry| Some((entry.id.clone(), Some(record(entry)?))))
        .collect();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = records.records_write(COLLECTION, writes).await;
        let _ = app;
    });
}

/// A profile was created, changed or deleted here.
pub(crate) fn profile_changed(id: &str, entry: Option<&ProfileEntry>) {
    let Some(records) = profile_data::profile_records(LIST_OWNER) else {
        return;
    };
    let write = (id.to_owned(), entry.and_then(record));
    tauri::async_runtime::spawn(async move {
        let _ = records.records_write(COLLECTION, vec![write]).await;
    });
}

/// Applies the list from the vault: new profiles appear, changes follow, and a profile deleted
/// elsewhere is deleted here too, its local store included. The first profile always stays.
pub(crate) fn follow_remote_list(app: AppHandle) {
    let mut changes = profile_data::subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            match changes.recv().await {
                Ok(change) if change.remote && change.collection == COLLECTION => apply(&app).await,
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

async fn apply(app: &AppHandle) {
    let Some(records) = profile_data::profile_records(LIST_OWNER) else {
        return;
    };
    let Ok(listed) = records.records_list(COLLECTION).await else {
        return;
    };
    let incoming: Vec<ProfileEntry> = listed
        .into_iter()
        .filter(|record| record.kind == Kind::Profile)
        .filter_map(|record| {
            serde_json::from_value(serde_json::Value::Object(
                record.fields.into_iter().collect(),
            ))
            .ok()
        })
        .collect();
    if incoming.is_empty() {
        return;
    }
    profile_windows::apply_remote_profiles(app, incoming);
}
