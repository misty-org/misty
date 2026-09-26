//! Native-only browser synchronization. Secret types deliberately cannot be
//! serialized or formatted; the web renderer only receives projected UI state.
pub mod crypto;
pub mod document;
pub mod protocol;
pub mod restore;
pub mod recovery;
pub mod secure_store;
pub mod store;
pub mod transport;
pub mod worker;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("This device is following sync. Make it active to publish changes.")]
    InactiveDevice,
    #[error("Invalid sync data")]
    Invalid,
    #[error("Sync identity or signature did not match")]
    Identity,
    #[error("Could not unlock encrypted sync data")]
    Unlock,
    #[error("Sync data exceeds the supported size")]
    TooLarge,
    #[error("Sync replay has a gap or conflicting receipt")]
    Sequence,
    #[error("OS-protected sync key storage is unavailable")]
    SecureStorage,
    #[error("Sync connection is unavailable")]
    Network,
    #[error("Sign in again to reconnect sync")]
    Authentication,
    #[error("Sync requires a newer client or a vault recovery step")]
    Recovery,
    #[error("Local sync storage is unavailable")]
    Storage(#[from] rusqlite::Error),
    #[error("Sync data could not be encoded")]
    Encoding(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
