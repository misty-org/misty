//! A run's calls to Misty's tool service. Ported from `mcp-runtime.ts`.
use std::collections::HashMap;

use futures_util::future::BoxFuture;

use crate::sdk::RawJson;

use super::{
    clock::now_ms,
    control_plane::{ControlPlane, RuntimeIdentity},
    js_json::JsValue,
    mcp_client::{ListedTool, ToolListPage},
    mcp_sessions::{McpRunAccess, McpSessions},
    model_tools::McpRemoteTool,
    run::step::step,
    runtime_errors::{rethrow_step_error, RuntimeError, StepFailure},
    text::js_prefix,
    tool_discovery::{collect_tool_pages, ToolPage},
    tool_execution::ToolExecutionResponse,
    tool_schema::normalize_tool_input_schema,
    tool_transport::{object, string},
};

/// What the run asks of the tool service. Tests stand in for it.
pub(crate) trait McpGateway: Send + Sync {
    fn discover<'a>(&'a self, identity: &'a RuntimeIdentity, control: &'a dyn ControlPlane) -> BoxFuture<'a, Result<Vec<McpRemoteTool>, RuntimeError>>;
    /// `requestMCPToolExecution`.
    fn call<'a>(&'a self, call: McpCall<'a>) -> BoxFuture<'a, Result<ToolExecutionResponse, RuntimeError>>;
    /// A bearer still good for a while, so the call skips the exchange.
    fn cached_access(&self, identity: &RuntimeIdentity) -> Option<McpRunAccess>;
    fn close(&self, identity: &RuntimeIdentity);
}

pub(crate) struct McpCall<'a> {
    pub(crate) identity: &'a RuntimeIdentity,
    pub(crate) access: McpRunAccess,
    pub(crate) call_id: &'a str,
    pub(crate) name: &'a str,
    pub(crate) input: &'a JsValue,
    pub(crate) device_hook_token: &'a str,
    pub(crate) call_meta: Vec<(String, JsValue)>,
}

pub(crate) struct HttpMcpGateway {
    pub(crate) http: reqwest::Client,
    pub(crate) sessions: McpSessions,
}

fn describe(tool: &ListedTool) -> McpRemoteTool {
    let value = &tool.value;
    let read_only = value.get("annotations").and_then(|annotations| annotations.get("readOnlyHint")) == Some(&JsValue::Bool(true));
    let locality = value.get("_meta").and_then(|meta| meta.get("misty/locality")).and_then(JsValue::as_str);
    let nonempty = |name: &str| value.get(name).and_then(JsValue::as_str).filter(|text| !text.is_empty());
    let description = nonempty("description").or(nonempty("title")).unwrap_or(&tool.name);
    let schema = value.get("inputSchema").map_or_else(|| "{}".to_owned(), JsValue::stringify);
    let schema = RawJson::from_text(schema).unwrap_or_else(|_| RawJson::empty_object());
    McpRemoteTool {
        name: tool.name.clone(),
        description: js_prefix(description, 2_000).to_owned(),
        input_schema: normalize_tool_input_schema(&schema),
        read_only,
        // Device tools and anything that waits for the person stay serial: a run holds one durable
        // wait at a time.
        concurrent: read_only && matches!(locality, Some("server" | "provider")) && tool.name != "browser.request_user_action",
        local: false,
    }
}

