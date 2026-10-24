//! Reading and sealing the per-profile capture record.
use super::*;

impl Store {
    pub(super) fn read_capture(&self, root: &VaultRoot, profile: &str) -> Result<Option<Capture>> {
        let row: Option<(u64, String)> = self
            .connection
            .query_row(
                "SELECT revision,observation FROM sync_browser_capture WHERE profile_id=?1",
                [profile],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let Some((revision, encoded)) = row else {
            return Ok(None);
        };
        let bytes = root.open_local(
            &self.scope,
            &self.grant.device_id,
            &key(profile, revision),
            &serde_json::from_str(&encoded)?,
        )?;
        let capture: Capture = serde_json::from_slice(&bytes)?;
        if capture.revision != revision || revision > MAX_COUNTER || !valid_id(&capture.generation)
        {
            return Err(Error::Identity);
        }
        validate_observation(profile, &capture.observed)?;
        for v in &capture.baseline {
            if v.profile_id != profile {
                return Err(Error::Identity);
            }
            v.area.key(profile)?;
            v.area.validate_payload(&v.payload)?;
        }
        if let Some(pending) = &capture.pending {
            if !valid_id(&pending.id) || pending.batch.profile_id != profile {
                return Err(Error::Identity);
            }
            pending.batch.validate()?;
        }
        Ok(Some(capture))
    }
    pub(super) fn save_capture(
        &mut self,
        root: &VaultRoot,
        profile: &str,
        capture: &mut Capture,
    ) -> Result<()> {
        let previous = capture.revision;
        let revision = previous
            .checked_add(1)
            .filter(|v| *v <= MAX_COUNTER)
            .ok_or(Error::TooLarge)?;
        let mut next = capture.clone();
        next.revision = revision;
        let bytes = Zeroizing::new(serde_json::to_vec(&next)?);
        if bytes.len() > 16 << 20 {
            return Err(Error::TooLarge);
        }
        let encrypted = serde_json::to_string(&root.seal_local(
            &self.scope,
            &self.grant.device_id,
            &key(profile, revision),
            &bytes,
        )?)?;
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let actual: Option<u64> = tx
            .query_row(
                "SELECT revision FROM sync_browser_capture WHERE profile_id=?1",
                [profile],
                |r| r.get(0),
            )
            .optional()?;
        if actual.unwrap_or(0) != previous {
            return Err(Error::Sequence);
        }
        if actual.is_none()
            && tx.query_row("SELECT count(*) FROM sync_browser_capture", [], |r| {
                r.get::<_, u64>(0)
            })? >= 64
        {
            return Err(Error::TooLarge);
        }
        tx.execute("INSERT INTO sync_browser_capture VALUES(?1,?2,?3) ON CONFLICT(profile_id) DO UPDATE SET revision=excluded.revision, observation=excluded.observation", params![profile,revision,encrypted])?;
        tx.commit()?;
        *capture = next;
        Ok(())
    }
}
