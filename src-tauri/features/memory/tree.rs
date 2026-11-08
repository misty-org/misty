//! A Space's memory tree as the Memory page and agents see it. Ids are stable strings: a branch is
//! "moments", a group is "moments:site:github.com", a leaf is "moment:<id>".
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::summaries::RecapOutline;
use super::tree_leaves::{facts, moments, summaries};
use super::{check_space, rfc3339, MemoryError, Result, FACTS, MOMENTS, SUMMARIES, WORKFLOWS};

const GROUPS: i64 = 60;
/// A moment that can be found by meaning, or has no text of its own to find.
pub(super) const SEARCHABLE: &str =
    "(e.indexed = 1 OR e.same_as IS NOT NULL OR trim(e.title || e.body) = '')";

fn empty(text: &str) -> bool {
    text.is_empty()
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub(crate) struct MemoryNode {
    pub id: String,
    pub parent: String,
    /// branch, group, moment, summary, fact, workflow
    #[serde(rename = "type")]
    pub node_type: String,
    pub branch: String,
    /// page, screen, voice, recording, note
    #[serde(skip_serializing_if = "empty")]
    pub source: String,
    pub label: String,
    #[serde(skip_serializing_if = "empty")]
    pub detail: String,
    pub count: i64,
    #[serde(skip_serializing_if = "empty")]
    pub preview: String,
    #[serde(skip_serializing_if = "empty")]
    pub text: String,
    #[serde(skip_serializing_if = "empty")]
    pub app: String,
    #[serde(skip_serializing_if = "empty")]
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_at: Option<String>,
    pub searchable: bool,
    pub expandable: bool,
    /// A day's recap only: its threads and what was left to do.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outline: Option<RecapOutline>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct TreeQuery {
    #[serde(default)]
    pub space_id: String,
    #[serde(default)]
    pub parent: String,
    pub from: Option<String>,
    pub to: Option<String>,
}

pub(super) fn first_non_empty<'a>(values: &[&'a str]) -> &'a str {
    values
        .iter()
        .find(|value| !value.trim().is_empty())
        .copied()
        .unwrap_or("")
}

/// The children of one node. Without a parent, the four branches with their counts.
pub(crate) fn children(
    connection: &Connection,
    account: &str,
    query: &TreeQuery,
    now: i64,
) -> Result<Vec<MemoryNode>> {
    check_space(&query.space_id)?;
    let from = super::optional_time(query.from.as_deref(), "invalid_memory_query")?.unwrap_or(0);
    let to =
        super::optional_time(query.to.as_deref(), "invalid_memory_query")?.unwrap_or(now + 60_000);
    let space = query.space_id.as_str();
    let parts: Vec<&str> = query.parent.splitn(3, ':').collect();
    match query.parent.as_str() {
        "" => branches(connection, account, space, from, to),
        MOMENTS => groups(connection, account, space, from, to),
        SUMMARIES => summaries(connection, account, space),
        FACTS => facts(connection, account, space),
        WORKFLOWS => workflows(connection, account, space),
        _ if parts[0] == MOMENTS && parts.len() == 3 => moments(
            connection,
            account,
            space,
            from,
            to,
            &query.parent,
            parts[1],
            parts[2],
        ),
        _ => Err(MemoryError::Invalid("invalid_memory_query")),
    }
}

/// Saved workflows are kept by their own tools, on the computer (`memory.workflow.*`). When those land,
/// this is where the tree reads them: a node with id "workflow:<id>" and text of its instructions.
fn workflows(_connection: &Connection, _account: &str, _space: &str) -> Result<Vec<MemoryNode>> {
    Ok(Vec::new())
}

