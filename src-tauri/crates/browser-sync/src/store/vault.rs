//! Public root identity plus encrypted unlock wrapper. No password, sync secret,
//! unwrapped root, or unwrapped device key is cached here.
use super::*;
use crate::transport::SyncApi;

#[derive(Clone)]
pub struct CachedVault {
    pub workspace: Workspace,
    pub bootstrap_pending: bool,
    pub enrollment_pending: bool,
}

impl CachedVault {
    pub(super) fn verify(
        &self,
        scope: &VaultScope,
        root: &VaultRoot,
        grant: &DeviceGrant,
    ) -> Result<()> {
        if self.workspace.workspace_id != scope.workspace_id
            || self.workspace.root_public_key != root.public_key()?
            || self.workspace.key_epoch != grant.key_epoch
            || self.workspace.head_sequence > MAX_COUNTER
            || (self.bootstrap_pending
                && (!self.enrollment_pending
                    || self.workspace.head_sequence != 0
                    || self.workspace.key_epoch != 1))
        {
            return Err(Error::Identity);
        }
        let wrapped = &self.workspace.key_envelope;
        if wrapped.version != 1 || wrapped.kdf != "argon2id-m65536-t3-p1" {
            return Err(Error::Invalid);
        }
        decode_fixed::<16>(&wrapped.salt)?;
        Envelope {
            version: wrapped.version,
            nonce: wrapped.nonce.clone(),
            ciphertext: wrapped.ciphertext.clone(),
        }
        .decode(4096)?;
        Ok(())
    }

    pub fn check_remote(&self, remote: &Workspace) -> Result<()> {
        if remote.workspace_id != self.workspace.workspace_id
            || remote.root_public_key != self.workspace.root_public_key
        {
            return Err(Error::Identity);
        }
        // Password/key rotation needs an authenticated transition; never replace
        // the locally pinned identity/wrapper merely because a server sent one.
        if remote.key_epoch != self.workspace.key_epoch
            || remote.key_envelope != self.workspace.key_envelope
            || remote.head_sequence < self.workspace.head_sequence
            || remote.head_sequence > MAX_COUNTER
        {
            return Err(Error::Recovery);
        }
        Ok(())
    }

    /// Called during reconnect while the worker keeps accepting offline edits.
    /// Both a lost bootstrap response and a lost enrollment response are safe:
    /// a matching existing vault/grant is adopted; a different vault is rejected.
    pub async fn ensure_enrolled(&self, api: &SyncApi, grant: &DeviceGrant) -> Result<()> {
        if !self.enrollment_pending {
            return Ok(());
        }
        match api.workspace().await? {
            Some(remote) => self.check_remote(&remote)?,
            None if self.bootstrap_pending => {
                match api
                    .bootstrap(
                        &self.workspace.root_public_key,
                        &self.workspace.key_envelope,
                        grant,
                    )
                    .await
                {
                    Ok(()) => {}
                    // Another retry may have just committed the same bootstrap.
                    Err(Error::Recovery) => {
                        self.check_remote(&api.workspace().await?.ok_or(Error::Recovery)?)?;
                    }
                    Err(error) => return Err(error),
                }
            }
            None => return Err(Error::Recovery),
        }
        api.enroll(grant).await
    }
}

