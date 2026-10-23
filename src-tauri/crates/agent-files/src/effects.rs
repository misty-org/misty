//! Applying a prepared manifest and undoing an applied one, journaling every
//! step before its effect.
use super::*;

impl Organizer {
    pub fn apply(&self, account: &str, id: &str, canceled: impl Fn() -> bool) -> Result<Manifest> {
        let mut manifest = self.manifest(account, id)?;
        if manifest.state == "completed" || manifest.state == "undone" {
            return Ok(manifest);
        }
        let (_, root) = self.scope(account, &manifest.grant_id)?;
        manifest.state = "running".into();
        self.save(id, "manifest", &manifest)?;
        for index in 0..manifest.receipts.len() {
            if canceled() {
                manifest.state = "paused".into();
                break;
            }
            self.scope(account, &manifest.grant_id)?;
            let receipt = manifest.receipts[index].clone();
            if receipt.state == "completed" {
                continue;
            }
            // A crash after a move but before its receipt is reconciled by inode/freshness.
            if receipt.state == "applying" {
                if let (Some(from), Some(expected)) = (&receipt.from, &receipt.fingerprint) {
                    let source_absent = parent(&root, from)
                        .and_then(|(d, n)| absent(&d, &n))
                        .is_ok();
                    if source_absent
                        && open_item(&root, &receipt.to)
                            .and_then(|f| fingerprint(&f))
                            .ok()
                            .as_ref()
                            == Some(expected)
                    {
                        manifest.receipts[index].state = "completed".into();
                        self.save(id, "manifest", &manifest)?;
                        continue;
                    }
                }
                manifest.receipts[index].state = "uncertain".into();
                manifest.receipts[index].error =
                    Some("Interrupted operation needs inspection; it was not repeated".into());
                manifest.state = "needs_review".into();
                break;
            }
            if receipt.state == "uncertain" || receipt.state == "failed" {
                manifest.state = "needs_review".into();
                break;
            }
            manifest.receipts[index].state = "applying".into();
            manifest.receipts[index].error = None;
            self.save(id, "manifest", &manifest)?;
            let result = (|| {
                let (to, name) = parent(&root, &receipt.to)?;
                absent(&to, &name)?;
                if let Some(from) = &receipt.from {
                    let current = open_item(&root, from)?;
                    if Some(fingerprint(&current)?) != receipt.fingerprint {
                        return Err("Source changed; this operation was not applied".into());
                    }
                    let (source, source_name) = parent(&root, from)?;
                    rename_exclusive(&source, &source_name, &to, &name)?;
                    sync_folder(&source)?;
                    sync_folder(&to)?;
                    if Some(fingerprint(&open_item(&root, &receipt.to)?)?) != receipt.fingerprint {
                        return Err(
                            "Moved item changed during verification; inspect the manifest".into(),
                        );
                    }
                } else {
                    make_folder(&to, &name)?;
                    sync_folder(&to)?;
                    manifest.receipts[index].fingerprint =
                        Some(fingerprint(&open_item(&root, &receipt.to)?)?);
                }
                Ok(())
            })();
            match result {
                Ok(()) => manifest.receipts[index].state = "completed".into(),
                Err(error) => {
                    manifest.receipts[index].state = "failed".into();
                    manifest.receipts[index].error = Some(error);
                    manifest.state = "needs_review".into();
                }
            }
            self.save(id, "manifest", &manifest)?;
            if manifest.state == "needs_review" {
                break;
            }
        }
        if manifest.receipts.iter().all(|r| r.state == "completed") {
            manifest.state = "completed".into();
        }
        self.save(id, "manifest", &manifest)?;
        Ok(manifest)
    }
    pub fn undo(&self, account: &str, id: &str) -> Result<Manifest> {
        let mut manifest = self.manifest(account, id)?;
        let (_, root) = self.scope(account, &manifest.grant_id)?;
        for index in (0..manifest.receipts.len()).rev() {
            let receipt = manifest.receipts[index].clone();
            if receipt.state == "undone" || receipt.state == "pending" || receipt.state == "failed"
            {
                continue;
            }
            if receipt.state != "completed" {
                return Err("Reconcile interrupted operations before undo".into());
            }
            let result = (|| {
                let current = open_item(&root, &receipt.to)?;
                let actual = fingerprint(&current)?;
                let expected = receipt
                    .fingerprint
                    .as_ref()
                    .ok_or("Missing verification receipt")?;
                if let Some(from) = &receipt.from {
                    if &actual != expected {
                        return Err("The moved file changed; undo did not replace it".into());
                    }
                    let (to, name) = parent(&root, from)?;
                    absent(&to, &name)?;
                    manifest.receipts[index].state = "undoing".into();
                    self.save(id, "manifest", &manifest)?;
                    let (source, source_name) = parent(&root, &receipt.to)?;
                    rename_exclusive(&source, &source_name, &to, &name)?;
                    sync_folder(&source)?;
                    sync_folder(&to)?;
                } else {
                    if (actual.device, actual.inode) != (expected.device, expected.inode) {
                        return Err("Created folder changed; undo stopped".into());
                    }
                    // rmdir removes only this newly created, still empty directory.
                    let (dir, name) = parent(&root, &receipt.to)?;
                    manifest.receipts[index].state = "undoing".into();
                    self.save(id, "manifest", &manifest)?;
                    remove_folder(&dir, &name)?;
                    sync_folder(&dir)?;
                }
                Ok(())
            })();
            if let Err(error) = result {
                manifest.state = "needs_review".into();
                manifest.receipts[index].error = Some(error);
                self.save(id, "manifest", &manifest)?;
                return Ok(manifest);
            }
            manifest.receipts[index].state = "undone".into();
            self.save(id, "manifest", &manifest)?;
        }
        manifest.state = "undone".into();
        self.save(id, "manifest", &manifest)?;
        Ok(manifest)
    }
}
