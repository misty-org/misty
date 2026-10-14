//! Misty account JWT persistence. Account logins live in the same `~/.misty/.auth`
//! files as every other credential on every platform; nothing here talks to an
//! operating-system keychain.
//! Blocking: call from a native worker, never the UI thread.
use std::io;

const SERVICE: &str = "com.misty.auth.cookies.v1";

pub fn load(account: &str) -> io::Result<Option<String>> {
    super::load(SERVICE, account)
}

pub fn store(account: &str, value: &str) -> io::Result<()> {
    super::store(SERVICE, account, value)
}

pub fn delete(account: &str) -> io::Result<()> {
    super::delete(SERVICE, account)
}
