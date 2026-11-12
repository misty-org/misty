// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//! Front matter, skill markers, local scans and content hashes.

use file_access::fs;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

use super::core::*;
// ===== Front matter, markers and local scans =====

/// upstream readYamlField: inline (with at most one pair of quotes) or a block scalar (`|`/`>`, with `+`/`-`).
pub(super) fn read_yaml_field(yaml: &str, key: &str) -> String {
    let lines: Vec<&str> = yaml.split('\n').collect();
    for (i, line) in lines.iter().enumerate() {
        let indent = line.chars().take_while(|c| c.is_whitespace()).count();
        let trimmed_start = line.trim_start();
        // The header looks like `^(\s*)key:[ \t]*(.*)$`: the key must be followed directly by a colon.
        let Some(after_key) = trimmed_start.strip_prefix(key) else {
            continue;
        };
        let Some(after_colon) = after_key.strip_prefix(':') else {
            continue;
        };
        let inline = after_colon.trim_start_matches([' ', '\t']).trim();
        if matches!(inline, ">" | "|" | ">+" | ">-" | "|+" | "|-") {
            // A block scalar: collect the more indented lines that follow, until a dedent.
            let mut collected: Vec<String> = Vec::new();
            for next in &lines[i + 1..] {
                if next.trim().is_empty() {
                    collected.push(String::new());
                    continue;
                }
                if next.chars().take_while(|c| c.is_whitespace()).count() <= indent {
                    break; // dedent ends it
                }
                collected.push(next.trim().to_string());
            }
            return collected.join(" ");
        }
        // Strip one pair of surrounding quotes.
        let mut out = inline;
        if out.starts_with('"') || out.starts_with('\'') {
            out = &out[1..];
        }
        if (out.ends_with('"') || out.ends_with('\'')) && !out.is_empty() {
            out = &out[..out.len() - 1];
        }
        return out.to_string();
    }
    String::new()
}

/// upstream's `/^---\s*\n([\s\S]*?)\n---/` front matter extraction.
pub(super) fn extract_frontmatter(raw: &str) -> Option<&str> {
    let rest = raw.strip_prefix("---")?;
    // `\s*\n`: the leading whitespace run must hold a `\n` (take what follows the run's last `\n`).
    let ws_len: usize = rest
        .char_indices()
        .take_while(|(_, c)| c.is_whitespace())
        .map(|(i, c)| i + c.len_utf8())
        .last()
        .unwrap_or(0);
    let newline = rest[..ws_len].rfind('\n')?;
    let content = &rest[newline + 1..];
    let end = content.find("\n---")?;
    Some(&content[..end])
}

pub(super) struct SkillMetadata {
    pub(super) name: String,
    pub(super) description: String,
}

/// upstream readSkillMetadata: front matter first, the name falls back, the description's whitespace collapsed.
pub(super) fn read_skill_metadata(markdown: &str, fallback_name: &str) -> SkillMetadata {
    let source = extract_frontmatter(markdown).unwrap_or(markdown);
    let name_field = read_yaml_field(source, "name");
    let name = if !name_field.is_empty() {
        name_field
    } else if !fallback_name.is_empty() {
        fallback_name.to_string()
    } else {
        "Skill".to_string()
    };
    let description = read_yaml_field(source, "description")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    SkillMetadata {
        name: name.trim().to_string(),
        description,
    }
}

/// upstream findSkillMarker: SKILL.md (uppercase first) or skill.md, counted only when it is a file.
pub(super) fn find_skill_marker(dir: &Path) -> Option<PathBuf> {
    for name in ["SKILL.md", "skill.md"] {
        let candidate = dir.join(name);
        if fs::metadata(&candidate)
            .map(|meta| meta.is_file())
            .unwrap_or(false)
        {
            return Some(candidate);
        }
    }
    None
}

