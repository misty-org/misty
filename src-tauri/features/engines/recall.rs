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

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn warning_for(source: &str) -> String {
    match source {
        "project instructions" => "Couldn't read the project's instruction files.".into(),
        "Codex memory" => "Couldn't read Codex's memory.".into(),
        "Claude Code memory" => "Couldn't read Claude Code's memory.".into(),
        "Hermes memory" => "Couldn't read Hermes's memory.".into(),
        "Grok memory" => "Couldn't read Grok's memory.".into(),
        "Gemini CLI memory" => "Couldn't read Gemini CLI's memory.".into(),
        _ => format!("Couldn't read {source}."),
    }
}

fn note_title(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Memory note".into());
    let parent = path
        .parent()
        .and_then(Path::file_name)
        .map(|name| name.to_string_lossy().into_owned());
    parent.map_or(name.clone(), |parent| format!("{parent}/{name}"))
}

fn add_file_note(
    path: &Path,
    source: &str,
    notes: &mut MemoryNotes,
    seen: &mut BTreeSet<PathBuf>,
) {
    if notes.notes.len() >= MAX_NOTE_FILES || !seen.insert(path.to_path_buf()) {
        return;
    }
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(_) => {
            let warning = warning_for(source);
            if !notes.errors.contains(&warning) {
                notes.errors.push(warning);
            }
            return;
        }
    };
    if !metadata.is_file() {
        return;
    }
    if metadata.len() > MAX_NOTE_BYTES {
        let warning = warning_for(source);
        if !notes.errors.contains(&warning) {
            notes.errors.push(warning);
        }
        return;
    }
    match std::fs::read_to_string(path) {
        Ok(content) => notes.notes.push(MemoryNote {
            id: format!("file:{}", path.to_string_lossy()),
            title: note_title(path),
            source: source.into(),
            content,
            deletable: true,
        }),
        Err(_) => {
            let warning = warning_for(source);
            if !notes.errors.contains(&warning) {
                notes.errors.push(warning);
            }
        }
    }
}

fn add_markdown_tree(
    root: &Path,
    source: &str,
    notes: &mut MemoryNotes,
    seen: &mut BTreeSet<PathBuf>,
) {
    if notes.notes.len() >= MAX_NOTE_FILES {
        return;
    }
    let mut pending = vec![root.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                let warning = warning_for(source);
                if !notes.errors.contains(&warning) {
                    notes.errors.push(warning);
                }
                continue;
            }
        };
        let mut paths = entries.flatten().map(|entry| entry.path()).collect::<Vec<_>>();
        paths.sort();
        for path in paths.into_iter().rev() {
            if notes.notes.len() >= MAX_NOTE_FILES {
                break;
            }
            let Ok(metadata) = std::fs::symlink_metadata(&path) else {
                continue;
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                pending.push(path);
            } else if path
                .extension()
                .is_some_and(|ext| ext.to_string_lossy().eq_ignore_ascii_case("md"))
            {
                add_file_note(&path, source, notes, seen);
            }
        }
    }
}

/// The engine's project instruction files along the working-folder path, closest first.
fn project_instructions(
    folder: Option<&Path>,
    notes: &mut MemoryNotes,
    seen: &mut BTreeSet<PathBuf>,
) {
    let Some(folder) = folder else { return };
    for parent in folder.ancestors().take(24) {
        for name in ["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", "GEMINI.md"] {
            add_file_note(&parent.join(name), "project instructions", notes, seen);
        }
    }
}

/// Claude Code keys automatic memory to its working folder's slug.
fn claude_memory_dir(folder: &Path) -> Option<PathBuf> {
    let home = home_dir()?;
    let name: String = folder
        .to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    Some(
        home.join(".claude")
            .join("projects")
            .join(name)
            .join("memory"),
    )
}

