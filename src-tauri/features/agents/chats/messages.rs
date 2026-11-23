use super::*;

impl AgentChatsService {
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
                let value: Value =
                    serde_json::from_str(&document).map_err(|_| "invalid_agent_chat")?;
                let id = value["id"]
                    .as_str()
                    .filter(|id| valid_key(id))
                    .ok_or("invalid_agent_chat")?;
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
}
