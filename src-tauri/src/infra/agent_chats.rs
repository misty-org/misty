//! Agent chats kept on this device, per account, in `misty.db`: conversations with their
//! messages, and the folders that group them. Like Claude Code and Codex, a chat lives on
//! the computer it was started on and never syncs; the server only runs its turns and
//! meters them. Documents are the app's own JSON, stored as they are. A lesson is a
//! Teach-mode chat's progress (goal, objectives, hint level), kept beside its chat.
use super::store::Store;

/// What one row holds.
const KINDS: &[&str] = &["conversation", "folder", "meta", "lesson", "course"];
/// A long chat with its timelines stays far below this.
const MAX_DOCUMENT_BYTES: usize = 16 * 1024 * 1024;

fn valid_key(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
}

fn check(account: &str, kind: &str, id: &str) -> Result<(), String> {
    if !valid_key(account) || !valid_key(id) || !KINDS.contains(&kind) {
        return Err("invalid_agent_chat".into());
    }
    Ok(())
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
            rows.collect::<Result<Vec<String>, _>>()
                .map_err(|e| e.to_string())
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
        if document.len() > MAX_DOCUMENT_BYTES
            || serde_json::from_str::<serde_json::Value>(&document).is_err()
        {
            return Err("invalid_agent_chat".into());
        }
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || {
            let connection = store.connect().map_err(|e| e.to_string())?;
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_millis() as i64)
                .unwrap_or_default();
            connection
                .execute(
                    "INSERT INTO agent_chats (account, kind, id, document, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT (account, kind, id)
                     DO UPDATE SET document = excluded.document, updated_at = excluded.updated_at",
                    rusqlite::params![account, kind, id, document, now],
                )
                .map(|_| ())
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    pub async fn delete(&self, account: String, kind: String, id: String) -> Result<(), String> {
        check(&account, &kind, &id)?;
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || {
            let connection = store.connect().map_err(|e| e.to_string())?;
            connection
                .execute(
                    "DELETE FROM agent_chats WHERE account = ?1 AND kind = ?2 AND id = ?3",
                    rusqlite::params![account, kind, id],
                )
                .map(|_| ())
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
