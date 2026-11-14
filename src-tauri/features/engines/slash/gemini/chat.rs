//! Gemini CLI's `/chat` checkpoints, listed and deleted from its files.

use super::*;

/// The folders under `~/.gemini/tmp` (and `~/.cache/.gemini/tmp`, where a run inside the
/// Seatbelt sandbox keeps its state) that hold `folder`'s chat checkpoints. Gemini CLI names
/// them by the short id `projects.json` gives the folder (each carries a `.project_root`
/// marker), and named them by the SHA-256 of its path before that.
pub(super) fn project_temp_dirs(folder: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(dir) = adapter::gemini_dir() {
        roots.push(dir);
    }
    if let Some(home) = adapter::gemini_home() {
        roots.push(home.join(".cache").join(".gemini"));
    }
    // The CLI names a folder by its real path (its working directory), so a chat folder reached
    // through a link is looked up by where it leads too.
    let mut wanted = vec![folder.to_path_buf()];
    if let Ok(real) = std::fs::canonicalize(folder) {
        if real != folder {
            wanted.push(real);
        }
    }
    let mut found = Vec::new();
    for root in roots {
        let tmp = root.join("tmp");
        let registry = files::read_json(&root.join("projects.json"));
        for folder in &wanted {
            let path = folder.to_string_lossy().into_owned();
            let slug = registry
                .as_ref()
                .and_then(|registry| {
                    registry
                        .pointer("/projects")?
                        .get(&path)?
                        .as_str()
                        .map(str::to_string)
                })
                .or_else(|| marked_slug(&tmp, folder));
            if let Some(slug) = slug {
                found.push(tmp.join(slug));
            }
            found.push(tmp.join(sha256_hex(&path)));
        }
    }
    found.retain(|dir| dir.is_dir());
    let mut seen = std::collections::HashSet::new();
    found.retain(|dir| seen.insert(dir.clone()));
    found
}

/// The folder under `tmp` whose `.project_root` marker names `folder`.
fn marked_slug(tmp: &Path, folder: &Path) -> Option<String> {
    std::fs::read_dir(tmp).ok()?.flatten().find_map(|entry| {
        let owner = std::fs::read_to_string(entry.path().join(".project_root")).ok()?;
        (Path::new(owner.trim()) == folder)
            .then(|| entry.file_name().to_string_lossy().into_owned())
    })
}

fn sha256_hex(text: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(text.as_bytes()))
}

/// `/chat list` and `/chat delete <tag>` over the conversation checkpoints `/chat save` wrote
/// (`checkpoint-<tag>.json`, the tag URI-encoded).
pub(super) fn chat(folder: Option<&Path>, args: &str) -> Result<Output, String> {
    let folder = folder.ok_or("This chat has no folder, so it has no Gemini CLI checkpoints.")?;
    let (sub, rest) = args.split_once(char::is_whitespace).unwrap_or((args, ""));
    let rest = rest.trim();
    match sub {
        "" | "list" => Ok(chat_list(folder)),
        "delete" if rest.is_empty() => Err("Give the tag to delete: /chat delete <tag>".into()),
        "delete" => chat_delete(folder, rest),
        "save" | "resume" | "load" | "share" => Err(format!(
            "/chat {sub} works on Gemini CLI's live terminal session, which Misty's chats don't run in."
        )),
        _ => Err(format!("Gemini CLI's /chat has no `{sub}`. Use list or delete <tag>.")),
    }
}

fn chat_list(folder: &Path) -> Output {
    let mut checkpoints: Vec<(String, std::time::SystemTime)> = Vec::new();
    for dir in project_temp_dirs(folder) {
        for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let file = entry.file_name().to_string_lossy().into_owned();
            let Some(tag) = file
                .strip_prefix("checkpoint-")
                .and_then(|rest| rest.strip_suffix(".json"))
            else {
                continue;
            };
            let modified = entry
                .metadata()
                .and_then(|meta| meta.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            checkpoints.push((decode_tag(tag), modified));
        }
    }
    checkpoints.sort_by(|a, b| b.1.cmp(&a.1));
    let rows = checkpoints
        .into_iter()
        .map(|(tag, modified)| row(tag, saved_at(modified)))
        .collect::<Vec<_>>();
    let sections = if rows.is_empty() {
        Vec::new()
    } else {
        vec![Section {
            heading: Some("Saved checkpoints".into()),
            rows,
            text: None,
        }]
    };
    files::info_or(
        "Gemini CLI chat checkpoints",
        sections,
        "No saved checkpoints for this folder. Gemini CLI's terminal app saves them with /chat save <tag>.",
    )
}

/// Gemini CLI's `decodeTagName`: URI-decoded, or the tag as it is when it doesn't decode.
fn decode_tag(tag: &str) -> String {
    percent_decode_str(tag)
        .decode_utf8()
        .map(|decoded| decoded.into_owned())
        .unwrap_or_else(|_| tag.to_string())
}

fn saved_at(modified: std::time::SystemTime) -> String {
    let at: chrono::DateTime<chrono::Local> = modified.into();
    format!("saved {}", at.format("%b %-d, %H:%M"))
}

/// Deletes the checkpoint file for `tag`, under its encoded name and, as the CLI does, its
/// older raw one (only for a tag that can't step out of the folder).
fn chat_delete(folder: &Path, tag: &str) -> Result<Output, String> {
    let mut names = vec![format!("checkpoint-{}.json", encode_component(tag))];
    if !tag.contains(['/', '\\']) && tag != ".." {
        names.push(format!("checkpoint-{tag}.json"));
    }
    names.dedup();
    let mut deleted = false;
    for dir in project_temp_dirs(folder) {
        for name in &names {
            let path = dir.join(name);
            match std::fs::remove_file(&path) {
                Ok(()) => deleted = true,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!("Couldn't delete {}: {error}", display_path(&path)))
                }
            }
        }
    }
    if deleted {
        Ok(Output::done(format!(
            "Conversation checkpoint '{tag}' has been deleted."
        )))
    } else {
        Err(format!("No checkpoint found with tag '{tag}'."))
    }
}