/// upstream scanSkillDirectories: recursive to depth 3, not into folder links, skipping names that
/// start with `.`; a folder holding SKILL.md/skill.md is a skill (relative paths returned).
pub(super) fn scan_skill_directories(root_dir: &Path) -> Vec<String> {
    fn walk(dir: &Path, rel_dir: &str, depth: usize, found: &mut Vec<String>) {
        let Ok(read_dir) = fs::read_dir(dir) else {
            return;
        };
        let mut entries: Vec<_> = read_dir.filter_map(|entry| entry.ok()).collect();
        // Code point order (a planned difference from upstream's localeCompare).
        entries.sort_by_key(|a| a.file_name());
        for entry in entries {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() && !file_type.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.is_empty() || name.starts_with('.') {
                continue;
            }
            let rel = if rel_dir.is_empty() {
                name.clone()
            } else {
                format!("{rel_dir}/{name}")
            };
            let full = entry.path();
            if find_skill_marker(&full).is_some() {
                found.push(rel);
                continue;
            }
            // A linked group folder isn't recursed into (the scan stays inside the target's skills tree).
            if file_type.is_dir() && depth + 1 < MAX_LOCAL_SKILL_SCAN_DEPTH {
                walk(&full, &rel, depth + 1, found);
            }
        }
    }
    let mut found = Vec::new();
    walk(root_dir, "", 0, &mut found);
    found
}

// ===== contentHash / sourceSignature =====

#[cfg(unix)]
pub(super) fn exec_bit_of(meta: &fs::Metadata) -> u8 {
    use std::os::unix::fs::PermissionsExt;
    if meta.permissions().mode() & 0o111 != 0 {
        1
    } else {
        0
    }
}

#[cfg(not(unix))]
pub(super) fn exec_bit_of(_meta: &fs::Metadata) -> u8 {
    0
}

/// upstream hashDirectory: recursive in name order, each file as
/// `"<rel>\0<execBit>\0" + its bytes + "\0"`; folders aren't hashed; a failed stat is skipped,
/// a failed read skips the contents but still adds the trailing NUL.
pub(super) fn hash_directory(dir: &Path) -> String {
    fn walk(base: &Path, rel_dir: &str, hasher: &mut Sha256) {
        let abs_dir = if rel_dir.is_empty() {
            base.to_path_buf()
        } else {
            base.join(rel_dir)
        };
        let Ok(read_dir) = fs::read_dir(&abs_dir) else {
            return;
        };
        let mut entries: Vec<_> = read_dir.filter_map(|entry| entry.ok()).collect();
        entries.sort_by_key(|a| a.file_name());
        for entry in entries {
            let name = entry.file_name().to_string_lossy().into_owned();
            if HASH_IGNORE.contains(&name.as_str()) {
                continue;
            }
            let rel = if rel_dir.is_empty() {
                name.clone()
            } else {
                format!("{rel_dir}/{name}")
            };
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                walk(base, &rel, hasher);
            } else if file_type.is_file() {
                let abs = base.join(&rel);
                let Ok(meta) = fs::metadata(&abs) else {
                    continue;
                };
                let exec_bit = exec_bit_of(&meta);
                hasher.update(format!("{rel}\0{exec_bit}\0"));
                if let Ok(bytes) = fs::read(&abs) {
                    hasher.update(&bytes);
                }
                hasher.update(b"\0");
            }
        }
    }
    let mut hasher = Sha256::new();
    walk(dir, "", &mut hasher);
    format!("{:x}", hasher.finalize())
}

/// upstream sourceSignatureFromTree: the sha256 hex of the tree's blobs under sourceDir as
/// `"<path>:<sha>"`, sorted and joined with `"\n"`; no match → None.
pub(super) fn source_signature_from_tree(tree: &[Value], source_dir: &str) -> Option<String> {
    if source_dir.is_empty() {
        return None;
    }
    let prefix = format!("{source_dir}/");
    let mut rels: Vec<String> = tree
        .iter()
        .filter_map(|entry| {
            if entry.get("type").and_then(Value::as_str) != Some("blob") {
                return None;
            }
            let sha = entry
                .get("sha")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())?;
            let path = entry.get("path").and_then(Value::as_str).unwrap_or("");
            if path == source_dir || path.starts_with(&prefix) {
                Some(format!("{path}:{sha}"))
            } else {
                None
            }
        })
        .collect();
    if rels.is_empty() {
        return None;
    }
    rels.sort();
    let mut hasher = Sha256::new();
    hasher.update(rels.join("\n"));
    Some(format!("{:x}", hasher.finalize()))
}
