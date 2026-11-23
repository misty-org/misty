use super::requests::{self, Request};
use super::AccountStore as Store;

pub(super) async fn on_store<T: Send + 'static>(
    store: &Store,
    work: impl FnOnce(&Store) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let store = store.clone();
    tokio::task::spawn_blocking(move || work(&store))
        .await
        .map_err(|_| "Misty couldn't read this computer's app requests.".to_owned())?
}

pub async fn current_request(store: &Store, id: &str) -> Result<Option<Request>, String> {
    let owned = id.to_owned();
    on_store(store, move |store| requests::get(store, &owned)).await
}
