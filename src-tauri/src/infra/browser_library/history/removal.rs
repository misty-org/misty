//! Deleting visits: single visits, every visit to a page, or a time range.
use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryDeleteRequest {
    #[serde(default)]
    pub ids: Vec<i64>,
}

pub(super) fn browser_history_delete_blocking(
    app: AppHandle,
    request: BrowserHistoryDeleteRequest,
) -> Result<(), String> {
    let connection = library(&app)?;
    for id in request.ids {
        mark_dirty(&connection, "id = ?1", params![id])?;
        connection
            .execute("DELETE FROM visits WHERE id = ?1", params![id])
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryForgetRequest {
    pub profile_id: Option<String>,
    pub url: String,
}

/// Removes every visit to one page, as when a suggestion is deleted from the address bar.
pub(super) fn browser_history_forget_blocking(
    app: AppHandle,
    request: BrowserHistoryForgetRequest,
) -> Result<(), String> {
    let Some(url) = history_url(&request.url) else {
        return Ok(());
    };
    let connection = library(&app)?;
    let profile = profile_key(request.profile_id);
    mark_dirty(
        &connection,
        "profile_id = ?1 AND url = ?2",
        params![profile, url],
    )?;
    connection
        .execute(
            "DELETE FROM visits WHERE profile_id = ?1 AND url = ?2",
            params![profile, url],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistoryClearRequest {
    /// Every profile when absent.
    pub profile_id: Option<String>,
    /// Visits at or after this time (ms); everything when absent.
    pub since: Option<i64>,
}

pub(super) fn browser_history_clear_blocking(
    app: AppHandle,
    request: BrowserHistoryClearRequest,
) -> Result<(), String> {
    let since = request.since.unwrap_or(0);
    let connection = library(&app)?;
    match &request.profile_id {
        Some(profile) => mark_dirty(
            &connection,
            "profile_id = ?1 AND visited_at >= ?2",
            params![profile_key(Some(profile.clone())), since],
        ),
        None => mark_dirty(&connection, "visited_at >= ?1", params![since]),
    }?;
    match request.profile_id {
        Some(profile) => connection.execute(
            "DELETE FROM visits WHERE profile_id = ?1 AND visited_at >= ?2",
            params![profile_key(Some(profile)), since],
        ),
        None => connection.execute("DELETE FROM visits WHERE visited_at >= ?1", params![since]),
    }
    .map_err(|error| error.to_string())?;
    Ok(())
}

/// Records the hours of visits about to be deleted, so their synced batches
/// are rewritten without them (on every device, not just this one).
pub(super) fn mark_dirty(
    connection: &rusqlite::Connection,
    filter: &str,
    values: impl rusqlite::Params,
) -> Result<(), String> {
    connection
        .execute(
            &format!(
                "INSERT OR IGNORE INTO history_dirty(origin, hour)
                 SELECT DISTINCT origin, visited_at / 3600000 FROM visits WHERE {filter}"
            ),
            values,
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}
