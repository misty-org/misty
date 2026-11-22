//! Agent chats kept on this computer, per account, in `misty.db`: conversations with their
//! messages, and the folders that group them. Like Claude Code and Codex, a chat lives on the
//! computer it was started on and never syncs; the server only runs its turns
//! Documents are the app's own JSON, stored as they are; a conversation's messages live separately
//! so the transcript can page them. A lesson is a Teach-mode chat's progress (goal, objectives,
//! hint level), kept beside its chat.
//! A chat's run state (plans, goals, questions, checklists) and notebook live here too, and a run
//! notes which chat it belongs to.

mod adoption;
pub mod commands;
mod messages;
pub(crate) mod storage;
#[cfg(test)]
mod tests;

use rusqlite::OptionalExtension;
use serde::Serialize;
use serde_json::{json, Value};

use database::store::Store;

/// What one row holds.
const KINDS: &[&str] = &[
    "conversation",
    "folder",
    "lesson",
    "course",
    "collaboration",
    "notebook",
    "run",
    "agent",
    "attachment",
    "artifact",
    // A chat's composer choices: the model and effort its next turn asks the engine for.
    "composer",
    // Tutor: notebooks with their sources and notes, flashcard decks, guides, and the agent runs
    // that make them.
    "tutor_notebook",
    "tutor_deck",
    "tutor_guide",
    "tutor_job",
    // A notebook's chunks and their vectors, for search by meaning.
    "tutor_index",
    // The virtual studio on this computer: each Space's room and how each agent looks in it.
    "studio",
];
/// Bound every local document at the IPC boundary.
const MAX_DOCUMENT_BYTES: usize = 16 * 1024 * 1024;
const CHAT_MESSAGE_PAGE_SIZE: usize = 50;
const MAX_CHAT_MESSAGE_PAGE_SIZE: usize = 100;

fn valid_key(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
}

fn check(account: &str, kind: &str, id: &str) -> Result<(), String> {
    if !valid_key(account) || !valid_key(id) || !KINDS.contains(&kind) {
        return Err("invalid_agent_chat".into());
    }
    Ok(())
}

fn check_document(document: &str) -> Result<(), String> {
    if document.len() > MAX_DOCUMENT_BYTES
        || serde_json::from_str::<serde_json::Value>(document).is_err()
    {
        return Err("invalid_agent_chat".into());
    }
    Ok(())
}

/// The longest catalog voice id an agent's profile may name.
const MAX_VOICE_ID: usize = 64;

