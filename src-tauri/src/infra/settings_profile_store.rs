//! Durable per-account settings cache and outbox. CAS prevents renderer races.
use crate::error::{ApiError, ApiResult};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStateSnapshot {
    pub revision: i64,
    pub state: Option<Value>,
}
pub fn profile_state(
    path: &Path,
    scope: &str,
    update: Option<(i64, Value)>,
) -> ApiResult<ProfileStateSnapshot> {
    if scope.is_empty() || scope.len() > 1024 {
        return Err(ApiError::Message("Invalid settings scope".into()));
    }
    let result = (|| -> Result<ProfileStateSnapshot, Box<dyn std::error::Error>> {
        let parent = path.parent().ok_or("Missing settings directory")?;
        std::fs::create_dir_all(parent)?;
        backup_legacy_settings(path)?;
        let mut db = Connection::open(parent.join("settings-profiles.sqlite"))?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state(scope TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL);")?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let existing: Option<(i64, String)> = tx
            .query_row(
                "SELECT revision,document FROM state WHERE scope=?1",
                [scope],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let revision = existing.as_ref().map(|v| v.0).unwrap_or(0);
        if let Some((expected, value)) = update {
            let encoded = serde_json::to_string(&value)?;
            if !value.is_object() || encoded.len() > 8 * 1024 * 1024 {
                return Err("Invalid settings state".into());
            }
            if revision != expected {
                return Err("SETTINGS_REVISION_CONFLICT".into());
            }
            tx.execute("INSERT INTO state(scope,revision,document) VALUES(?1,?2,?3) ON CONFLICT(scope) DO UPDATE SET revision=excluded.revision,document=excluded.document", params![scope,revision+1,encoded])?;
            tx.commit()?;
            return Ok(ProfileStateSnapshot {
                revision: revision + 1,
                state: Some(value),
            });
        }
        Ok(ProfileStateSnapshot {
            revision,
            state: existing.map(|v| serde_json::from_str(&v.1)).transpose()?,
        })
    })();
    result.map_err(|err| ApiError::Message(format!("Settings persistence failed: {err}")))
}

/// Complete the backup before any legacy normalization or profile projection.
pub fn backup_legacy_settings(path: &Path) -> std::io::Result<()> {
    use std::io::Write;
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    let backup = parent.join("settings.before-profiles.json");
    if !path.exists() || backup.exists() {
        return Ok(());
    }
    let data = std::fs::read(path)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    temporary.write_all(&data)?;
    temporary.as_file().sync_all()?;
    match temporary.persist_noclobber(backup) {
        Ok(_) => Ok(()),
        Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error.error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn durable_cas_and_account_isolation() {
        let root = std::env::temp_dir().join(format!("misty-settings-{}", uuid::Uuid::new_v4()));
        let path = root.join("settings.json");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&path, r#"{"legacy":{"unknown":true}}"#).unwrap();
        let state = serde_json::json!({"outbox":[{"id":"pending"}]});
        profile_state(&path, "account-a", Some((0, state.clone()))).unwrap();
        assert_eq!(
            profile_state(&path, "account-a", None).unwrap().state,
            Some(state.clone())
        );
        assert!(profile_state(&path, "account-a", Some((0, state))).is_err());
        assert!(profile_state(&path, "account-b", None)
            .unwrap()
            .state
            .is_none());
        std::fs::write(&path, r#"{"projected":true}"#).unwrap();
        profile_state(&path, "account-a", None).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("settings.before-profiles.json")).unwrap(),
            r#"{"legacy":{"unknown":true}}"#,
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
