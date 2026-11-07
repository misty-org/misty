//! Activates the run, reads its context, and answers a lesson step without the agent loop.
use std::sync::{atomic::AtomicI64, Arc, Mutex};

use crate::runtime::{
    control_plane::RuntimeIdentity,
    control_plane_steps::{activate_runtime, fetch_context, HarnessCompletion},
    document_ids::DocumentIds,
    js_json::JsValue,
    ledger::{ledger_from_prompt, Ledger},
    runtime_errors::{classify_runtime_error, RuntimeError},
    teach_turn::run_teach_turn,
};

use super::{
    agent_run::{FinishState, RunShared},
    context::SpaceTaskContext,
    deps::RunDeps,
    space_task_agent::RunResult,
    state::restored_ledger,
    store::{StoredRun, STORE_VERSION},
};

pub(crate) enum RunStart {
    Agent(Arc<RunShared>),
    Done(RunResult),
}

pub(crate) fn identity_of(stored: &StoredRun) -> RuntimeIdentity {
    RuntimeIdentity {
        misty_run_id: stored.misty_run_id.clone(),
        runtime_run_id: stored.runtime_run_id.clone(),
    }
}

pub(crate) fn new_stored(identity: &RuntimeIdentity) -> StoredRun {
    StoredRun {
        version: STORE_VERSION,
        misty_run_id: identity.misty_run_id.clone(),
        runtime_run_id: identity.runtime_run_id.clone(),
        context: None,
        state: None,
    }
}

fn shared_of(deps: Arc<RunDeps>, identity: RuntimeIdentity, context: SpaceTaskContext, stored: &StoredRun) -> Result<Arc<RunShared>, RuntimeError> {
    let (ledger, documents, finish, rejected) = match &stored.state {
        Some(state) => (
            restored_ledger(&state.ledger).ok_or_else(|| RuntimeError::error("run_store_unreadable: the saved ledger no longer reads"))?,
            DocumentIds::restored(state.documents_latest.clone(), state.documents_issued.clone()),
            FinishState { verified: state.verified, persisted: state.persisted, persisted_at: state.persisted_at.clone(), reported_only: state.reported_only },
            state.rejected.clone(),
        ),
        None => (Ledger::new(ledger_from_prompt(&context.prompt)), DocumentIds::default(), FinishState::default(), Default::default()),
    };
    Ok(Arc::new(RunShared {
        identity,
        context,
        deps,
        rejected: Arc::new(Mutex::new(rejected)),
        documents: Mutex::new(documents),
        ledger: Mutex::new(ledger),
        finish: Mutex::new(finish),
        model_turn: AtomicI64::new(0),
        limit: AtomicI64::new(0),
    }))
}

/// A fresh run asks for its context; a resumed one has it, and the models it started with. A run that
/// can't read its context still reports the failure, and a lesson step ends here.
pub(crate) async fn start_run(deps: Arc<RunDeps>, stored: &mut StoredRun) -> Result<RunStart, RuntimeError> {
    let identity = identity_of(stored);
    let context = match stored.context.as_deref().and_then(JsValue::parse) {
        Some(saved) => saved,
        None => {
            activate_runtime(deps.control.as_ref(), &identity).await?;
            let fetched = match fetch_context(deps.control.as_ref(), deps.device.as_ref(), &identity).await {
                Ok(context) => context,
                Err(error) => {
                    let failure = classify_runtime_error(&error);
                    let failed = HarnessCompletion::ended("failed", "", failure.code, failure.message);
                    crate::runtime::control_plane_steps::complete(deps.control.as_ref(), deps.device.as_ref(), &identity, &failed, None, None).await?;
                    return Err(error);
                }
            };
            stored.context = Some(fetched.stringify());
            let saved = stored.clone();
            let store = deps.store.clone();
            tokio::task::spawn_blocking(move || store.save(&saved)).await.map_err(|_| RuntimeError::error("run_store_failed"))?.map_err(|_| RuntimeError::error("run_store_failed"))?;
            fetched
        }
    };
    let context = SpaceTaskContext::from_json(context);
    let shared = shared_of(deps, identity, context, stored)?;
    if !shared.context.teach {
        return Ok(RunStart::Agent(shared));
    }
    // A lesson step: one streamed call, no tools (teach_turn.rs).
    match run_teach_turn(&shared).await {
        Ok(completion) => {
            shared.finish_run(&completion).await?;
            Ok(RunStart::Done(RunResult { incomplete: completion.status != "success", text: completion.text, steps: 1 }))
        }
        Err(error) => {
            let failure = classify_runtime_error(&error);
            shared.finish_run(&HarnessCompletion::ended("failed", "", failure.code, failure.message)).await?;
            Err(RuntimeError::named("FatalError", failure.message))
        }
    }
}
