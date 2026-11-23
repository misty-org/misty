use futures_util::future::BoxFuture;

use super::{js_json::JsValue, runtime_errors::RuntimeError};

#[derive(Clone, Debug)]
pub(crate) struct RuntimeIdentity {
    pub(crate) misty_run_id: String,
    pub(crate) runtime_run_id: String,
}

pub(crate) trait ControlPlane: Send + Sync {
    fn request<'a>(
        &'a self,
        identity: &'a RuntimeIdentity,
        action: &'static str,
        payload: JsValue,
        idempotency_key: String,
    ) -> BoxFuture<'a, Result<JsValue, RuntimeError>>;
}
