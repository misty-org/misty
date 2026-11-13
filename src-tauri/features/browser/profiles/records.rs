//! One profile's records: what its windows and native data read and write.
use super::*;

/// One profile's records.
#[derive(Clone)]
pub struct ProfileRecords {
    pub profile: String,
    pub(super) store: Arc<Mutex<LocalStore>>,
}

impl ProfileRecords {
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
}
