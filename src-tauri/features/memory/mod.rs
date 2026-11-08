//! Memory on this computer: one tree per account and Space,
//! private to its owner. Moments are what the person read, heard or recorded; facts are what they asked
//! Misty to remember; summaries are recaps. It syncs between computers only as sealed vault records
//! (`sync`), so the server can't read it, and without a vault it stays here.
//!
//! The personal Space is the empty Space id on every computer, since its server id means nothing to a
//! person who is signed out.
use rusqlite::Connection;

pub(crate) mod commands;
mod events;
mod export;
mod forget;
mod index;
pub(crate) mod pref_commands;
mod prefs;
mod search;
mod summaries;
pub(crate) mod sync;
mod sync_apply;
mod tree;
mod tree_leaves;
pub(crate) mod vault_link;

#[cfg(test)]
mod index_tests;
#[cfg(test)]
mod prefs_tests;
#[cfg(test)]
mod search_timing_tests;
#[cfg(test)]
mod sync_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tree_tests;

pub(crate) const MOMENTS: &str = "moments";
pub(crate) const SUMMARIES: &str = "summaries";
pub(crate) const FACTS: &str = "facts";
pub(crate) const WORKFLOWS: &str = "workflows";

/// How much may wait for a vector before new pages stop being kept.
pub(crate) const BACKLOG_CAP: i64 = 2000;

const HOUR_MS: i64 = 3_600_000;

#[derive(Debug, PartialEq)]
pub(crate) enum MemoryError {
    /// The request can't be kept or read. The code says what kind.
    Invalid(&'static str),
    NotFound,
    BacklogFull,
    Storage(String),
}

impl From<rusqlite::Error> for MemoryError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage(error.to_string())
    }
}

impl MemoryError {
    pub(crate) fn code(&self) -> String {
        match self {
            Self::Invalid(code) => (*code).to_owned(),
            Self::NotFound => "memory_not_found".to_owned(),
            Self::BacklogFull => "memory_backlog_full".to_owned(),
            Self::Storage(_) => "memory_unavailable".to_owned(),
        }
    }
}

pub(crate) type Result<T> = std::result::Result<T, MemoryError>;

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

/// A Space id as the app's windows use them, or the personal Space's empty one.
pub(crate) fn check_space(space: &str) -> Result<()> {
    let valid = space.len() <= 100
        && space
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'));
    if valid {
        Ok(())
    } else {
        Err(MemoryError::Invalid("memory_space_not_found"))
    }
}

pub(crate) fn rfc3339(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .unwrap_or_default()
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub(crate) fn parse_time(text: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(text)
        .ok()
        .map(|time| time.timestamp_millis())
}

/// A time a request may leave out. One that doesn't parse is an error, never "no limit".
pub(crate) fn optional_time(text: Option<&str>, code: &'static str) -> Result<Option<i64>> {
    match text.filter(|text| !text.is_empty()) {
        Some(text) => parse_time(text).map(Some).ok_or(MemoryError::Invalid(code)),
        None => Ok(None),
    }
}

/// Text on one line, cut to `limit` characters.
pub(crate) fn clip(text: &str, limit: usize) -> String {
    let joined = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if joined.chars().count() > limit {
        let cut: String = joined.chars().take(limit).collect();
        format!("{cut}…")
    } else {
        joined
    }
}

/// Keeps a deleted record's id until the vault has heard, if the vault could have it.
pub(crate) fn mark_deleted(
    connection: &Connection,
    account: &str,
    record: &str,
    now: i64,
) -> rusqlite::Result<()> {
    connection.execute(
        "INSERT OR REPLACE INTO memory_deleted (account, record_id, deleted_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![account, record, now],
    )?;
    Ok(())
}
