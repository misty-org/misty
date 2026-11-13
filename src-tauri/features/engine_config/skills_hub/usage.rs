// Adapted from desktop-cc-gui (MIT, Copyright (c) 2026 zhukunpenglinyutong).
// See NOTICE.
//! Skill usage counted from Claude Code transcripts.

use file_access::fs;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use super::core::*;
use super::fsutil::*;
use super::target_sync::*;
use super::updates_popular::*;
// ===== Skill usage (upstream skill-usage.js): scans Claude Code session transcripts =====
//
// Only Claude Code is counted: `<claude home>/projects/**/*.jsonl` (following
// `CLAUDE_CONFIG_DIR`). Codex keeps no reliable record of Skill calls; Misty doesn't guess, and
// doesn't pass install records off as calls.

pub(super) fn claude_projects_dir() -> PathBuf {
    crate::engine_config::support::engine_home(Some("CLAUDE_CONFIG_DIR"), ".claude")
        .join("projects")
}

pub(super) struct TranscriptFile {
    pub(super) path: String,
    pub(super) size: u64,
    pub(super) mtime_ms: i64,
}

/// upstream listTranscriptFiles: collects .jsonl at any depth (a failed stat is skipped), sorted by path.
pub(super) fn list_transcript_files(root_dir: &Path) -> Vec<TranscriptFile> {
    fn walk(dir: &Path, out: &mut Vec<TranscriptFile>) {
        let Ok(read_dir) = fs::read_dir(dir) else {
            return;
        };
        for entry in read_dir.filter_map(|entry| entry.ok()) {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let full = entry.path();
            if file_type.is_dir() {
                walk(&full, out);
            } else if file_type.is_file() && entry.file_name().to_string_lossy().ends_with(".jsonl")
            {
                let Ok(meta) = fs::metadata(&full) else {
                    continue;
                };
                let mtime_ms = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                out.push(TranscriptFile {
                    path: full.to_string_lossy().into_owned(),
                    size: meta.len(),
                    mtime_ms,
                });
            }
        }
    }
    let mut out = Vec::new();
    walk(root_dir, &mut out);
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// upstream fingerprintFiles: `"<count>:" + sha256hex(each file's "<path>:<size>:<mtimeMs>\n")`.
pub(super) fn fingerprint_files(files: &[TranscriptFile]) -> String {
    let mut hasher = Sha256::new();
    for file in files {
        hasher.update(format!("{}:{}:{}\n", file.path, file.size, file.mtime_ms));
    }
    format!("{}:{:x}", files.len(), hasher.finalize())
}

/// upstream toInt: the floor of a finite positive number, else 0.
pub(super) fn to_int(value: f64) -> i64 {
    if value.is_finite() && value > 0.0 {
        value.floor() as i64
    } else {
        0
    }
}

/// The five columns of upstream SKILL_TOKEN_KEYS (summed internally as f64 shares).
#[derive(Default)]
pub(super) struct UsageTokens {
    pub(super) input: f64,
    pub(super) output: f64,
    pub(super) cached_input: f64,
    pub(super) cache_creation: f64,
    pub(super) reasoning: f64,
}

pub(super) struct UsageEntry {
    pub(super) skill: String,
    pub(super) invocations: i64,
    pub(super) last_used_at: Option<String>,
    pub(super) tokens: UsageTokens,
}

/// upstream normalizeUsage (columns mapped as the Claude parser's normalizeClaudeUsage).
pub(super) fn normalize_usage(usage: Option<&Value>) -> UsageTokens {
    let get = |key: &str| usage.and_then(|u| u.get(key)).map(js_f64).unwrap_or(0.0);
    UsageTokens {
        input: to_int(get("input_tokens")) as f64,
        output: to_int(get("output_tokens")) as f64,
        cached_input: to_int(get("cache_read_input_tokens")) as f64,
        cache_creation: to_int(get("cache_creation_input_tokens")) as f64,
        reasoning: 0.0,
    }
}

/// upstream scanFile: lines are pre-filtered on the substring `"name":"Skill"` and only those parsed;
/// tool_use/Skill/id deduped across files, input.skill non-empty; a turn's tokens split evenly by block.
pub(super) fn scan_transcript_file(
    path: &str,
    skills: &mut Vec<UsageEntry>,
    index: &mut HashMap<String, usize>,
    seen_block_ids: &mut HashSet<String>,
) {
    use std::io::BufRead;
    let Ok(file) = fs::File::open(path) else {
        return;
    };
    let reader = std::io::BufReader::new(file);
    for line_bytes in reader.split(b'\n') {
        let Ok(line_bytes) = line_bytes else { continue };
        let line = String::from_utf8_lossy(&line_bytes);
        let line = line.strip_suffix('\r').unwrap_or(&line);
        if !line.contains("\"name\":\"Skill\"") {
            continue;
        }
        let Ok(obj) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let Some(content) = obj
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(Value::as_array)
        else {
            continue;
        };
        // Collect this turn's fresh Skill calls first, then split the usage.
        let mut blocks: Vec<String> = Vec::new();
        for block in content {
            if block.get("type").and_then(Value::as_str) != Some("tool_use") {
                continue;
            }
            if block.get("name").and_then(Value::as_str) != Some("Skill") {
                continue;
            }
            let id = block
                .get("id")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty());
            if let Some(id) = id {
                if seen_block_ids.contains(id) {
                    continue;
                }
            }
            let skill_name = js_string(block.get("input").and_then(|input| input.get("skill")))
                .trim()
                .to_string();
            if skill_name.is_empty() {
                continue;
            }
            if let Some(id) = id {
                seen_block_ids.insert(id.to_string());
            }
            blocks.push(skill_name);
        }
        if blocks.is_empty() {
            continue;
        }
        let ts = obj
            .get("timestamp")
            .and_then(Value::as_str)
            .map(str::to_string);
        let turn_tokens = normalize_usage(obj.get("message").and_then(|m| m.get("usage")));
        let share = 1.0 / blocks.len() as f64;
        for skill_name in blocks {
            let entry_index = match index.get(&skill_name) {
                Some(&i) => i,
                None => {
                    let i = skills.len();
                    skills.push(UsageEntry {
                        skill: skill_name.clone(),
                        invocations: 0,
                        last_used_at: None,
                        tokens: UsageTokens::default(),
                    });
                    index.insert(skill_name, i);
                    i
                }
            };
            let entry = &mut skills[entry_index];
            entry.invocations += 1; // invocations aren't split
            if let Some(ts) = &ts {
                if entry
                    .last_used_at
                    .as_deref()
                    .map(|current| ts.as_str() > current)
                    .unwrap_or(true)
                {
                    entry.last_used_at = Some(ts.clone());
                }
            }
            entry.tokens.input += turn_tokens.input * share;
            entry.tokens.output += turn_tokens.output * share;
            entry.tokens.cached_input += turn_tokens.cached_input * share;
            entry.tokens.cache_creation += turn_tokens.cache_creation * share;
            entry.tokens.reasoning += turn_tokens.reasoning * share;
        }
    }
}

