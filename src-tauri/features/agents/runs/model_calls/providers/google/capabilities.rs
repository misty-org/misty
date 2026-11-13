//! What a Gemini model can do, read from its name. Ported from `getGoogleModelCapabilities` and the
//! thinking settings in `google-language-model.ts`. The SDK does this with regular expressions over
//! path segments, and these follow them piece by piece.
use serde_json::{json, Value};

/// A path segment that starts with `prefix` and then ends or goes on with `.` or `-`, without
/// regard to case: `(^|/)prefix(?:[.-]|$)`.
fn has_versioned_segment(model: &str, prefix: &str) -> bool {
    let lower = model.to_lowercase();
    let segments: Vec<&str> = lower.split('/').collect();
    segments.iter().enumerate().any(|(index, segment)| {
        segment.strip_prefix(prefix).is_some_and(|rest| {
            rest.starts_with(['.', '-']) || (rest.is_empty() && index == segments.len() - 1)
        })
    })
}

fn is_gemini(model: &str) -> bool {
    model.to_lowercase().split('/').any(|segment| segment.starts_with("gemini-"))
}

fn is_known_pre_gemini_2(model: &str) -> bool {
    let lower = model.to_lowercase();
    let last = lower.rsplit('/').next().unwrap_or(&lower);
    has_versioned_segment(model, "gemini-1")
        || last == "gemini-pro"
        || last == "gemini-pro-vision"
        || has_versioned_segment(model, "gemini-robotics-er-1.5")
}

/// `usesGemini3Features`: every Gemini model not known to be older.
pub(super) fn uses_gemini_3_features(model: &str) -> bool {
    is_gemini(model) && !is_known_pre_gemini_2(model) && !has_versioned_segment(model, "gemini-2")
}

pub(super) fn is_gemma(model: &str) -> bool {
    model.to_lowercase().starts_with("gemma-")
}

/// `/^gemini-(\d+)\.(\d+)-flash(?:$|-(?!lite(?:-|$)))/`, written out because the lookahead has no
/// equivalent in the `regex` crate.
fn flash_version(name: &str) -> Option<(f64, f64)> {
    let rest = name.strip_prefix("gemini-")?;
    let (major, rest) = rest.split_once('.')?;
    let digits = rest.find(|character: char| !character.is_ascii_digit()).unwrap_or(rest.len());
    let (minor, rest) = rest.split_at(digits);
    if major.is_empty() || minor.is_empty() || !major.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let rest = rest.strip_prefix("-flash")?;
    let is_lite = rest
        .strip_prefix("-lite")
        .is_some_and(|after| after.is_empty() || after.starts_with('-'));
    if !(rest.is_empty() || (rest.starts_with('-') && !is_lite)) {
        return None;
    }
    Some((major.parse().ok()?, minor.parse().ok()?))
}

fn minimum_thinking_level(model: &str) -> &'static str {
    let name = model.rsplit('/').next().unwrap_or(model).to_lowercase();
    if name == "gemini-flash-latest" {
        return "low";
    }
    match flash_version(&name) {
        Some((major, minor)) if major > 3.0 || (major == 3.0 && minor >= 7.0) => "low",
        _ => "minimal",
    }
}

fn gemini_3_thinking(reasoning: &str, model: &str, warnings: &mut Vec<Value>) -> Option<Value> {
    let minimum = minimum_thinking_level(model);
    if reasoning == "none" {
        return Some(json!({ "thinkingLevel": minimum }));
    }
    let level = match reasoning {
        "minimal" => minimum,
        "low" => "low",
        "medium" => "medium",
        "high" | "xhigh" => "high",
        _ => {
            warnings.push(json!({
                "type": "unsupported",
                "feature": "reasoning",
                "details": format!("reasoning \"{reasoning}\" is not supported by this model."),
            }));
            return None;
        }
    };
    if level != reasoning {
        warnings.push(json!({
            "type": "compatibility",
            "feature": "reasoning",
            "details": format!("reasoning \"{reasoning}\" is not directly supported by this model. mapped to effort \"{level}\"."),
        }));
    }
    Some(json!({ "thinkingLevel": level }))
}

