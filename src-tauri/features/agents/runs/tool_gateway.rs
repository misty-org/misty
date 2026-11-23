use futures_util::future::BoxFuture;

use super::{
    control_plane::RuntimeIdentity, js_json::JsValue, model_tools::CatalogTool,
    runtime_errors::RuntimeError, tool_execution::ToolExecutionResponse,
};

pub(crate) trait ToolGateway: Send + Sync {
    fn discover<'a>(
        &'a self,
        identity: &'a RuntimeIdentity,
    ) -> BoxFuture<'a, Result<Vec<CatalogTool>, RuntimeError>>;
    fn call<'a>(
        &'a self,
        call: GatewayCall<'a>,
    ) -> BoxFuture<'a, Result<ToolExecutionResponse, RuntimeError>>;
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) struct GatewayCall<'a> {
    pub(crate) call_id: &'a str,
    pub(crate) name: &'a str,
    pub(crate) input: &'a JsValue,
    pub(crate) device_hook_token: &'a str,
}
