//! What the browser keeps on this computer: profile records, workspace recovery and the keys that
//! seal them. Secret types deliberately cannot be serialized or formatted; the web renderer only
//! receives projected UI state.
pub mod crypto;
pub mod document;
pub mod local;
pub mod recovery;
mod recovery_pending;
pub mod secure_store;
pub mod transport;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Invalid data")]
    Invalid,
    #[error("Identity did not match")]
    Identity,
    #[error("Could not unlock encrypted data")]
    Unlock,
    #[error("Data exceeds the supported size")]
    TooLarge,
    #[error("A newer copy was saved first")]
    Sequence,
    #[error("OS-protected key storage is unavailable")]
    SecureStorage,
    #[error("Local recovery files are unavailable")]
    Recovery,
    #[error("Local storage is unavailable")]
    Storage(#[from] rusqlite::Error),
    #[error("Data could not be encoded")]
    Encoding(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
