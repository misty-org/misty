//! The part of the MCP client Misty uses over HTTP: `server/discover`, `tools/list` and `tools/call`
//! on protocol 2026-07-28, as `@modelcontextprotocol/client` sends them. Each request is one signed
//! POST with the version, method and tool name in its headers and the envelope in its `_meta`. The
//! server (go-sdk, stateless, JSON responses) keeps no session. Anything older isn't spoken, because
//! the server's token response names this protocol and `McpRunAccess::check` refuses anything else.
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, PoisonError,
    },
    time::Duration,
};

use super::{
    js_json::JsValue,
    run::schema_check::schema_errors,
    runtime_errors::RuntimeError,
    tool_transport::{object, string},
};

const PROTOCOL: &str = "2026-07-28";
const META_VERSION: &str = "io.modelcontextprotocol/protocolVersion";
const META_CLIENT_INFO: &str = "io.modelcontextprotocol/clientInfo";
const META_CAPABILITIES: &str = "io.modelcontextprotocol/clientCapabilities";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

fn sdk_error(message: impl Into<String>) -> RuntimeError {
    RuntimeError::named("SdkError", message)
}

fn protocol_error(code: i64, message: &str) -> RuntimeError {
    RuntimeError::named("ProtocolError", format!("MCP error {code}: {message}"))
}

fn envelope() -> Vec<(String, JsValue)> {
    vec![
        (META_VERSION.to_owned(), string(PROTOCOL)),
        (META_CLIENT_INFO.to_owned(), object([("name", string("misty-vercel-agent-runtime")), ("version", string("1.0.0"))])),
        (META_CAPABILITIES.to_owned(), JsValue::Object(Vec::new())),
    ]
}

/// One tool from `tools/list`, as the runtime reads it.
#[derive(Clone, Debug)]
pub(crate) struct ListedTool {
    pub(crate) value: JsValue,
    pub(crate) name: String,
}

pub(crate) struct ToolListPage {
    pub(crate) tools: Vec<ListedTool>,
    pub(crate) next_cursor: Option<String>,
}

#[derive(Clone)]
pub(crate) struct McpClient {
    http: reqwest::Client,
    endpoint: String,
    token: String,
    next_id: Arc<AtomicU64>,
    has_tools: bool,
    output_schemas: Arc<Mutex<HashMap<String, JsValue>>>,
}

/// The JSON-RPC answer in a response's body, from JSON or the first data line of an event stream.
fn read_body(content_type: &str, text: &str) -> Result<JsValue, RuntimeError> {
    let essence = content_type.split(';').next().unwrap_or("").trim().to_lowercase();
    let body = match essence.as_str() {
        "application/json" => text.to_owned(),
        "text/event-stream" => text.lines().filter_map(|line| line.strip_prefix("data:")).map(str::trim).find(|data| !data.is_empty()).unwrap_or("").to_owned(),
        _ => return Err(sdk_error(format!("Unexpected content type: {content_type}"))),
    };
    JsValue::parse(&body).ok_or_else(|| RuntimeError::named("SyntaxError", "The tool service sent invalid JSON."))
}

fn rpc_error(error: &JsValue) -> RuntimeError {
    let code = match error.get("code") {
        Some(JsValue::Number(code)) => *code as i64,
        _ => -32603,
    };
    protocol_error(code, error.get("message").and_then(JsValue::as_str).unwrap_or(""))
}

impl McpClient {
    /// `client.connect`: the version probe. A failure is the caller's to close.
    pub(crate) async fn connect(http: reqwest::Client, endpoint: String, token: String) -> Result<Self, RuntimeError> {
        let mut client = Self { http, endpoint, token, next_id: Arc::new(AtomicU64::new(0)), has_tools: false, output_schemas: Arc::default() };
        let discovered = client.request("server/discover", Vec::new(), None).await?;
        let supported = discovered.get("supportedVersions").and_then(JsValue::as_array).unwrap_or_default();
        if !supported.iter().any(|version| version.as_str() == Some(PROTOCOL)) {
            return Err(sdk_error("Version negotiation failed: the server did not offer protocol version 2026-07-28."));
        }
        client.has_tools = discovered.get("capabilities").and_then(|capabilities| capabilities.get("tools")).is_some_and(|tools| !matches!(tools, JsValue::Null | JsValue::Bool(false)));
        Ok(client)
    }

    pub(crate) fn with_token(&self, token: String) -> Self {
        Self { token, ..self.clone() }
    }

    /// What `tools/list` declared; `tools/call` checks structured results against it, as the client's
    /// response cache does, for as long as this client lives.
    pub(crate) fn remember_output_schemas(&self, schemas: HashMap<String, JsValue>) {
        *self.output_schemas.lock().unwrap_or_else(PoisonError::into_inner) = schemas;
    }

