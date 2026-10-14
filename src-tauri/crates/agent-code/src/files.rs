//! The file tools: read, write, edit, list, find and search.
//!
//! Reads show each line as `12:k3f|text`: its number and a short hash of its
//! content. Edits can name lines by that anchor instead of retyping old text,
//! which cheaper models get right far more often; an anchor whose hash no
//! longer matches means the file changed since it was read.
use std::{
    io::Read,
    path::{Path, PathBuf},
};

use globset::GlobBuilder;
use regex::RegexBuilder;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    beneath::{self, Entry},
    io_fix, walk, CodeError,
};

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_LINE_CHARS: usize = 2_000;
const DEFAULT_READ_LINES: usize = 400;
const MAX_READ_LINES: usize = 2_000;
/// One read returns at most this much text; the rest comes with offset.
const MAX_READ_BYTES: usize = 100_000;
const MAX_SEARCH_RESULTS: usize = 300;
const MAX_FIND_RESULTS: usize = 500;
const MAX_LIST_ENTRIES: usize = 500;
const MAX_WALK_FILES: usize = 20_000;

const ANCHOR_ALPHABET: &[u8; 32] = b"0123456789abcdefghjkmnpqrstvwxyz";

/// Three characters from a hash of one line's text.
pub fn line_hash(line: &str) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for byte in line.trim_end_matches('\r').bytes() {
        hash ^= byte as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    (0..3)
        .map(|index| ANCHOR_ALPHABET[((hash >> (index * 5)) & 31) as usize] as char)
        .collect()
}

fn anchored(number: usize, line: &str) -> String {
    let text = line.trim_end_matches('\r');
    let shown: String = text.chars().take(MAX_LINE_CHARS).collect();
    let cut = if shown.len() < text.len() { " … [line cut]" } else { "" };
    format!("{number}:{}|{shown}{cut}", line_hash(line))
}

fn checked(relative: &str) -> Result<PathBuf, CodeError> {
    let path = beneath::clean_relative(relative)?;
    if path.as_os_str().is_empty() {
        return Err(CodeError::fix("Name a file inside the project."));
    }
    if let Some(reason) = beneath::protected(&path) {
        return Err(CodeError::fix(reason));
    }
    Ok(path)
}

/// A project path as the model reads and writes it: `/` between parts on
/// every platform.
fn display(path: &Path) -> String {
    let text = path.to_string_lossy();
    if cfg!(windows) {
        text.replace('\\', "/")
    } else {
        text.into_owned()
    }
}