fn codex_memory_db() -> Option<PathBuf> {
    std::env::var_os("CODEX_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| home_dir().map(|home| home.join(".codex")))
        .map(|home| home.join("memories_1.sqlite"))
}

fn codex_notes(notes: &mut MemoryNotes) {
    let Some(path) = codex_memory_db() else { return };
    if !path.exists() {
        return;
    }
    let connection = match Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(connection) => connection,
        Err(_) => {
            notes.errors.push(warning_for("Codex memory"));
            return;
        }
    };
    let result = (|| -> rusqlite::Result<()> {
        let mut statement = connection.prepare(
            "SELECT thread_id, raw_memory, rollout_summary FROM stage1_outputs
             ORDER BY source_updated_at DESC LIMIT ?1",
        )?;
        let rows = statement.query_map([MAX_NOTE_FILES as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        for row in rows {
            if notes.notes.len() >= MAX_NOTE_FILES {
                break;
            }
            let (thread, memory, summary) = row?;
            let content = format!(
                "{}{}{}",
                memory.trim(),
                if !memory.trim().is_empty() && !summary.trim().is_empty() {
                    "\n\n"
                } else {
                    ""
                },
                summary.trim()
            );
            if content.trim().is_empty() {
                continue;
            }
            if content.len() > MAX_NOTE_BYTES as usize {
                let warning = warning_for("Codex memory");
                if !notes.errors.contains(&warning) {
                    notes.errors.push(warning);
                }
                continue;
            }
            notes.notes.push(MemoryNote {
                id: format!("codex:{thread}"),
                title: format!("Memory from thread {thread}"),
                source: "Codex memory".into(),
                content,
                deletable: true,
            });
        }
        Ok(())
    })();
    if result.is_err() {
        notes.errors.push(warning_for("Codex memory"));
    }
}

fn grok_slug(folder: &Path) -> Option<String> {
    let name = folder.file_name()?.to_string_lossy();
    Some(
        name.chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() {
                    character.to_ascii_lowercase()
                } else {
                    '-'
                }
            })
            .collect(),
    )
}

