//! Postgres schemas, queries and row edits, over the clients `pg_pool` lends.

use futures_util::StreamExt;
use serde_json::{Map, Value};
use tokio_postgres::error::SqlState;
use tokio_postgres::types::ToSql;
use tokio_postgres::{Client, SimpleQueryMessage};

pub use super::pg_pool::{cancel, connect, error_text, forget, lease, Lease};
use super::pg_values;
use super::types::{
    quote_ident, DbSchema, QueryColumn, QueryResult, SchemaColumn, SchemaGroup, SchemaTable,
    TableKind, TableRef,
};

// ---------------------------------------------------------------------------------------------
// Schema

const SCHEMA_SQL: &str = "
    SELECT n.nspname, c.relname, c.relkind::text, a.attname,
           format_type(a.atttypid, a.atttypmod), NOT a.attnotnull,
           COALESCE(a.attnum = ANY(i.indkey), false)
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_attribute a
        ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN pg_catalog.pg_index i ON i.indrelid = c.oid AND i.indisprimary
     WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND n.nspname <> 'information_schema' AND n.nspname NOT LIKE 'pg\\_%'
     ORDER BY n.nspname, c.relname, a.attnum";

/// Every schema the person can see with its tables, views and their columns, from the catalog in
/// one read. Postgres's own schemas are left out.
pub async fn schema(client: &Client) -> Result<DbSchema, String> {
    let rows = client
        .query(SCHEMA_SQL, &[])
        .await
        .map_err(|error| error_text(&error))?;
    let mut schemas: Vec<SchemaGroup> = Vec::new();
    for row in rows {
        let schema: String = row.get(0);
        let table: String = row.get(1);
        let kind: String = row.get(2);
        let column = SchemaColumn {
            name: row.get(3),
            type_name: row.get::<_, Option<String>>(4).unwrap_or_default(),
            nullable: row.get(5),
            primary_key: row.get(6),
        };
        if schemas.last().map(|group| group.name.as_str()) != Some(schema.as_str()) {
            schemas.push(SchemaGroup {
                name: schema,
                tables: Vec::new(),
            });
        }
        let group = schemas.last_mut().expect("pushed above");
        if group.tables.last().map(|last| last.name.as_str()) != Some(table.as_str()) {
            group.tables.push(SchemaTable {
                name: table,
                kind: if matches!(kind.as_str(), "v" | "m") {
                    TableKind::View
                } else {
                    TableKind::Table
                },
                columns: Vec::new(),
            });
        }
        group
            .tables
            .last_mut()
            .expect("pushed above")
            .columns
            .push(column);
    }
    Ok(DbSchema { schemas })
}

// ---------------------------------------------------------------------------------------------
// Queries

/// Whether `sql` starts a transaction the person means to keep open past this run.
fn opens_transaction(sql: &str) -> bool {
    let first = sql
        .trim_start()
        .split(|c: char| c.is_whitespace() || c == ';')
        .next()
        .unwrap_or("")
        .to_ascii_uppercase();
    first == "BEGIN" || first == "START"
}

/// Runs `sql`. One statement goes through the extended protocol, so its values come typed and
/// only `limit + 1` rows are fetched; a script, which Postgres won't prepare, runs as a simple
/// query whose rows arrive as text.
pub async fn query(lease: &mut Lease, sql: &str, limit: usize) -> Result<QueryResult, String> {
    if opens_transaction(sql) {
        lease.discard = true;
    }
    let client = lease.client();
    let statement = match client.prepare(sql).await {
        Ok(statement) => statement,
        // "Cannot insert multiple commands into a prepared statement" carries the syntax error
        // code; a real syntax error fails the same way again below.
        Err(error) if error.code() == Some(&SqlState::SYNTAX_ERROR) => {
            return script(client, sql, limit).await;
        }
        Err(error) => return Err(error_text(&error)),
    };
    if !statement.params().is_empty() {
        return Err("This query has $1-style parameters, which can't be filled in here.".into());
    }
    if statement.columns().is_empty() {
        // Outside a transaction, so statements that can't run in one (VACUUM, CREATE DATABASE)
        // still work.
        let affected = client
            .execute(&statement, &[])
            .await
            .map_err(|error| error_text(&error))?;
        return Ok(QueryResult {
            rows_affected: affected,
            ..QueryResult::default()
        });
    }
    let columns: Vec<QueryColumn> = statement
        .columns()
        .iter()
        .map(|column| QueryColumn {
            name: column.name().to_string(),
            type_name: column.type_().name().to_string(),
        })
        .collect();
    let types: Vec<_> = statement
        .columns()
        .iter()
        .map(|column| column.type_().clone())
        .collect();
    // A portal lives in a transaction; it lets the server stop after the rows the grid shows.
    let transaction = client
        .transaction()
        .await
        .map_err(|error| error_text(&error))?;
    let portal = transaction
        .bind(&statement, &[])
        .await
        .map_err(|error| error_text(&error))?;
    let fetched = transaction
        .query_portal(&portal, i32::try_from(limit + 1).unwrap_or(i32::MAX))
        .await
        .map_err(|error| error_text(&error))?;
    transaction
        .commit()
        .await
        .map_err(|error| error_text(&error))?;
    let truncated = fetched.len() > limit;
    let rows = fetched
        .iter()
        .take(limit)
        .map(|row| {
            types
                .iter()
                .enumerate()
                .map(|(index, ty)| pg_values::cell(row, index, ty))
                .collect()
        })
        .collect();
    Ok(QueryResult {
        columns,
        rows,
        truncated,
        ..QueryResult::default()
    })
}

