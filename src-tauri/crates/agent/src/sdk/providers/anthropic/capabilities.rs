//! What each Claude model can do, and how `reasoning` maps onto it. Ported from `getModelCapabilities`
//! and `resolveAnthropicReasoningConfig` in `@ai-sdk/anthropic`.
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Capabilities {
    pub max_output_tokens: u64,
    pub supports_structured_output: bool,
    pub supports_adaptive_thinking: bool,
    pub rejects_sampling_parameters: bool,
    pub supports_xhigh_effort: bool,
    pub rejects_thinking_disabled_above_high_effort: bool,
    pub is_known_model: bool,
}

const CONSERVATIVE: Capabilities = Capabilities {
    max_output_tokens: 4096,
    supports_structured_output: false,
    supports_adaptive_thinking: false,
    rejects_sampling_parameters: false,
    supports_xhigh_effort: false,
    rejects_thinking_disabled_above_high_effort: false,
    is_known_model: true,
};

/// `claude-instant`, `claude-2` or `claude-3`, which the SDK treats as no longer known.
fn is_legacy_claude(model: &str) -> bool {
    model.match_indices("claude-").any(|(at, prefix)| {
        let rest = &model[at + prefix.len()..];
        let instant = rest
            .strip_prefix("instant")
            .is_some_and(|after| after.is_empty() || after.starts_with('-'));
        let two = rest
            .strip_prefix("v2")
            .or_else(|| rest.strip_prefix('2'))
            .is_some_and(|after| after.is_empty() || after.starts_with(['-', '.', ':']));
        let three = rest
            .strip_prefix('3')
            .is_some_and(|after| after.is_empty() || after.starts_with(['-', '.']));
        instant || two || three
    })
}

