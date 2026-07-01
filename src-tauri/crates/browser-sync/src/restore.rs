//! Native-only orchestration for a staged browser profile. The caller must own
//! the account lease and keep the profile quiescent (no navigation, scripts,
//! service workers, other views, or capture) until it decides to expose it.
//! Applied receipts are not a global readiness signal: a newer server event or
//! another profile can still require restoration.
use std::future::Future;

use crate::{
    document::{CredentialRecord, Document},
    worker::WorkerHandle,
    Error,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineError {
    Unsupported,
    Unavailable,
    Invalid,
    Timeout,
}

#[derive(Debug, thiserror::Error)]
pub enum RestoreError {
    #[error("Native browser import is quarantined")]
    Quarantined,
    #[error("Native browser import could not be verified")]
    Engine(EngineError),
    #[error("Native browser import journal is unavailable")]
    Journal(#[from] Error),
}

/// Implementations must preflight every target before their first side effect,
/// await actual engine completion (not dispatch), and enumerate actual stored
/// values on readback. They must never substitute the requested payload for a
/// readback or silently omit unsupported credential areas.
pub trait QuiescentProfile {
    fn prepare_ephemeral(
        &mut self,
        _target: &[CredentialRecord],
    ) -> impl Future<Output = Result<(), EngineError>> + Send {
        async { Ok(()) }
    }
    fn preflight(
        &mut self,
        target: &[CredentialRecord],
    ) -> impl Future<Output = Result<(), EngineError>> + Send;
    fn apply(
        &mut self,
        target: &[CredentialRecord],
    ) -> impl Future<Output = Result<(), EngineError>> + Send;
    fn readback(
        &mut self,
        target: &[CredentialRecord],
    ) -> impl Future<Output = Result<Vec<CredentialRecord>, EngineError>> + Send;
}

/// The native backend must validate this physical identity against the actual
/// engine store, not merely echo the logical profile from credential records.
pub trait StagedProfile: QuiescentProfile {
    fn physical_id(&self) -> &str;
}

#[derive(Debug)]
pub enum RestoreOutcome {
    /// No credential area has been recorded. This is not an empty-cookie logout
    /// and does not authorize clearing the local profile or claiming capture.
    NoCredentials {
        sequence: u64,
    },
    Applied {
        sequence: u64,
    },
}

pub async fn restore_profile(
    worker: &WorkerHandle,
    profile: &str,
    backend: &mut impl QuiescentProfile,
) -> Result<RestoreOutcome, RestoreError> {
    // Shared by every handle clone. Drop order sends cancellation quarantine
    // before another caller can acquire this lease and inspect the journal.
    let _lease = worker.acquire_browser_import_lease().await;
    if worker
        .browser_profile_binding(profile.into())
        .await?
        .revision
        != 0
    {
        return Err(Error::Recovery.into());
    }
    restore_locked(worker, profile, None, backend).await
}

/// Restore only into the current native-allocated stage. Activation is separate
/// so the host can keep the previous live profile until it can switch views.
pub async fn restore_staged_profile(
    worker: &WorkerHandle,
    profile: &str,
    generation_id: &str,
    backend: &mut impl StagedProfile,
) -> Result<RestoreOutcome, RestoreError> {
    let _lease = worker.acquire_browser_import_lease().await;
    let binding = worker.browser_profile_binding(profile.into()).await?;
    let stage = binding.staged.as_ref().ok_or(Error::Recovery)?;
    if stage.id != generation_id || stage.physical_id != backend.physical_id() {
        return Err(Error::Identity.into());
    }
    restore_locked(worker, profile, Some(generation_id), backend).await
}

/// The host must close all live website views before entering and retain the
/// exclusive lifecycle lease until the refreshed store has been verified.
pub async fn refresh_active_profile(
    worker: &WorkerHandle,
    profile: &str,
    backend: &mut impl StagedProfile,
) -> Result<RestoreOutcome, RestoreError> {
    let _lease = worker.acquire_browser_import_lease().await;
    let binding = worker.browser_profile_binding(profile.into()).await?;
    let active = binding.active.as_ref().ok_or(Error::Recovery)?;
    if binding.staged.is_some() || active.physical_id != backend.physical_id() {
        return Err(Error::Identity.into());
    }
    restore_locked(worker, profile, Some(&active.id), backend).await
}

/// Revalidate a previously activated store against actual native observations
/// after process restart. This never calls apply: mismatches preserve the engine
/// contents and require recovery rather than silently overwriting a live store.
/// The host still owns the account/browser lifecycle lease across this call and
/// subsequent exposure of the selected profile.
pub async fn verify_active_profile(
    worker: &WorkerHandle,
    profile: &str,
    backend: &mut impl StagedProfile,
) -> Result<RestoreOutcome, RestoreError> {
    let _lease = worker.acquire_browser_import_lease().await;
    let binding = worker.browser_profile_binding(profile.into()).await?;
    if binding.staged.is_some() {
        return Err(Error::Recovery.into());
    }
    let active = binding.active.as_ref().ok_or(Error::Recovery)?;
    if active.physical_id != backend.physical_id() {
        return Err(Error::Identity.into());
    }
    let journal = worker.browser_import_journal(profile.into()).await?;
    if journal.quarantined || journal.pending.is_some() {
        return Err(RestoreError::Quarantined);
    }
    let receipt = journal
        .applied
        .as_ref()
        .filter(|receipt| receipt.id == active.id)
        .ok_or(Error::Recovery)?;
    backend
        .prepare_ephemeral(&receipt.credentials)
        .await
        .map_err(RestoreError::Engine)?;
    backend
        .preflight(&receipt.credentials)
        .await
        .map_err(RestoreError::Engine)?;
    let observed = backend
        .readback(&receipt.credentials)
        .await
        .map_err(RestoreError::Engine)?;
    worker
        .finish_browser_import(
            profile.into(),
            journal.revision,
            receipt.id.clone(),
            observed,
        )
        .await?;
    Ok(RestoreOutcome::Applied {
        sequence: receipt.snapshot_sequence,
    })
}

async fn restore_locked(
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
