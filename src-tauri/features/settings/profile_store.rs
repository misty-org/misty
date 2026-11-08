//! This device's preference state, with a revision so two windows cannot overwrite each
//! other. It lives in `misty.db` and never leaves the device.
use crate::error::{Error as ApiError, Result as ApiResult};
use database::store::Store;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStateSnapshot {
    pub revision: i64,
    pub state: Option<Value>,
}

/// Scopes only native code writes: what the person has granted. Windows reach `profile_state`, and a
/// window must not be able to grant itself anything or read what it's been granted this way.
pub fn is_protected_scope(scope: &str) -> bool {
    scope.starts_with("grant:") || scope.starts_with("permission:")
}

pub fn profile_state(
    store: &Store,
    scope: &str,
    update: Option<(i64, Value)>,
) -> ApiResult<ProfileStateSnapshot> {
    if scope.is_empty() || scope.len() > 1024 || is_protected_scope(scope) {
        return Err(ApiError::new("Invalid settings scope"));
    }
    let result = (|| -> Result<ProfileStateSnapshot, Box<dyn std::error::Error>> {
        let mut db = store.connect()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let existing: Option<(i64, String)> = tx
            .query_row(
                "SELECT revision,document FROM settings_state WHERE scope=?1",
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
            tx.execute(
                "INSERT INTO settings_state(scope,revision,document) VALUES(?1,?2,?3)
                 ON CONFLICT(scope) DO UPDATE SET revision=excluded.revision,document=excluded.document",
                params![scope, revision + 1, encoded],
            )?;
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
    result.map_err(|err| ApiError::new(format!("Settings persistence failed: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn durable_cas_and_scope_isolation() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::at(directory.path().join("misty.db"));
        let state = serde_json::json!({"values":{"a":1}});
        profile_state(&store, "scope-a", Some((0, state.clone()))).unwrap();
        assert_eq!(
            profile_state(&store, "scope-a", None).unwrap().state,
            Some(state.clone())
        );
        // A stale revision is refused, so two windows cannot overwrite each other.
        assert!(profile_state(&store, "scope-a", Some((0, state))).is_err());
        assert!(profile_state(&store, "scope-b", None)
            .unwrap()
            .state
            .is_none());
    }

    #[test]
    fn windows_cannot_write_or_read_what_was_granted() {
        let directory = tempfile::tempdir().unwrap();
        let store = Store::at(directory.path().join("misty.db"));
        let state = serde_json::json!({"on":true});
        for scope in ["grant:downloads", "permission:screen-capture"] {
            assert!(profile_state(&store, scope, Some((0, state.clone()))).is_err());
            assert!(profile_state(&store, scope, None).is_err());
        }
    }
}
