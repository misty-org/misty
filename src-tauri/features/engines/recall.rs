//! Recall: one agent searching its own chat history and the notes its engine wrote. Chat history
//! lives in `misty.db`; engine notes are read in place and are never copied there.
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use database::store::Store;

mod notes;
use notes::*;

/// The tool's name on the wire.
pub(super) const RECALL: &str = "recall";

/// How many hits come back at most.
const MAX_HITS: usize = 8;
/// A chunk of text is cut here, so a hit stays a snippet.
const CHUNK_CHARS: usize = 400;
/// How many chat messages the table hands the fuzzy matcher.
const MAX_CANDIDATES: usize = 300;
/// A note larger than this is skipped.
const MAX_NOTE_BYTES: u64 = 256 * 1024;
/// Don't walk an engine-managed tree without a bound.
const MAX_NOTE_FILES: usize = 500;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryNote {
    pub id: String,
    pub title: String,
    pub source: String,
    pub content: String,
    pub deletable: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryNotes {
    pub notes: Vec<MemoryNote>,
    pub errors: Vec<String>,
}

pub(super) fn tool() -> Value {
    json!({
        "name": RECALL,
        "description": "Search your own memory: your saved notes and everything said in your chat with the person. Typos and partial words still match. Use it when the person refers to something from before that you don't have in front of you.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": { "type": "string", "minLength": 1, "maxLength": 200, "description": "What to look for." },
                "limit": { "type": "integer", "minimum": 1, "maximum": 20, "description": "How many results, 8 by default." },
            },
            "required": ["query"],
        },
        "annotations": { "readOnlyHint": true },
    })
}

struct Chunk {
    source: String,
    text: String,
}

impl AsRef<str> for Chunk {
    fn as_ref(&self) -> &str {
        &self.text
    }
}

/// Text cut into paragraphs of at most [`CHUNK_CHARS`] characters.
fn chunks(source: &str, text: &str, into: &mut Vec<Chunk>) {
    for paragraph in text.split("\n\n") {
        let paragraph = paragraph.trim();
        if paragraph.is_empty() {
            continue;
        }
        let mut current = String::new();
        for word in paragraph.split_whitespace() {
            if !current.is_empty() && current.chars().count() + word.chars().count() >= CHUNK_CHARS {
                into.push(Chunk {
                    source: source.to_string(),
                    text: std::mem::take(&mut current),
                });
            }
            if !current.is_empty() {
                current.push(' ');
            }
            current.push_str(word);
        }
        if !current.is_empty() {
            into.push(Chunk {
                source: source.to_string(),
                text: current,
            });
        }
    }
}

/// The query's own 3-letter pieces, each quoted for FTS5: a typo spoils only some of them, so the
/// words it was meant for still share most (the table is trigram-tokenized).
fn pieces(query: &str) -> String {
    let mut found: Vec<String> = Vec::new();
    for word in query.split(|c: char| !c.is_alphanumeric()) {
        let letters: Vec<char> = word.to_lowercase().chars().collect();
        for window in letters.windows(3) {
            let piece: String = window.iter().collect();
            if !found.contains(&piece) {
                found.push(piece);
            }
        }
    }
    found.truncate(40);
    found
        .iter()
        .map(|piece| format!("\"{piece}\""))
        .collect::<Vec<_>>()
        .join(" OR ")
}

/// This agent's chat messages that share pieces with the query, best first (`chat_recall`, kept up to
/// date as chats are saved). The fuzzy matcher then orders them.
fn chat_chunks(
    store: &Store,
    account: &str,
    agent_id: &str,
    query: &str,
    into: &mut Vec<Chunk>,
) -> Result<(), String> {
    let connection = store.connect().map_err(|error| error.to_string())?;
    let matched = pieces(query);
    let (sql, term) = if matched.is_empty() {
        (
            "SELECT text, role, at FROM chat_recall
             WHERE account = ?1 AND agent_id = ?2 AND text LIKE ?3 LIMIT ?4",
            format!("%{}%", query.trim()),
        )
    } else {
        (
            "SELECT text, role, at FROM chat_recall
             WHERE chat_recall MATCH ?3 AND account = ?1 AND agent_id = ?2
             ORDER BY rank LIMIT ?4",
            matched,
        )
    };
    let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            rusqlite::params![account, agent_id, term, MAX_CANDIDATES as i64],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .map_err(|error| error.to_string())?;
    for (text, role, at) in rows.flatten() {
        let who = if role == "user" { "you" } else { "me" };
        chunks(&format!("chat, {who}, {}", at.get(..10).unwrap_or("")), &text, into);
    }
    Ok(())
}