fn branches(
    connection: &Connection,
    account: &str,
    space: &str,
    from: i64,
    to: i64,
) -> Result<Vec<MemoryNode>> {
    let (moments, moments_found, first, last): (i64, i64, Option<i64>, Option<i64>) = connection.query_row(
        &format!(
            "SELECT count(*), coalesce(sum({SEARCHABLE}), 0), min(e.occurred_at), max(e.occurred_at)
             FROM memory_events e
             WHERE e.account = ?1 AND e.space_id = ?2 AND e.occurred_at >= ?3 AND e.occurred_at < ?4"
        ),
        params![account, space, from, to],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )?;
    let counted = |sql: &str| -> rusqlite::Result<(i64, i64)> {
        connection.query_row(sql, params![account, space], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
    };
    let (summaries, summaries_found) = counted(
        "SELECT count(*), coalesce(sum(EXISTS (SELECT 1 FROM memory_chunks c WHERE c.account = s.account
                 AND c.space_id = s.space_id AND c.branch = 'summaries' AND c.record_id = s.surface_id
                 AND c.embedded = 1)), 0)
         FROM memory_summaries s WHERE s.account = ?1 AND s.space_id = ?2",
    )?;
    let (facts, facts_found) = counted(
        "SELECT count(*), coalesce(sum(EXISTS (SELECT 1 FROM memory_chunks c WHERE c.account = m.account
                 AND c.space_id = m.space_id AND c.branch = 'facts' AND c.record_id = m.id
                 AND c.embedded = 1)), 0)
         FROM memory_facts m WHERE m.account = ?1 AND m.space_id = ?2",
    )?;
    let workflows = workflows(connection, account, space)?;
    let workflow_count = workflows.len() as i64;
    let workflows_found = workflows.iter().filter(|node| node.searchable).count() as i64;
    let rows = [
        (
            MOMENTS,
            "Moments",
            "Pages, screens, voice and notes",
            moments,
            moments_found,
        ),
        (
            SUMMARIES,
            "Summaries",
            "Daily and weekly recaps",
            summaries,
            summaries_found,
        ),
        (
            FACTS,
            "Facts",
            "What Misty knows about you",
            facts,
            facts_found,
        ),
        (
            WORKFLOWS,
            "Workflows",
            "Methods Misty learned",
            workflow_count,
            workflows_found,
        ),
    ];
    Ok(rows
        .into_iter()
        .map(|(id, label, detail, count, found)| MemoryNode {
            id: id.to_owned(),
            parent: "space".to_owned(),
            node_type: "branch".to_owned(),
            branch: id.to_owned(),
            label: label.to_owned(),
            detail: detail.to_owned(),
            count,
            first_at: (id == MOMENTS).then_some(first).flatten().map(rfc3339),
            last_at: (id == MOMENTS).then_some(last).flatten().map(rfc3339),
            searchable: found == count,
            expandable: count > 0,
            ..MemoryNode::default()
        })
        .collect())
}

fn groups(
    connection: &Connection,
    account: &str,
    space: &str,
    from: i64,
    to: i64,
) -> Result<Vec<MemoryNode>> {
    let mut statement = connection.prepare_cached(&format!(
        "SELECT key, count(*), min(occurred_at), max(occurred_at), min(found) FROM (
             SELECT e.occurred_at, {SEARCHABLE} AS found,
                 CASE WHEN e.session_id <> '' THEN 'session:' || e.session_id
                      WHEN e.kind = 'page' THEN 'site:' || e.site
                      ELSE 'kind:' || e.kind END AS key
             FROM memory_events e
             WHERE e.account = ?1 AND e.space_id = ?2 AND e.occurred_at >= ?3 AND e.occurred_at < ?4)
         GROUP BY key ORDER BY max(occurred_at) DESC LIMIT ?5"
    ))?;
    let rows = statement
        .query_map(params![account, space, from, to, GROUPS], |row| {
            let key: String = row.get(0)?;
            let first: i64 = row.get(2)?;
            let (name, value) = key.split_once(':').unwrap_or((key.as_str(), ""));
            let (source, label, detail) = match name {
                "session" => (
                    "screen".to_owned(),
                    "Capture session".to_owned(),
                    local_time(first),
                ),
                "site" => (
                    "page".to_owned(),
                    if value.is_empty() {
                        "Other pages"
                    } else {
                        value
                    }
                    .to_owned(),
                    String::new(),
                ),
                _ => {
                    let label = match value {
                        "voice" => "Dictation",
                        "recording" => "Recordings",
                        "note" => "Notes",
                        other => other,
                    };
                    (value.to_owned(), label.to_owned(), String::new())
                }
            };
            Ok(MemoryNode {
                id: format!("{MOMENTS}:{key}"),
                parent: MOMENTS.to_owned(),
                node_type: "group".to_owned(),
                branch: MOMENTS.to_owned(),
                source,
                label,
                detail,
                count: row.get(1)?,
                first_at: Some(rfc3339(first)),
                last_at: Some(rfc3339(row.get(3)?)),
                searchable: row.get(4)?,
                expandable: true,
                ..MemoryNode::default()
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

fn local_time(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .unwrap_or_default()
        .with_timezone(&chrono::Local)
        .format("%b %-d, %-I:%M %p")
        .to_string()
}
