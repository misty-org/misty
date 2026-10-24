//! What other parts of the app reach through an open vault: admission, extension sync, the clipboard and passwords.
use super::*;

/// The open vault's root, scope and this device's sync identity, for signing
/// device grants and lists. Admission uses the personal vault, whose root
/// opens every other vault. None while the vault is locked.
pub(crate) async fn device_admission_authority(
    account: &str,
) -> Option<(VaultRoot, VaultScope, String)> {
    personal_session()
        .await
        .as_ref()
        .filter(|s| s.scope.account_id == account)
        .map(|s| {
            (
                s.admission_root.duplicate(),
                s.scope.clone(),
                s.device_id.clone(),
            )
        })
}

/// Opens the vault with a root sealed to this device by one already added
/// (approval from another device). The root was checked against the vault's
/// root public key before this is called.
pub(crate) async fn open_with_transferred_root(
    app: tauri::AppHandle,
    api_base: String,
    account_id: String,
    root: VaultRoot,
    remember: bool,
) -> Result<SyncView, String> {
    open_vault_with(
        app,
        api_base,
        account_id,
        None,
        None,
        Some(root),
        remember,
        false,
        false,
    )
    .await
}

/// Native extension settings ride the vault of the Space they are installed in,
/// independent of whether this device shares its tabs or website sign-ins.
/// `space` is the Space's key; None while that Space's vault is not open.
pub(crate) async fn extension_sync_handle(account: &str, space: &str) -> Option<WorkerHandle> {
    let session = match crate::infra::space_windows::space_id_for_key(space) {
        None => personal_session().await,
        Some(space_id) => {
            let slot = sessions()
                .vaults
                .values()
                .find(|entry| entry.space_id.as_deref() == Some(space_id.as_str()))
                .map(|entry| entry.slot.clone());
            lock_slot(slot).await
        }
    };
    session
        .as_ref()
        .filter(|s| s.scope.account_id == account)
        .map(|s| s.handle.clone())
}

/// Whether a vault keeps its website data in `store` (its logical identity or the
/// native store bound to it). Erasing retired device-profile stores skips these.
pub(crate) fn vault_uses_store(store: &str) -> bool {
    sessions()
        .vaults
        .values()
        .any(|entry| entry.logical == store)
        || profile_selection::any_selected(|selected| {
            selected.logical == store || selected.physical == store
        })
}

/// The shared clipboard rides on the personal vault's connection and seals
/// clips with a key derived from its root: one ring per account, which every
/// Space uses. None while the vault is locked.
pub(crate) async fn clipboard_session(
    account: &str,
) -> Option<(WorkerHandle, misty_browser_sync::crypto::ClipboardKey)> {
    let session = personal_session().await;
    let active = session.as_ref().filter(|s| s.scope.account_id == account)?;
    let key = active.admission_root.clipboard_key(&active.scope).ok()?;
    Some((active.handle.clone(), key))
}

/// Saved passwords live in the unlocked personal vault of the signed-in
/// account. None while that vault is locked. With no synced personal vault at
/// all (nobody signed in, or sync not set up) they live in this device's local
/// vault, so they work without an account.
pub(crate) async fn vault_handle() -> Option<WorkerHandle> {
    if personal_vault().is_none() {
        return super::local_vault::local_vault_handle().await;
    }
    personal_session().await.as_ref().map(|s| s.handle.clone())
}

/// Whether a window shows `vault_id`. Only those vaults keep a socket open;
/// the rest pull on the sync batching interval. The personal vault starts
/// live and Space vaults dormant until a window opens them.
pub(crate) async fn set_vault_open(vault_id: &str, open: bool) {
    let slot = sessions()
        .vaults
        .get(vault_id)
        .map(|entry| entry.slot.clone());
    if let Some(active) = lock_slot(slot).await.as_ref() {
        active.handle.set_live(open);
    }
}

/// The signed-in account's synced personal vault, while it is open.
pub(crate) async fn synced_vault_handle() -> Option<WorkerHandle> {
    personal_session().await.as_ref().map(|s| s.handle.clone())
}

/// This device's local vault, which holds saved passwords while no synced one exists.
pub(crate) async fn device_vault_handle() -> Option<WorkerHandle> {
    super::local_vault::local_vault_handle().await
}
