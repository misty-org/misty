//! Where a run's tool service answers. Ported from `mcp-endpoint.ts`.
use super::runtime_errors::RuntimeError;

pub(crate) fn resolve_mcp_endpoint(control_plane_url: &str, mcp_path: &str) -> Result<String, RuntimeError> {
    if !mcp_path.starts_with('/') {
        return Err(RuntimeError::error("Misty returned an invalid MCP path"));
    }
    let mut base = url::Url::parse(control_plane_url).map_err(|_| RuntimeError::named("TypeError", "Invalid URL"))?;
    base.set_path(&format!("{}/", base.path().trim_end_matches('/')));
    let joined = base.join(mcp_path.trim_start_matches('/')).map_err(|_| RuntimeError::named("TypeError", "Invalid URL"))?;
    Ok(joined.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_a_public_reverse_proxy_path_prefix() {
        assert_eq!(resolve_mcp_endpoint("https://misty.example.com/api", "/mcp").unwrap(), "https://misty.example.com/api/mcp");
    }

    #[test]
    fn resolves_the_local_direct_api_endpoint() {
        assert_eq!(resolve_mcp_endpoint("http://misty-api:8080", "/mcp").unwrap(), "http://misty-api:8080/mcp");
    }

    #[test]
    fn rejects_a_non_rooted_path_from_the_token_response() {
        assert!(resolve_mcp_endpoint("https://misty.example.com/api", "mcp").unwrap_err().to_string().contains("invalid MCP path"));
    }
}