impl HttpMcpGateway {
    async fn discover_once(&self, identity: &RuntimeIdentity, control: &dyn ControlPlane) -> Result<Vec<McpRemoteTool>, StepFailure> {
        let token = control
            .request(identity, "mcp-token", object([("intervention_wait_version", JsValue::Number(1.0))]), format!("{}:mcp-list", identity.misty_run_id))
            .await
            .map_err(rethrow_step_error)?;
        let access = McpRunAccess::from_json(&token);
        access.check().map_err(StepFailure::Unrecognized)?;
        // The run's first tool calls reuse this bearer and connection.
        self.sessions.remember_run_access(&identity.misty_run_id, &identity.control_plane_url, access, now_ms()).map_err(StepFailure::Unrecognized)?;
        let close = |error: RuntimeError| {
            self.sessions.close_run_session(&identity.misty_run_id, &identity.control_plane_url);
            StepFailure::Unrecognized(error)
        };
        let client = self.sessions.run_client(&self.http, &identity.misty_run_id, &identity.control_plane_url, now_ms()).await.map_err(close)?;
        let listing = collect_tool_pages(
            |cursor| {
                let client = client.clone();
                async move {
                    let ToolListPage { tools, next_cursor } = client.list_tools(cursor).await?;
                    Ok(ToolPage { tools, next_cursor })
                }
            },
            |tool: &ListedTool| tool.name.as_str(),
        )
        .await
        .map_err(close)?;
        let schemas: HashMap<String, JsValue> = listing.iter().filter_map(|tool| Some((tool.name.clone(), tool.value.get("outputSchema")?.clone()))).collect();
        client.remember_output_schemas(schemas);
        Ok(listing.iter().map(describe).collect())
    }
}

/// Reads the answer to one `tools/call`.
pub(crate) fn read_call_response(response: &JsValue) -> ToolExecutionResponse {
    let meta = response.get("_meta");
    let device_wait = meta.and_then(|meta| meta.get("misty/device_wait")) == Some(&JsValue::Bool(true));
    let intervention = meta.and_then(|meta| meta.get("misty/intervention_wait")).filter(|wait| truthy(wait));
    let is_error = response.get("isError").is_some_and(truthy);
    let structured = response.get("structuredContent");
    let wait_count = usize::from(device_wait) + usize::from(intervention.is_some());
    if wait_count > 1 || (wait_count > 0 && (is_error || structured.is_some())) {
        return ToolExecutionResponse::tool_error("invalid_tool_outcome", "The tool returned contradictory wait or completion outcomes.");
    }
    if let Some(wait) = intervention {
        return ToolExecutionResponse { intervention_wait: Some(wait.clone()), ..ToolExecutionResponse::default() };
    }
    if device_wait {
        return ToolExecutionResponse { device_wait: Some(JsValue::Bool(true)), ..ToolExecutionResponse::default() };
    }
    let content = response.get("content").and_then(JsValue::as_array).unwrap_or_default();
    let is_text = |item: &&JsValue| item.get("type").and_then(JsValue::as_str) == Some("text");
    if is_error {
        let detail: Vec<&str> = content.iter().filter(is_text).filter_map(|item| item.get("text").and_then(JsValue::as_str)).collect();
        let detail = detail.join("; ");
        let detail = js_prefix(&detail, 500);
        let message = if detail.is_empty() { "Misty could not complete this tool call." } else { detail };
        return ToolExecutionResponse::tool_error("tool_execution_failed", message);
    }
    if let Some(structured) = structured {
        return ToolExecutionResponse::result(structured.clone());
    }
    let text = content.iter().find(|item| is_text(item)).and_then(|item| item.get("text")).and_then(JsValue::as_str).filter(|text| !text.is_empty());
    let Some(text) = text else {
        return ToolExecutionResponse::tool_error("missing_tool_result", "The provider returned no execution result.");
    };
    ToolExecutionResponse::result(JsValue::parse(text).unwrap_or_else(|| string(text)))
}

fn truthy(value: &JsValue) -> bool {
    match value {
        JsValue::Null => false,
        JsValue::Bool(value) => *value,
        JsValue::Number(value) => *value != 0.0 && !value.is_nan(),
        JsValue::String(text) => !text.is_empty(),
        JsValue::Array(_) | JsValue::Object(_) => true,
    }
}

