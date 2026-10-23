//! The locked restore path: replays a pending import or begins a new one.
use super::{QuiescentProfile, RestoreError, RestoreOutcome};
use crate::{document::Document, worker::WorkerHandle, Error};

pub(super) async fn restore_locked(
    worker: &WorkerHandle,
    profile: &str,
    generation_id: Option<&str>,
    backend: &mut impl QuiescentProfile,
) -> Result<RestoreOutcome, RestoreError> {
    let mut journal = worker.browser_import_journal(profile.into()).await?;
    if journal.quarantined {
        return Err(RestoreError::Quarantined);
    }
    if let Some(id) = generation_id {
        if journal
            .pending
            .as_ref()
            .is_some_and(|pending| pending.id != id)
        {
            return Err(Error::Identity.into());
        }
        if journal.pending.is_none() {
            let document: Document =
                serde_json::from_slice(&worker.snapshot().await?).map_err(Error::from)?;
            let current: Vec<_> = document
                .credentials
                .values()
                .filter(|record| record.profile_id == profile)
                .cloned()
                .collect();
            if let Some(applied) = journal
                .applied
                .as_ref()
                .filter(|receipt| receipt.id == id)
                .filter(|receipt| {
                    crate::store::browser_import::equivalent(&receipt.credentials, &current)
                        .unwrap_or(false)
                })
            {
                // A lost successful response can be retried, but a receipt from
                // a prior process is not proof the engine still holds values.
                backend
                    .prepare_ephemeral(&applied.credentials)
                    .await
                    .map_err(RestoreError::Engine)?;
                backend
                    .preflight(&applied.credentials)
                    .await
                    .map_err(RestoreError::Engine)?;
                let observed = backend
                    .readback(&applied.credentials)
                    .await
                    .map_err(RestoreError::Engine)?;
                worker
                    .finish_browser_import(profile.into(), journal.revision, id.into(), observed)
                    .await?;
                return Ok(RestoreOutcome::Applied {
                    sequence: applied.snapshot_sequence,
                });
            }
        }
    }
    if journal.pending.is_none() {
        let document: Document =
            serde_json::from_slice(&worker.snapshot().await?).map_err(Error::from)?;
        document.validate()?;
        let target: Vec<_> = document
            .credentials
            .values()
            .filter(|record| record.profile_id == profile)
            .cloned()
            .collect();
        if target.is_empty() {
            return Ok(RestoreOutcome::NoCredentials {
                sequence: document.sequence,
            });
        }
        // Unsupported native formats must leave both the browser and journal
        // untouched. Begin rechecks the committed cursor before issuing work.
        backend
            .preflight(&target)
            .await
            .map_err(RestoreError::Engine)?;
        journal = worker
            .begin_browser_import(
                profile.into(),
                journal.revision,
                generation_id
                    .map(str::to_owned)
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                document.sequence,
            )
            .await?;
    }
    let pending = journal.pending.as_ref().ok_or(Error::Recovery)?;
    backend
        .preflight(&pending.credentials)
        .await
        .map_err(RestoreError::Engine)?;
    let attempt = worker
        .browser_import_attempt(profile.into(), journal.revision, pending.id.clone())
        .await?;
    let result = async {
        backend
            .apply(&pending.credentials)
            .await
            .map_err(RestoreError::Engine)?;
        let observed = backend
            .readback(&pending.credentials)
            .await
            .map_err(RestoreError::Engine)?;
        worker
            .finish_browser_import(
                profile.into(),
                journal.revision,
                pending.id.clone(),
                observed,
            )
            .await?;
        Ok::<_, RestoreError>(RestoreOutcome::Applied {
            sequence: pending.snapshot_sequence,
        })
    }
    .await;
    if result.is_err() {
        // Explicit errors and canceled futures follow the same durable path.
        // A stopped worker still retains its pending receipt after restart.
        attempt.quarantine().await?;
    } else {
        attempt.complete();
    }
    result
}