    async fn request(&self, method: &str, params: Vec<(String, JsValue)>, name: Option<&str>) -> Result<JsValue, RuntimeError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let mut meta = envelope();
        let mut fields = Vec::new();
        for (key, value) in params {
            // Keys a caller gives win over the envelope, as with the client's own merge.
            if key == "_meta" {
                if let JsValue::Object(given) = value {
                    for (given_key, given_value) in given {
                        meta.retain(|(known, _)| *known != given_key);
                        meta.push((given_key, given_value));
                    }
                }
            } else {
                fields.push((key, value));
            }
        }
        fields.push(("_meta".to_owned(), JsValue::Object(meta)));
        let body = object([("method", string(method)), ("params", JsValue::Object(fields)), ("jsonrpc", string("2.0")), ("id", JsValue::Number(id as f64))]).stringify();
        let mut sending = self
            .http
            .post(&self.endpoint)
            .bearer_auth(&self.token)
            .header("content-type", "application/json")
            .header("accept", "application/json, text/event-stream")
            .header("mcp-protocol-version", PROTOCOL)
            .header("mcp-method", method)
            .timeout(REQUEST_TIMEOUT);
        // A tool's name is plain ASCII; anything else travels only in the body.
        if let Some(name) = name.filter(|name| name.is_ascii()) {
            sending = sending.header("mcp-name", name);
        }
        let response = sending.body(body).send().await.map_err(|error| {
            if error.is_timeout() {
                sdk_error("Request timed out")
            } else {
                RuntimeError::named("TypeError", "fetch failed")
            }
        })?;
        let status = response.status();
        let content_type = response.headers().get("content-type").and_then(|value| value.to_str().ok()).unwrap_or("").to_owned();
        let text = response.text().await.map_err(|_| RuntimeError::named("TypeError", "terminated"))?;
        if status.as_u16() == 401 {
            return Err(RuntimeError::named("UnauthorizedError", "Unauthorized"));
        }
        if !status.is_success() {
            // A modern server may answer 400 with the JSON-RPC error itself.
            if status.as_u16() == 400 {
                if let Some(error) = JsValue::parse(&text).as_ref().and_then(|parsed| parsed.get("error")) {
                    return Err(rpc_error(error));
                }
            }
            return Err(RuntimeError::named("SdkHttpError", format!("Error POSTing to endpoint: {text}")).with_status(status.as_u16()));
        }
        let answer = read_body(&content_type, &text)?;
        if let Some(error) = answer.get("error") {
            return Err(rpc_error(error));
        }
        answer.get("result").cloned().ok_or_else(|| sdk_error("The tool service sent no result."))
    }

    /// `client.listTools`, one page at a time.
    pub(crate) async fn list_tools(&self, cursor: Option<String>) -> Result<ToolListPage, RuntimeError> {
        if !self.has_tools {
            return Ok(ToolListPage { tools: Vec::new(), next_cursor: None });
        }
        let params = cursor.map(|cursor| ("cursor".to_owned(), string(cursor))).into_iter().collect();
        let result = self.request("tools/list", params, None).await?;
        let tools = result
            .get("tools")
            .and_then(JsValue::as_array)
            .unwrap_or_default()
            .iter()
            .filter_map(|tool| Some(ListedTool { name: tool.get("name")?.as_str()?.to_owned(), value: tool.clone() }))
            .collect();
        let next_cursor = result.get("nextCursor").and_then(JsValue::as_str).map(str::to_owned);
        Ok(ToolListPage { tools, next_cursor })
    }

    /// `client.callTool`, with its output-schema check.
    pub(crate) async fn call_tool(&self, name: &str, arguments: JsValue, meta: JsValue) -> Result<JsValue, RuntimeError> {
        let params = vec![("name".to_owned(), string(name)), ("arguments".to_owned(), arguments), ("_meta".to_owned(), meta)];
        let result = self.request("tools/call", params, Some(name)).await?;
        let schema = self.output_schemas.lock().unwrap_or_else(PoisonError::into_inner).get(name).cloned();
        if let Some(schema) = schema {
            let failed = matches!(result.get("isError"), Some(JsValue::Bool(true)));
            if !failed {
                let Some(structured) = result.get("structuredContent") else {
                    return Err(protocol_error(-32600, &format!("Tool {name} has an output schema but did not return structured content")));
                };
                if let Some(problem) = schema_errors(&schema, structured) {
                    return Err(protocol_error(-32602, &format!("Structured content does not match the tool's output schema: {problem}")));
                }
            }
        }
        Ok(result)
    }
}
