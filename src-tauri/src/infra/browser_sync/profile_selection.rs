//! Which native store each vault's pages open in, remembered while locked,
//! and the per-vault lock that keeps it steady while pages open.
use super::*;

// Non-secret native engine identity survives locking the vault, so opening a
// tab while locked cannot silently fall back to the unrelated legacy store.
// Account replacement clears it only after closing the previous browser views.
// One per vault: each Space opens its pages in its own store.
#[derive(Default)]
struct Selections {
    /// The personal vault, remembered while locked: pages that name no
    /// profile open in its store.
    personal: Option<String>,
    by_vault: std::collections::HashMap<String, SelectedProfile>,
}
static SELECTED_PROFILES: OnceLock<std::sync::Mutex<Selections>> = OnceLock::new();
fn selections() -> Result<std::sync::MutexGuard<'static, Selections>, String> {
    SELECTED_PROFILES
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Browser profile state is unavailable".into())
}

/// The store `vault`'s pages open in, if one was selected.
pub(super) fn selected_profile(vault: &str) -> Result<Option<SelectedProfile>, String> {
    Ok(selections()?.by_vault.get(vault).cloned())
}

pub(super) fn set_selected_profile(
    vault: &str,
    selected: Option<SelectedProfile>,
) -> Result<(), String> {
    let mut all = selections()?;
    match selected {
        Some(selected) => all.by_vault.insert(vault.to_owned(), selected),
        None => all.by_vault.remove(vault),
    };
    Ok(())
}

pub(super) fn remember_personal_vault(vault: &str) -> Result<(), String> {
    selections()?.personal = Some(vault.to_owned());
    Ok(())
}

/// Account changes forget every vault's store, after closing its pages.
pub(super) fn clear_selected_profiles() -> Result<(), String> {
    *selections()? = Selections::default();
    Ok(())
}

pub(super) fn any_selected(matches: impl Fn(&SelectedProfile) -> bool) -> bool {
    selections().is_ok_and(|all| all.by_vault.values().any(matches))
}

/// Whether pages still open in another personal vault's store: a different
/// account (or vault) must be switched to first. Space vaults open through
/// the personal root, so they always belong to the same account.
pub(super) fn selected_for_other_account(personal: &VaultScope) -> Result<bool, String> {
    let all = selections()?;
    Ok(all
        .personal
        .as_deref()
        .is_some_and(|vault| vault != personal.vault_id && all.by_vault.contains_key(vault)))
}

/// While locked: the vault whose remembered store `requested` names, or the
/// personal vault's when nothing is requested.
pub(super) fn remembered(
    requested: Option<&str>,
) -> Result<Option<(String, SelectedProfile)>, String> {
    let all = selections()?;
    Ok(match requested {
        None => all
            .personal
            .as_ref()
            .and_then(|vault| Some((vault.clone(), all.by_vault.get(vault)?.clone()))),
        Some(requested) => all
            .by_vault
            .iter()
            .find(|(_, selected)| selected.logical == requested)
            .map(|(vault, selected)| (vault.clone(), selected.clone())),
    })
}

// Selecting or switching a vault's store takes its write side; opening a page
// in it the read side. Account changes still take `browser_lifecycle()`, so
// the order is lifecycle, then the vault's store lock, then its session.
static STORE_LOCKS: OnceLock<std::sync::Mutex<std::collections::HashMap<String, Arc<RwLock<()>>>>> =
    OnceLock::new();
pub(super) fn store_lock(vault: &str) -> Arc<RwLock<()>> {
    STORE_LOCKS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .entry(vault.to_owned())
        .or_default()
        .clone()
}
