//! Moments: one thing the person read, heard or recorded. A page revisit that barely changed points at
//! the visit holding its text, so a page read every day is kept once.
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use super::{check_space, index, parse_time, rfc3339, MemoryError, Result, HOUR_MS, MOMENTS};

/// A revisit within this many simhash bits is the same page.
pub(super) const SAME_BITS: u32 = 6;
pub(super) const MAX_BODY_BYTES: usize = 20_000;
const KINDS: &[&str] = &["page", "voice", "recording", "note", "screen"];

fn empty(text: &str) -> bool {
    text.is_empty()
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct MemoryEvent {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub space_id: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "empty")]
    pub device_id: String,
    #[serde(default, skip_serializing_if = "empty")]
    pub url: String,
    #[serde(default, skip_serializing_if = "empty")]
    pub site: String,
    #[serde(default)]
    pub title: String,
    #[serde(default, skip_serializing_if = "empty")]
    pub body: String,
    #[serde(default, skip_serializing_if = "empty")]
    pub simhash: String,
    #[serde(default, skip_serializing_if = "empty")]
    pub same_as: String,
    #[serde(default, skip_serializing_if = "empty")]
    pub ref_id: String,
    #[serde(default)]
    pub dwell_ms: i64,
    #[serde(default)]
    pub occurred_at: String,
    /// What was in front, and the capture session that read it (screen moments).
    #[serde(default, skip_serializing_if = "empty")]
    pub app: String,
    #[serde(default, skip_serializing_if = "empty")]
    pub window_title: String,
    #[serde(default, skip_serializing_if = "empty")]
    pub session_id: String,
}

/// The host a page belongs to, without "www.".
pub(super) fn site_of(raw: &str) -> String {
    url::Url::parse(raw)
        .ok()
        .and_then(|url| url.host_str().map(str::to_lowercase))
        .map(|host| host.strip_prefix("www.").unwrap_or(&host).to_owned())
        .unwrap_or_default()
}

/// How many bits two 16-digit hex simhashes differ by, or 64 when either is missing or malformed.
pub(super) fn simhash_distance(left: &str, right: &str) -> u32 {
    let read = |text: &str| {
        (text.len() == 16 && text.bytes().all(|b| b.is_ascii_hexdigit()))
            .then(|| u64::from_str_radix(text, 16).ok())
            .flatten()
    };
    match (read(left), read(right)) {
        (Some(a), Some(b)) => (a ^ b).count_ones(),
        _ => 64,
    }
}

pub(super) fn valid(event: &MemoryEvent) -> bool {
    if !KINDS.contains(&event.kind.as_str())
        || event.url.len() > 2048
        || event.title.len() > 300
        || event.body.len() > MAX_BODY_BYTES
        || event.device_id.len() > 200
        || event.ref_id.len() > 200
        || event.app.len() > 200
        || event.window_title.len() > 300
        || event.session_id.len() > 100
        || event.dwell_ms < 0
    {
        return false;
    }
    if !event.simhash.is_empty() && simhash_distance(&event.simhash, &event.simhash) == 64 {
        return false;
    }
    if event.kind == "page" {
        return url::Url::parse(&event.url)
            .is_ok_and(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some());
    }
    true
}

/// A moment's text in the search index. A revisit has none of its own.
pub(super) fn index_text(event: &MemoryEvent) -> String {
    if event.same_as.is_empty() {
        format!("{}\n{}", event.title, event.body)
    } else {
        String::new()
    }
}

