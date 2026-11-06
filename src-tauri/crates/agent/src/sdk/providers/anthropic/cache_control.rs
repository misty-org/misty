//! Where prompt caching breakpoints are allowed. Ported from `get-cache-control.ts`.
use serde_json::{json, Value};

use crate::sdk::prompt::ProviderOptions;

/// Anthropic allows four cache breakpoints in a request.
const MAX_CACHE_BREAKPOINTS: u32 = 4;

/// Counts breakpoints across a request, so a fifth one is dropped rather than refused by the API.
#[derive(Default)]
pub(super) struct CacheControlValidator {
    count: u32,
    warnings: Vec<Value>,
}

impl CacheControlValidator {
    pub(super) fn get(&mut self, options: Option<&ProviderOptions>, kind: &str, can_cache: bool) -> Option<Value> {
        let anthropic = options?.get("anthropic")?;
        let value = anthropic
            .get("cacheControl")
            .filter(|value| !value.is_null())
            .or_else(|| anthropic.get("cache_control"))?;
        // The SDK tests truthiness here.
        let falsy = value.is_null()
            || value == &Value::Bool(false)
            || value.as_str() == Some("")
            || value.as_f64() == Some(0.0);
        if falsy {
            return None;
        }
        if !can_cache {
            self.warnings.push(json!({
                "type": "unsupported",
                "feature": "cache_control on non-cacheable context",
                "details": format!("cache_control cannot be set on {kind}. It will be ignored."),
            }));
            return None;
        }
        self.count += 1;
        if self.count > MAX_CACHE_BREAKPOINTS {
            self.warnings.push(json!({
                "type": "unsupported",
                "feature": "cacheControl breakpoint limit",
                "details": format!(
                    "Maximum {MAX_CACHE_BREAKPOINTS} cache breakpoints exceeded (found {}). This breakpoint will be ignored.",
                    self.count
                ),
            }));
            return None;
        }
        Some(value.clone())
    }

    pub(super) fn into_warnings(self) -> Vec<Value> {
        self.warnings
    }
}
