use crate::models::*;
use serde::de::DeserializeOwned;
use tauri::{plugin::PluginApi, AppHandle, Runtime};
const TOKEN_SERVICE: &str = "com.impierce.identity-wallet";
const TOKEN_USER: &str = "tester";

pub fn init<R: Runtime, C: DeserializeOwned>(
    app: &AppHandle<R>,
    _api: PluginApi<R, C>,
) -> crate::Result<Keystore<R>> {
    #[cfg(mobile)]
    {
        use tauri::Manager;
        let root = app
            .path()
            .app_local_data_dir()
            .map_err(|error| std::io::Error::other(error.to_string()))?;
        std::fs::create_dir_all(&root)?;
        misty_credential_store::configure_root(root.join(".auth"))?;
    }
    Ok(Keystore(app.clone()))
}

pub struct Keystore<R: Runtime>(AppHandle<R>);
impl<R: Runtime> Keystore<R> {
    pub fn store(&self, payload: StoreRequest) -> crate::Result<()> {
        misty_credential_store::store(TOKEN_SERVICE, TOKEN_USER, &payload.value)?;
        Ok(())
    }
    pub fn retrieve(&self, payload: RetrieveRequest) -> crate::Result<RetrieveResponse> {
        let mut value = misty_credential_store::load(&payload.service, &payload.user)?;
        // Import the prior macOS debug file. Production Keychain items are left
        // untouched; this plugin never requests access to them.
        #[cfg(target_os = "macos")]
        if value.is_none() && payload.service == TOKEN_SERVICE && payload.user == TOKEN_USER {
            use tauri::Manager;
            let profile = std::env::var("MISTY_PROFILE")
                .or_else(|_| std::env::var("MISTY_DESKTOP_PROFILE"))
                .ok();
            let profile = profile
                .as_deref()
                .and_then(normalize_profile)
                .unwrap_or_else(|| "default".to_owned());
            let legacy = self
                .0
                .path()
                .app_local_data_dir()
                .map_err(|error| std::io::Error::other(error.to_string()))?
                .join("development-credentials")
                .join(format!("account-session-{profile}.json"));
            if let Some(saved) = misty_credential_store::read_private_file(&legacy)? {
                misty_credential_store::store(TOKEN_SERVICE, TOKEN_USER, &saved)?;
                std::fs::remove_file(legacy)?;
                value = Some(saved);
            }
        }
        Ok(RetrieveResponse { value })
    }
    pub fn remove(&self, payload: RemoveRequest) -> crate::Result<()> {
        // Import first so removing a session cannot resurrect a legacy file.
        self.retrieve(RetrieveRequest {
            service: payload.service.clone(),
            user: payload.user.clone(),
        })?;
        misty_credential_store::delete(&payload.service, &payload.user)?;
        Ok(())
    }
}
#[cfg(target_os = "macos")]
fn normalize_profile(profile: &str) -> Option<String> {
    let profile = profile.trim().to_ascii_lowercase();
    if profile.is_empty()
        || profile.len() > 32
        || !profile.as_bytes()[0].is_ascii_alphanumeric()
        || !profile
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return None;
    }
    Some(profile)
}