/// Reads a whole text file, refusing binaries and very large files.
fn read_text(root: &std::fs::File, path: &Path) -> Result<String, CodeError> {
    let file = beneath::open_file(root, path).map_err(|error| io_fix("open that file", error))?;
    let size = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    if size > MAX_FILE_BYTES {
        return Err(CodeError::fix(format!(
            "{} is {} KB, more than the 2 MB agents can open. Search it instead.",
            display(path),
            size / 1024
        )));
    }
    let mut bytes = Vec::with_capacity(size as usize);
    file.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| io_fix("read that file", error))?;
    if bytes.iter().take(8_000).any(|byte| *byte == 0) {
        return Err(CodeError::fix(format!(
            "{} is a binary file ({} KB) and can't be shown as text.",
            display(path),
            size / 1024
        )));
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn split_lines(text: &str) -> Vec<&str> {
    if text.is_empty() {
        return Vec::new();
    }
    let body = text.strip_suffix('\n').unwrap_or(text);
    body.split('\n').collect()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadRequest {
    pub path: String,
    #[serde(default)]
    pub offset: Option<usize>,
    #[serde(default)]
    pub limit: Option<usize>,
}

pub fn read(root: &std::fs::File, request: ReadRequest) -> Result<Value, CodeError> {
    let path = checked(&request.path)?;
    let text = read_text(root, &path)?;
    let lines = split_lines(&text);
    let start = request.offset.unwrap_or(1).max(1);
    let limit = request
        .limit
        .unwrap_or(DEFAULT_READ_LINES)
        .clamp(1, MAX_READ_LINES);
    if start > lines.len().max(1) {
        return Err(CodeError::fix(format!(
            "{} has {} lines; start at or before line {}.",
            display(&path),
            lines.len(),
            lines.len().max(1)
        )));
    }
    let last = (start - 1 + limit).min(lines.len());
    let mut shown = Vec::new();
    let mut bytes = 0;
    for (index, line) in lines[start - 1..last].iter().enumerate() {
        let text = anchored(start + index, line);
        if bytes + text.len() > MAX_READ_BYTES && !shown.is_empty() {
            break;
        }
        bytes += text.len() + 1;
        shown.push(text);
    }
    let end = start - 1 + shown.len();
    let content = shown.join("\n");
    Ok(json!({
        "path": display(&path),
        "totalLines": lines.len(),
        "startLine": start,
        "endLine": end,
        "content": content,
        "more": end < lines.len(),
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteRequest {
    pub path: String,
    pub content: String,
}

pub fn write(root: &std::fs::File, request: WriteRequest) -> Result<Value, CodeError> {
    let path = checked(&request.path)?;
    if request.content.len() as u64 > MAX_FILE_BYTES {
        return Err(CodeError::fix(
            "That content is over 2 MB. Split it into smaller files.",
        ));
    }
    let created = beneath::write_file(root, &path, request.content.as_bytes())
        .map_err(|error| io_fix("write that file", error))?;
    Ok(json!({
        "path": display(&path),
        "created": created,
        "bytes": request.content.len(),
        "lines": split_lines(&request.content).len(),
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditRequest {
    pub path: String,
    /// Exact text to replace (string mode).
    #[serde(default)]
    pub old_text: Option<String>,
    #[serde(default)]
    pub new_text: Option<String>,
    #[serde(default)]
    pub replace_all: bool,
    /// First line to replace, as `12:k3f` (anchor mode).
    #[serde(default)]
    pub start: Option<String>,
    /// Last line to replace; defaults to `start`.
    #[serde(default)]
    pub end: Option<String>,
    /// Insert after this line instead of replacing (`0` for the top).
    #[serde(default)]
    pub after: Option<String>,
    /// Replacement lines for anchor mode. Empty deletes the range.
    #[serde(default)]
    pub content: Option<String>,
}

fn parse_anchor(value: &str, lines: &[&str], path: &Path) -> Result<usize, CodeError> {
    let value = value.trim();
    let (number, hash) = value.split_once(':').unwrap_or((value, ""));
    let number: usize = number.trim().parse().map_err(|_| {
        CodeError::fix(format!(
            "{value} isn't a line anchor. Use the number:hash shown by code_read, like 12:k3f."
        ))
    })?;
    if number == 0 || number > lines.len() {
        return Err(CodeError::fix(format!(
            "{} has {} lines; line {number} doesn't exist. Read it again.",
            display(path),
            lines.len()
        )));
    }
    let current = line_hash(lines[number - 1]);
    if !hash.is_empty() && hash.trim() != current {
        return Err(CodeError::fix(format!(
            "Line {number} of {} changed since it was read (it is now {number}:{current}). Read the file again before editing.",
            display(path)
        )));
    }
    if hash.is_empty() {
        return Err(CodeError::fix(format!(
            "Give the full anchor for line {number}, such as {number}:{current}, so the edit can't land on changed lines."
        )));
    }
    Ok(number)
}

fn snippet(lines: &[String], from: usize, to: usize) -> String {
    let first = from.saturating_sub(3).max(1);
    let last = (to + 3).min(lines.len());
    (first..=last)
        .filter(|number| *number >= 1 && *number <= lines.len())
        .map(|number| anchored(number, &lines[number - 1]))
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn edit(root: &std::fs::File, request: EditRequest) -> Result<Value, CodeError> {
    let path = checked(&request.path)?;
    let text = read_text(root, &path)?;
    let crlf = text.contains("\r\n");
    let newline = if crlf { "\r\n" } else { "\n" };
    let trailing_newline = text.ends_with('\n');
    let (updated, changed_from, changed_to, replacements) = if let Some(old) = request.old_text {
        let new = request.new_text.unwrap_or_default();
        if old.is_empty() {
            return Err(CodeError::fix(
                "oldText is empty. To add text, include a nearby line in oldText, or use an anchor edit with after.",
            ));
        }
        let (old, new) = if crlf && !old.contains("\r\n") {
            (old.replace('\n', "\r\n"), new.replace('\n', "\r\n"))
        } else {
            (old, new)
        };
        let count = text.matches(&old).count();
        if count == 0 {
            return Err(CodeError::fix(format!(
                "oldText wasn't found in {}. Read the file again and copy the text exactly, including indentation, or use a line-anchor edit.",
                display(&path)
            )));
        }
        if count > 1 && !request.replace_all {
            return Err(CodeError::fix(format!(
                "oldText appears {count} times in {}. Include more surrounding lines so it is unique, or set replaceAll.",
                display(&path)
            )));
        }
        let first_at = text.find(&old).unwrap_or(0);
        let from = text[..first_at].matches('\n').count() + 1;
        let updated = if request.replace_all {
            text.replace(&old, &new)
        } else {
            text.replacen(&old, &new, 1)
        };
        let to = from + new.matches('\n').count();
        (updated, from, to, count.min(if request.replace_all { count } else { 1 }))
    } else {
        let lines = split_lines(&text);
        let content = request.content.unwrap_or_default();
        let content = content.strip_suffix('\n').unwrap_or(&content).to_owned();
        let inserted: Vec<String> = if content.is_empty() {
            Vec::new()
        } else {
            content
                .split('\n')
                .map(|line| line.trim_end_matches('\r').to_owned())
                .collect()
        };
        let mut owned: Vec<String> = lines
            .iter()
            .map(|line| line.trim_end_matches('\r').to_owned())
            .collect();
        let (from, to) = if let Some(after) = request.after {
            let at = if after.trim() == "0" {
                0
            } else {
                parse_anchor(&after, &lines, &path)?
            };
            let count = inserted.len();
            owned.splice(at..at, inserted);
            (at + 1, at + count)
        } else if let Some(start) = request.start {
            let first = parse_anchor(&start, &lines, &path)?;
            let last = match request.end {
                Some(end) => parse_anchor(&end, &lines, &path)?,
                None => first,
            };
            if last < first {
                return Err(CodeError::fix("end comes before start."));
            }
            let count = inserted.len();
            owned.splice(first - 1..last, inserted);
            (first, (first + count).saturating_sub(1).max(first))
        } else {
            return Err(CodeError::fix(
                "Say what to change: oldText and newText, or start (and end) with content, or after with content.",
            ));
        };
        let mut updated = owned.join(newline);
        if trailing_newline || (lines.is_empty() && !owned.is_empty()) {
            updated.push_str(newline);
        }
        (updated, from, to, 1)
    };
    if updated == text {
        return Err(CodeError::fix("That edit changes nothing."));
    }
    if updated.len() as u64 > MAX_FILE_BYTES {
        return Err(CodeError::fix("The edited file would be over 2 MB."));
    }
    beneath::write_file(root, &path, updated.as_bytes())
        .map_err(|error| io_fix("save that file", error))?;
    let lines: Vec<String> = split_lines(&updated)
        .into_iter()
        .map(str::to_owned)
        .collect();
    Ok(json!({
        "path": display(&path),
        "replacements": replacements,
        "totalLines": lines.len(),
        "around": snippet(&lines, changed_from, changed_to),
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRequest {
    #[serde(default)]
    pub path: String,
}

pub fn list(root: &std::fs::File, request: ListRequest) -> Result<Value, CodeError> {
    let path = beneath::clean_relative(&request.path)?;
    if let Some(reason) = beneath::protected(&path) {
        return Err(CodeError::fix(reason));
    }
    let dir = beneath::open_dir(root, &path).map_err(|error| io_fix("open that folder", error))?;
    let mut entries = Vec::new();
    let mut more = false;
    let listing = list_names(&dir).map_err(|error| io_fix("list that folder", error))?;
    for name in listing {
        if beneath::internal_folder(&name).is_some() {
            continue;
        }
        if entries.len() >= MAX_LIST_ENTRIES {
            more = true;
            break;
        }
        let kind = match beneath::entry(&dir, std::ffi::OsStr::new(&name)) {
            Ok(Entry::Directory) => "folder",
            Ok(Entry::File { .. }) => "file",
            Ok(Entry::Symlink) => "symlink",
            _ => "other",
        };
        entries.push(json!({ "name": name, "kind": kind }));
    }
    Ok(json!({ "path": display(&path), "entries": entries, "more": more }))
}

fn list_names(dir: &std::fs::File) -> std::io::Result<Vec<String>> {
    let mut names: Vec<String> = beneath::list_names(dir)?
        .into_iter()
        .map(|name| name.to_string_lossy().into_owned())
        .collect();
    names.sort_by_key(|name| name.to_lowercase());
    Ok(names)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindRequest {
    pub pattern: String,
    #[serde(default)]
    pub path: String,
}

pub fn find(root_path: &Path, root: &std::fs::File, request: FindRequest) -> Result<Value, CodeError> {
    let start = beneath::clean_relative(&request.path)?;
    beneath::open_dir(root, &start).map_err(|error| io_fix("open that folder", error))?;
    let pattern = request.pattern.trim();
    let by_name = !pattern.contains('/');
    let glob = GlobBuilder::new(pattern)
        .literal_separator(true)
        .build()
        .map_err(|error| CodeError::fix(format!("That glob doesn't parse: {error}")))?
        .compile_matcher();
    let (all, cut) = walk::files(root_path, &start, MAX_WALK_FILES);
    let mut matches = Vec::new();
    let mut more = cut;
    for path in all {
        let candidate = if by_name {
            path.file_name().map(PathBuf::from).unwrap_or_default()
        } else {
            path.strip_prefix(&start).map(Path::to_path_buf).unwrap_or(path.clone())
        };
        if glob.is_match(&candidate) {
            if matches.len() >= MAX_FIND_RESULTS {
                more = true;
                break;
            }
            matches.push(display(&path));
        }
    }
    Ok(json!({ "files": matches, "more": more }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub pattern: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub glob: Option<String>,
    #[serde(default)]
    pub ignore_case: bool,
    #[serde(default)]
    pub max_results: Option<usize>,
}

pub fn search(root_path: &Path, root: &std::fs::File, request: SearchRequest) -> Result<Value, CodeError> {
    let regex = RegexBuilder::new(&request.pattern)
        .case_insensitive(request.ignore_case)
        .size_limit(1 << 20)
        .build()
        .map_err(|error| CodeError::fix(format!("That pattern doesn't parse as a regex: {error}")))?;
    let limit = request.max_results.unwrap_or(100).clamp(1, MAX_SEARCH_RESULTS);
    let glob = match request.glob.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        Some(pattern) => Some((
            GlobBuilder::new(pattern)
                .literal_separator(true)
                .build()
                .map_err(|error| CodeError::fix(format!("That glob doesn't parse: {error}")))?
                .compile_matcher(),
            !pattern.contains('/'),
        )),
        None => None,
    };
    let start = beneath::clean_relative(&request.path)?;
    let targets: Vec<PathBuf> = match beneath::open_dir(root, &start) {
        Ok(_) => walk::files(root_path, &start, MAX_WALK_FILES).0,
        Err(_) => vec![checked(&request.path)?],
    };
    let mut matches = Vec::new();
    let mut more = false;
    'files: for path in targets {
        if beneath::protected(&path).is_some() {
            continue;
        }
        if let Some((glob, by_name)) = &glob {
            let candidate = if *by_name {
                path.file_name().map(PathBuf::from).unwrap_or_default()
            } else {
                path.clone()
            };
            if !glob.is_match(&candidate) {
                continue;
            }
        }
        let Ok(text) = read_text(root, &path) else {
            continue;
        };
        for (index, line) in split_lines(&text).iter().enumerate() {
            if regex.is_match(line) {
                if matches.len() >= limit {
                    more = true;
                    break 'files;
                }
                let shown: String = line.trim_end_matches('\r').chars().take(300).collect();
                matches.push(format!(
                    "{}:{}:{}|{}",
                    display(&path),
                    index + 1,
                    line_hash(line),
                    shown
                ));
            }
        }
    }
    Ok(json!({ "matches": matches, "more": more }))
}
