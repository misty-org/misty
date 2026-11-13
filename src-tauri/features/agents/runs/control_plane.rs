//! The seam between the run loop and whoever follows its run: `local_run` on the computer, and a
//! fake in the tests.
use futures_util::future::BoxFuture;

use super::{js_json::JsValue, runtime_errors::RuntimeError};

/// Which run this is. Nothing here is a secret or an address: a run belongs to this computer.
#[derive(Clone, Debug)]
pub(crate) struct RuntimeIdentity {
    pub(crate) misty_run_id: String,
    pub(crate) runtime_run_id: String,
}

/// What the run loop asks of whoever follows it. Tests stand in for it.
pub(crate) trait ControlPlane: Send + Sync {
    fn request<'a>(&'a self, identity: &'a RuntimeIdentity, action: &'static str, payload: JsValue, idempotency_key: String) -> BoxFuture<'a, Result<JsValue, RuntimeError>>;
}
