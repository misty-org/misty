//! Gemini CLI and Qwen Code chats, for Misty's history of past chats.

use std::path::Path;

use super::discovery::peek_head_json_lines;
use super::{same_or_child, SessionFile};

/// Gemini CLI and Qwen Code (a fork of it) keep each chat as JSONL under
/// `<home>/tmp/<project>/chats/`. Gemini's first line is the session's metadata
/// (`sessionId`, `projectHash` = sha256 of the project folder, `directories`);
/// Qwen's records each carry `sessionId` and `cwd`. A chat belongs to the
/// workspace when any of those names it. Subagent chats sit one folder deeper and
/// are left out.
pub(super) fn discover_gemini_family(engine: &'static str, workspace: &Path) -> Vec<SessionFile> {
    let home = match engine {
        "qwen" => crate::engines::engine_home(None, ".qwen"),
        _ => crate::engines::engine_home(Some("GEMINI_CLI_HOME"), ".gemini"),
    };
    discover_gemini_family_in(engine, &home.join("tmp"), workspace)
}

pub(super) fn discover_gemini_family_in(
    engine: &'static str,
    tmp: &Path,
    workspace: &Path,
) -> Vec<SessionFile> {
    use sha2::{Digest, Sha256};
    let Ok(projects) = file_access::fs::read_dir(tmp) else {
        return Vec::new();
    };
    let hash = hex::encode(Sha256::digest(workspace.to_string_lossy().as_bytes()));
    let mut out = Vec::new();
    for project in projects.flatten() {
        let Ok(chats) = file_access::fs::read_dir(project.path().join("chats")) else {
            continue;
        };
        for chat in chats.flatten() {
            let path = chat.path();
            if path.extension().and_then(|ending| ending.to_str()) != Some("jsonl") {
                continue;
            }
            let head = peek_head_json_lines(&path, false, 8);
            let session_id = head
                .iter()
                .find_map(|line| line.get("sessionId").and_then(serde_json::Value::as_str))
                .unwrap_or("")
                .to_string();
            let names_workspace = head.iter().any(|line| {
                line.get("projectHash").and_then(serde_json::Value::as_str) == Some(hash.as_str())
                    || line
                        .get("cwd")
                        .and_then(serde_json::Value::as_str)
                        .is_some_and(|cwd| same_or_child(Path::new(cwd), workspace))
                    || line
                        .get("directories")
                        .and_then(serde_json::Value::as_array)
                        .is_some_and(|dirs| {
                            dirs.iter()
                                .filter_map(serde_json::Value::as_str)
                                .any(|dir| Path::new(dir) == workspace)
                        })
            });
            let subagent = head
                .first()
                .and_then(|line| line.get("kind"))
                .and_then(serde_json::Value::as_str)
                == Some("subagent");
            if session_id.is_empty() || !names_workspace || subagent {
                continue;
            }
            out.push(SessionFile {
                engine,
                session_id,
                workspace_path: workspace.to_string_lossy().to_string(),
                file_path: path,
            });
        }
    }
    out
}

/// A Gemini chat's lines as they stand after its edits: `{"$rewindTo": id}` drops that message
/// and everything after it, and `$set` / `$patch` lines (metadata and in-place changes) are left
/// out. What `$patch` changes inside a message isn't applied, so a patched message reads as first
/// written.
pub(super) fn replayed_gemini_chat(path: &Path) -> Result<String, String> {
    let text = file_access::fs::read_to_string(path)
        .map_err(|error| format!("open {}: {error}", path.display()))?;
    Ok(replay(&text))
}

fn replay(text: &str) -> String {
    let mut kept: Vec<(Option<String>, &str)> = Vec::new();
    for line in text.lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if let Some(target) = value.get("$rewindTo").and_then(serde_json::Value::as_str) {
            if let Some(at) = kept
                .iter()
                .position(|(id, _)| id.as_deref() == Some(target))
            {
                kept.truncate(at);
            }
            continue;
        }
        if value.get("$set").is_some() || value.get("$patch").is_some() {
            continue;
        }
        let id = value
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string);
        kept.push((id, line));
    }
    kept.into_iter()
        .map(|(_, line)| line)
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::super::scanner::tests::scratch_dir;
    use super::*;

    #[test]
    fn a_rewind_drops_the_message_and_what_followed() {
        let chat = [
            r#"{"sessionId":"g1","projectHash":"h"}"#,
            r#"{"id":"m1","type":"user","content":"first"}"#,
            r#"{"id":"m2","type":"gemini","content":"one"}"#,
            r#"{"id":"m3","type":"user","content":"oops"}"#,
            r#"{"id":"m4","type":"gemini","content":"two"}"#,
            r#"{"$rewindTo":"m3"}"#,
            r#"{"$set":{"summary":"s"}}"#,
            r#"{"id":"m5","type":"user","content":"again"}"#,
        ]
        .join("\n");
        let ids: Vec<String> = replay(&chat)
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .filter_map(|value| {
                value
                    .get("id")
                    .and_then(|id| id.as_str())
                    .map(str::to_string)
            })
            .collect();
        assert_eq!(ids, ["m1", "m2", "m5"]);
    }

    #[test]
    fn gemini_and_qwen_chats_are_found_by_their_project() {
        use sha2::{Digest, Sha256};
        let root = scratch_dir("gemini-family");
        let workspace = root.join("project");
        std::fs::create_dir_all(&workspace).unwrap();
        let hash = hex::encode(Sha256::digest(workspace.to_string_lossy().as_bytes()));
        let gemini = root.join("gemini-tmp");
        std::fs::create_dir_all(gemini.join("project/chats/parent")).unwrap();
        std::fs::write(
            gemini.join("project/chats/session-2026-11-12T10-00-abcd1234.jsonl"),
            format!("{{\"sessionId\":\"g1\",\"projectHash\":\"{hash}\",\"kind\":\"main\"}}\n"),
        )
        .unwrap();
        std::fs::write(
            gemini.join("project/chats/session-other.jsonl"),
            "{\"sessionId\":\"g2\",\"projectHash\":\"elsewhere\"}\n",
        )
        .unwrap();
        std::fs::write(
            gemini.join("project/chats/parent/child.jsonl"),
            format!("{{\"sessionId\":\"g3\",\"projectHash\":\"{hash}\",\"kind\":\"subagent\"}}\n"),
        )
        .unwrap();
        let found = discover_gemini_family_in("gemini", &gemini, &workspace);
        assert_eq!(
            found
                .iter()
                .map(|f| f.session_id.as_str())
                .collect::<Vec<_>>(),
            ["g1"]
        );

        let qwen = root.join("qwen-tmp");
        std::fs::create_dir_all(qwen.join("p1/chats")).unwrap();
        std::fs::write(
            qwen.join("p1/chats/q1.jsonl"),
            format!(
                "{{\"sessionId\":\"q1\",\"type\":\"user\",\"cwd\":\"{}\"}}\n",
                workspace.join("src").to_string_lossy()
            ),
        )
        .unwrap();
        let found = discover_gemini_family_in("qwen", &qwen, &workspace);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].engine, "qwen");
        assert_eq!(found[0].session_id, "q1");
        let _ = std::fs::remove_dir_all(&root);
    }
}
