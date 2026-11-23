use std::io;

pub fn load(service: &str, account: &str) -> io::Result<Option<String>> {
    misty_credential_store::load(service, account)
}

pub fn store(service: &str, account: &str, value: &str) -> io::Result<()> {
    misty_credential_store::store(service, account, value)
}

pub fn delete(service: &str, account: &str) -> io::Result<()> {
    misty_credential_store::delete(service, account)
}
