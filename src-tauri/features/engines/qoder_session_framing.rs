//! ACP framing for the Qoder driver: decoding one JSON-RPC line into a response, a notification
//! or an agent-initiated request, and building the frames the client writes back.

use serde_json::{json, Value};

use super::JSONRPC_INTERNAL_ERROR;

/// Routes the lines of one in-flight request that are not its response:
/// `session/update` notifications and agent-initiated requests. Returning
/// `Some` writes that frame back to the CLI; `None` means the driver has
/// taken the line over — a question parked for the user must stay
/// unanswered until the answer command posts its response.
pub(crate) type LineRouter<'a> = dyn FnMut(&AcpLine) -> Option<Value> + Send + 'a;

#[derive(Debug)]
pub(crate) enum AcpLine {
    Response {
        id: Value,
        result: Option<Value>,
        error: Option<AcpRpcError>,
    },
    Notification {
        method: String,
        params: Value,
    },
    AgentRequest {
        id: Value,
        method: String,
        params: Value,
    },
    Other,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AcpRpcError {
    pub code: i64,
    pub message: String,
}

pub(crate) fn jsonrpc_id_key(id: &Value) -> Option<String> {
    match id {
        Value::Number(n) => Some(n.to_string()),
        Value::String(s) => Some(s.clone()),
        _ => None,
    }
}

pub(crate) fn parse_acp_line(value: &Value) -> AcpLine {
    if value.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
        && value.get("method").is_none()
        && value.get("id").is_none()
    {
        return AcpLine::Other;
    }
    let method = value.get("method").and_then(Value::as_str);
    let id = value.get("id").cloned().filter(|id| !id.is_null());
    let params = value.get("params").cloned().unwrap_or(Value::Null);
    if let Some(method) = method {
        if let Some(id) = id {
            return AcpLine::AgentRequest {
                id,
                method: method.to_string(),
                params,
            };
        }
        return AcpLine::Notification {
            method: method.to_string(),
            params,
        };
    }
    if let Some(id) = id {
        let error = value.get("error").map(|err| {
            let code = err
                .get("code")
                .and_then(Value::as_i64)
                .unwrap_or(JSONRPC_INTERNAL_ERROR);
            let mut message = err
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("JSON-RPC error")
                .to_string();
            if let Some(detail) = err
                .get("data")
                .and_then(|data| data.get("details").or_else(|| data.get("message")))
                .and_then(Value::as_str)
                .and_then(|detail| detail.lines().next())
                .map(str::trim)
                .filter(|detail| !detail.is_empty() && !message.contains(detail))
            {
                message.push_str(": ");
                message.extend(detail.chars().take(512));
            }
            let message = crate::engines::reader::redact_secrets(&message);
            AcpRpcError { code, message }
        });
        return AcpLine::Response {
            id,
            result: value.get("result").cloned(),
            error,
        };
    }
    AcpLine::Other
}

pub(crate) fn jsonrpc_request(id: u64, method: &str, params: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params,
    })
}

pub(crate) fn jsonrpc_notification(method: &str, params: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
    })
}

pub(crate) fn jsonrpc_error_response(id: &Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message },
    })
}

pub(crate) fn jsonrpc_result_response(id: &Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    })
}

pub(crate) fn encode_ndjson(value: &Value) -> Result<Vec<u8>, String> {
    let mut bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    bytes.push(b'\n');
    Ok(bytes)
}
