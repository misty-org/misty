//! Deleting visits: a time range, or every visit of a deleted profile.
use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryClearRequest {
    /// Visits at or after this time (ms); everything when absent.
    pub since: Option<i64>,
}

pub(super) fn browser_history_clear_blocking(
    app: AppHandle,
    profile: String,
    request: BrowserHistoryClearRequest,
) -> Result<(), String> {
    let since = request.since.unwrap_or(0);
    let connection = library(&app)?;
    connection
        .execute(
            "DELETE FROM visits WHERE profile_id = ?1 AND visited_at >= ?2",
            params![profile, since],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Deletes every visit of a profile that was deleted.
pub(crate) fn forget_profile(connection: &rusqlite::Connection, key: &str) -> rusqlite::Result<()> {
    connection.execute("DELETE FROM visits WHERE profile_id = ?1", params![key])?;
    Ok(())
}