pub(super) fn get_model_capabilities(model: &str) -> Capabilities {
    let has = |name: &str| model.contains(name);
    if has("claude-opus-5") {
        Capabilities {
            max_output_tokens: 128_000,
            supports_structured_output: true,
            supports_adaptive_thinking: true,
            rejects_sampling_parameters: true,
            supports_xhigh_effort: true,
            rejects_thinking_disabled_above_high_effort: true,
            is_known_model: true,
        }
    } else if has("claude-opus-4-8") || has("claude-opus-4-7") || has("claude-fable-5") || has("claude-sonnet-5") {
        Capabilities {
            max_output_tokens: 128_000,
            supports_structured_output: true,
            supports_adaptive_thinking: true,
            rejects_sampling_parameters: true,
            supports_xhigh_effort: true,
            ..CONSERVATIVE
        }
    } else if has("claude-sonnet-4-6") || has("claude-opus-4-6") {
        Capabilities {
            max_output_tokens: 128_000,
            supports_structured_output: true,
            supports_adaptive_thinking: true,
            ..CONSERVATIVE
        }
    } else if has("claude-sonnet-4-5") || has("claude-opus-4-5") || has("claude-haiku-4-5") {
        Capabilities { max_output_tokens: 64_000, supports_structured_output: true, ..CONSERVATIVE }
    } else if has("claude-opus-4-1") {
        Capabilities { max_output_tokens: 32_000, supports_structured_output: true, ..CONSERVATIVE }
    } else if has("claude-sonnet-4-") {
        Capabilities { max_output_tokens: 64_000, ..CONSERVATIVE }
    } else if has("claude-opus-4-") {
        Capabilities { max_output_tokens: 32_000, ..CONSERVATIVE }
    } else if has("claude-3-haiku") {
        CONSERVATIVE
    } else if is_legacy_claude(model) {
        Capabilities { is_known_model: false, ..CONSERVATIVE }
    } else if has("claude-") {
        // Known and legacy families are handled above, so any other Claude ID is newer than the
        // list. It stays unknown so callers still get the maxOutputTokens warning.
        Capabilities {
            max_output_tokens: 128_000,
            supports_structured_output: true,
            supports_adaptive_thinking: true,
            rejects_sampling_parameters: true,
            supports_xhigh_effort: true,
            rejects_thinking_disabled_above_high_effort: true,
            is_known_model: false,
        }
    } else {
        // Models served through Anthropic-compatible APIs keep conservative defaults.
        Capabilities { is_known_model: false, ..CONSERVATIVE }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(super) enum Thinking {
    Disabled,
    Adaptive,
    Enabled { budget_tokens: u64 },
}

#[derive(Debug, PartialEq)]
pub(super) struct ReasoningConfig {
    pub thinking: Thinking,
    pub effort: Option<&'static str>,
}

fn unsupported_level(reasoning: &str, warnings: &mut Vec<Value>) {
    warnings.push(json!({
        "type": "unsupported",
        "feature": "reasoning",
        "details": format!("reasoning \"{reasoning}\" is not supported by this model."),
    }));
}

/// A model that thinks on its own takes an effort; older ones take a share of their output tokens.
pub(super) fn resolve_reasoning(
    reasoning: &str,
    capabilities: &Capabilities,
    warnings: &mut Vec<Value>,
) -> Option<ReasoningConfig> {
    if reasoning == "none" {
        return Some(ReasoningConfig { thinking: Thinking::Disabled, effort: None });
    }
    if capabilities.supports_adaptive_thinking {
        let effort = match reasoning {
            "minimal" | "low" => Some("low"),
            "medium" => Some("medium"),
            "high" => Some("high"),
            "xhigh" => Some(if capabilities.supports_xhigh_effort { "xhigh" } else { "max" }),
            _ => None,
        };
        match effort {
            None => unsupported_level(reasoning, warnings),
            Some(mapped) if mapped != reasoning => warnings.push(json!({
                "type": "compatibility",
                "feature": "reasoning",
                "details": format!(
                    "reasoning \"{reasoning}\" is not directly supported by this model. mapped to effort \"{mapped}\"."
                ),
            })),
            Some(_) => {}
        }
        return Some(ReasoningConfig { thinking: Thinking::Adaptive, effort });
    }
    let share = match reasoning {
        "minimal" => 0.02,
        "low" => 0.1,
        "medium" => 0.3,
        "high" => 0.6,
        "xhigh" => 0.9,
        _ => {
            unsupported_level(reasoning, warnings);
            return None;
        }
    };
    let maximum = capabilities.max_output_tokens;
    let budget_tokens = ((maximum as f64 * share).round() as u64).max(1024).min(maximum);
    Some(ReasoningConfig { thinking: Thinking::Enabled { budget_tokens }, effort: None })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn families_get_their_limits() {
        assert_eq!(get_model_capabilities("claude-opus-5-5").max_output_tokens, 128_000);
        assert!(get_model_capabilities("claude-opus-5-5").rejects_thinking_disabled_above_high_effort);
        assert!(!get_model_capabilities("claude-sonnet-5").rejects_thinking_disabled_above_high_effort);
        assert!(!get_model_capabilities("claude-sonnet-4-6").rejects_sampling_parameters);
        assert!(!get_model_capabilities("claude-haiku-4-5").supports_adaptive_thinking);
        assert_eq!(get_model_capabilities("claude-opus-4-1-20250805").max_output_tokens, 32_000);
        assert!(!get_model_capabilities("claude-sonnet-4-0").supports_structured_output);
        assert_eq!(get_model_capabilities("claude-3-haiku-20240307").max_output_tokens, 4096);
        assert!(get_model_capabilities("claude-3-haiku-20240307").is_known_model);
    }

    #[test]
    fn legacy_and_unknown_names_are_not_known_models() {
        for legacy in ["claude-3-5-sonnet", "claude-3", "claude-2.1", "claude-v2:1", "claude-instant-1", "claude-instant"] {
            let found = get_model_capabilities(legacy);
            assert!(!found.is_known_model, "{legacy}");
            assert_eq!(found.max_output_tokens, 4096, "{legacy}");
        }
        for newer in ["claude-30", "claude-20", "claude-instantly", "claude-haiku-9"] {
            let found = get_model_capabilities(newer);
            assert!(!found.is_known_model, "{newer}");
            assert_eq!(found.max_output_tokens, 128_000, "{newer}");
        }
        assert_eq!(get_model_capabilities("minimax-1").max_output_tokens, 4096);
    }

    #[test]
    fn budgets_are_shares_of_the_output_limit() {
        let older = get_model_capabilities("claude-sonnet-4-5");
        let budget = |level: &str| match resolve_reasoning(level, &older, &mut Vec::new()).unwrap().thinking {
            Thinking::Enabled { budget_tokens } => budget_tokens,
            other => panic!("{other:?}"),
        };
        assert_eq!(budget("minimal"), 1280);
        assert_eq!(budget("low"), 6400);
        assert_eq!(budget("medium"), 19_200);
        assert_eq!(budget("high"), 38_400);
        assert_eq!(budget("xhigh"), 57_600);
        let small = Capabilities { max_output_tokens: 4096, ..older };
        match resolve_reasoning("minimal", &small, &mut Vec::new()).unwrap().thinking {
            Thinking::Enabled { budget_tokens } => assert_eq!(budget_tokens, 1024),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn xhigh_maps_to_max_where_there_is_no_xhigh() {
        let mut warnings = Vec::new();
        let config = resolve_reasoning("xhigh", &get_model_capabilities("claude-sonnet-4-6"), &mut warnings).unwrap();
        assert_eq!(config.effort, Some("max"));
        assert_eq!(warnings.len(), 1);
        let config = resolve_reasoning("xhigh", &get_model_capabilities("claude-opus-5"), &mut Vec::new()).unwrap();
        assert_eq!(config.effort, Some("xhigh"));
    }
}
