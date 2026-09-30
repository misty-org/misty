use std::{collections::HashMap, io};
use zeroize::Zeroizing;

pub(super) type Secret = Zeroizing<String>;
pub(super) type Result<T> = std::result::Result<T, Failure>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Failure(pub &'static str);

impl From<Failure> for io::Error {
    fn from(error: Failure) -> Self {
        io::Error::other(error.0)
    }
}

pub(super) trait Backend {
    fn read(&self, key: &str, allow_prompt: bool) -> Result<Option<Secret>>;
    /// Writes and deletes must never display authorization UI.
    fn write(&self, key: &str, value: &str) -> Result<()>;
    fn delete(&self, key: &str) -> Result<()>;
    fn legacy_read(&self, key: &str) -> Result<Option<Secret>>;
    fn legacy_delete(&self, key: &str) -> Result<()>;
}

#[derive(Default)]
pub(super) struct State {
    // Cache failures too: a canceled/denied restore must not prompt again on
    // every retry. Explicitly signing in can replace the entry via save().
    entries: HashMap<String, Result<Option<Secret>>>,
}

impl State {
    pub fn load(&mut self, backend: &impl Backend, key: &str) -> Result<Option<Secret>> {
        if let Some(value) = self.entries.get(key) {
            return value.clone();
        }
        let result = (|| {
            if let Some(value) = backend.read(key, true)? {
                // Keychain is authoritative, including after an interrupted migration.
                backend.legacy_delete(key)?;
                return Ok(Some(value));
            }
            let Some(value) = backend.legacy_read(key)? else {
                return Ok(None);
            };
            verified_write(backend, key, &value)?;
            Ok(Some(value))
        })();
        self.entries.insert(key.into(), result.clone());
        result
    }

    pub fn save(&mut self, backend: &impl Backend, key: &str, value: &str) -> Result<()> {
        if matches!(self.entries.get(key), Some(Ok(Some(saved))) if saved.as_str() == value) {
            return Ok(());
        }
        let result = verified_write(backend, key, value);
        // Never restore a stale cached token after a rotation or partial write.
        self.entries.insert(
            key.into(),
            result.map(|()| Some(Zeroizing::new(value.to_owned()))),
        );
        result
    }

    pub fn delete(&mut self, backend: &impl Backend, key: &str) -> Result<()> {
        let result = backend
            .legacy_delete(key)
            .and_then(|()| backend.delete(key));
        self.entries.insert(key.into(), result.map(|()| None));
        result
    }
}

fn verified_write(backend: &impl Backend, key: &str, value: &str) -> Result<()> {
    backend.write(key, value)?;
    let stored = backend.read(key, false)?;
    if stored.as_deref().map(String::as_str) != Some(value) {
        return Err(Failure(
            "Misty could not verify its saved Keychain session. Restart Misty and sign in again.",
        ));
    }
    // Keep the old file until the Keychain write has been read back successfully.
    backend.legacy_delete(key)
}

#[cfg(test)]
mod tests;
