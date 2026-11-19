//! What the database commands hand back to the window: a schema tree and query results whose
//! values are all JSON-safe (bytes as `\x` hex, big numbers as strings, times as ISO text).

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaColumn {
    pub name: String,
    #[serde(rename = "type")]
    pub type_name: String,
    pub nullable: bool,
    pub primary_key: bool,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TableKind {
    Table,
    View,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaTable {
    pub name: String,
    pub kind: TableKind,
    pub columns: Vec<SchemaColumn>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaGroup {
    pub name: String,
    pub tables: Vec<SchemaTable>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbSchema {
    pub schemas: Vec<SchemaGroup>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryColumn {
    pub name: String,
    /// The column's type as the database names it; "" when the driver can't tell (a Postgres
    /// script's rows arrive as text).
    #[serde(rename = "type")]
    pub type_name: String,
}

/// The last result set a run produced, and what the statements without one changed.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<QueryColumn>,
    pub rows: Vec<Vec<Value>>,
    pub rows_affected: u64,
    pub elapsed_ms: u64,
    /// More rows came back than the limit; only the first `limit` are here.
    pub truncated: bool,
}

/// The table a row edit is for.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRef {
    /// The Postgres schema or attached SQLite database; `public` and `main` when left out.
    #[serde(default)]
    pub schema: Option<String>,
    pub name: String,
}

/// An identifier in double quotes, for both SQLite and Postgres: the name is never spliced in
/// bare, so a table called `a; drop …` stays a name.
pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// The largest integer a JavaScript number holds exactly; anything past it goes as text.
pub const SAFE_INTEGER: i64 = (1 << 53) - 1;

pub fn integer(value: i64) -> Value {
    if (-SAFE_INTEGER..=SAFE_INTEGER).contains(&value) {
        Value::from(value)
    } else {
        Value::String(value.to_string())
    }
}

pub fn float(value: f64) -> Value {
    serde_json::Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or_else(|| Value::String(value.to_string()))
}

/// Bytes as Postgres writes `bytea`, which both databases' edits read back.
pub fn bytes(value: &[u8]) -> Value {
    Value::String(format!("\\x{}", hex::encode(value)))
}

/// A driver's message as a sentence: capitalized, ending in a full stop.
pub fn sentence(text: &str) -> String {
    let text = text.trim();
    let mut chars = text.chars();
    let mut out = match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect::<String>(),
        None => return "Something went wrong.".to_string(),
    };
    if !out.ends_with(&['.', '!', '?'][..]) {
        out.push('.');
    }
    out
}

/// Checks a row edit against the table as the database describes it, not as the window does: a
/// primary key, the key naming exactly its columns, and changes only to columns that exist.
pub fn check_edit(
    primary: &[&str],
    columns: &[&str],
    key: &serde_json::Map<String, Value>,
    changes: &serde_json::Map<String, Value>,
) -> Result<(), String> {
    if primary.is_empty() {
        return Err(
            "This table has no primary key, so Misty can't tell which row to change.".into(),
        );
    }
    if key.len() != primary.len() || primary.iter().any(|name| !key.contains_key(*name)) {
        return Err("The table's primary key has changed. Open the table again.".into());
    }
    if primary.iter().any(|name| key[*name].is_null()) {
        return Err("This row has no key, so Misty can't tell which row to change.".into());
    }
    if changes.is_empty() {
        return Err("There's nothing to save.".into());
    }
    if let Some(missing) = changes
        .keys()
        .find(|name| !columns.contains(&name.as_str()))
    {
        return Err(format!("The column {missing} isn't in the table any more."));
    }
    Ok(())
}

/// Why an edit that didn't change exactly one row was rolled back.
pub fn matched_error(changed: u64) -> String {
    if changed == 0 {
        "No row matched, so nothing was saved. It may have changed or been deleted; run the query again."
            .to_string()
    } else {
        format!("That would have changed {changed} rows, so nothing was saved.")
    }
}
