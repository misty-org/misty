//! Everything Memory kept, as a zip: one event per line in memory.jsonl, a readable page per day, and the
//! facts and summaries, which this computer alone now holds.
use std::collections::BTreeMap;
use std::io::{Cursor, Write};

use rusqlite::{params, Connection};
use zip::write::SimpleFileOptions;

use super::{events, parse_time, rfc3339, MemoryError, Result};

fn line(writer: &mut impl Write, value: &impl serde::Serialize) -> std::io::Result<()> {
    serde_json::to_writer(&mut *writer, value)?;
    writer.write_all(b"\n")
}

pub(crate) fn zip_all(connection: &Connection, account: &str) -> Result<Vec<u8>> {
    let failed = |_| MemoryError::Storage("The export couldn't be written.".to_owned());
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut days: BTreeMap<String, String> = BTreeMap::new();
    zip.start_file("memory.jsonl", options)
        .map_err(|_| failed(()))?;
    let mut statement = connection.prepare(&format!(
        "{} WHERE e.account = ?1 ORDER BY e.occurred_at, e.id",
        events::SELECTED
    ))?;
    let mut rows = statement.query(params![account])?;
    while let Some(row) = rows.next()? {
        let event = events::from_row(row)?;
        line(&mut zip, &event).map_err(|_| failed(()))?;
        let at = parse_time(&event.occurred_at).unwrap_or_default();
        let stamp = chrono::DateTime::from_timestamp_millis(at).unwrap_or_default();
        let page = days
            .entry(stamp.format("%Y-%m-%d").to_string())
            .or_insert_with_key(|day| format!("# {day}\n\n"));
        let name = [&event.title, &event.url, &event.kind]
            .into_iter()
            .find(|value| !value.trim().is_empty())
            .cloned()
            .unwrap_or_default();
        page.push_str(&format!("- {} · {name}", stamp.format("%H:%M")));
        if !event.url.is_empty() {
            page.push_str(&format!(" — {}", event.url));
        }
        page.push('\n');
    }
    zip.start_file("facts.jsonl", options)
        .map_err(|_| failed(()))?;
    let mut statement = connection.prepare(
        "SELECT id, space_id, agent_id, kind, content, reason, created_at, updated_at
         FROM memory_facts WHERE account = ?1 ORDER BY created_at, id",
    )?;
    let mut rows = statement.query(params![account])?;
    while let Some(row) = rows.next()? {
        let fact = serde_json::json!({
            "id": row.get::<_, String>(0)?,
            "space_id": row.get::<_, String>(1)?,
            "agent_id": row.get::<_, String>(2)?,
            "kind": row.get::<_, String>(3)?,
            "content": row.get::<_, String>(4)?,
            "reason": row.get::<_, String>(5)?,
            "created_at": rfc3339(row.get(6)?),
            "updated_at": rfc3339(row.get(7)?),
        });
        line(&mut zip, &fact).map_err(|_| failed(()))?;
    }
    zip.start_file("summaries.jsonl", options)
        .map_err(|_| failed(()))?;
    let mut statement = connection.prepare(
        "SELECT space_id, surface_id, title, text, updated_at
         FROM memory_summaries WHERE account = ?1 ORDER BY updated_at, surface_id",
    )?;
    let mut rows = statement.query(params![account])?;
    while let Some(row) = rows.next()? {
        let summary = serde_json::json!({
            "space_id": row.get::<_, String>(0)?,
            "surface_id": row.get::<_, String>(1)?,
            "title": row.get::<_, String>(2)?,
            "text": row.get::<_, String>(3)?,
            "updated_at": rfc3339(row.get(4)?),
        });
        line(&mut zip, &summary).map_err(|_| failed(()))?;
    }
    for (day, page) in &days {
        zip.start_file(format!("days/{day}.md"), options)
            .map_err(|_| failed(()))?;
        zip.write_all(page.as_bytes()).map_err(|_| failed(()))?;
    }
    let finished = zip.finish().map_err(|_| failed(()))?;
    Ok(finished.into_inner())
}
