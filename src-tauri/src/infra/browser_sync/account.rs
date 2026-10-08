//! Account changes: stopping the open vault's workers before another account's
//! session, cookies or browser views take its place.
use super::*;

/// Lock, sign-out and account switches send batched changes first. Bounded:
/// a slow server never holds the vault open; what does not make it stays
/// stored and goes out on the next unlock.
const STOP_FLUSH: std::time::Duration = std::time::Duration::from_secs(1);

pub(super) async fn stop(active: Option<Session>) {
    if let Some(mut active) = active {
        let _ = tokio::time::timeout(STOP_FLUSH, active.handle.flush()).await;
        if let Some(task) = active.credential_task.take() {
            task.abort();
            let _ = task.await;
        }
        if let Some(task) = active.history_task.take() {
            task.abort();
            let _ = task.await;
        }
        #[cfg(any(target_os = "macos", windows))]
        {
            active.capture_view = None;
        }
        active.handle.stop();
        // Notifications cannot race a replacement account's view.
        active.notifications.abort();
        let _ = active.notifications.await;
        let _ = active.task.await;
    }
}

/// Account-cookie selection calls this before swapping jars. Returning means the
/// previous socket and its decrypted vault/signing keys have been dropped.
pub(in crate::infra) async fn change_account<T>(
    app: Option<&tauri::AppHandle>,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    change_account_if(app, |_| true, action).await
}

/// Forgetting an inactive saved account must not stop the current workspace.
/// Evaluate the condition after acquiring the same account-change barrier.
pub(in crate::infra) async fn change_account_if<T>(
    app: Option<&tauri::AppHandle>,
    changes_active: impl FnOnce(Option<&VaultScope>) -> bool,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _lifecycle = browser_lifecycle().write().await;
    let mut current = session().lock().await;
    if !changes_active(current.as_ref().map(|active| &active.scope)) {
        return action();
    }
    BROWSER_ACCOUNT_EPOCH.fetch_add(1, Ordering::AcqRel);
    super::super::extensions::close_account().await;
    super::super::workspace_recovery::close_account()?;
    stop(current.take()).await;
    #[cfg(desktop)]
    if let Some(app) = app {
        super::super::agent_workspace::stop_account_tasks(app)?;
        super::super::browser::close_account_views(app)?;
    }
    #[cfg(not(desktop))]
    let _ = app;
    *selected_profile()
        .lock()
        .map_err(|_| "Browser profile state is unavailable")? = None;
    // Keep the registry lock through jar replacement. Otherwise a concurrent
    // unlock can capture the old account between shutdown and activation.
    action()
}

/// This device's sync frequency ("live", "balanced" or "saver"), which scales how soon edits
/// are sent. It is a setting of this device alone and takes effect immediately.
#[tauri::command]
pub fn browser_sync_set_frequency(webview: tauri::Webview, frequency: String) -> Result<(), String> {
    require_main(&webview)?;
    if misty_browser_sync::batch::set_frequency(&frequency) {
        Ok(())
    } else {
        Err("Unknown sync frequency.".to_owned())
    }
}

#[tauri::command]
pub async fn browser_sync_lock(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    session_id: String,
    forget: bool,
) -> Result<(), String> {
    require_main(&webview)?;
    let _lifecycle = browser_lifecycle().write().await;
    let mut current = session().lock().await;
    let scope = if let Some(active) = current.as_ref() {
        require_session(active, &session_id)?;
        Some(active.scope.clone())
    } else if forget {
        return Err("Unlock this vault before removing its remembered key.".into());
    } else {
        None
    };
    stop(current.take()).await;
    let _ = crate::infra::space_windows::emit(&app, "misty:browser-sync-changed", "");
    if forget {
        if let Some(scope) = scope {
            tokio::task::spawn_blocking(move || secure_store::forget(&scope))
                .await
                .map_err(|_| "Could not remove the remembered sync key")?
                .map_err(issue)?;
        }
    }
    Ok(())
}
