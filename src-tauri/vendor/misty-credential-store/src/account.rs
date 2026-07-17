//! Misty account JWT persistence. Only this API migrates to macOS Keychain;
//! unrelated device identities, website cookies and vault keys keep their stores.
//! Blocking: call from a native worker, never the UI thread.
use std::io;

const SERVICE: &str = "com.misty.auth.cookies.v1";

#[cfg(target_os = "macos")]
mod macos;
#[cfg(any(target_os = "macos", test))]
mod state;

pub fn load(account: &str) -> io::Result<Option<String>> {
    #[cfg(target_os = "macos")]
    return macos::load(account);
    #[cfg(not(target_os = "macos"))]
    super::load(SERVICE, account)
}

pub fn store(account: &str, value: &str) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    return macos::store(account, value);
    #[cfg(not(target_os = "macos"))]
    super::store(SERVICE, account, value)
}

pub fn delete(account: &str) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    return macos::delete(account);
    #[cfg(not(target_os = "macos"))]
    super::delete(SERVICE, account)
}
