//! The registry of open vault sessions, one per Space of the signed-in
//! account. Each has its own lock, so one Space's work never waits on another.
use super::*;

/// One open vault's session. Commands lock only the vault they act on, so one
/// Space's restore never stalls another Space's pages.
pub(super) type Slot = Arc<Mutex<Option<Session>>>;
pub(super) type SessionGuard = tokio::sync::OwnedMutexGuard<Option<Session>>;

pub(super) struct Entry {
    pub(super) session_id: String,
    /// The vault's logical browser profile (`default_profile_id`).
    pub(super) logical: String,
    /// The Space this vault belongs to; None for the personal vault.
    pub(super) space_id: Option<String>,
    /// Read without locking the session, for the account's sync status.
    pub(super) status: tokio::sync::watch::Receiver<Status>,
    /// The vault's sign-in sync issue, mirrored for the same status.
    pub(super) issue: Option<Cow<'static, str>>,
    pub(super) slot: Slot,
}

/// Every open vault of the signed-in account, one per Space. The personal
/// vault holds device admission, extensions, passwords and the clipboard.
#[derive(Default)]
pub(super) struct Sessions {
    pub(super) personal: Option<String>,
    pub(super) vaults: std::collections::BTreeMap<String, Entry>,
    /// Spaces whose vault could not open on this unlock, by Space id.
    pub(super) failed: std::collections::BTreeMap<String, Cow<'static, str>>,
}

static SESSIONS: OnceLock<std::sync::Mutex<Sessions>> = OnceLock::new();
pub(super) fn sessions() -> std::sync::MutexGuard<'static, Sessions> {
    SESSIONS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// A guard over no session, for callers that found none.
pub(super) fn no_session() -> SessionGuard {
    Arc::new(Mutex::new(None))
        .try_lock_owned()
        .expect("a new mutex is unlocked")
}

pub(super) async fn lock_slot(slot: Option<Slot>) -> SessionGuard {
    match slot {
        Some(slot) => slot.lock_owned().await,
        None => no_session(),
    }
}

/// The personal vault's session; empty while the vault is locked.
pub(super) async fn personal_session() -> SessionGuard {
    let slot = {
        let all = sessions();
        all.personal
            .as_ref()
            .and_then(|vault| all.vaults.get(vault))
            .map(|entry| entry.slot.clone())
    };
    lock_slot(slot).await
}

/// A Space's vault session: the personal vault's for `None`. Empty while that
/// vault is locked or not open; a Space never falls back to another's vault.
pub(super) async fn space_session(space_id: Option<&str>) -> SessionGuard {
    let Some(space) = space_id else {
        return personal_session().await;
    };
    let slot = sessions()
        .vaults
        .values()
        .find(|entry| entry.space_id.as_deref() == Some(space))
        .map(|entry| entry.slot.clone());
    lock_slot(slot).await
}

/// The session a renderer command names. An unknown id falls back to the
/// personal session so `require_session` reports that the session changed.
pub(super) async fn session_by_id(session_id: &str) -> SessionGuard {
    let slot = sessions()
        .vaults
        .values()
        .find(|entry| entry.session_id == session_id)
        .map(|entry| entry.slot.clone());
    match slot {
        Some(slot) => slot.lock_owned().await,
        None => personal_session().await,
    }
}

#[cfg(test)]
pub(super) fn vault_of_session(session_id: &str) -> Option<String> {
    sessions()
        .vaults
        .iter()
        .find(|(_, entry)| entry.session_id == session_id)
        .map(|(vault, _)| vault.clone())
}

/// The open vault whose logical browser profile is `logical`.
pub(super) fn vault_for_profile(logical: &str) -> Option<(String, Slot)> {
    sessions()
        .vaults
        .iter()
        .find(|(_, entry)| entry.logical == logical)
        .map(|(vault, entry)| (vault.clone(), entry.slot.clone()))
}

pub(super) fn personal_vault() -> Option<(String, Slot)> {
    let all = sessions();
    let vault = all.personal.clone()?;
    let slot = all.vaults.get(&vault)?.slot.clone();
    Some((vault, slot))
}

/// Registers a session and returns its slot. Replaces any earlier entry for
/// the same vault; the caller has already stopped it.
pub(super) fn install(session: Session, personal: bool) -> Result<Slot, String> {
    let vault = session.scope.vault_id.clone();
    let space_id = session.space_id.clone();
    let entry = Entry {
        session_id: session.id.clone(),
        logical: default_profile_id(&session.scope)?,
        space_id: space_id.clone(),
        status: session.handle.status.clone(),
        issue: None,
        slot: Arc::new(Mutex::new(Some(session))),
    };
    let slot = entry.slot.clone();
    let mut all = sessions();
    if personal {
        all.personal = Some(vault.clone());
    }
    if let Some(space) = &space_id {
        all.failed.remove(space);
    }
    all.vaults.insert(vault, entry);
    Ok(slot)
}

/// Records why a Space's vault could not open, for the account's status.
pub(super) fn space_failed(space_id: &str, issue: Cow<'static, str>) {
    sessions().failed.insert(space_id.to_owned(), issue);
}

/// Mirrors a vault's sign-in sync issue into the account's status.
pub(super) fn note_issue(vault_id: &str, issue: Option<Cow<'static, str>>) {
    if let Some(entry) = sessions().vaults.get_mut(vault_id) {
        entry.issue = issue;
    }
}

/// Lock, sign-out and account changes close every vault of the account.
pub(super) async fn stop_all() {
    let slots: Vec<Slot> = {
        let mut all = sessions();
        all.personal = None;
        all.failed.clear();
        std::mem::take(&mut all.vaults)
            .into_values()
            .map(|entry| entry.slot)
            .collect()
    };
    for slot in slots {
        stop(slot.lock_owned().await.take()).await;
    }
}
