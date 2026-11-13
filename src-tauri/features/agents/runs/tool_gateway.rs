//! The seam for a tool the run doesn't run itself and the computer's tool host doesn't take. On a real
//! run this is `local_run::LocalGateway`, which gives the catalog and turns any such call down. Tests
//! stand in for it to script what tools answer, waits included.
use futures_util::future::BoxFuture;

use super::{
    control_plane::RuntimeIdentity,
    js_json::JsValue,
    model_tools::CatalogTool,
    runtime_errors::RuntimeError,
    tool_execution::ToolExecutionResponse,
};

pub(crate) trait ToolGateway: Send + Sync {
    fn discover<'a>(&'a self, identity: &'a RuntimeIdentity) -> BoxFuture<'a, Result<Vec<CatalogTool>, RuntimeError>>;
    fn call<'a>(&'a self, call: GatewayCall<'a>) -> BoxFuture<'a, Result<ToolExecutionResponse, RuntimeError>>;
}

/// A call the run's own tools don't take. On this computer the gateway refuses it
/// (`LocalGateway`); the tests' gateways read what reached them.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) struct GatewayCall<'a> {
    pub(crate) call_id: &'a str,
    pub(crate) name: &'a str,
    pub(crate) input: &'a JsValue,
    pub(crate) device_hook_token: &'a str,
}
