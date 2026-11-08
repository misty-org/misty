//! Reaching the account's records from a long-running pass. Each step takes the account-change
//! lease for just that step and checks the account is still the one the pass began under, so a
//! pass never writes into the next account's records and never keeps a store open across a change.
use crate::browser::profiles::{self, browser_lifecycle};
use browser_data::document::ViewRecord;
use serde::{de::DeserializeOwned, Serialize};
use tokio::sync::RwLockReadGuard;
use zeroize::Zeroizing;

/// The account changed or the store couldn't be reached. Either way this pass stops.
#[derive(Debug)]
pub(super) struct Unavailable;

pub(super) type Stored<T> = Result<T, Unavailable>;

/// The account a pass runs under.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct Scope {
    epoch: u64,
}

impl Scope {
    pub fn current() -> Self {
        Self {
            epoch: profiles::account_epoch(),
        }
    }

    pub fn is_current(self) -> bool {
        self.epoch == profiles::account_epoch()
    }

    /// Holds the account steady for one step, such as one engine write.
    pub async fn lease(self) -> Stored<RwLockReadGuard<'static, ()>> {
        let lease = browser_lifecycle().read().await;
        if !self.is_current() {
            return Err(Unavailable);
        }
        Ok(lease)
    }

    pub async fn list(self, profile: &str, collection: &str) -> Stored<Vec<ViewRecord>> {
        let _lease = self.lease().await?;
        let records = profiles::profile_records(profile).ok_or(Unavailable)?;
        records
            .records_list(collection)
            .await
            .map_err(|_| Unavailable)
    }

    pub async fn write(
        self,
        profile: &str,
        collection: &str,
        writes: Vec<(String, Option<ViewRecord>)>,
    ) -> Stored<()> {
        let _lease = self.lease().await?;
        let records = profiles::profile_records(profile).ok_or(Unavailable)?;
        records
            .records_write(collection, writes)
            .await
            .map_err(|_| Unavailable)
    }

    pub async fn get(
        self,
        profile: &str,
        collection: &str,
        id: &str,
    ) -> Stored<Option<ViewRecord>> {
        let (profile, collection, id) = (profile.to_owned(), collection.to_owned(), id.to_owned());
        self.with_store(move |store| store.get(&profile, &collection, &id))
            .await
    }

    pub async fn meta(self, key: &str) -> Stored<Option<String>> {
        let key = key.to_owned();
        self.with_store(move |store| store.meta(&key)).await
    }

    pub async fn set_meta(self, key: &str, value: &str) -> Stored<()> {
        let (key, value) = (key.to_owned(), value.to_owned());
        self.with_store(move |store| store.set_meta(&key, &value))
            .await
    }

    /// A value kept sealed with the store: it names sites, so never in its plain settings.
    pub async fn sealed<T: DeserializeOwned + Default + Send + 'static>(
        self,
        name: &str,
    ) -> Stored<T> {
        let name = name.to_owned();
        // Damaged counts as absent: a store that can't read this starts over rather than stick.
        let bytes = self
            .with_store(move |store| Ok(store.secret(&name).ok().flatten()))
            .await?;
        Ok(bytes
            .and_then(|bytes: Zeroizing<Vec<u8>>| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default())
    }

    pub async fn seal<T: Serialize>(self, name: &str, value: &T) -> Stored<()> {
        let name = name.to_owned();
        let bytes = serde_json::to_vec(value).map_err(|_| Unavailable)?;
        self.with_store(move |store| store.set_secret(&name, &bytes))
            .await
    }

    async fn with_store<T: Send + 'static>(
        self,
        work: impl FnOnce(&mut browser_data::local::LocalStore) -> browser_data::Result<T>
            + Send
            + 'static,
    ) -> Stored<T> {
        let _lease = self.lease().await?;
        tokio::task::spawn_blocking(move || {
            let store = profiles::local_store().map_err(|_| Unavailable)?;
            let mut store = store.lock().map_err(|_| Unavailable)?;
            work(&mut store).map_err(|_| Unavailable)
        })
        .await
        .map_err(|_| Unavailable)?
    }
}
