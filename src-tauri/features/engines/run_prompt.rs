// The prompt and pictures one engine turn starts with, built from the chat's request (`runs.rs`).

use std::path::PathBuf;

use serde_json::Value;

/// How much of a chat's earlier turns a fresh engine session is given, newest kept.
const HISTORY_SEED_LIMIT: usize = 60_000;

/// A chat the engine has no session for yet but that already has turns (a forked chat, or one that
/// changed engine) starts with those turns written out, so the engine knows what came before.
pub(super) fn with_history(prompt: String, history: &Value) -> String {
    let Some(turns) = history.as_array().filter(|turns| !turns.is_empty()) else {
        return prompt;
    };
    let mut kept: Vec<String> = Vec::new();
    let mut size = 0;
    for turn in turns.iter().rev() {
        let asked = turn["prompt"].as_str().unwrap_or("").trim();
        if asked.is_empty() {
            continue;
        }
        let reply = turn["reply"].as_str().unwrap_or("").trim();
        let text = if reply.is_empty() {
            format!("Me: {asked}")
        } else {
            format!("Me: {asked}\n\nYou: {reply}")
        };
        size += text.len();
        if size > HISTORY_SEED_LIMIT && !kept.is_empty() {
            break;
        }
        kept.push(text);
    }
    if kept.is_empty() {
        return prompt;
    }
    kept.reverse();
    format!(
        "(This chat continues an earlier conversation. Here it is, oldest first:)\n\n{}\n\n---\n\n{prompt}",
        kept.join("\n\n")
    )
}

/// The prompt an engine gets. With the Browser attachment it is told to work in Misty's browser,
/// whose tools the Space's MCP server offers only then (mcp.rs).
pub(super) fn with_browser_hint(prompt: &str, browser: bool) -> String {
    if !browser {
        return prompt.to_string();
    }
    format!(
        "{prompt}\n\n(Use Misty's browser for this, through the misty MCP server: open a tab with \
screen_open, read it with browser_snapshot and act with browser_steps. I can watch it and take over.)"
    )
}

/// The pictures among a request's attachments, saved where the engine layer reads pasted
/// images. Anything that isn't an inline image is left out: an engine reads files from its
/// folder with its own tools.
pub(super) fn save_images(attachments: &Value) -> Vec<PathBuf> {
    attachments
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|attachment| {
            let mime = attachment["mime_type"].as_str()?;
            let (head, data) = attachment["data_url"].as_str()?.split_once(";base64,")?;
            if !mime.starts_with("image/") || head != format!("data:{mime}") {
                return None;
            }
            let ending = match mime {
                "image/jpeg" => "jpg",
                "image/gif" => "gif",
                "image/webp" => "webp",
                _ => "png",
            };
            super::images::save_pasted_image(data.to_string(), ending.to_string())
                .ok()
                .map(PathBuf::from)
        })
        .take(8)
        .collect()
}

/// In a shared Space, the files teammates' agents are changing right now go before the prompt, as
/// advice. The renderer builds the note from run events, never from a model; a slash command the
/// CLI runs itself is left as it is.
pub(super) fn with_teammates(prompt: String, note: &Value) -> String {
    match note.as_str().map(str::trim) {
        Some(note) if !note.is_empty() && !prompt.trim_start().starts_with('/') => {
            let note: String = note.chars().take(2_000).collect();
            format!("{note}\n\n{prompt}")
        }
        _ => prompt,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_fresh_session_is_given_the_earlier_turns() {
        let history = json!([
            { "prompt": "Name a fruit", "reply": "Mango", "created_at": "" },
            { "prompt": "  ", "reply": "skipped", "created_at": "" },
            { "prompt": "Another", "created_at": "" },
        ]);
        let seeded = with_history("And now?".into(), &history);
        assert!(seeded.starts_with("(This chat continues an earlier conversation."));
        assert!(seeded.contains("Me: Name a fruit\n\nYou: Mango\n\nMe: Another"));
        assert!(!seeded.contains("skipped"));
        assert!(seeded.ends_with("---\n\nAnd now?"));
        assert_eq!(with_history("Hi".into(), &json!([])), "Hi");
        assert_eq!(with_history("Hi".into(), &Value::Null), "Hi");
    }

    #[test]
    fn a_long_history_keeps_its_newest_turns() {
        let old = "x".repeat(HISTORY_SEED_LIMIT);
        let history = json!([
            { "prompt": old, "created_at": "" },
            { "prompt": "Newest", "created_at": "" },
        ]);
        let seeded = with_history("Go".into(), &history);
        assert!(seeded.contains("Me: Newest"));
        assert!(!seeded.contains(&old));
    }
}
