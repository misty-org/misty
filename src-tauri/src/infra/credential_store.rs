//! Misty's credential store: encrypted rows in `misty.db`, keyed by one master key that
//! release builds keep in the OS keychain under `com.misty.auth`.
use std::io;

pub type CredentialStoreError = io::Error;

pub fn load(service: &str, account: &str) -> io::Result<Option<String>> {
    misty_credential_store::load(service, account)
}

pub fn store(service: &str, account: &str, value: &str) -> io::Result<()> {
    misty_credential_store::store(service, account, value)
}

pub fn delete(service: &str, account: &str) -> io::Result<()> {
    misty_credential_store::delete(service, account)
}
