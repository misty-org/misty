//! Handing chats kept signed out to the account that signs in.

use super::*;

impl AgentChatsService {
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
}