impl Store {
    /// Reading metadata cannot unlock any encrypted data. An absent file is a
    /// first run. Older identities may lack this cache and need one authenticated
    /// online unlock to add it in place without replacing their device key.
    pub fn read_cached_vault(
        path: &Path,
        deployment: &str,
        account_id: &str,
    ) -> Result<Option<CachedVault>> {
        if !path.exists() {
            return Ok(None);
        }
        let connection = connect(path)?;
        let cached = read(&connection)?;
        let stored: Option<Vec<u8>> = connection
            .query_row(
                "SELECT scope FROM sync_identity WHERE singleton=1",
                [],
                |r| r.get(0),
            )
            .optional()?;
        match (&cached, stored) {
            (Some(cached), Some(stored)) => {
                let expected = VaultScope {
                    deployment: deployment.into(),
                    account_id: account_id.into(),
                    workspace_id: cached.workspace.workspace_id.clone(),
                };
                if stored != fingerprint(&expected)? {
                    return Err(Error::Identity);
                }
            }
            (None, None) => {}
            (None, Some(stored)) => {
                let grant: String = connection.query_row(
                    "SELECT grant_json FROM sync_identity WHERE singleton=1",
                    [],
                    |r| r.get(0),
                )?;
                let grant: DeviceGrant = serde_json::from_str(&grant)?;
                let expected = VaultScope {
                    deployment: deployment.into(),
                    account_id: account_id.into(),
                    workspace_id: grant.workspace_id,
                };
                if stored != fingerprint(&expected)? {
                    return Err(Error::Identity);
                }
            }
            _ => return Err(Error::Recovery),
        }
        Ok(cached)
    }

    /// Locate development-era databases without opening another account's
    /// encrypted records or modifying its schema. Identity is verified again
    /// cryptographically after unlocking; this is only a routing hint.
    pub fn belongs_to_account(path: &Path, deployment: &str, account_id: &str) -> Result<bool> {
        if !path.is_file() {
            return Ok(false);
        }
        let connection =
            Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let exists: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name='sync_identity' AND type='table')", [], |r| r.get(0))?;
        if !exists {
            return Ok(false);
        }
        let row: Option<(Vec<u8>, String)> = connection
            .query_row(
                "SELECT scope,grant_json FROM sync_identity WHERE singleton=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((stored, grant)) = row else {
            return Ok(false);
        };
        let grant: DeviceGrant = serde_json::from_str(&grant)?;
        let scope = VaultScope {
            deployment: deployment.into(),
            account_id: account_id.into(),
            workspace_id: grant.workspace_id,
        };
        Ok(stored == fingerprint(&scope)?)
    }

    /// Upgrade an already verified local identity in place. Its outbox, device
    /// counter, database location, and replay receipts remain unchanged.
    pub fn cache_verified_vault(&mut self, root: &VaultRoot, vault: &CachedVault) -> Result<()> {
        vault.verify(&self.scope, root, &self.grant)?;
        if let Some(existing) = self.cached_vault()? {
            existing.check_remote(&vault.workspace)?;
            return Ok(());
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "INSERT INTO sync_vault VALUES(1,?1,?2,?3)",
            params![
                serde_json::to_string(&vault.workspace)?,
                vault.bootstrap_pending,
                vault.enrollment_pending
            ],
        )?;
        tx.execute(
            "UPDATE sync_high_watermark SET observed_head=max(observed_head,?1) WHERE singleton=1",
            [vault.workspace.head_sequence],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn cached_vault(&self) -> Result<Option<CachedVault>> {
        read(&self.connection)
    }

    pub fn confirm_enrollment(&mut self, remote: &Workspace) -> Result<()> {
        let Some(cached) = self.cached_vault()? else {
            return Ok(());
        };
        cached.check_remote(remote)?;
        if remote.head_sequence < self.observed_head()? {
            return Err(Error::Recovery);
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("UPDATE sync_vault SET workspace=?1,bootstrap_pending=0,enrollment_pending=0 WHERE singleton=1", [serde_json::to_string(remote)?])?;
        tx.execute(
            "UPDATE sync_high_watermark SET observed_head=max(observed_head,?1) WHERE singleton=1",
            [remote.head_sequence],
        )?;
        tx.commit()?;
        Ok(())
    }
}

fn read(connection: &Connection) -> Result<Option<CachedVault>> {
    let row: Option<(String, bool, bool)> = connection.query_row(
        "SELECT workspace,bootstrap_pending,enrollment_pending FROM sync_vault WHERE singleton=1", [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).optional()?;
    row.map(|(workspace, bootstrap_pending, enrollment_pending)| {
        Ok(CachedVault {
            workspace: serde_json::from_str(&workspace)?,
            bootstrap_pending,
            enrollment_pending,
        })
    })
    .transpose()
}
