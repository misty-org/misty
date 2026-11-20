//! Agent chats kept on this computer, per account, in `misty.db`: conversations with their
//! messages, and the folders that group them. Like Claude Code and Codex, a chat lives on the
//! computer it was started on and never syncs; the server only runs its turns
//! Documents are the app's own JSON, stored as they are; a conversation's messages live separately
//! so the transcript can page them. A lesson is a Teach-mode chat's progress (goal, objectives,
//! hint level), kept beside its chat.
//! A chat's run state (plans, goals, questions, checklists) and notebook live here too, and a run
//! notes which chat it belongs to.

pub mod commands;
pub(crate) mod storage;

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

    /// What adopting would hand over that someone would want asked about first: chats.
    /// Built-in rows and approvals go or stay without a question.
    pub async fn adoptable(&self, from: String, to: String) -> Result<u64, String> {
        check(&from, "conversation", "adopt")?;
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || {
            let connection = store.connect().map_err(|e| e.to_string())?;
            connection
                .query_row(
                    "SELECT COUNT(*) FROM agent_chats AS kept WHERE kept.account = ?1
                     AND kept.kind = 'conversation'
                     AND NOT EXISTS (SELECT 1 FROM agent_chats AS theirs
                       WHERE theirs.account = ?2 AND theirs.kind = kept.kind AND theirs.id = kept.id)",
                    [from, to],
                    |row| row.get::<_, i64>(0),
                )
                .map(|count| count as u64)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// What was kept signed out goes to the account that signs in, once it's said yes. Its remembered
    /// site approvals stay behind. A row the account already has stays as it is, and the signed-out
    /// copy stays behind it.
    pub async fn adopt(&self, from: String, to: String) -> Result<u64, String> {
        check(&from, "conversation", "adopt")?;
        check(&to, "conversation", "adopt")?;
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || {
            let mut connection = store.connect().map_err(|e| e.to_string())?;
            let transaction = connection
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(|e| e.to_string())?;
            transaction
                .execute(
                    "CREATE TEMP TABLE chats_to_adopt AS
                         SELECT kept.id FROM agent_chats AS kept
                         WHERE kept.account = ?1 AND kept.kind = 'conversation'
                           AND NOT EXISTS (SELECT 1 FROM agent_chats theirs
                               WHERE theirs.account = ?2 AND theirs.kind = kept.kind
                                 AND theirs.id = kept.id)",
                    rusqlite::params![from, to],
                )
                .map_err(|e| e.to_string())?;
            transaction
                .execute(
                    "DELETE FROM chat_recall
                     WHERE rowid IN (SELECT recall_rowid FROM chat_recall_seen
                         WHERE account = ?1 AND conversation IN
                           (SELECT id FROM chats_to_adopt))",
                    [&from],
                )
                .map_err(|e| e.to_string())?;
            transaction
                .execute(
                    "DELETE FROM chat_recall_seen WHERE account = ?1 AND conversation IN
                         (SELECT id FROM chats_to_adopt)",
                    [&from],
                )
                .map_err(|e| e.to_string())?;
            transaction
                .execute(
                    "UPDATE agent_chat_messages SET account = ?2 WHERE account = ?1
                     AND conversation IN (SELECT id FROM chats_to_adopt)",
                    rusqlite::params![from, to],
                )
                .map_err(|e| e.to_string())?;
            let moved = transaction
                .execute(
                    "UPDATE OR IGNORE agent_chats SET account = ?2 WHERE account = ?1
                     AND NOT (kind = 'agent' AND id LIKE 'sitegrant\\_%' ESCAPE '\\')
                     AND NOT EXISTS (SELECT 1 FROM agent_chats theirs
                         WHERE theirs.account = ?2 AND theirs.kind = agent_chats.kind
                           AND theirs.id = agent_chats.id)",
                    rusqlite::params![from, to],
                )
                .map_err(|e| e.to_string())?;
            // Recall's FTS rows carry the account and agent as searchable metadata, so rebuild only
            // the rows for conversations that actually moved to the new account.
            let mut chats = transaction
                .prepare(
                    "SELECT c.id, c.document FROM agent_chats c
                     WHERE c.account = ?1 AND c.kind = 'conversation'
                       AND c.id IN (SELECT id FROM chats_to_adopt)",
                )
                .map_err(|e| e.to_string())?;
            let rows = chats
                .query_map([&to], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(chats);
            for (conversation, metadata) in rows {
                let agent = serde_json::from_str::<Value>(&metadata)
                    .ok()
                    .and_then(|chat| chat["agentId"].as_str().map(str::to_owned))
                    .unwrap_or_default();
                let mut statement = transaction
                    .prepare(
                        "SELECT document FROM agent_chat_messages
                         WHERE account = ?1 AND conversation = ?2 ORDER BY seq ASC",
                    )
                    .map_err(|e| e.to_string())?;
                let messages = statement
                    .query_map(rusqlite::params![to, conversation], |row| row.get::<_, String>(0))
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                for message in messages {
                    if let Ok(value) = serde_json::from_str::<Value>(&message) {
                        update_recall(&transaction, &to, &conversation, &agent, &value)
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
            transaction
                .execute(
                    "UPDATE agent_tool_journal SET account = ?2 WHERE account = ?1",
                    rusqlite::params![from, to],
                )
                .map_err(|e| e.to_string())?;
            transaction
                .execute_batch("DROP TABLE chats_to_adopt;")
                .map_err(|e| e.to_string())?;
            transaction.commit().map_err(|e| e.to_string())?;
            Ok(moved as u64)
        })
        .await
        .map_err(|e| e.to_string())?
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

    /// One bounded window of messages, oldest to newest within the page.
    pub async fn messages_page(
        &self,
        account: String,
        conversation: String,
        before_seq: Option<i64>,
        limit: usize,
    ) -> Result<AgentChatMessagePage, String> {
        check(&account, "conversation", &conversation)?;
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || {
            let connection = store.connect().map_err(|error| error.to_string())?;
            read_message_page(&connection, &account, &conversation, before_seq, limit)
                .map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| error.to_string())?
    }

    /// Upserts only the changed message documents and removes messages discarded by a rewind.
    pub async fn upsert_messages(
        &self,
        account: String,
        conversation: String,
        messages: Vec<String>,
        deleted: Vec<String>,
    ) -> Result<(), String> {
        check(&account, "conversation", &conversation)?;
        if messages.len() > MAX_CHAT_MESSAGE_PAGE_SIZE {
            return Err("invalid_agent_chat".into());
        }
        let parsed = messages
            .into_iter()
            .map(|document| {
                check_document(&document)?;
                let value: Value = serde_json::from_str(&document).map_err(|_| "invalid_agent_chat")?;
                let id = value["id"].as_str().filter(|id| valid_key(id)).ok_or("invalid_agent_chat")?;
                Ok((id.to_string(), value, document))
            })
            .collect::<Result<Vec<_>, String>>()?;
        if deleted.len() > MAX_CHAT_MESSAGE_PAGE_SIZE || deleted.iter().any(|id| !valid_key(id)) {
            return Err("invalid_agent_chat".into());
        }
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || {
            let mut connection = store.connect().map_err(|error| error.to_string())?;
            let transaction = connection
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(|error| error.to_string())?;
            let metadata = transaction
                .query_row(
                    "SELECT document FROM agent_chats
                     WHERE account = ?1 AND kind = 'conversation' AND id = ?2",
                    rusqlite::params![account, conversation],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "This chat is no longer available.".to_string())?;
            let agent = serde_json::from_str::<Value>(&metadata)
                .ok()
                .and_then(|chat| chat["agentId"].as_str().map(str::to_owned))
                .unwrap_or_default();
            for message in deleted {
                transaction
                    .execute(
                        "DELETE FROM agent_chat_messages
                         WHERE account = ?1 AND conversation = ?2 AND id = ?3",
                        rusqlite::params![account, conversation, message],
                    )
                    .map_err(|error| error.to_string())?;
                delete_recall_message(&transaction, &account, &conversation, &message)
                    .map_err(|error| error.to_string())?;
            }
            for (id, value, document) in parsed {
                let sequence = transaction
                    .query_row(
                        "SELECT seq FROM agent_chat_messages
                         WHERE account = ?1 AND conversation = ?2 AND id = ?3",
                        rusqlite::params![account, conversation, id],
                        |row| row.get::<_, i64>(0),
                    )
                    .optional()
                    .map_err(|error| error.to_string())?;
                if let Some(sequence) = sequence {
                    transaction
                        .execute(
                            "UPDATE agent_chat_messages SET document = ?1
                             WHERE account = ?2 AND conversation = ?3 AND seq = ?4",
                            rusqlite::params![document, account, conversation, sequence],
                        )
                        .map_err(|error| error.to_string())?;
                } else {
                    let sequence = transaction
                        .query_row(
                            "SELECT COALESCE(MAX(seq) + 1, 0) FROM agent_chat_messages
                             WHERE account = ?1 AND conversation = ?2",
                            rusqlite::params![account, conversation],
                            |row| row.get::<_, i64>(0),
                        )
                        .map_err(|error| error.to_string())?;
                    transaction
                        .execute(
                            "INSERT INTO agent_chat_messages (account, conversation, seq, id, document)
                             VALUES (?1, ?2, ?3, ?4, ?5)",
                            rusqlite::params![account, conversation, sequence, id, document],
                        )
                        .map_err(|error| error.to_string())?;
                }
                update_recall(&transaction, &account, &conversation, &agent, &value)
                    .map_err(|error| error.to_string())?;
            }
            transaction
                .execute(
                    "UPDATE agent_chats SET updated_at = ?1
                     WHERE account = ?2 AND kind = 'conversation' AND id = ?3",
                    rusqlite::params![now_ms(), account, conversation],
                )
                .map_err(|error| error.to_string())?;
            transaction.commit().map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| error.to_string())?
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
        check_document(&document)?;
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
        check_document(&document)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn adopting_moves_chats_and_leaves_approvals_behind() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::at(directory.path().join("misty.db"));
        let service = AgentChatsService::new(store.clone());
        let put = |account: &str, kind: &str, id: &str, document: &str| {
            service.put(account.into(), kind.into(), id.into(), document.into())
        };
        assert_eq!(
            service.adoptable("local".into(), "a".into()).await.unwrap(),
            0
        );
        put("local", "conversation", "c1", "{}").await.unwrap();
        put("local", "agent", "sitegrant_x", "{}").await.unwrap();
        put("local", "agent", "personal_misty", "{}").await.unwrap();
        assert_eq!(
            service.adoptable("local".into(), "a".into()).await.unwrap(),
            1
        );
        service.adopt("local".into(), "a".into()).await.unwrap();
        assert_eq!(
            service.adoptable("local".into(), "a".into()).await.unwrap(),
            0
        );
        let kept = |account: &str| -> Vec<String> {
            let connection = store.connect().unwrap();
            let mut statement = connection
                .prepare(
                    "SELECT id FROM agent_chats WHERE account = ?1 AND kind = 'agent' ORDER BY id",
                )
                .unwrap();
            let ids = statement
                .query_map([account], |row| row.get::<_, String>(0))
                .unwrap()
                .flatten()
                .collect();
            ids
        };
        assert_eq!(kept("a"), ["personal_misty"]);
        assert_eq!(kept("local"), ["sitegrant_x"]);
    }

    #[tokio::test]
    async fn chats_stay_per_account_and_kind() {
        let directory = tempfile::tempdir().unwrap();
        let service = AgentChatsService::new(Store::at(directory.path().join("misty.db")));
        let put = |account: &str, kind: &str, id: &str, document: &str| {
            service.put(account.into(), kind.into(), id.into(), document.into())
        };
        put("a", "conversation", "c1", r#"{"id":"c1"}"#)
            .await
            .unwrap();
        put("a", "conversation", "c1", r#"{"id":"c1","title":"Edited"}"#)
            .await
            .unwrap();
        put("a", "folder", "f1", r#"{"id":"f1"}"#).await.unwrap();
        put("b", "conversation", "c2", r#"{"id":"c2"}"#)
            .await
            .unwrap();
        let listed = service
            .list("a".into(), "conversation".into())
            .await
            .unwrap();
        assert_eq!(listed, vec![r#"{"id":"c1","title":"Edited"}"#.to_owned()]);
        service
            .delete("a".into(), "conversation".into(), "c1".into())
            .await
            .unwrap();
        assert!(service
            .list("a".into(), "conversation".into())
            .await
            .unwrap()
            .is_empty());
        assert_eq!(
            service
                .list("b".into(), "conversation".into())
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn signing_in_brings_signed_out_chats_along_and_keeps_the_accounts_own() {
        let directory = tempfile::tempdir().unwrap();
        let service = AgentChatsService::new(Store::at(directory.path().join("misty.db")));
        let put = |account: &str, id: &str, text: &str| {
            service.put(
                account.into(),
                "conversation".into(),
                id.into(),
                format!("{{\"t\":\"{text}\"}}"),
            )
        };
        put("local", "a", "signed out").await.unwrap();
        put("local", "b", "signed out").await.unwrap();
        put("me", "b", "the account's").await.unwrap();
        assert_eq!(service.adopt("local".into(), "me".into()).await.unwrap(), 1);
        let mine = service
            .list("me".into(), "conversation".into())
            .await
            .unwrap();
        assert_eq!(mine.len(), 2);
        assert!(mine.iter().any(|row| row.contains("the account's")));
    }

    #[tokio::test]
    async fn a_swap_writes_only_over_what_it_read() {
        let directory = tempfile::tempdir().unwrap();
        let service = AgentChatsService::new(Store::at(directory.path().join("misty.db")));
        let swap = |expected: Option<&str>, document: &str| {
            service.swap(
                "a".into(),
                "collaboration".into(),
                "c1".into(),
                expected.map(str::to_owned),
                document.into(),
            )
        };
        let read = || service.get("a".into(), "collaboration".into(), "c1".into());
        assert_eq!(read().await.unwrap(), None);
        assert!(swap(None, r#"{"v":1}"#).await.unwrap());
        // Someone wrote first: both a second create and a stale update lose.
        assert!(!swap(None, r#"{"v":2}"#).await.unwrap());
        assert!(!swap(Some(r#"{"v":0}"#), r#"{"v":2}"#).await.unwrap());
        assert_eq!(read().await.unwrap().as_deref(), Some(r#"{"v":1}"#));
        assert!(swap(Some(r#"{"v":1}"#), r#"{"v":2}"#).await.unwrap());
        assert_eq!(read().await.unwrap().as_deref(), Some(r#"{"v":2}"#));
        assert!(swap(Some(r#"{"v":2}"#), "not json").await.is_err());
    }

    #[tokio::test]
    async fn racing_swaps_have_one_winner() {
        let directory = tempfile::tempdir().unwrap();
        let service = AgentChatsService::new(Store::at(directory.path().join("misty.db")));
        let start = r#"{"state":"idle"}"#;
        service
            .put("a".into(), "run".into(), "s1".into(), start.into())
            .await
            .unwrap();
        let racers: Vec<_> = (0..8)
            .map(|index| {
                let service = service.clone();
                tokio::spawn(async move {
                    service
                        .swap(
                            "a".into(),
                            "run".into(),
                            "s1".into(),
                            Some(start.to_owned()),
                            format!(r#"{{"state":"running","by":{index}}}"#),
                        )
                        .await
                        .unwrap()
                })
            })
            .collect();
        let mut winners = 0;
        for racer in racers {
            winners += usize::from(racer.await.unwrap());
        }
        assert_eq!(winners, 1);
    }

    #[tokio::test]
    async fn bad_documents_and_kinds_are_refused() {
        let directory = tempfile::tempdir().unwrap();
        let service = AgentChatsService::new(Store::at(directory.path().join("misty.db")));
        assert!(service
            .put(
                "a".into(),
                "conversation".into(),
                "c1".into(),
                "not json".into()
            )
            .await
            .is_err());
        assert!(service
            .put("a".into(), "secrets".into(), "c1".into(), "{}".into())
            .await
            .is_err());
    }
}
