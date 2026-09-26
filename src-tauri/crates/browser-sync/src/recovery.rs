//! Device-local encrypted workspace recovery. This key is independent of the
//! sync vault; records never become network payloads without client reconciliation.
use crate::{
    crypto::{VaultRoot, VaultScope},
    Error, Result,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::path::Path;
use zeroize::Zeroizing;

const MAX_BYTES: usize = 16 << 20;
const MAX_TOTAL_BYTES: u64 = 128 << 20;
const MAX_RECORDS: u64 = 128;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryRecord {
    pub revision: u64,
    pub value: String,
}

pub struct RecoveryStore {
    connection: Connection,
    scope: VaultScope,
    root: VaultRoot,
}

fn validate_key(key: &str) -> Result<()> {
    if key.is_empty()
        || key.len() > 200
        || !key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b':' | b'-'))
    {
        return Err(Error::Invalid);
    }
    Ok(())
}
fn aad(key: &str, revision: u64) -> String {
    format!("workspace-recovery:v1:{key}:{revision}")
}

impl RecoveryStore {
    pub fn open(path: &Path, scope: VaultScope, root: VaultRoot) -> Result<Self> {
        scope.validate()?;
        let mut options = std::fs::OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(path).map_err(|_| Error::Recovery)?;
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
          CREATE TABLE IF NOT EXISTS recovery_identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1), proof TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS recovery_records(record_key TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0), envelope TEXT NOT NULL);")?;
        let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let proof: Option<String> = tx
            .query_row(
                "SELECT proof FROM recovery_identity WHERE singleton=1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(proof) = proof {
            let bytes = root.open_local(
                &scope,
                &scope.workspace_id,
                "workspace-recovery:identity:v1",
                &serde_json::from_str(&proof)?,
            )?;
            if bytes.as_slice() != b"misty-workspace-recovery-v1" {
                return Err(Error::Identity);
            }
        } else {
            let proof = root.seal_local(
                &scope,
                &scope.workspace_id,
                "workspace-recovery:identity:v1",
                b"misty-workspace-recovery-v1",
            )?;
            tx.execute(
                "INSERT INTO recovery_identity VALUES(1,?1)",
                [serde_json::to_string(&proof)?],
            )?;
        }
        tx.commit()?;
        Ok(Self {
            connection,
            scope,
            root,
        })
    }

    pub fn read(&self, key: &str) -> Result<Option<RecoveryRecord>> {
        validate_key(key)?;
        let row: Option<(u64, String)> = self
            .connection
            .query_row(
                "SELECT revision,envelope FROM recovery_records WHERE record_key=?1",
                [key],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((revision, envelope)) = row else {
            return Ok(None);
        };
        if revision > crate::protocol::MAX_COUNTER || envelope.len() > MAX_BYTES * 2 {
            return Err(Error::TooLarge);
        }
        let raw = self.root.open_local(
            &self.scope,
            &self.scope.workspace_id,
            &aad(key, revision),
            &serde_json::from_str(&envelope)?,
        )?;
        let value = String::from_utf8(raw.to_vec()).map_err(|_| Error::Invalid)?;
        Ok(Some(RecoveryRecord { revision, value }))
    }

    /// Exact retry after a lost response performs no write. Revision checking
    /// prevents a delayed renderer from overwriting a newer local record.
    pub fn write(&mut self, key: &str, expected: u64, value: &str) -> Result<RecoveryRecord> {
        validate_key(key)?;
        if value.len() > MAX_BYTES {
            return Err(Error::TooLarge);
        }
        let current = self.read(key)?;
        if let Some(current) = current.as_ref().filter(|record| record.value == value) {
            return Ok(current.clone());
        }
        if current.as_ref().map_or(0, |record| record.revision) != expected {
            return Err(Error::Sequence);
        }
        if key.starts_with("archive:") && current.is_some() {
            return Err(Error::Sequence);
        }
        let revision = expected
            .checked_add(1)
            .filter(|v| *v <= crate::protocol::MAX_COUNTER)
            .ok_or(Error::TooLarge)?;
        let raw = Zeroizing::new(value.as_bytes().to_vec());
        let encrypted = serde_json::to_string(&self.root.seal_local(
            &self.scope,
            &self.scope.workspace_id,
            &aad(key, revision),
            &raw,
        )?)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let actual: Option<u64> = tx
            .query_row(
                "SELECT revision FROM recovery_records WHERE record_key=?1",
                [key],
                |r| r.get(0),
            )
            .optional()?;
        if actual.unwrap_or(0) != expected {
            return Err(Error::Sequence);
        }
        let (count, bytes): (u64, u64) = tx.query_row("SELECT count(*),coalesce(sum(length(envelope)),0) FROM recovery_records WHERE record_key<>?1", [key], |r| Ok((r.get(0)?,r.get(1)?)))?;
        if count >= MAX_RECORDS || bytes + encrypted.len() as u64 > MAX_TOTAL_BYTES {
            return Err(Error::TooLarge);
        }
        tx.execute("INSERT INTO recovery_records VALUES(?1,?2,?3) ON CONFLICT(record_key) DO UPDATE SET revision=excluded.revision,envelope=excluded.envelope", params![key,revision,encrypted])?;
        tx.commit()?;
        Ok(RecoveryRecord {
            revision,
            value: value.into(),
        })
    }
}
