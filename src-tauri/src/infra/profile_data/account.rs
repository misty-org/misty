//! Account changes: everything tied to the previous account closes before another account's
//! sessions or browser views take its place.
use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

static ACCOUNT_EPOCH: AtomicU64 = AtomicU64::new(0);

/// Bumps each time the account changes, so work started for the old account can tell.
pub(crate) fn account_epoch() -> u64 {
    ACCOUNT_EPOCH.load(Ordering::Acquire)
}

/// Selecting an account's session calls this before swapping clients.
pub(in crate::infra) async fn change_account<T>(
    app: Option<&tauri::AppHandle>,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    change_account_if(app, |_| true, action).await
}

/// Forgetting an inactive saved account must not stop the current workspace. Evaluate the
/// condition after acquiring the same account-change barrier. The condition receives the current
/// scope, `<server>|<account id>` or `local`.
pub(in crate::infra) async fn change_account_if<T>(
    app: Option<&tauri::AppHandle>,
    changes_active: impl FnOnce(&str) -> bool,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _lifecycle = browser_lifecycle().write().await;
    if !changes_active(&profile_windows::current_scope()) {
        return action();
    }
    ACCOUNT_EPOCH.fetch_add(1, Ordering::AcqRel);
    super::super::extensions::close_account().await;
    super::super::workspace_recovery::close_account()?;
    #[cfg(desktop)]
    if let Some(app) = app {
        super::super::agents::workspace::stop_account_tasks(app)?;
        super::super::browser::close_account_views(app)?;
    }
    #[cfg(not(desktop))]
    let _ = app;
    super::super::vault::close_for_account_change().await;
    close_store();
    // Keep the lifecycle lock through replacing the client, so nothing opens for the old account
    // between shutdown and activation.
    let result = action();
    #[cfg(desktop)]
    if let Some(app) = app {
        // Menus and windows list the new account's profiles.
        profile_windows::profiles_changed(app);
        seed_first_profile();
    }
    result
}

/// The scope an account on a server is known by. It names folders and stores on this computer.
pub(crate) fn account_scope(server: &url::Url, account: Option<&str>) -> String {
    match account.filter(|account| !account.is_empty()) {
        Some(account) => format!("{}|{account}", server.origin().ascii_serialization()),
        None => profile_windows::LOCAL_SCOPE.to_owned(),
    }
}
