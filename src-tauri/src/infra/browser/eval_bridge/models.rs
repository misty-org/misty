//! What this device's agents run on, for the Odysseys benchmark's report (debug builds only;
//! docs/agents/evals/odysseys.md): the same document the agent runtime gets, without its keys.
use super::*;

/// The model of each role, the reasoning and the web search provider.
pub(super) async fn models(
    AxumState(bridge): AxumState<Bridge>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if let Err(response) = request::<Value>(&bridge, &headers, &body) {
        return response;
    }
    let document = crate::infra::models::current_document(&bridge.app).await;
    reply(Ok(without_keys(document.as_ref())))
}

/// Only names known to carry no secret are copied; providers and their keys never are.
fn without_keys(document: Option<&Value>) -> Value {
    let field = |pointer: &str| {
        document
            .and_then(|document| document.pointer(pointer))
            .cloned()
            .unwrap_or(Value::Null)
    };
    json!({
        "models": field("/models"),
        "reasoning": field("/reasoning"),
        "search": field("/search/provider"),
    })
}

#[cfg(test)]
mod tests {
    use super::without_keys;
    use serde_json::json;

    #[test]
    fn the_report_never_gets_a_key() {
        let document = json!({
            "version": 1,
            "providers": { "anthropic": { "apiKey": "sk-secret" } },
            "models": { "agent": "anthropic/model" },
            "reasoning": "low",
            "search": { "provider": "serper", "apiKey": "search-secret" },
        });
        let reply = without_keys(Some(&document));
        assert!(!reply.to_string().contains("secret"));
        assert_eq!(reply["models"]["agent"], "anthropic/model");
        assert_eq!(reply["search"], "serper");
    }

    #[test]
    fn no_document_is_no_models() {
        assert!(without_keys(None)["models"].is_null());
    }
}