/// Keeps one event. Past the backlog cap nothing new with text is kept.
pub(crate) fn record(
    connection: &mut Connection,
    account: &str,
    mut event: MemoryEvent,
    backlog_cap: i64,
    now: i64,
) -> Result<MemoryEvent> {
    check_space(&event.space_id)?;
    event.id = uuid::Uuid::new_v4().to_string();
    if !valid(&event) {
        return Err(MemoryError::Invalid("invalid_memory_event"));
    }
    let occurred = parse_time(&event.occurred_at)
        .filter(|at| *at <= now + 5 * 60_000)
        .unwrap_or(now);
    event.occurred_at = rfc3339(occurred);
    if event.kind == "page" {
        event.site = site_of(&event.url);
    }
    let transaction = connection.transaction()?;
    if event.kind == "page" && !event.simhash.is_empty() {
        let holder: Option<(String, String)> = transaction
            .query_row(
                "SELECT id, simhash FROM memory_events
                 WHERE account = ?1 AND space_id = ?2 AND url = ?3 AND same_as IS NULL AND simhash <> ''
                 ORDER BY occurred_at DESC LIMIT 1",
                params![account, event.space_id, event.url],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        if let Some((id, hash)) = holder {
            if simhash_distance(&hash, &event.simhash) <= SAME_BITS {
                event.same_as = id;
                event.body.clear();
            }
        }
    }
    let text = index_text(&event);
    if !text.trim().is_empty() && index::waiting(&transaction, account)? >= backlog_cap {
        return Err(MemoryError::BacklogFull);
    }
    insert(&transaction, account, &event, occurred, now, false)?;
    // Embedded in hourly batches, with the hour's other moments.
    let due = (now / HOUR_MS + 1) * HOUR_MS;
    index::put(
        &transaction,
        account,
        &event.space_id,
        MOMENTS,
        &event.id,
        &text,
        due,
        false,
    )?;
    transaction.commit()?;
    Ok(event)
}

/// `synced` is a copy that came from the vault, so it has nothing to send back.
pub(super) fn insert(
    connection: &Connection,
    account: &str,
    event: &MemoryEvent,
    occurred: i64,
    now: i64,
    synced: bool,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT INTO memory_events (account, id, space_id, kind, device_id, url, site, title, simhash,
             same_as, ref_id, dwell_ms, occurred_at, app, window_title, session_id, updated_at, sent,
             changed, body)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULLIF(?10, ''), ?11, ?12, ?13, ?14, ?15, ?16, ?17,
             ?18, ?19, ?20)
         ON CONFLICT (account, id) DO UPDATE SET space_id = excluded.space_id, kind = excluded.kind,
             device_id = excluded.device_id, url = excluded.url, site = excluded.site,
             title = excluded.title, simhash = excluded.simhash, same_as = excluded.same_as,
             ref_id = excluded.ref_id, dwell_ms = excluded.dwell_ms,
             occurred_at = excluded.occurred_at, app = excluded.app,
             window_title = excluded.window_title, session_id = excluded.session_id,
             updated_at = excluded.updated_at, sent = excluded.sent, changed = excluded.changed,
             body = excluded.body",
        params![
            account,
            event.id,
            event.space_id,
            event.kind,
            event.device_id,
            event.url,
            event.site,
            event.title,
            event.simhash,
            event.same_as,
            event.ref_id,
            event.dwell_ms,
            occurred,
            event.app,
            event.window_title,
            event.session_id,
            now,
            synced,
            !synced,
            event.body,
        ],
    )?;
    Ok(())
}

/// Narrows a timeline to one Space.
#[derive(Debug, Default, Deserialize)]
pub(crate) struct MemoryQuery {
    #[serde(default)]
    pub space_id: String,
    pub from: Option<String>,
    pub to: Option<String>,
    #[serde(default)]
    pub site: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub ids: Vec<String>,
    #[serde(default)]
    pub limit: i64,
}

/// A row with the text a revisit points at. Goes with `SELECTED`.
pub(super) fn from_row(row: &Row) -> rusqlite::Result<MemoryEvent> {
    Ok(MemoryEvent {
        id: row.get(0)?,
        space_id: row.get(1)?,
        kind: row.get(2)?,
        device_id: row.get(3)?,
        url: row.get(4)?,
        site: row.get(5)?,
        title: row.get(6)?,
        body: row.get(7)?,
        simhash: row.get(8)?,
        same_as: row.get(9)?,
        ref_id: row.get(10)?,
        dwell_ms: row.get(11)?,
        occurred_at: rfc3339(row.get(12)?),
        app: row.get(13)?,
        window_title: row.get(14)?,
        session_id: row.get(15)?,
    })
}

pub(super) const SELECTED: &str =
    "SELECT e.id, e.space_id, e.kind, e.device_id, e.url, e.site, e.title,
         COALESCE(h.body, e.body), e.simhash, COALESCE(e.same_as, ''), e.ref_id, e.dwell_ms,
         e.occurred_at, e.app, e.window_title, e.session_id, e.updated_at
     FROM memory_events e LEFT JOIN memory_events h ON h.account = e.account AND h.id = e.same_as";

/// The person's events in one Space, newest first. With ids, just those events.
pub(crate) fn list(
    connection: &Connection,
    account: &str,
    query: &MemoryQuery,
    now: i64,
) -> Result<Vec<MemoryEvent>> {
    check_space(&query.space_id)?;
    let from = super::optional_time(query.from.as_deref(), "invalid_memory_query")?.unwrap_or(0);
    let to =
        super::optional_time(query.to.as_deref(), "invalid_memory_query")?.unwrap_or(now + 60_000);
    if query.site.len() > 255 {
        return Err(MemoryError::Invalid("invalid_memory_query"));
    }
    let limit = if (1..=200).contains(&query.limit) {
        query.limit
    } else {
        50
    };
    let ids = serde_json::to_string(&query.ids).unwrap_or_else(|_| "[]".to_owned());
    let mut statement = connection.prepare_cached(&format!(
        "{SELECTED}
         WHERE e.account = ?1 AND e.space_id = ?2 AND e.occurred_at >= ?3 AND e.occurred_at < ?4
           AND (?5 = '' OR e.site = ?5 OR (length(e.site) > length(?5)
                AND substr(e.site, -length(?5) - 1) = '.' || ?5))
           AND (?6 = '' OR e.kind = ?6)
           AND (?7 = '[]' OR e.id IN (SELECT value FROM json_each(?7)))
         ORDER BY e.occurred_at DESC LIMIT ?8"
    ))?;
    let site = query.site.trim().to_lowercase();
    let rows = statement
        .query_map(
            params![
                account,
                query.space_id,
                from,
                to,
                site,
                query.kind,
                ids,
                limit
            ],
            from_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}
