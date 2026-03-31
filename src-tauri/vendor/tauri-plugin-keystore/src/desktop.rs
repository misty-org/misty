use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};

use crate::models::*;

const TOKEN_SERVICE: &str = "com.impierce.identity-wallet";
const TOKEN_USER: &str = "tester";

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Keystore<R>> {
    Ok(Keystore(app.clone()))
}

pub struct Keystore<R: Runtime>(AppHandle<R>);

impl<R: Runtime> Keystore<R> {
    pub fn store(&self, payload: StoreRequest) -> crate::Result<()> {
        keyring::Entry::new(TOKEN_SERVICE, TOKEN_USER)?.set_password(&payload.value)?;
        Ok(())
    }

    pub fn retrieve(&self, payload: RetrieveRequest) -> crate::Result<RetrieveResponse> {
        let value = keyring::Entry::new(&payload.service, &payload.user)?.get_password()?;
        Ok(RetrieveResponse { value: Some(value) })
    }

    pub fn remove(&self, payload: RemoveRequest) -> crate::Result<()> {
        keyring::Entry::new(&payload.service, &payload.user)?.delete_credential()?;
        Ok(())
    }
}
