//! One profile's records: what its windows and native data read and write.
use super::*;

/// One profile's records.
#[derive(Clone)]
pub struct ProfileRecords {
    pub profile: String,
    pub(super) store: Arc<Mutex<LocalStore>>,
}

impl ProfileRecords {
    /// A collection's live records.
    pub async fn records_list(&self, collection: &str) -> Result<Vec<ViewRecord>, String> {
        let (store, profile, collection) = (
            self.store.clone(),
            self.profile.clone(),
            collection.to_owned(),
        );
        tokio::task::spawn_blocking(move || {
            store
                .lock()
                .map_err(|_| "Local storage is unavailable.".to_owned())?
                .list(&profile, &collection)
                .map_err(|_| "Local storage is unavailable.".to_owned())
        })
        .await
        .map_err(|_| "Local storage is unavailable.".to_owned())?
    }

    /// Saves local edits: `None` deletes.
    pub async fn records_write(
        &self,
        collection: &str,
        writes: Vec<(String, Option<ViewRecord>)>,
    ) -> Result<(), String> {
        let (store, profile, name) = (
            self.store.clone(),
            self.profile.clone(),
            collection.to_owned(),
        );
        tokio::task::spawn_blocking(move || {
            store
                .lock()
                .map_err(|_| "Local storage is unavailable.".to_owned())?
                .write(&profile, &name, writes)
                .map_err(|_| "Local storage is unavailable.".to_owned())
        })
        .await
        .map_err(|_| "Local storage is unavailable.".to_owned())??;
        Ok(())
    }

    /// Saves an opaque record body: `None` deletes.
    pub async fn raw_write(
        &self,
        collection: &str,
        id: &str,
        body: Option<Vec<u8>>,
    ) -> Result<(), String> {
        let (store, profile, name, id) = (
            self.store.clone(),
            self.profile.clone(),
            collection.to_owned(),
            id.to_owned(),
        );
        tokio::task::spawn_blocking(move || {
            store
                .lock()
                .map_err(|_| "Local storage is unavailable.".to_owned())?
                .write_one(&profile, &name, &id, body.as_deref())
                .map_err(|_| "Local storage is unavailable.".to_owned())
        })
        .await
        .map_err(|_| "Local storage is unavailable.".to_owned())??;
        Ok(())
    }
}

/// A stable record id for text that may not be one (an origin, a download id).
pub fn hashed_id(prefix: &str, value: &str) -> String {
    format!("{prefix}:{}", &hashed(value)[..32])
}
