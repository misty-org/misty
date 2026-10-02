use super::*;

/// Migration: before workspaces, this machine's store was loaded from the
/// workspace-wide sign-in log, and its import receipt records exactly what it
/// received. This machine's own device starts from that receipt, so synced
/// storage of sites without an open page carries over instead of vanishing.
pub(super) async fn migrated_baseline(
    active: &Session,
    workspace: &str,
) -> Result<Vec<CredentialRecord>, String> {
    if workspace != active.device_id {
        return Ok(Vec::new());
    }
    let logical = default_profile_id(&active.scope)?;
    // Best effort: an unreadable legacy receipt only means less carries over.
    let Ok(journal) = active.handle.browser_import_journal(logical.clone()).await else {
        return Ok(Vec::new());
    };
    Ok(journal
        .applied
        .map(|receipt| receipt.credentials)
        .unwrap_or_default()
        .into_iter()
        .filter(|record| {
            record.profile_id == logical
                && !matches!(
                    record.area,
                    misty_browser_sync::document::credentials::Area::Cookies
                )
        })
        .map(|record| CredentialRecord {
            sequence: 0,
            ..record
        })
        .collect())
}
