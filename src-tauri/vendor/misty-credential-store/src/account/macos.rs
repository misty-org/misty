use super::{state::*, SERVICE};
use core_foundation::{
    base::TCFType,
    string::{CFString, CFStringRef},
};
use security_framework::passwords::{
    delete_generic_password_options, generic_password, set_generic_password_options,
    PasswordOptions,
};
use security_framework_sys::{base::errSecItemNotFound, item::kSecUseAuthenticationUI};
use std::{io, sync::Mutex};
use zeroize::Zeroizing;

// Not exposed by security-framework-sys. This is a per-operation policy: do
// not toggle process-wide interaction settings used by other Keychain clients.
extern "C" {
    static kSecUseAuthenticationUIFail: CFStringRef;
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

struct Keychain;

fn options(key: &str, allow_prompt: bool) -> PasswordOptions {
    let mut options = PasswordOptions::new_generic_password(SERVICE, key);
    if !allow_prompt {
        // The framework wrapper does not yet expose an authentication-UI setter.
        #[allow(deprecated)]
        unsafe {
            options.query.push((
                CFString::wrap_under_get_rule(kSecUseAuthenticationUI),
                CFString::wrap_under_get_rule(kSecUseAuthenticationUIFail).into_CFType(),
            ));
        }
    }
    options
}

const UNAVAILABLE: Failure = Failure("Misty could not access its Keychain session. Unlock the login keychain or allow Misty access in Keychain Access, then restart Misty. Background requests will not prompt for access.");
const LEGACY: Failure = Failure("Misty could not migrate its saved login. The existing credential file has been preserved; restart Misty to retry.");

impl Backend for Keychain {
    fn read(&self, key: &str, allow_prompt: bool) -> Result<Option<Secret>> {
        match generic_password(options(key, allow_prompt)) {
            Ok(bytes) => {
                let bytes = Zeroizing::new(bytes);
                let value = std::str::from_utf8(&bytes).map_err(|_| UNAVAILABLE)?;
                Ok(Some(Zeroizing::new(value.to_owned())))
            }
            Err(error) if error.code() == errSecItemNotFound => Ok(None),
            Err(_) => Err(UNAVAILABLE),
        }
    }
    fn write(&self, key: &str, value: &str) -> Result<()> {
        set_generic_password_options(value.as_bytes(), options(key, false)).map_err(|_| UNAVAILABLE)
    }
    fn delete(&self, key: &str) -> Result<()> {
        match delete_generic_password_options(options(key, false)) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == errSecItemNotFound => Ok(()),
            Err(_) => Err(UNAVAILABLE),
        }
    }
    fn legacy_read(&self, key: &str) -> Result<Option<Secret>> {
        let path = crate::root().map_err(|_| LEGACY)?.join(key);
        crate::read_private_file(&path)
            .map(|value| value.map(Zeroizing::new))
            .map_err(|_| LEGACY)
    }
    fn legacy_delete(&self, key: &str) -> Result<()> {
        let path = crate::root().map_err(|_| LEGACY)?.join(key);
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(LEGACY),
        }
    }
}

fn with_state<T>(
    account: &str,
    action: impl FnOnce(&mut State, &str) -> Result<T>,
) -> io::Result<T> {
    let profile = std::env::var("MISTY_PROFILE")
        .or_else(|_| std::env::var("MISTY_DESKTOP_PROFILE"))
        .ok();
    // Preserve server/account/profile isolation without exposing identifiers in
    // Keychain labels. The same digest identifies the old credential file.
    let key = crate::file_name(SERVICE, account, profile.as_deref());
    let mut state = STATE.lock().map_err(|_| io::Error::from(UNAVAILABLE))?;
    action(state.get_or_insert_with(State::default), &key).map_err(Into::into)
}

pub(super) fn load(account: &str) -> io::Result<Option<String>> {
    with_state(account, |state, key| state.load(&Keychain, key))
        .map(|value| value.map(|value| value.to_string()))
}
pub(super) fn store(account: &str, value: &str) -> io::Result<()> {
    with_state(account, |state, key| state.save(&Keychain, key, value))
}
pub(super) fn delete(account: &str) -> io::Result<()> {
    with_state(account, |state, key| state.delete(&Keychain, key))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn child(key: &str, phase: &str) -> bool {
        std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "account::macos::tests::keychain_child",
                "--ignored",
            ])
            .env("MISTY_KEYCHAIN_TEST_ITEM", key)
            .env("MISTY_KEYCHAIN_TEST_PHASE", phase)
            .status()
            .is_ok_and(|status| status.success())
    }

    // Opt-in tests touch only a uniquely named disposable Keychain item. All
    // operations explicitly forbid UI; they never open real saved logins.
    #[test]
    #[ignore = "requires an unlocked macOS login keychain"]
    fn keychain_persists_across_processes_without_prompts() {
        let temp = tempfile::tempdir().unwrap();
        let key = format!(
            "test-{}",
            crate::file_name(SERVICE, &temp.path().to_string_lossy(), None)
        );
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = child(&self.0, "delete");
            }
        }
        let _cleanup = Cleanup(key.clone());
        // Each phase is a fresh process, as on app quit/relaunch. macOS's
        // file-based Keychain has process-local caches; do not keep another
        // Keychain client alive in the test driver while changing its items.
        for phase in ["create", "read", "rotate", "verify", "delete", "absent"] {
            assert!(child(&key, phase), "Keychain subprocess failed: {phase}");
        }
    }

    #[test]
    #[ignore = "subprocess helper for the opt-in Keychain test"]
    fn keychain_child() {
        let Ok(key) = std::env::var("MISTY_KEYCHAIN_TEST_ITEM") else {
            return;
        };
        assert!(key.starts_with("test-"));
        let phase = std::env::var("MISTY_KEYCHAIN_TEST_PHASE").unwrap();
        let read = || {
            Keychain
                .read(&key, false)
                .unwrap()
                .map(|value| value.to_string())
        };
        match phase.as_str() {
            "create" => {
                assert!(read().is_none());
                Keychain
                    .write(&key, "non-secret-test-access-and-refresh")
                    .unwrap();
                assert_eq!(
                    read().as_deref(),
                    Some("non-secret-test-access-and-refresh")
                );
            }
            "read" => assert_eq!(
                read().as_deref(),
                Some("non-secret-test-access-and-refresh")
            ),
            "rotate" => {
                assert_eq!(
                    read().as_deref(),
                    Some("non-secret-test-access-and-refresh")
                );
                Keychain.write(&key, "non-secret-rotated-tokens").unwrap();
                assert_eq!(read().as_deref(), Some("non-secret-rotated-tokens"));
            }
            "verify" => assert_eq!(read().as_deref(), Some("non-secret-rotated-tokens")),
            "delete" => {
                Keychain.delete(&key).unwrap();
                assert!(read().is_none());
            }
            "absent" => assert!(read().is_none()),
            _ => panic!("unknown Keychain test phase"),
        }
    }
}
