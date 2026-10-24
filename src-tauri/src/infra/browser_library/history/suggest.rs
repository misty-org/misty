//! Address bar suggestions from history, ranked by visits decayed by age.
use super::*;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHistorySuggestion {
    pub(super) url: String,
    pub(super) title: String,
    pub(super) visits: i64,
    pub(super) typed_visits: i64,
    pub(super) last_visited_at: i64,
}

/// Empty text asks for the person's top pages; only recent visits count then.
pub(super) const TOP_PAGES_WINDOW_MS: i64 = 90 * 86_400_000;

/// Address bar suggestions: pages matching the typed text, ranked by visits
/// (typed visits count triple) decayed by age. Empty text returns top pages.
pub(super) fn browser_history_suggest_blocking(
    app: AppHandle,
    request: BrowserHistoryQueryRequest,
) -> Result<Vec<BrowserHistorySuggestion>, String> {
    let search = text(&request.text, 200);
    let now = now_ms();
    let since = if search.is_empty() {
        now - TOP_PAGES_WINDOW_MS
    } else {
        0
    };
    let connection = library(&app)?;
    let mut statement = connection
        .prepare(
            "SELECT url, (SELECT title FROM visits latest WHERE latest.profile_id = ?1 AND latest.url = visits.url
                          ORDER BY visited_at DESC LIMIT 1),
                    COUNT(*) AS count, SUM(typed) AS typed_count, MAX(visited_at) AS last
             FROM visits
             WHERE profile_id = ?1 AND visited_at >= ?5
               AND (url LIKE ?2 ESCAPE '\\' OR title LIKE ?2 ESCAPE '\\')
             GROUP BY url
             ORDER BY ((COUNT(*) + 2.0 * SUM(typed)) * 1.0) / (1 + (?3 - MAX(visited_at)) / 86400000.0) DESC
             LIMIT ?4",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![
                profile_key(request.profile_id),
                like_pattern(&search),
                now,
                request.limit.unwrap_or(5).clamp(1, 20),
                since,
            ],
            |row| {
                Ok(BrowserHistorySuggestion {
                    url: row.get(0)?,
                    title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    visits: row.get(2)?,
                    typed_visits: row.get(3)?,
                    last_visited_at: row.get(4)?,
                })
            },
        )
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .collect();
    Ok(rows)
}