/// upstream roundTokens: rounded to integers, total_tokens = the sum of the five columns.
pub(super) fn round_tokens(tokens: &UsageTokens) -> Value {
    let input = tokens.input.round() as i64;
    let output = tokens.output.round() as i64;
    let cached_input = tokens.cached_input.round() as i64;
    let cache_creation = tokens.cache_creation.round() as i64;
    let reasoning = tokens.reasoning.round() as i64;
    json!({
        "input_tokens": input,
        "output_tokens": output,
        "cached_input_tokens": cached_input,
        "cache_creation_input_tokens": cache_creation,
        "reasoning_output_tokens": reasoning,
        "total_tokens": input + output + cached_input + cache_creation + reasoning,
    })
}

/// upstream serialize: skills by invocations, descending (models left out).
pub(super) fn serialize_usage(skills: &[UsageEntry]) -> Vec<Value> {
    let mut entries: Vec<Value> = skills
        .iter()
        .map(|entry| {
            json!({
                "skill": entry.skill,
                "invocations": entry.invocations,
                "lastUsedAt": entry.last_used_at.as_deref().map(Value::from).unwrap_or(Value::Null),
                "tokens": round_tokens(&entry.tokens),
            })
        })
        .collect();
    entries.sort_by(|a, b| {
        let ai = a.get("invocations").and_then(Value::as_i64).unwrap_or(0);
        let bi = b.get("invocations").and_then(Value::as_i64).unwrap_or(0);
        bi.cmp(&ai)
    });
    entries
}

/// upstream scanSkillUsage: fingerprint plus a 10-minute cache.
pub(super) fn scan_skill_usage(force: bool) -> Value {
    scan_skill_usage_in(&claude_projects_dir(), force)
}

/// The scan itself, with the folder passed in so tests stay isolated.
pub(super) fn scan_skill_usage_in(projects_dir: &Path, force: bool) -> Value {
    let files = list_transcript_files(projects_dir);
    let fingerprint = fingerprint_files(&files);
    if !force {
        if let Some(cached) = read_json(&usage_cache_path()) {
            if cache_hit(
                &cached,
                &fingerprint,
                "generatedAt",
                USAGE_CACHE_TTL_MS,
                "skills",
                false,
            ) {
                let mut result = cached.as_object().cloned().unwrap_or_default();
                result.insert("cached".to_string(), json!(true));
                return Value::Object(result);
            }
        }
    }

    let mut skills: Vec<UsageEntry> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut seen_block_ids: HashSet<String> = HashSet::new();
    for file in &files {
        scan_transcript_file(&file.path, &mut skills, &mut index, &mut seen_block_ids);
    }
    let total_invocations: i64 = skills.iter().map(|s| s.invocations).sum();
    let result = json!({
        "fingerprint": fingerprint,
        "generatedAt": now_ms(),
        "scannedFiles": files.len(),
        "totalInvocations": total_invocations,
        "skills": serialize_usage(&skills),
    });
    // A best-effort cache write (0o600, one JSON line and a newline).
    let _ = ensure_dir(&skills_root());
    if let Ok(text) = serde_json::to_string(&result) {
        let _ = write_file_private(&usage_cache_path(), &format!("{text}\n"));
    }
    let mut out = result.as_object().cloned().unwrap_or_default();
    out.insert("cached".to_string(), json!(false));
    Value::Object(out)
}