/// The best matches for `query` among this agent's notes and chat, as the tool's result text.
pub(super) fn search(
    store: &Store,
    account: &str,
    agent_id: &str,
    engine: &str,
    folder: Option<&Path>,
    query: &str,
    limit: usize,
) -> Result<String, String> {
    if account.is_empty() || agent_id.is_empty() {
        return Err("Recall needs an agent chat.".into());
    }
    let notes = memory_notes(engine, folder);
    let mut all = Vec::new();
    for note in notes.notes {
        chunks(&format!("note: {} · {}", note.source, note.title), &note.content, &mut all);
    }
    chat_chunks(store, account, agent_id, query, &mut all)?;
    let pattern = Pattern::parse(query.trim(), CaseMatching::Ignore, Normalization::Smart);
    let mut matcher = Matcher::new(Config::DEFAULT);
    let mut hits = pattern.match_list(all, &mut matcher);
    // Notes are what the agent chose to keep, so they win a tie.
    hits.sort_by(|(a, x), (b, y)| {
        let boost = |chunk: &Chunk, score: u32| {
            score + if chunk.source.starts_with("note") { score / 5 } else { 0 }
        };
        boost(b, *y).cmp(&boost(a, *x))
    });
    let limit = if limit == 0 { MAX_HITS } else { limit.min(20) };
    let mut result = if hits.is_empty() {
        "Nothing in your memory matches that.".into()
    } else {
        hits.into_iter()
            .take(limit)
            .map(|(chunk, _)| format!("[{}] {}", chunk.source, chunk.text))
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    if !notes.errors.is_empty() {
        if result != "Nothing in your memory matches that." {
            result.push_str("\n\n");
        }
        result.push_str(&notes.errors.join("\n"));
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn agent_memory_list(
    webview: tauri::Webview,
    state: tauri::State<'_, crate::app::runtime::MistyRuntime>,
    account: String,
    agent_id: String,
    engine: String,
    conversation_id: Option<String>,
) -> Result<MemoryNotes, String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only a profile's window can read engine memory.".into());
    }
    let folder = resolve_agent_folder(
        &state.environment.store(),
        &account,
        &agent_id,
        conversation_id.as_deref(),
    )?;
    tauri::async_runtime::spawn_blocking(move || Ok(memory_notes(&engine, folder.as_deref())))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn agent_memory_delete(
    webview: tauri::Webview,
    state: tauri::State<'_, crate::app::runtime::MistyRuntime>,
    account: String,
    agent_id: String,
    engine: String,
    conversation_id: Option<String>,
    note_id: String,
) -> Result<(), String> {
    if !crate::browser::app_windows::is_person_window(webview.label()) {
        return Err("Only a profile's window can delete engine memory.".into());
    }
    let folder = resolve_agent_folder(
        &state.environment.store(),
        &account,
        &agent_id,
        conversation_id.as_deref(),
    )?;
    tauri::async_runtime::spawn_blocking(move || delete_memory_note(&engine, folder.as_deref(), &note_id))
        .await
        .map_err(|error| error.to_string())?
}

fn resolve_agent_folder(
    store: &Store,
    account: &str,
    agent_id: &str,
    conversation_id: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    if account.is_empty() || agent_id.is_empty() {
        return Err("Choose an agent first.".into());
    }
    let Some(conversation_id) = conversation_id.filter(|id| !id.is_empty()) else {
        return Ok(None);
    };
    let document = store
        .connect()
        .map_err(|error| error.to_string())?
        .query_row(
            "SELECT document FROM agent_chats WHERE account = ?1 AND kind = 'conversation' AND id = ?2",
            rusqlite::params![account, conversation_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| "This agent chat is no longer available.".to_string())?;
    let chat: Value = serde_json::from_str(&document).map_err(|error| error.to_string())?;
    if chat["agentId"].as_str().unwrap_or("") != agent_id {
        return Err("This chat belongs to another agent.".into());
    }
    let folder = crate::engines::store::chat_folder(store, account, conversation_id)
        .map(|(path, _)| PathBuf::from(path));
    Ok(folder)
}
