//! Which OpenAI models reason. Ported from `openai-language-model-capabilities.ts`.

pub(super) struct Capabilities {
    pub is_reasoning_model: bool,
    /// Allows temperature and top_p when reasoning is `none`.
    pub supports_non_reasoning_parameters: bool,
}

struct GptVersion<'a> {
    major: u64,
    minor: Option<u64>,
    variant: Option<&'a str>,
}

fn digits_then(text: &str) -> Option<(u64, &str)> {
    let end = text.find(|c: char| !c.is_ascii_digit()).unwrap_or(text.len());
    let number = text[..end].parse().ok()?;
    Some((number, &text[end..]))
}

/// `/^o(\d+)(?:-|$)/`
fn is_o_series(model: &str) -> bool {
    model
        .strip_prefix('o')
        .and_then(digits_then)
        .is_some_and(|(_, rest)| rest.is_empty() || rest.starts_with('-'))
}

/// `/^gpt-(\d+)(?:\.(\d+))?(?:-(.+))?$/`
fn gpt_version(model: &str) -> Option<GptVersion<'_>> {
    let (major, rest) = digits_then(model.strip_prefix("gpt-")?)?;
    let (minor, rest) = match rest.strip_prefix('.') {
        Some(after) => {
            let (minor, rest) = digits_then(after)?;
            (Some(minor), rest)
        }
        None => (None, rest),
    };
    let variant = match rest.strip_prefix('-') {
        Some(variant) if !variant.is_empty() && !variant.contains('\n') => Some(variant),
        _ if rest.is_empty() => None,
        _ => return None,
    };
    Some(GptVersion { major, minor, variant })
}

pub(super) fn get_capabilities(model: &str) -> Capabilities {
    let gpt = gpt_version(model);
    let is_chat_model = gpt
        .as_ref()
        .is_some_and(|gpt| gpt.minor.is_none() && gpt.variant.is_some_and(|variant| variant.starts_with("chat")));
    // Only recognizable OpenAI families use the developer role. Fine-tuned and custom model IDs
    // keep conservative defaults.
    let is_reasoning_model = is_o_series(model) || (gpt.as_ref().is_some_and(|gpt| gpt.major >= 5) && !is_chat_model);
    let supports_non_reasoning_parameters = gpt
        .as_ref()
        .is_some_and(|gpt| gpt.major > 5 || (gpt.major == 5 && gpt.minor.unwrap_or(0) >= 1));
    Capabilities { is_reasoning_model, supports_non_reasoning_parameters }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reasoning_families_are_recognized() {
        for model in ["o1", "o3-mini", "o4-mini", "gpt-5", "gpt-5.1", "gpt-5-mini", "gpt-5.2-codex", "gpt-6"] {
            assert!(get_capabilities(model).is_reasoning_model, "{model}");
        }
        for model in ["gpt-4o", "gpt-4.1", "gpt-5-chat-latest", "ft:gpt-5", "o1x", "gpt-5.", "gpt-5-", "custom"] {
            assert!(!get_capabilities(model).is_reasoning_model, "{model}");
        }
        assert!(get_capabilities("gpt-5.1-chat").is_reasoning_model);
    }

    #[test]
    fn sampling_with_no_reasoning_starts_at_five_point_one() {
        assert!(!get_capabilities("gpt-5").supports_non_reasoning_parameters);
        assert!(get_capabilities("gpt-5.1").supports_non_reasoning_parameters);
        assert!(get_capabilities("gpt-6").supports_non_reasoning_parameters);
        assert!(!get_capabilities("o3").supports_non_reasoning_parameters);
    }
}
