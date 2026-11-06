//! Failures of the tool service's transport: which are worth retrying, and what they mean.
use super::runtime_errors::RuntimeError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct McpTransportFailure {
    pub(crate) code: &'static str,
    pub(crate) message: &'static str,
    pub(crate) transient: bool,
    pub(crate) recognized: bool,
    pub(crate) retry_after_ms: u64,
}

pub(crate) fn classify_mcp_transport_error(error: &RuntimeError) -> McpTransportFailure {
    if error.name() == "ProtocolError" {
        let unavailable = error.to_string().to_lowercase().contains("unknown tool");
        return McpTransportFailure {
            code: if unavailable { "tool_unavailable" } else { "mcp_protocol_error" },
            message: if unavailable { "That tool is not available for this run." } else { "Misty's tool service rejected the request protocol." },
            transient: false,
            recognized: true,
            retry_after_ms: 0,
        };
    }
    let status = error.status().unwrap_or(0);
    if error.name() == "SdkHttpError" || (400..=599).contains(&status) {
        let transient = status == 408 || status == 429 || status >= 500;
        let denied = status == 401 || status == 403;
        return McpTransportFailure {
            code: if status == 429 {
                "rate_limited"
            } else if transient {
                "tool_service_unavailable"
            } else if denied {
                "permission_denied"
            } else {
                "mcp_transport_error"
            },
            message: if status == 429 {
                "Misty's tool service is busy. Please try again shortly."
            } else if transient {
                "Misty's tool service is temporarily unavailable."
            } else if denied {
                "This run is no longer authorized to use that tool."
            } else {
                "Misty's tool service rejected the request."
            },
            transient,
            recognized: true,
            retry_after_ms: if status == 429 { 5_000 } else { 1_000 },
        };
    }
    McpTransportFailure {
        code: "tool_transport_failed",
        message: "Misty could not reach its tool service.",
        transient: true,
        recognized: false,
        retry_after_ms: 1_000,
    }
}