impl McpGateway for HttpMcpGateway {
    fn discover<'a>(&'a self, identity: &'a RuntimeIdentity, control: &'a dyn ControlPlane) -> BoxFuture<'a, Result<Vec<McpRemoteTool>, RuntimeError>> {
        Box::pin(step("discoverRemoteMCPTools", 2, move || self.discover_once(identity, control)))
    }

    fn call<'a>(&'a self, call: McpCall<'a>) -> BoxFuture<'a, Result<ToolExecutionResponse, RuntimeError>> {
        Box::pin(async move {
            let McpCall { identity, access, call_id, name, input, device_hook_token, call_meta } = call;
            access.check()?;
            let (run_id, base) = (identity.misty_run_id.as_str(), identity.control_plane_url.as_str());
            self.sessions.remember_run_access(run_id, base, access, now_ms())?;
            let client = self.sessions.run_client(&self.http, run_id, base, now_ms()).await?;
            let mut meta = vec![("misty/call_id".to_owned(), string(call_id)), ("misty/device_hook_token".to_owned(), string(device_hook_token))];
            meta.extend(call_meta);
            let response = client.call_tool(name, input.clone(), JsValue::Object(meta)).await.inspect_err(|_| {
                // Never reuse a session whose connection or bearer failed mid-call; the next call
                // exchanges a new bearer and connects again.
                self.sessions.close_run_session(run_id, base);
            })?;
            Ok(read_call_response(&response))
        })
    }

    fn cached_access(&self, identity: &RuntimeIdentity) -> Option<McpRunAccess> {
        self.sessions.cached_run_access(&identity.misty_run_id, &identity.control_plane_url, now_ms())
    }

    fn close(&self, identity: &RuntimeIdentity) {
        self.sessions.close_run_session(&identity.misty_run_id, &identity.control_plane_url);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(text: &str) -> ToolExecutionResponse {
        read_call_response(&JsValue::parse(text).unwrap())
    }

    #[test]
    fn reads_each_outcome_of_a_call() {
        assert_eq!(read(r#"{"structuredContent":{"b":1,"a":2},"content":[]}"#).result.unwrap().stringify(), r#"{"b":1,"a":2}"#);
        assert_eq!(read(r#"{"content":[{"type":"text","text":"{\"ok\":true}"}]}"#).result.unwrap().stringify(), r#"{"ok":true}"#);
        assert_eq!(read(r#"{"content":[{"type":"text","text":"plain"}]}"#).result.unwrap().stringify(), r#""plain""#);
        assert_eq!(read(r#"{"_meta":{"misty/device_wait":true},"content":[]}"#).device_wait, Some(JsValue::Bool(true)));
        assert!(read(r#"{"_meta":{"misty/intervention_wait":{"id":"w","action":"review","reason":"r"}},"content":[]}"#).intervention_wait.is_some());
    }

    #[test]
    fn failures_and_contradictions_become_tool_errors() {
        let code = |text: &str| read(text).tool_error.unwrap().get("code").unwrap().as_str().unwrap().to_owned();
        assert_eq!(code(r#"{"isError":true,"content":[{"type":"text","text":"no"}]}"#), "tool_execution_failed");
        assert_eq!(read(r#"{"isError":true,"content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}"#).tool_error.unwrap().get("message").unwrap().as_str(), Some("a; b"));
        assert_eq!(code(r#"{"content":[]}"#), "missing_tool_result");
        assert_eq!(code(r#"{"_meta":{"misty/device_wait":true},"structuredContent":{}}"#), "invalid_tool_outcome");
    }

    #[test]
    fn describes_a_tool_for_the_model() {
        let tool = ListedTool {
            name: "note.read".to_owned(),
            value: JsValue::parse(r#"{"name":"note.read","title":"Read","inputSchema":{"type":"object","oneOf":[]},"annotations":{"readOnlyHint":true},"_meta":{"misty/locality":"server"}}"#).unwrap(),
        };
        let described = describe(&tool);
        assert_eq!(described.description, "Read");
        assert_eq!(described.input_schema.get(), r#"{"type":"object"}"#);
        assert!(described.read_only && described.concurrent);
    }
}