/// An agent's voice is a catalog voice id ("kokoro-heart"): lowercase letters, digits and dashes,
/// at most 64 of them. Absent or empty means it has none yet and speaks in Misty's voice.
fn valid_voice(voice: &str) -> bool {
    voice.len() <= MAX_VOICE_ID
        && voice
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// What a kind's document must hold beyond being JSON: an agent's profile names its voice by id.
fn check_kind_document(kind: &str, document: &str) -> Result<(), String> {
    check_document(document)?;
    if kind != "agent" {
        return Ok(());
    }
    let parsed: Value = serde_json::from_str(document).map_err(|_| "invalid_agent_chat")?;
    match parsed.get("voice") {
        None | Some(Value::Null) => Ok(()),
        Some(Value::String(voice)) if valid_voice(voice) => Ok(()),
        Some(_) => Err("invalid_agent_voice".into()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentChatMessagePage {
    /// Messages in display order, oldest to newest within this page.
    pub messages: Vec<String>,
    /// The cursor for the next older page.
    pub before_seq: Option<i64>,
    pub has_older: bool,
}

fn read_message_page(
    connection: &rusqlite::Connection,
    account: &str,
    conversation: &str,
    before_seq: Option<i64>,
    limit: usize,
) -> rusqlite::Result<AgentChatMessagePage> {
    let limit = limit.clamp(1, MAX_CHAT_MESSAGE_PAGE_SIZE);
    let mut statement = connection.prepare(
        "SELECT seq, document FROM agent_chat_messages
         WHERE account = ?1 AND conversation = ?2 AND (?3 IS NULL OR seq < ?3)
         ORDER BY seq DESC LIMIT ?4",
    )?;
    let rows = statement.query_map(
        rusqlite::params![account, conversation, before_seq, (limit + 1) as i64],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
    )?;
    let mut rows = rows.collect::<Result<Vec<_>, _>>()?;
    let has_older = rows.len() > limit;
    rows.truncate(limit);
    rows.reverse();
    let before_seq = rows.first().map(|(seq, _)| *seq);
    Ok(AgentChatMessagePage {
        messages: rows.into_iter().map(|(_, document)| document).collect(),
        before_seq,
        has_older,
    })
}

/// Replaces one finished-message recall row, or removes its old row when the message is no longer
/// complete. The FTS entry and message row are always changed in the same SQLite transaction.
fn update_recall(
    transaction: &rusqlite::Transaction<'_>,
    account: &str,
    conversation: &str,
    agent: &str,
    message: &Value,
) -> rusqlite::Result<()> {
    let Some(id) = message["id"].as_str() else {
        return Ok(());
    };
    if let Some(rowid) = transaction
        .query_row(
            "SELECT recall_rowid FROM chat_recall_seen
             WHERE account = ?1 AND conversation = ?2 AND message = ?3",
            rusqlite::params![account, conversation, id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
    {
        transaction.execute("DELETE FROM chat_recall WHERE rowid = ?1", [rowid])?;
        transaction.execute(
            "DELETE FROM chat_recall_seen WHERE account = ?1 AND conversation = ?2 AND message = ?3",
            rusqlite::params![account, conversation, id],
        )?;
    }
    let text = message["content"].as_str().unwrap_or("");
    let state = message["state"].as_str().unwrap_or("completed");
    if state != "completed" || text.trim().is_empty() {
        return Ok(());
    }
    transaction.execute(
        "INSERT INTO chat_recall (text, account, agent_id, conversation, role, at, message)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            text,
            account,
            agent,
            conversation,
            message["role"].as_str().unwrap_or(""),
            message["createdAt"].as_str().unwrap_or(""),
            id,
        ],
    )?;
    let rowid = transaction.last_insert_rowid();
    transaction.execute(
        "INSERT INTO chat_recall_seen (account, conversation, message, recall_rowid)
         VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![account, conversation, id, rowid],
    )?;
    Ok(())
}

fn delete_recall_message(
    transaction: &rusqlite::Transaction<'_>,
    account: &str,
    conversation: &str,
    message: &str,
) -> rusqlite::Result<()> {
    if let Some(rowid) = transaction
        .query_row(
            "SELECT recall_rowid FROM chat_recall_seen
             WHERE account = ?1 AND conversation = ?2 AND message = ?3",
            rusqlite::params![account, conversation, message],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
    {
        transaction.execute("DELETE FROM chat_recall WHERE rowid = ?1", [rowid])?;
        transaction.execute(
            "DELETE FROM chat_recall_seen WHERE account = ?1 AND conversation = ?2 AND message = ?3",
            rusqlite::params![account, conversation, message],
        )?;
    }
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

#[derive(Clone)]
pub struct AgentChatsService {
    store: Store,
}

impl AgentChatsService {
    pub fn new(store: Store) -> Self {
        Self { store }
    }


    /// Every document of one kind for the account, newest first.
    pub async fn list(&self, account: String, kind: String) -> Result<Vec<String>, String> {
        check(&account, &kind, "list")?;
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || {
            let connection = store.connect().map_err(|e| e.to_string())?;
            let mut statement = connection
                .prepare(
                    "SELECT document FROM agent_chats WHERE account = ?1 AND kind = ?2
                     ORDER BY updated_at DESC",
                )
                .map_err(|e| e.to_string())?;
            let rows = statement
                .query_map(rusqlite::params![account, kind], |row| row.get(0))
                .map_err(|e| e.to_string())?;
            let mut documents = rows
                .collect::<Result<Vec<String>, _>>()
                .map_err(|e| e.to_string())?;
            if kind == "conversation" {
                for document in &mut documents {
                    let Ok(mut value) = serde_json::from_str::<Value>(document) else {
                        continue;
                    };
                    let Some(id) = value["id"].as_str() else {
                        continue;
                    };
                    let page = read_message_page(
                        &connection,
                        &account,
                        id,
                        None,
                        CHAT_MESSAGE_PAGE_SIZE,
                    )
                    .map_err(|e| e.to_string())?;
                    let messages: Vec<Value> = page
                        .messages
                        .iter()
                        .filter_map(|message| serde_json::from_str(message).ok())
                        .collect();
                    value["messages"] = json!(messages);
                    value["messageBeforeSeq"] = json!(page.before_seq);
                    value["hasOlderMessages"] = json!(page.has_older);
                    *document = serde_json::to_string(&value).map_err(|e| e.to_string())?;
                }
            }
            Ok(documents)
        })
        .await
        .map_err(|e| e.to_string())?
    }


    pub async fn get(
        &self,
        account: String,
        kind: String,
        id: String,
    ) -> Result<Option<String>, String> {
        check(&account, &kind, &id)?;
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || {
            let connection = store.connect().map_err(|e| e.to_string())?;
            connection
                .query_row(
                    "SELECT document FROM agent_chats WHERE account = ?1 AND kind = ?2 AND id = ?3",
                    rusqlite::params![account, kind, id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// Writes only if the row still holds `expected` (`None`: no row yet), and says whether it did.
    /// Two windows can change one document, and a question's answer must reach exactly one of a
    /// waiting run or a new turn.
    pub async fn swap(
        &self,
        account: String,
        kind: String,
        id: String,
        expected: Option<String>,
        document: String,
    ) -> Result<bool, String> {
        check(&account, &kind, &id)?;
        check_kind_document(&kind, &document)?;
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || {
            let connection = store.connect().map_err(|e| e.to_string())?;
            let now = now_ms();
            let changed = match expected {
                Some(expected) => connection.execute(
                    "UPDATE agent_chats SET document = ?1, updated_at = ?2
                     WHERE account = ?3 AND kind = ?4 AND id = ?5 AND document = ?6",
                    rusqlite::params![document, now, account, kind, id, expected],
                ),
                None => connection.execute(
                    "INSERT INTO agent_chats (account, kind, id, document, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT (account, kind, id) DO NOTHING",
                    rusqlite::params![account, kind, id, document, now],
                ),
            };
            let changed = changed.map(|rows| rows == 1).map_err(|e| e.to_string())?;
            Ok(changed)
        })
        .await
        .map_err(|e| e.to_string())?
    }

    pub async fn put(
        &self,
        account: String,
        kind: String,
        id: String,
        document: String,
    ) -> Result<(), String> {
        check(&account, &kind, &id)?;
        check_kind_document(&kind, &document)?;
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || {
            let connection = store.connect().map_err(|e| e.to_string())?;
            let now = now_ms();
            connection
                .execute(
                    "INSERT INTO agent_chats (account, kind, id, document, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT (account, kind, id)
                     DO UPDATE SET document = excluded.document, updated_at = excluded.updated_at",
                    rusqlite::params![account, kind, id, document, now],
                )
                .map_err(|e| e.to_string())?;
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    pub async fn delete(&self, account: String, kind: String, id: String) -> Result<(), String> {
        check(&account, &kind, &id)?;
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || {
            let mut connection = store.connect().map_err(|e| e.to_string())?;
            let transaction = connection
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(|e| e.to_string())?;
            if kind == "conversation" {
                transaction
                    .execute(
                        "DELETE FROM chat_recall WHERE rowid IN (
                             SELECT recall_rowid FROM chat_recall_seen
                             WHERE account = ?1 AND conversation = ?2
                         )",
                        rusqlite::params![account, id],
                    )
                    .map_err(|e| e.to_string())?;
                transaction
                    .execute(
                    "DELETE FROM chat_recall_seen WHERE account = ?1 AND conversation = ?2",
                    rusqlite::params![account, id],
                    )
                    .map_err(|e| e.to_string())?;
                transaction
                    .execute(
                        "DELETE FROM agent_chat_messages WHERE account = ?1 AND conversation = ?2",
                        rusqlite::params![account, id],
                    )
                    .map_err(|e| e.to_string())?;
            }
            transaction
                .execute(
                    "DELETE FROM agent_chats WHERE account = ?1 AND kind = ?2 AND id = ?3",
                    rusqlite::params![account, kind, id],
                )
                .map_err(|e| e.to_string())?;
            transaction.commit().map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
}
