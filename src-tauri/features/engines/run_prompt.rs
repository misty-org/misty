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
        let reply = agent_runs::without_cursor_tags(turn["reply"].as_str().unwrap_or(""));
        let reply = reply.trim();
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

/// What a turn with the Browser attachment adds after the prompt.
const BROWSER_HINT: &str = "\n\n(Use Misty's browser for this, through the misty MCP server: open a tab with \
screen_open, read it with browser_snapshot and act with browser_steps. I can watch it and take over.)";

/// The prompt an engine gets. With the Browser attachment it is told to work in Misty's browser,
/// whose tools the Space's MCP server offers only then (mcp.rs).
pub(super) fn with_browser_hint(prompt: &str, browser: bool) -> String {
    if !browser {
        return prompt.to_string();
    }
    format!("{prompt}{BROWSER_HINT}")
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

/// Where one run's attached documents are saved. The engine is given this folder as one it may
/// read (`send_reserved`), and the folders are cleared when Misty starts.
pub(crate) fn attached_files_dir(run_id: &str) -> PathBuf {
    let name: String = run_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(80)
        .collect();
    crate::engines::support::paths::app_home()
        .join("attached-files")
        .join(if name.is_empty() { "run".into() } else { name })
}

/// Clears every run's attached documents, at startup: a run that ended has no use for them.
pub(crate) fn sweep_attached_files() {
    let _ = file_access::fs::remove_dir_all(
        crate::engines::support::paths::app_home().join("attached-files"),
    );
}

/// A safe file name for an attachment: its own name without any folder, and a `.txt` ending
/// when what arrives is the text Misty took out of it (a Word document, say).
fn attachment_file_name(name: &str, mime: &str, index: usize) -> String {
    let base: String = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .take(120)
        .collect();
    let base = base.trim().trim_start_matches('.');
    let base = if base.is_empty() {
        format!("attachment-{}", index + 1)
    } else {
        base.to_string()
    };
    let lower = base.to_ascii_lowercase();
    if mime.starts_with("text/") && (!base.contains('.') || lower.ends_with(".docx")) {
        format!("{base}.txt")
    } else {
        base
    }
}

/// The documents among a request's attachments (PDFs, and the text of Word, Markdown, CSV and
/// JSON files), saved as files the engine reads with its own tools. Pictures go as images instead.
pub(super) fn save_files(attachments: &Value, run_id: &str) -> Vec<PathBuf> {
    use base64::Engine as _;
    let dir = attached_files_dir(run_id);
    let mut saved = Vec::new();
    for (index, attachment) in attachments.as_array().into_iter().flatten().enumerate() {
        let Some(mime) = attachment["mime_type"].as_str() else {
            continue;
        };
        if mime.starts_with("image/") {
            continue;
        }
        let Some((head, data)) = attachment["data_url"]
            .as_str()
            .and_then(|url| url.split_once(";base64,"))
        else {
            continue;
        };
        if head != format!("data:{mime}") {
            continue;
        }
        let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(data.trim()) else {
            continue;
        };
        if bytes.is_empty() || bytes.len() > 10 * 1024 * 1024 {
            continue;
        }
        let name = attachment_file_name(attachment["name"].as_str().unwrap_or(""), mime, index);
        let mut path = dir.join(&name);
        if saved.contains(&path) {
            path = dir.join(format!("{}-{name}", index + 1));
        }
        if file_access::fs::create_dir_all(&dir).is_err()
            || file_access::fs::write(&path, &bytes).is_err()
        {
            continue;
        }
        saved.push(path);
        if saved.len() == 8 {
            break;
        }
    }
    saved
}

/// The prompt with the attached documents named after it, so the engine opens them.
pub(super) fn with_attached_files(prompt: String, files: &[PathBuf]) -> String {
    if files.is_empty() || prompt.trim_start().starts_with('/') {
        return prompt;
    }
    let list: Vec<String> = files
        .iter()
        .map(|path| format!("- {}", path.display()))
        .collect();
    format!(
        "{prompt}\n\n(I attached {}. Read {} with your file tools before answering:)\n{}",
        if files.len() == 1 {
            "a file"
        } else {
            "these files"
        },
        if files.len() == 1 { "it" } else { "them" },
        list.join("\n")
    )
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
    fn documents_are_saved_for_the_engine_and_named_in_the_prompt() {
        let run = format!("test-{}", uuid::Uuid::new_v4());
        let attachments = json!([
            { "name": "report.pdf", "mime_type": "application/pdf", "data_url": "data:application/pdf;base64,JVBERi0=" },
            { "name": "photo.png", "mime_type": "image/png", "data_url": "data:image/png;base64,AAAA" },
            { "name": "../../notes.docx", "mime_type": "text/plain", "data_url": "data:text/plain;base64,aGk=" },
            { "name": "bad.pdf", "mime_type": "application/pdf", "data_url": "data:text/html;base64,aGk=" },
        ]);
        let saved = save_files(&attachments, &run);
        let names: Vec<String> = saved
            .iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["report.pdf", "notes.docx.txt"]);
        assert!(saved
            .iter()
            .all(|path| path.starts_with(attached_files_dir(&run))));
        assert_eq!(file_access::fs::read(&saved[0]).unwrap(), b"%PDF-");
        let prompt = with_attached_files("Summarize".into(), &saved);
        assert!(prompt.starts_with("Summarize\n\n(I attached these files."));
        assert!(prompt.contains("report.pdf"));
        assert_eq!(with_attached_files("/compact".into(), &saved), "/compact");
        assert_eq!(with_attached_files("Hi".into(), &[]), "Hi");
        let _ = file_access::fs::remove_dir_all(attached_files_dir(&run));
    }

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
    fn earlier_replies_lose_the_cursor_companions_tags() {
        let history = json!([
            { "prompt": "Rock", "reply": "I pick paper. [POINT:none] [GUIDE:1/2]", "created_at": "" },
        ]);
        let seeded = with_history("Again".into(), &history);
        assert!(seeded.contains("You: I pick paper."));
        assert!(!seeded.contains("[POINT"));
        assert!(!seeded.contains("[GUIDE"));
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
