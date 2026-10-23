//! This device's preference state, with a revision so two windows cannot overwrite each
//! other. It lives in `misty.db` and never leaves the device.
use super::super::store::Store;
use crate::error::{ApiError, ApiResult};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStateSnapshot {
    pub revision: i64,
    pub state: Option<Value>,
}

pub fn profile_state(
    store: &Store,
    scope: &str,
    update: Option<(i64, Value)>,
) -> ApiResult<ProfileStateSnapshot> {
    if scope.is_empty() || scope.len() > 1024 {
        return Err(ApiError::Message("Invalid settings scope".into()));
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
    result.map_err(|err| ApiError::Message(format!("Settings persistence failed: {err}")))
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
}
