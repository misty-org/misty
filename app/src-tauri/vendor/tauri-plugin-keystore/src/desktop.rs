use serde::de::DeserializeOwned;
#[cfg(all(target_os = "macos", debug_assertions))]
use std::{
    fs,
    io::{self, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::PathBuf,
};
#[cfg(all(target_os = "macos", debug_assertions))]
use tauri::Manager;
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
        #[cfg(all(target_os = "macos", debug_assertions))]
        {
            return store_development_token(&self.0, &payload.value);
        }

        #[cfg(not(all(target_os = "macos", debug_assertions)))]
        {
            keyring::Entry::new(TOKEN_SERVICE, &token_user())?.set_password(&payload.value)?;
            Ok(())
        }
    }

    pub fn retrieve(&self, payload: RetrieveRequest) -> crate::Result<RetrieveResponse> {
        let user = credential_user(&payload.service, &payload.user);

        #[cfg(all(target_os = "macos", debug_assertions))]
        if payload.service == TOKEN_SERVICE && payload.user == TOKEN_USER {
            if let Some(value) = retrieve_development_token(&self.0)? {
                return Ok(RetrieveResponse { value: Some(value) });
            }
            if development_keychain_migration_complete(&self.0)? {
                return Ok(RetrieveResponse { value: None });
            }

            // Migrate the existing Keychain value once. Development binaries
            // are ad-hoc signed, so their code identity changes after a rebuild
            // and macOS asks the user to authorize the same item repeatedly.
            match keyring::Entry::new(&payload.service, &user)?.get_password() {
                Ok(value) => {
                    store_development_token(&self.0, &value)?;
                    return Ok(RetrieveResponse { value: Some(value) });
                }
                Err(keyring::Error::NoEntry) => {
                    mark_development_keychain_migration_complete(&self.0)?;
                    return Ok(RetrieveResponse { value: None });
                }
                Err(error) => return Err(error.into()),
            }
        }

        let value = keyring::Entry::new(&payload.service, &user)?.get_password()?;
        Ok(RetrieveResponse { value: Some(value) })
    }

    pub fn remove(&self, payload: RemoveRequest) -> crate::Result<()> {
        #[cfg(all(target_os = "macos", debug_assertions))]
        if payload.service == TOKEN_SERVICE && payload.user == TOKEN_USER {
            return remove_development_token(&self.0);
        }

        keyring::Entry::new(
            &payload.service,
            &credential_user(&payload.service, &payload.user),
        )?
        .delete_credential()?;
        Ok(())
    }
}

// A debug binary has no stable macOS code-signing identity: every rebuild gets
// a new ad-hoc signature and therefore loses access to its previous Keychain
// ACL. Keep development sessions in Misty's private application-data directory
// instead. Release builds never compile this path and continue to use Keychain.
#[cfg(all(target_os = "macos", debug_assertions))]
fn development_token_path<R: Runtime>(app: &AppHandle<R>) -> crate::Result<PathBuf> {
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| io::Error::other(error.to_string()))?
        .join("development-credentials");
    fs::create_dir_all(&directory)?;
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
    Ok(directory.join(development_token_file_name(
        std::env::var("MISTY_PROFILE")
            .or_else(|_| std::env::var("MISTY_DESKTOP_PROFILE"))
            .ok()
            .as_deref(),
    )))
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn development_token_file_name(profile: Option<&str>) -> String {
    let profile = profile
        .and_then(normalize_profile)
        .unwrap_or_else(|| "default".to_owned());
    format!("account-session-{profile}.json")
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn store_development_token<R: Runtime>(app: &AppHandle<R>, value: &str) -> crate::Result<()> {
    let path = development_token_path(app)?;
    let temporary_path = path.with_extension(format!("tmp-{}", std::process::id()));
    let mut temporary = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(&temporary_path)?;
    temporary.write_all(value.as_bytes())?;
    temporary.sync_all()?;
    fs::rename(&temporary_path, &path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    mark_development_keychain_migration_complete(app)?;
    Ok(())
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn retrieve_development_token<R: Runtime>(app: &AppHandle<R>) -> crate::Result<Option<String>> {
    let path = development_token_path(app)?;
    match fs::read_to_string(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn remove_development_token<R: Runtime>(app: &AppHandle<R>) -> crate::Result<()> {
    let path = development_token_path(app)?;
    match fs::remove_file(path) {
        Ok(()) => mark_development_keychain_migration_complete(app),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            mark_development_keychain_migration_complete(app)
        }
        Err(error) => Err(error.into()),
    }
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn development_keychain_migration_complete<R: Runtime>(app: &AppHandle<R>) -> crate::Result<bool> {
    Ok(development_token_path(app)?
        .with_extension("migrated")
        .is_file())
}

#[cfg(all(target_os = "macos", debug_assertions))]
fn mark_development_keychain_migration_complete<R: Runtime>(
    app: &AppHandle<R>,
) -> crate::Result<()> {
    let marker = development_token_path(app)?.with_extension("migrated");
    fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(marker)?
        .sync_all()?;
    Ok(())
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
    if !chars.all(|character| {
        character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
    }) {
        return None;
    }
    Some(profile)
}

#[cfg(test)]
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

    #[cfg(all(target_os = "macos", debug_assertions))]
    #[test]
    fn development_token_paths_are_profile_scoped_and_safe() {
        assert_eq!(
            development_token_file_name(Some(" David ")),
            "account-session-david.json"
        );
        assert_eq!(
            development_token_file_name(Some("../bad")),
            "account-session-default.json"
        );
    }

    #[test]
    fn profile_mapping_only_rewrites_the_default_token() {
        assert_eq!(
            credential_user(TOKEN_SERVICE, TOKEN_USER),
            profile_token_user(std::env::var("MISTY_PROFILE").ok().as_deref())
        );
        assert_eq!(
            credential_user(TOKEN_SERVICE, "tester:david"),
            "tester:david"
        );
        assert_eq!(credential_user("other", TOKEN_USER), TOKEN_USER);
    }
}
