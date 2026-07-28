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
        keyring::Entry::new(TOKEN_SERVICE, &token_user())?.set_password(&payload.value)?;
        Ok(())
    }

    pub fn retrieve(&self, payload: RetrieveRequest) -> crate::Result<RetrieveResponse> {
        let value =
            keyring::Entry::new(&payload.service, &credential_user(&payload.service, &payload.user))?
                .get_password()?;
        Ok(RetrieveResponse { value: Some(value) })
    }

    pub fn remove(&self, payload: RemoveRequest) -> crate::Result<()> {
        keyring::Entry::new(&payload.service, &credential_user(&payload.service, &payload.user))?
            .delete_credential()?;
        Ok(())
    }
}

fn token_user() -> String {
    std::env::var("MISTY_PROFILE")
        .or_else(|_| std::env::var("MISTY_DESKTOP_PROFILE"))
        .ok()
        .and_then(|profile| normalize_profile(&profile))
        .map(|profile| format!("{TOKEN_USER}:{profile}"))
        .unwrap_or_else(|| TOKEN_USER.to_owned())
}

fn normalize_profile(profile: &str) -> Option<String> {
    let profile = profile.trim().to_ascii_lowercase();
    let mut chars = profile.chars();
    let first = chars.next()?;
    if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
        return None;
    }
    if profile.len() > 32 {
        return None;
    }
    if !chars.all(|character| character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-') {
        return None;
    }
    Some(profile)
}

fn profile_token_user(profile: Option<&str>) -> String {
    profile
        .and_then(normalize_profile)
        .filter(|profile| !profile.is_empty())
        .map(|profile| format!("{TOKEN_USER}:{profile}"))
        .unwrap_or_else(|| TOKEN_USER.to_owned())
}

fn credential_user(service: &str, user: &str) -> String {
    if service == TOKEN_SERVICE && user == TOKEN_USER {
        token_user()
    } else {
        user.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profiles_scope_the_default_token_user() {
        assert_eq!(profile_token_user(Some("david")), "tester:david");
        assert_eq!(profile_token_user(Some(" David ")), "tester:david");
    }

    #[test]
    fn invalid_profiles_fall_back_to_default_token_user() {
        assert_eq!(profile_token_user(None), "tester");
        assert_eq!(profile_token_user(Some("")), "tester");
        assert_eq!(profile_token_user(Some("../bad")), "tester");
    }

    #[test]
    fn profile_mapping_only_rewrites_the_default_token() {
        assert_eq!(
            credential_user(TOKEN_SERVICE, TOKEN_USER),
            profile_token_user(std::env::var("MISTY_PROFILE").ok().as_deref())
        );
        assert_eq!(credential_user(TOKEN_SERVICE, "tester:david"), "tester:david");
        assert_eq!(credential_user("other", TOKEN_USER), TOKEN_USER);
    }
}
