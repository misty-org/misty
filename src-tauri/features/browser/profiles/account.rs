use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

static ACCOUNT_EPOCH: AtomicU64 = AtomicU64::new(0);

pub(crate) fn account_epoch() -> u64 {
    ACCOUNT_EPOCH.load(Ordering::Acquire)
}

pub(crate) async fn change_account<T>(
    app: Option<&tauri::AppHandle>,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    change_account_if(app, |_| true, action).await
}

pub(crate) async fn change_account_if<T>(
    app: Option<&tauri::AppHandle>,
    changes_active: impl FnOnce(&str) -> bool,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _lifecycle = browser_lifecycle().write().await;
    if !changes_active(&crate::browser::app_windows::current_scope()) {
        return action();
    }
    ACCOUNT_EPOCH.fetch_add(1, Ordering::AcqRel);
    crate::browser::app_windows::workspace_recovery::close_account()?;
    #[cfg(desktop)]
    if let Some(app) = app {
        crate::agents::task_scopes::stop_account_tasks(app)?;
        crate::browser::close_account_views(app)?;
    }
    #[cfg(not(desktop))]
    let _ = app;
    close_store();
    let result = action();
    #[cfg(desktop)]
    if let Some(app) = app {
        crate::browser::app_windows::profiles_changed(app);
    }
    result
}

pub(crate) fn account_scope(server: &url::Url, account: Option<&str>) -> String {
    match account.filter(|account| !account.is_empty()) {
        Some(account) => format!("{}|{account}", server.origin().ascii_serialization()),
        None => crate::browser::app_windows::LOCAL_SCOPE.to_owned(),
    }
}
