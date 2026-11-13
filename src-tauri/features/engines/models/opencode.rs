// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong), src-tauri/src/engine/models/opencode.rs.
use super::{run_probe, EngineModel};

pub(super) async fn opencode_catalog(bin: &str) -> super::EngineCatalog {
    if let Ok(stdout) = run_probe(bin, &["models"], "models").await {
        let models = parse_models_output(&stdout);
        if !models.is_empty() {
            return super::EngineCatalog::authoritative(models);
        }
    }
    // No answer from `opencode models`: no list of ours stands in for the engine's.
    super::EngineCatalog::unknown()
}

/// `opencode models` prints one `provider/model` id per line (plus ANSI
/// styling and possible chatter), the CLI's own default marked `(default)`.
/// There is no `--json` flag and no display names: a row is its id, as the
/// CLI prints it, never a name Misty makes up.
pub fn parse_models_output(stdout: &str) -> Vec<EngineModel> {
    let clean = strip_ansi_codes(stdout);
    let mut default_index = None;
    let mut models: Vec<EngineModel> = Vec::new();
    for line in clean.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let Some(full_id) = line.split_whitespace().find(|token| token.contains('/')) else {
            continue;
        };
        if line.contains("(default)") && default_index.is_none() {
            default_index = Some(models.len());
        }
        let provider = full_id.split_once('/').map_or("opencode", |(provider, _)| provider);
        models.push(EngineModel {
            id: full_id.to_string(),
            name: None,
            description: None,
            provider: provider.to_string(),
            context_window: None,
        });
    }
    // The frontend auto-selects the leading entry when nothing is pinned:
    // lead with the one the CLI marks as its default.
    if let Some(index) = default_index.filter(|index| *index > 0) {
        let entry = models.remove(index);
        models.insert(0, entry);
    }
    models
}

fn strip_ansi_codes(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if let Some('[') = chars.peek().copied() {
                let _ = chars.next();
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
                continue;
            }
        }
        out.push(ch);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ids_through_ansi_and_leads_with_the_cli_default() {
        let stdout = "\
\u{1b}[32mLoading models...\u{1b}[0m
opencode/big-pickle
anthropic/claude-sonnet-5 \u{1b}[90m(default)\u{1b}[0m
not-a-model-line
openai/gpt-5.3-codex
";
        let models = parse_models_output(stdout);
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                "anthropic/claude-sonnet-5",
                "opencode/big-pickle",
                "openai/gpt-5.3-codex",
            ]
        );
        // OpenCode names nothing, so neither does Misty.
        assert_eq!(models[1].name, None);
        assert_eq!(models[1].provider, "opencode");
    }
}
