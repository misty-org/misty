// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.

use super::source_spec;
use crate::engine_config::mcp::{McpConfigEntry, McpError};

pub(crate) fn write_enabled(
    source_id: &str,
    _name: &str,
    _enabled: bool,
    _expected_version: &str,
    _workspace: Option<&str>,
) -> Result<McpConfigEntry, McpError> {
    let spec = source_spec(source_id).ok_or_else(|| McpError::invalid("unknown MCP source"))?;
    if !spec.writable {
        return Err(McpError::new(
            "readonly",
            spec.readonly_reason
                .or(spec.readonly_reason_code)
                .unwrap_or("this MCP source is read-only"),
        ));
    }
    Err(McpError::new(
        "readonly",
        "this MCP source is read-only in the current build",
    ))
}