/// upstream local-api.js's skill_usage join: exact directory → unique directory leaf → unique
/// name; unusedInstalled = installed skills nothing matched. Neither cost nor models are returned.
pub(super) fn skill_usage_query(force: bool) -> Value {
    let usage = scan_skill_usage(force);
    let installed = list_installed_skills();

    fn directory_leaf(value: &str) -> String {
        value
            .replace('\\', "/")
            .split('/')
            .rfind(|part| !part.is_empty())
            .map(|leaf| leaf.trim().to_lowercase())
            .unwrap_or_default()
    }

    let mut leaf_counts: HashMap<String, usize> = HashMap::new();
    for skill in &installed {
        let leaf = directory_leaf(&js_string(skill.get("directory")));
        if !leaf.is_empty() {
            *leaf_counts.entry(leaf).or_insert(0) += 1;
        }
    }
    let mut by_directory: HashMap<String, &Value> = HashMap::new();
    let mut by_leaf: HashMap<String, &Value> = HashMap::new();
    let mut name_counts: HashMap<String, usize> = HashMap::new();
    let mut by_name: HashMap<String, &Value> = HashMap::new();
    for skill in &installed {
        let dir = js_string(skill.get("directory")).trim().to_lowercase();
        if !dir.is_empty() {
            by_directory.insert(dir, skill);
        }
        let leaf = directory_leaf(&js_string(skill.get("directory")));
        if !leaf.is_empty() && leaf_counts.get(&leaf) == Some(&1) {
            by_leaf.insert(leaf, skill);
        }
        let name = js_string(skill.get("name")).trim().to_lowercase();
        if !name.is_empty() {
            *name_counts.entry(name.clone()).or_insert(0) += 1;
            by_name.entry(name).or_insert(skill);
        }
    }
    let find_installed = |value: &str| -> Option<&Value> {
        let norm = value.trim().to_lowercase();
        if norm.is_empty() {
            return None;
        }
        if let Some(skill) = by_directory.get(&norm) {
            return Some(skill);
        }
        if let Some(skill) = by_leaf.get(&norm) {
            return Some(skill);
        }
        if name_counts.get(&norm) == Some(&1) {
            if let Some(skill) = by_name.get(&norm) {
                return Some(skill);
            }
        }
        None
    };

    let mut used_skill_ids: HashSet<String> = HashSet::new();
    let usage_skills = usage
        .get("skills")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut joined: Vec<Value> = Vec::new();
    for entry in &usage_skills {
        let matched = find_installed(&js_string(entry.get("skill")));
        if let Some(id) = matched.and_then(|m| m.get("id")).and_then(Value::as_str) {
            if !id.is_empty() {
                used_skill_ids.insert(id.to_string());
            }
        }
        joined.push(json!({
            "skill": entry.get("skill").cloned().unwrap_or(Value::Null),
            "invocations": entry.get("invocations").cloned().unwrap_or_else(|| json!(0)),
            "lastUsedAt": entry.get("lastUsedAt").cloned().unwrap_or(Value::Null),
            "tokens": entry.get("tokens").cloned().unwrap_or(Value::Null),
            "installed": matched.is_some(),
            "skillId": matched.and_then(|m| m.get("id").cloned()).unwrap_or(Value::Null),
            "directory": matched.and_then(|m| m.get("directory").cloned()).unwrap_or(Value::Null),
        }));
    }
    let unused_installed: Vec<Value> = installed
        .iter()
        .filter(|skill| {
            skill
                .get("id")
                .and_then(Value::as_str)
                .map(|id| !used_skill_ids.contains(id))
                .unwrap_or(true)
        })
        .map(|skill| {
            json!({
                "skillId": skill.get("id").cloned().unwrap_or(Value::Null),
                "directory": skill.get("directory").cloned().unwrap_or(Value::Null),
                "name": skill.get("name").cloned().unwrap_or(Value::Null),
            })
        })
        .collect();
    json!({
        "engine": "claude",
        "scope": USAGE_SCOPE_CLAUDE_TRANSCRIPTS,
        "generatedAt": usage.get("generatedAt").cloned().unwrap_or(Value::Null),
        "scannedFiles": usage.get("scannedFiles").cloned().unwrap_or(json!(0)),
        "totalInvocations": usage.get("totalInvocations").cloned().unwrap_or(json!(0)),
        "cached": usage.get("cached").cloned().unwrap_or(json!(false)),
        "skills": joined,
        "unusedInstalled": unused_installed,
    })
}