/// Several statements at once, as one simple query: Postgres runs them in turn (in one implicit
/// transaction unless the script says otherwise). The last result set is kept; the counts of the
/// statements without one add up.
async fn script(client: &Client, sql: &str, limit: usize) -> Result<QueryResult, String> {
    let stream = client
        .simple_query_raw(sql)
        .await
        .map_err(|error| error_text(&error))?;
    let mut stream = std::pin::pin!(stream);
    let mut result = QueryResult::default();
    let mut current: Option<QueryResult> = None;
    while let Some(message) = stream.next().await {
        match message.map_err(|error| error_text(&error))? {
            SimpleQueryMessage::RowDescription(columns) => {
                current = Some(QueryResult {
                    columns: columns
                        .iter()
                        .map(|column| QueryColumn {
                            name: column.name().to_string(),
                            type_name: String::new(),
                        })
                        .collect(),
                    ..QueryResult::default()
                });
            }
            SimpleQueryMessage::Row(row) => {
                if let Some(set) = current.as_mut() {
                    if set.rows.len() < limit {
                        set.rows.push(
                            (0..row.len())
                                .map(|index| {
                                    row.get(index)
                                        .map_or(Value::Null, |text| Value::String(text.to_string()))
                                })
                                .collect(),
                        );
                    } else {
                        set.truncated = true;
                    }
                }
            }
            SimpleQueryMessage::CommandComplete(count) => match current.take() {
                Some(set) => {
                    result.columns = set.columns;
                    result.rows = set.rows;
                    result.truncated = set.truncated;
                }
                None => result.rows_affected += count,
            },
            _ => {}
        }
    }
    Ok(result)
}

// ---------------------------------------------------------------------------------------------
// Editing a row

/// A grid value as the text Postgres reads it from: arrays as `{…}` literals, JSON as JSON.
fn param_text(value: &Value, array: bool) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(text) => Some(text.clone()),
        Value::Array(items) if array => Some(array_literal(items)),
        other => Some(other.to_string()),
    }
}

fn array_literal(items: &[Value]) -> String {
    let parts: Vec<String> = items
        .iter()
        .map(|item| match item {
            Value::Null => "NULL".to_string(),
            Value::Array(inner) => array_literal(inner),
            Value::String(text) => {
                format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
            }
            other => {
                let text = other.to_string();
                format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
            }
        })
        .collect();
    format!("{{{}}}", parts.join(","))
}

const COLUMNS_SQL: &str = "
    SELECT a.attname, format_type(a.atttypid, NULL), COALESCE(a.attnum = ANY(i.indkey), false)
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_index i ON i.indrelid = c.oid AND i.indisprimary
     WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum";

/// Changes one row, found by its primary key, in a transaction that commits only when exactly one
/// row changed. Every value goes as a text parameter cast to its column's type (without the
/// type's modifier, so a value too long for `varchar(20)` is refused rather than cut short).
pub async fn update_row(
    lease: &mut Lease,
    table: &TableRef,
    key: &Map<String, Value>,
    changes: &Map<String, Value>,
) -> Result<(), String> {
    let schema = table.schema.as_deref().unwrap_or("public");
    let client = lease.client();
    let described = client
        .query(COLUMNS_SQL, &[&schema, &table.name])
        .await
        .map_err(|error| error_text(&error))?;
    if described.is_empty() {
        return Err("That table isn't in the database any more.".to_string());
    }
    let columns: Vec<(String, String, bool)> = described
        .iter()
        .map(|row| {
            (
                row.get::<_, String>(0),
                row.get::<_, Option<String>>(1)
                    .unwrap_or_else(|| "text".into()),
                row.get::<_, bool>(2),
            )
        })
        .collect();
    let primary: Vec<&str> = columns
        .iter()
        .filter(|column| column.2)
        .map(|column| column.0.as_str())
        .collect();
    let names: Vec<&str> = columns.iter().map(|column| column.0.as_str()).collect();
    super::types::check_edit(&primary, &names, key, changes)?;

    let type_of = |name: &str| {
        columns
            .iter()
            .find(|column| column.0 == name)
            .map(|column| column.1.as_str())
            .unwrap_or("text")
    };
    let mut params: Vec<Option<String>> = Vec::with_capacity(changes.len() + key.len());
    let mut sets = Vec::with_capacity(changes.len());
    for (name, value) in changes {
        let ty = type_of(name);
        params.push(param_text(value, ty.ends_with("[]")));
        sets.push(format!(
            "{} = ${}::text::{ty}",
            quote_ident(name),
            params.len()
        ));
    }
    let mut wheres = Vec::with_capacity(primary.len());
    for name in &primary {
        let ty = type_of(name);
        params.push(param_text(&key[*name], ty.ends_with("[]")));
        wheres.push(format!(
            "{} = ${}::text::{ty}",
            quote_ident(name),
            params.len()
        ));
    }
    let sql = format!(
        "UPDATE {}.{} SET {} WHERE {}",
        quote_ident(schema),
        quote_ident(&table.name),
        sets.join(", "),
        wheres.join(" AND ")
    );
    let refs: Vec<&(dyn ToSql + Sync)> = params
        .iter()
        .map(|param| param as &(dyn ToSql + Sync))
        .collect();

    let transaction = client
        .transaction()
        .await
        .map_err(|error| error_text(&error))?;
    let changed = transaction
        .execute(sql.as_str(), &refs)
        .await
        .map_err(|error| error_text(&error))?;
    if changed != 1 {
        let _ = transaction.rollback().await;
        return Err(super::types::matched_error(changed));
    }
    transaction
        .commit()
        .await
        .map_err(|error| error_text(&error))
}