/// Reads each source independently. A changed or inaccessible engine store is reported beside the
/// available notes instead of making recall or the notes page fail as a whole.
pub(crate) fn memory_notes(engine: &str, folder: Option<&Path>) -> MemoryNotes {
    let mut notes = MemoryNotes::default();
    let mut seen = BTreeSet::new();
    project_instructions(folder, &mut notes, &mut seen);
    let home = home_dir();
    match engine {
        "claude" => {
            if let Some(home) = &home {
                add_file_note(
                    &home.join(".claude/CLAUDE.md"),
                    "Claude Code memory",
                    &mut notes,
                    &mut seen,
                );
            }
            if let Some(folder) = folder.and_then(claude_memory_dir) {
                add_markdown_tree(&folder, "Claude Code memory", &mut notes, &mut seen);
            }
        }
        "codex" => {
            codex_notes(&mut notes);
            if let Some(home) = &home {
                add_file_note(
                    &home.join(".codex/AGENTS.md"),
                    "Codex memory",
                    &mut notes,
                    &mut seen,
                );
            }
        }
        "hermes" => {
            if let Some(home) = &home {
                let root = home.join(".hermes");
                add_file_note(
                    &root.join("SOUL.md"),
                    "Hermes memory",
                    &mut notes,
                    &mut seen,
                );
                add_markdown_tree(
                    &root.join("memories"),
                    "Hermes memory",
                    &mut notes,
                    &mut seen,
                );
            }
        }
        "grok" => {
            if let Some(home) = &home {
                let root = home.join(".grok/memory-v2");
                add_markdown_tree(
                    &root.join("global/topics"),
                    "Grok memory",
                    &mut notes,
                    &mut seen,
                );
                if let Some(slug) = folder.and_then(grok_slug) {
                    let workspaces = root.join("workspaces");
                    let entries = match std::fs::read_dir(workspaces) {
                        Ok(entries) => Some(entries),
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                        Err(_) => {
                            notes.errors.push(warning_for("Grok memory"));
                            None
                        }
                    };
                    if let Some(entries) = entries {
                        for entry in entries {
                            let entry = match entry {
                                Ok(entry) => entry,
                                Err(_) => {
                                    notes.errors.push(warning_for("Grok memory"));
                                    continue;
                                }
                            };
                            let path = entry.path();
                            let name = entry.file_name().to_string_lossy().to_lowercase();
                            let metadata = match std::fs::symlink_metadata(&path) {
                                Ok(metadata) => metadata,
                                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                                    continue;
                                }
                                Err(_) => {
                                    notes.errors.push(warning_for("Grok memory"));
                                    continue;
                                }
                            };
                            let is_real_dir =
                                !metadata.file_type().is_symlink() && metadata.is_dir();
                            if is_real_dir
                                && (name == slug || name.starts_with(&format!("{slug}-")))
                            {
                                add_markdown_tree(
                                    &path.join("topics"),
                                    "Grok memory",
                                    &mut notes,
                                    &mut seen,
                                );
                            }
                        }
                    }
                }
            }
        }
        "gemini" => {
            if let Some(home) = &home {
                add_file_note(
                    &home.join(".gemini/GEMINI.md"),
                    "Gemini CLI memory",
                    &mut notes,
                    &mut seen,
                );
            }
            if let Some(folder) = folder {
                add_file_note(
                    &folder.join("GEMINI.md"),
                    "Gemini CLI memory",
                    &mut notes,
                    &mut seen,
                );
            }
        }
        _ => {
            if let Some(home) = &home {
                add_file_note(
                    &home.join(".agents/AGENTS.md"),
                    "project instructions",
                    &mut notes,
                    &mut seen,
                );
                add_file_note(
                    &home.join(".claude/CLAUDE.md"),
                    "project instructions",
                    &mut notes,
                    &mut seen,
                );
                add_file_note(
                    &home.join(".gemini/GEMINI.md"),
                    "project instructions",
                    &mut notes,
                    &mut seen,
                );
            }
        }
    }
    notes.notes.sort_by(|a, b| {
        a.source
            .cmp(&b.source)
            .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
    });
    notes.errors.sort();
    notes.errors.dedup();
    notes
}

/// Deletes a listed note after a person's explicit confirmation. File paths are resolved again
/// from the current engine store; the caller cannot name an arbitrary local file to remove.
pub(crate) fn delete_memory_note(
    engine: &str,
    folder: Option<&Path>,
    id: &str,
) -> Result<(), String> {
    if engine == "codex" && id.starts_with("codex:") {
        let listed = memory_notes(engine, folder)
            .notes
            .into_iter()
            .any(|note| note.id == id && note.deletable);
        if !listed {
            return Err("This memory note is no longer available.".into());
        }
        let thread = id
            .strip_prefix("codex:")
            .filter(|id| !id.is_empty())
            .ok_or_else(|| "This memory note is no longer available.".to_string())?;
        let path = codex_memory_db().ok_or_else(|| "Couldn't find Codex's memory.".to_string())?;
        let connection = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|_| warning_for("Codex memory"))?;
        let removed = connection
            .execute("DELETE FROM stage1_outputs WHERE thread_id = ?1", [thread])
            .map_err(|_| warning_for("Codex memory"))?;
        return if removed == 1 {
            Ok(())
        } else {
            Err("This memory note is no longer available.".into())
        };
    }
    let current = memory_notes(engine, folder);
    let note = current
        .notes
        .into_iter()
        .find(|note| note.id == id && note.deletable)
        .ok_or_else(|| "This memory note is no longer available.".to_string())?;
    let path = id
        .strip_prefix("file:")
        .map(PathBuf::from)
        .ok_or_else(|| "This memory note is no longer available.".to_string())?;
    // Protect against a symlink swap between listing and deletion.
    let metadata = std::fs::symlink_metadata(&path)
        .map_err(|_| "This memory note is no longer available.".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("This memory note is no longer available.".into());
    }
    std::fs::remove_file(path).map_err(|_| warning_for(&note.source))
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
