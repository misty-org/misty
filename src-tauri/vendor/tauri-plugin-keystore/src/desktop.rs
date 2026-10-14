use crate::models::*;
use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};
const TOKEN_SERVICE: &str = "com.impierce.identity-wallet";
const TOKEN_USER: &str = "tester";

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Keystore<R>> {
    Ok(Keystore(app.clone()))
}

/// The renderer's door to Misty's credential store (encrypted rows in `misty.db`).
/// Despite the name, it never talks to an operating-system keychain itself.
pub struct Keystore<R: Runtime>(AppHandle<R>);
impl<R: Runtime> Keystore<R> {
    pub fn store(&self, payload: StoreRequest) -> crate::Result<()> {
        misty_credential_store::store(TOKEN_SERVICE, TOKEN_USER, &payload.value)?;
        Ok(())
    }
    pub fn retrieve(&self, payload: RetrieveRequest) -> crate::Result<RetrieveResponse> {
        let value = misty_credential_store::load(&payload.service, &payload.user)?;
        Ok(RetrieveResponse { value })
    }
    pub fn remove(&self, payload: RemoveRequest) -> crate::Result<()> {
        misty_credential_store::delete(&payload.service, &payload.user)?;
        Ok(())
    }
}