fn gemini_25_thinking(reasoning: &str, model: &str, warnings: &mut Vec<Value>) -> Option<Value> {
    if reasoning == "none" {
        return Some(json!({ "thinkingBudget": 0 }));
    }
    let share = match reasoning {
        "minimal" => 0.02,
        "low" => 0.1,
        "medium" => 0.3,
        "high" => 0.6,
        "xhigh" => 0.9,
        _ => {
            warnings.push(json!({
                "type": "unsupported",
                "feature": "reasoning",
                "details": format!("reasoning \"{reasoning}\" is not supported by this model."),
            }));
            return None;
        }
    };
    let lower = model.to_lowercase();
    let maximum = if lower.contains("2.5-pro") || lower.contains("gemini-3-pro-image") { 32_768 } else { 24_576 };
    // `Math.round` of 65536 tokens times the share.
    let budget = (65_536.0_f64 * share + 0.5).floor() as u64;
    Some(json!({ "thinkingBudget": budget.min(maximum) }))
}

/// `resolveThinkingConfig`.
pub(super) fn thinking_config(reasoning: Option<&str>, model: &str, warnings: &mut Vec<Value>) -> Option<Value> {
    let reasoning = reasoning.filter(|value| *value != "provider-default")?;
    if uses_gemini_3_features(model) && !model.contains("gemini-3-pro-image") {
        gemini_3_thinking(reasoning, model, warnings)
    } else {
        gemini_25_thinking(reasoning, model, warnings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_generations() {
        for newer in ["gemini-3-pro", "gemini-3.5-flash", "gemini-flash-latest", "tunedModels/gemini-4"] {
            assert!(uses_gemini_3_features(newer), "{newer}");
        }
        for older in ["gemini-1.5-pro", "gemini-pro", "gemini-pro-vision", "gemini-2.0-flash", "gemini-2.5-flash", "gemma-3", "gemini-robotics-er-1.5-preview"] {
            assert!(!uses_gemini_3_features(older), "{older}");
        }
    }

    #[test]
    fn the_lowest_thinking_level_depends_on_the_flash_version() {
        for (model, level) in [
            ("gemini-flash-latest", "low"),
            ("gemini-3.7-flash", "low"),
            ("gemini-3.7-flash-preview", "low"),
            ("gemini-4.0-flash", "low"),
            ("models/gemini-4.0-flash", "low"),
            ("gemini-3.5-flash", "minimal"),
            ("gemini-3.7-flash-lite", "minimal"),
            ("gemini-3.7-flash-lite-preview", "minimal"),
            ("gemini-3.7-flash-litex", "low"),
            ("gemini-3-pro", "minimal"),
        ] {
            assert_eq!(minimum_thinking_level(model), level, "{model}");
        }
    }

    #[test]
    fn budgets_scale_by_effort_and_stop_at_the_model_limit() {
        let budget = |reasoning, model| thinking_config(Some(reasoning), model, &mut Vec::new());
        assert_eq!(budget("minimal", "gemini-2.5-flash"), Some(json!({ "thinkingBudget": 1311 })));
        assert_eq!(budget("low", "gemini-2.5-flash"), Some(json!({ "thinkingBudget": 6554 })));
        assert_eq!(budget("medium", "gemini-2.5-flash"), Some(json!({ "thinkingBudget": 19661 })));
        assert_eq!(budget("high", "gemini-2.5-flash"), Some(json!({ "thinkingBudget": 24576 })));
        assert_eq!(budget("high", "gemini-2.5-pro"), Some(json!({ "thinkingBudget": 32768 })));
        assert_eq!(budget("none", "gemini-2.5-flash"), Some(json!({ "thinkingBudget": 0 })));
        assert_eq!(budget("provider-default", "gemini-2.5-flash"), None);
    }

    #[test]
    fn efforts_map_with_a_warning_when_they_change() {
        let mut warnings = Vec::new();
        assert_eq!(thinking_config(Some("xhigh"), "gemini-3-pro", &mut warnings), Some(json!({ "thinkingLevel": "high" })));
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0]["type"], "compatibility");
        let mut warnings = Vec::new();
        assert_eq!(thinking_config(Some("max"), "gemini-3-pro", &mut warnings), None);
        assert_eq!(warnings[0]["type"], "unsupported");
    }
}
