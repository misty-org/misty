//! What the connection should do and tell the person after each frame.
use serde::Serialize;

use super::wire::ClientFrame;

/// What the person may need to know. Everything else stays silent.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Notice {
    /// The account's storage is full; downloads carry on.
    StorageFull,
    /// This session was removed.
    SessionRemoved,
    /// The vault was destroyed, here or elsewhere.
    VaultGone,
}

/// What the connection should do after a frame.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Outcome {
    pub send: Vec<ClientFrame>,
    /// Records that changed here, as (profile, collection).
    pub changed: Vec<(String, String)>,
    pub notice: Option<Notice>,
    /// The session must stop: nothing more can be done with this vault.
    pub stop: bool,
    pub sessions_changed: bool,
    pub vault_key_changed: bool,
}
