//! Agent chats kept on this computer, per account, in `misty.db`: conversations with their
//! messages, and the folders that group them. Like Claude Code and Codex, a chat lives on the
//! computer it was started on and never syncs; the server only runs its turns
//! Documents are the app's own JSON, stored as they are. A lesson
//! is a Teach-mode chat's progress (goal, objectives, hint level), kept beside its chat.
//! A chat's run state (plans, goals, questions, checklists) and notebook live here too, and a run
//! notes which chat it belongs to.
use rusqlite::OptionalExtension;

use super::super::store::Store;

/// What one row holds.
const KINDS: &[&str] = &[
    "conversation",
    "folder",
    "lesson",
    "course",
    "collaboration",
    "notebook",
    "run",
    "workflow_method",
    "workflow_schedule",
    "workflow_replay",
    "workflow_vector",
    "agent",
    "attachment",
    "artifact",
];
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

fn check_document(document: &str) -> Result<(), String> {
    if document.len() > MAX_DOCUMENT_BYTES
        || serde_json::from_str::<serde_json::Value>(document).is_err()
    {
        return Err("invalid_agent_chat".into());
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

    /// What adopting would hand over that someone would want asked about first: chats and workflows.
    /// Built-in rows and approvals go or stay without a question.
    pub async fn adoptable(&self, from: String, to: String) -> Result<u64, String> {
        check(&from, "conversation", "adopt")?;
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || {
            let connection = store.connect().map_err(|e| e.to_string())?;
            connection
                .query_row(
                    "SELECT COUNT(*) FROM agent_chats AS kept WHERE kept.account = ?1
                     AND kept.kind IN ('conversation', 'workflow_method', 'workflow_schedule')
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

    /// What was kept signed out goes to the account that signs in, once it's said yes. Its schedules
    /// arrive turned off: one set by whoever used this computer before must not run in this account in
    /// Auto. Its remembered site approvals stay behind. A row the account already has stays as it is,
    /// and the signed-out copy stays behind it.
    pub async fn adopt(&self, from: String, to: String) -> Result<u64, String> {
        check(&from, "conversation", "adopt")?;
        check(&to, "conversation", "adopt")?;
        let store = self.store.clone();
        tokio::task::spawn_blocking(move || {
            let mut connection = store.connect().map_err(|e| e.to_string())?;
            let transaction = connection.transaction().map_err(|e| e.to_string())?;
            transaction
                .execute(
                    "UPDATE agent_chats SET document =
                       json_remove(json_set(document, '$.enabled', json('false'), '$.state', 'idle'), '$.next_run_at')
                     WHERE account = ?1 AND kind = 'workflow_schedule'",
                    [&from],
                )
                .map_err(|e| e.to_string())?;
            let moved = transaction
                .execute(
                    "UPDATE OR IGNORE agent_chats SET account = ?2 WHERE account = ?1
                     AND NOT (kind = 'agent' AND id LIKE 'sitegrant\\_%' ESCAPE '\\')",
                    rusqlite::params![from, to],
                )
                .map_err(|e| e.to_string())?;
            transaction
                .execute("UPDATE agent_tool_journal SET account = ?2 WHERE account = ?1", rusqlite::params![from, to])
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
            rows.collect::<Result<Vec<String>, _>>()
                .map_err(|e| e.to_string())
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
            changed.map(|rows| rows == 1).map_err(|e| e.to_string())
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
    async fn adopting_turns_schedules_off_and_leaves_approvals_behind() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::at(directory.path().join("misty.db"));
        let service = AgentChatsService::new(store.clone());
        let put = |account: &str, kind: &str, id: &str, document: &str| {
            service.put(account.into(), kind.into(), id.into(), document.into())
        };
        assert_eq!(service.adoptable("local".into(), "a".into()).await.unwrap(), 0);
        put("local", "conversation", "c1", "{}").await.unwrap();
        put("local", "workflow_schedule", "m1", r#"{"enabled":true,"state":"idle","next_run_at":"2026-11-07T00:00:00Z"}"#).await.unwrap();
        put("local", "agent", "sitegrant_x", "{}").await.unwrap();
        put("local", "agent", "personal_misty", "{}").await.unwrap();
        assert_eq!(service.adoptable("local".into(), "a".into()).await.unwrap(), 2);
        service.adopt("local".into(), "a".into()).await.unwrap();
        assert_eq!(service.adoptable("local".into(), "a".into()).await.unwrap(), 0);
        let schedule: serde_json::Value = serde_json::from_str(&service.list("a".into(), "workflow_schedule".into()).await.unwrap()[0]).unwrap();
        assert_eq!(schedule["enabled"], false);
        assert!(schedule.get("next_run_at").is_none());
        let kept = |account: &str| -> Vec<String> {
            let connection = store.connect().unwrap();
            let mut statement = connection.prepare("SELECT id FROM agent_chats WHERE account = ?1 AND kind = 'agent' ORDER BY id").unwrap();
            let ids = statement.query_map([account], |row| row.get::<_, String>(0)).unwrap().flatten().collect();
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
            service.put(account.into(), "conversation".into(), id.into(), format!("{{\"t\":\"{text}\"}}"))
        };
        put("local", "a", "signed out").await.unwrap();
        put("local", "b", "signed out").await.unwrap();
        put("me", "b", "the account's").await.unwrap();
        assert_eq!(service.adopt("local".into(), "me".into()).await.unwrap(), 1);
        let mine = service.list("me".into(), "conversation".into()).await.unwrap();
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
            .put("a".into(), "workflow_schedule".into(), "s1".into(), start.into())
            .await
            .unwrap();
        let racers: Vec<_> = (0..8)
            .map(|index| {
                let service = service.clone();
                tokio::spawn(async move {
                    service
                        .swap(
                            "a".into(),
                            "workflow_schedule".into(),
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
