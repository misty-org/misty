//! The leaves of the memory tree: one moment, summary or fact each.
use rusqlite::{params, Connection};

use super::summaries::{MANUAL_PREFIX, RECAP_PREFIX};
use super::tree::{first_non_empty, MemoryNode, SEARCHABLE};
use super::{clip, rfc3339, MemoryError, Result, FACTS, MOMENTS, SUMMARIES};

const LEAVES: i64 = 100;

#[allow(clippy::too_many_arguments)]
pub(super) fn moments(
    connection: &Connection,
    account: &str,
    space: &str,
    from: i64,
    to: i64,
    parent: &str,
    name: &str,
    value: &str,
) -> Result<Vec<MemoryNode>> {
    let filter = match name {
        "session" => "e.session_id = ?5",
        "site" => "e.session_id = '' AND e.kind = 'page' AND e.site = ?5",
        "kind" => "e.session_id = '' AND e.kind = ?5",
        _ => return Err(MemoryError::Invalid("invalid_memory_query")),
    };
    let mut statement = connection.prepare_cached(&format!(
        "SELECT e.id, e.kind, e.title, e.window_title, e.app, e.url, e.site, COALESCE(h.body, e.body),
             e.occurred_at, {SEARCHABLE}
         FROM memory_events e LEFT JOIN memory_events h ON h.account = e.account AND h.id = e.same_as
         WHERE e.account = ?1 AND e.space_id = ?2 AND e.occurred_at >= ?3 AND e.occurred_at < ?4 AND {filter}
         ORDER BY e.occurred_at DESC LIMIT ?6"
    ))?;
    let rows = statement
        .query_map(params![account, space, from, to, value, LEAVES], |row| {
            let (id, kind, title, window, app, url, site, body): (
                String, String, String, String, String, String, String, String,
            ) = (
                row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?,
                row.get(7)?,
            );
            let label = first_non_empty(&[&title, &window, &site, &url, "Untitled"]);
            Ok(MemoryNode {
                id: format!("moment:{id}"),
                parent: parent.to_owned(),
                node_type: "moment".to_owned(),
                branch: MOMENTS.to_owned(),
                source: kind,
                label: clip(label, 80),
                detail: first_non_empty(&[&app, &site]).to_owned(),
                preview: clip(&body, 140),
                text: clip(&body, 2000),
                last_at: Some(rfc3339(row.get(8)?)),
                searchable: row.get(9)?,
                app,
                url,
                ..MemoryNode::default()
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub(super) fn summaries(connection: &Connection, account: &str, space: &str) -> Result<Vec<MemoryNode>> {
    let mut statement = connection.prepare_cached(
        "SELECT s.surface_id, s.text, s.updated_at, s.title, s.outline,
             EXISTS (SELECT 1 FROM memory_chunks c WHERE c.account = s.account AND c.space_id = s.space_id
                 AND c.branch = 'summaries' AND c.record_id = s.surface_id AND c.embedded = 1)
         FROM memory_summaries s WHERE s.account = ?1 AND s.space_id = ?2
         ORDER BY s.updated_at DESC LIMIT ?3",
    )?;
    let rows = statement
        .query_map(params![account, space, LEAVES], |row| {
            let (surface, text, title, outline): (String, String, String, Option<String>) =
                (row.get(0)?, row.get(1)?, row.get(3)?, row.get(4)?);
            let mut node = MemoryNode {
                id: format!("summary:{surface}"),
                parent: SUMMARIES.to_owned(),
                node_type: "summary".to_owned(),
                branch: SUMMARIES.to_owned(),
                label: "Daily recap".to_owned(),
                detail: surface.clone(),
                preview: clip(&text, 140),
                text: clip(&text, 2000),
                last_at: Some(rfc3339(row.get(2)?)),
                searchable: row.get(5)?,
                ..MemoryNode::default()
            };
            if surface.starts_with(MANUAL_PREFIX) {
                node.label = first_non_empty(&[&clip(&title, 80), "Summary"]).to_owned();
                node.detail = "Added by you".to_owned();
            }
            if surface.starts_with(RECAP_PREFIX) {
                node.label = first_non_empty(&[&clip(&title, 80), "Recap"]).to_owned();
                node.detail = "Recap".to_owned();
                node.source = "recap".to_owned();
                node.outline = outline.and_then(|text| serde_json::from_str(&text).ok());
            }
            Ok(node)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub(super) fn facts(connection: &Connection, account: &str, space: &str) -> Result<Vec<MemoryNode>> {
    let mut statement = connection.prepare_cached(
        "SELECT m.id, m.kind, m.content, m.reason, m.updated_at,
             EXISTS (SELECT 1 FROM memory_chunks c WHERE c.account = m.account AND c.space_id = m.space_id
                 AND c.branch = 'facts' AND c.record_id = m.id AND c.embedded = 1)
         FROM memory_facts m WHERE m.account = ?1 AND m.space_id = ?2
         ORDER BY m.updated_at DESC LIMIT ?3",
    )?;
    let rows = statement
        .query_map(params![account, space, LEAVES], |row| {
            let (id, kind, content, reason): (String, String, String, String) =
                (row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?);
            Ok(MemoryNode {
                id: format!("fact:{id}"),
                parent: FACTS.to_owned(),
                node_type: "fact".to_owned(),
                branch: FACTS.to_owned(),
                source: kind.clone(),
                label: clip(&content, 80),
                detail: kind,
                preview: clip(&reason, 140),
                text: clip(&content, 2000),
                last_at: Some(rfc3339(row.get(4)?)),
                searchable: row.get(5)?,
                ..MemoryNode::default()
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}
