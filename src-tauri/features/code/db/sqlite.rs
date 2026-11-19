//! SQLite through rusqlite. Every call here blocks, so the commands run them on a blocking
//! thread; a running query stops through the connection's interrupt handle.

use std::path::Path;
use std::time::Duration;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{ErrorCode, OpenFlags};
use serde_json::{Map, Value};

use super::types::{
    bytes, float, integer, quote_ident, sentence, DbSchema, QueryColumn, QueryResult, SchemaColumn,
    SchemaGroup, SchemaTable, TableKind, TableRef,
};

/// Opens an existing database file for reading and writing (read-only when the file is). It is
/// never created: a mistyped path should say so, not leave an empty database behind.
pub fn open(path: &Path) -> Result<rusqlite::Connection, String> {
    let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let connection = file_access::fs::open_sqlite_with_flags(path, flags).map_err(|error| {
        match error {
            // The file gate's refusal.
            rusqlite::Error::ToSqlConversionFailure(_) => {
                "Misty can only open a database file in a linked folder, or one you chose."
                    .to_string()
            }
            rusqlite::Error::SqliteFailure(failure, _) if failure.code == ErrorCode::CannotOpen => {
                "That database file couldn't be opened. Check that it's still there.".to_string()
            }
            other => error_text(other),
        }
    })?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(error_text)?;
    Ok(connection)
}

pub fn error_text(error: rusqlite::Error) -> String {
    match &error {
        rusqlite::Error::SqliteFailure(failure, message) => {
            if failure.code == ErrorCode::OperationInterrupted {
                return "The query was stopped.".to_string();
            }
            sentence(message.as_deref().unwrap_or(&failure.to_string()))
        }
        other => sentence(&other.to_string()),
    }
}

/// Reads one row of the database's own catalog, so a file that isn't a database says so now.
pub fn test(connection: &rusqlite::Connection) -> Result<(), String> {
    connection
        .query_row("SELECT count(*) FROM sqlite_master", [], |row| {
            row.get::<_, i64>(0)
        })
        .map(|_| ())
        .map_err(error_text)
}

/// One attached database's columns: (name, declared type, not null, primary key position).
fn table_info(
    connection: &rusqlite::Connection,
    schema: &str,
    table: &str,
) -> Result<Vec<(String, String, bool, i64)>, String> {
    let mut statement = connection
        .prepare(r#"SELECT name, type, "notnull", pk FROM pragma_table_info(?1, ?2) ORDER BY cid"#)
        .map_err(error_text)?;
    let rows = statement
        .query_map([table, schema], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, i64>(2)? != 0,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(error_text)?;
    rows.collect::<Result<_, _>>().map_err(error_text)
}

/// Each attached database (`main` first) with its tables and views. SQLite's own tables are left
/// out.
pub fn schema(connection: &rusqlite::Connection) -> Result<DbSchema, String> {
    let names: Vec<String> = {
        let mut statement = connection
            .prepare("SELECT name FROM pragma_database_list WHERE name <> 'temp' ORDER BY seq")
            .map_err(error_text)?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(error_text)?;
        rows.collect::<Result<_, _>>().map_err(error_text)?
    };
    let mut schemas = Vec::with_capacity(names.len());
    for name in names {
        let listing: Vec<(String, String)> = {
            let mut statement = connection
                .prepare(&format!(
                    "SELECT name, type FROM {}.sqlite_master
                     WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
                     ORDER BY name COLLATE NOCASE",
                    quote_ident(&name)
                ))
                .map_err(error_text)?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(error_text)?;
            rows.collect::<Result<_, _>>().map_err(error_text)?
        };
        let mut tables = Vec::with_capacity(listing.len());
        for (table, kind) in listing {
            let columns = table_info(connection, &name, &table)?
                .into_iter()
                .map(|(column, type_name, not_null, pk)| SchemaColumn {
                    name: column,
                    type_name,
                    nullable: !not_null,
                    primary_key: pk > 0,
                })
                .collect();
            tables.push(SchemaTable {
                name: table,
                kind: if kind == "view" {
                    TableKind::View
                } else {
                    TableKind::Table
                },
                columns,
            });
        }
        schemas.push(SchemaGroup { name, tables });
    }
    Ok(DbSchema { schemas })
}

fn cell(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(number) => integer(number),
        ValueRef::Real(number) => float(number),
        ValueRef::Text(text) => Value::String(String::from_utf8_lossy(text).into_owned()),
        ValueRef::Blob(blob) => bytes(blob),
    }
}

/// SQLite types values, not columns: a result column is named for the first value it holds.
fn storage_class(value: ValueRef<'_>) -> &'static str {
    match value {
        ValueRef::Null => "",
        ValueRef::Integer(_) => "integer",
        ValueRef::Real(_) => "real",
        ValueRef::Text(_) => "text",
        ValueRef::Blob(_) => "blob",
    }
}

/// Runs every statement in `sql` in turn. The last one that returns rows is the result (its first
/// `limit` rows); the others add up what they changed.
pub fn query(
    connection: &rusqlite::Connection,
    sql: &str,
    limit: usize,
) -> Result<QueryResult, String> {
    let mut result = QueryResult::default();
    let mut batch = rusqlite::Batch::new(connection, sql);
    while let Some(mut statement) = batch.next().map_err(error_text)? {
        if statement.column_count() == 0 {
            result.rows_affected += statement.execute([]).map_err(error_text)? as u64;
            continue;
        }
        let names: Vec<String> = statement
            .column_names()
            .into_iter()
            .map(str::to_string)
            .collect();
        let count = names.len();
        let mut kinds = vec![""; count];
        let mut rows_out = Vec::new();
        let mut truncated = false;
        {
            let mut rows = statement.query([]).map_err(error_text)?;
            while let Some(row) = rows.next().map_err(error_text)? {
                // One row past the limit says there were more, without reading the rest.
                if rows_out.len() >= limit {
                    truncated = true;
                    break;
                }
                let mut cells = Vec::with_capacity(count);
                for (index, kind) in kinds.iter_mut().enumerate() {
                    let value = row.get_ref(index).map_err(error_text)?;
                    if kind.is_empty() {
                        *kind = storage_class(value);
                    }
                    cells.push(cell(value));
                }
                rows_out.push(cells);
            }
        }
        result.columns = names
            .into_iter()
            .zip(kinds)
            .map(|(name, kind)| QueryColumn {
                name,
                type_name: kind.to_string(),
            })
            .collect();
        result.rows = rows_out;
        result.truncated = truncated;
    }
    Ok(result)
}

/// A value from the grid as SQLite stores it. Text in a BLOB column that reads as `\x` hex (how
/// the grid shows bytes) goes back as those bytes.
fn sqlite_value(value: &Value, declared: &str) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(flag) => SqlValue::Integer(i64::from(*flag)),
        Value::Number(number) => number
            .as_i64()
            .map(SqlValue::Integer)
            .or_else(|| number.as_f64().map(SqlValue::Real))
            .unwrap_or(SqlValue::Null),
        Value::String(text) => {
            if declared.to_ascii_uppercase().contains("BLOB") {
                if let Some(blob) = text
                    .strip_prefix("\\x")
                    .and_then(|hex| hex::decode(hex).ok())
                {
                    return SqlValue::Blob(blob);
                }
            }
            SqlValue::Text(text.clone())
        }
        other => SqlValue::Text(other.to_string()),
    }
}

/// Changes one row, found by its primary key, inside a transaction that only commits when exactly
/// one row changed.
pub fn update_row(
    connection: &mut rusqlite::Connection,
    table: &TableRef,
    key: &Map<String, Value>,
    changes: &Map<String, Value>,
) -> Result<(), String> {
    let schema = table
        .schema
        .as_deref()
        .unwrap_or(crate::known_names::SQLITE_MAIN_SCHEMA);
    let columns = table_info(connection, schema, &table.name)?;
    if columns.is_empty() {
        return Err("That table isn't in the database any more.".to_string());
    }
    let mut primary: Vec<(&str, i64)> = columns
        .iter()
        .filter(|column| column.3 > 0)
        .map(|column| (column.0.as_str(), column.3))
        .collect();
    primary.sort_by_key(|column| column.1);
    let primary: Vec<&str> = primary.into_iter().map(|column| column.0).collect();
    let names: Vec<&str> = columns.iter().map(|column| column.0.as_str()).collect();
    super::types::check_edit(&primary, &names, key, changes)?;

    let declared = |name: &str| {
        columns
            .iter()
            .find(|column| column.0 == name)
            .map(|column| column.1.as_str())
            .unwrap_or("")
    };
    let mut params = Vec::with_capacity(changes.len() + key.len());
    let mut sets = Vec::with_capacity(changes.len());
    for (name, value) in changes {
        params.push(sqlite_value(value, declared(name)));
        sets.push(format!("{} = ?{}", quote_ident(name), params.len()));
    }
    let mut wheres = Vec::with_capacity(key.len());
    for name in &primary {
        params.push(sqlite_value(&key[*name], declared(name)));
        wheres.push(format!("{} = ?{}", quote_ident(name), params.len()));
    }
    let sql = format!(
        "UPDATE {}.{} SET {} WHERE {}",
        quote_ident(schema),
        quote_ident(&table.name),
        sets.join(", "),
        wheres.join(" AND ")
    );

    let transaction = connection.transaction().map_err(error_text)?;
    let changed = transaction
        .execute(&sql, rusqlite::params_from_iter(params.iter()))
        .map_err(error_text)?;
    if changed != 1 {
        // Dropping the transaction rolls it back.
        return Err(super::types::matched_error(changed as u64));
    }
    transaction.commit().map_err(error_text)
}
