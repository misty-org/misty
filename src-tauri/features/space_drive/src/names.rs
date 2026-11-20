// Adapted from Kura's kuragine (`src-tauri/crates/kuragine/src/names.rs`,
// https://github.com/kannachi323/kura): drive paths, safe local names, case collisions and junk names.
//
// MIT License
//
// Copyright (c) 2026 Kura contributors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
// associated documentation files (the "Software"), to deal in the Software without restriction,
// including without limitation the rights to use, copy, modify, merge, publish, distribute,
// sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all copies or
// substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
// NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//
// Misty's changes: names are kept in NFC as the server keeps them, the server's own name rules are
// checked here, and the path checks shared folders use (`spaces_folders/paths.rs`) moved in.

//! Drive paths and the local names items get.
//!
//! A drive path is `/`-rooted and uses `/` whatever the platform: `/`, `/Reports`,
//! `/Reports/q3.xlsx`. It is the item's path under its Space's mount after names were made safe
//! and unique on this computer, so it maps one-to-one to a local path.
use std::{
    collections::{HashMap, HashSet},
    path::{Component, Path, PathBuf},
};

use unicode_normalization::UnicodeNormalization;

pub const ROOT: &str = "/";

pub fn join(parent: &str, name: &str) -> String {
    if parent == ROOT || parent.is_empty() {
        format!("/{name}")
    } else {
        format!("{parent}/{name}")
    }
}

pub fn parent(path: &str) -> String {
    match path.rfind('/') {
        Some(0) | None => ROOT.to_owned(),
        Some(index) => path[..index].to_owned(),
    }
}

pub fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or_default()
}

/// Whether `path` is `ancestor` or inside it.
pub fn is_within(path: &str, ancestor: &str) -> bool {
    ancestor == ROOT
        || path == ancestor
        || (path.starts_with(ancestor) && path.as_bytes().get(ancestor.len()) == Some(&b'/'))
}

/// Rewrites `path` from under `from` to under `to`.
pub fn rebase(path: &str, from: &str, to: &str) -> String {
    if path == from {
        return to.to_owned();
    }
    let rest = &path[from.len()..];
    if to == ROOT {
        rest.to_owned()
    } else {
        format!("{to}{rest}")
    }
}

/// A drive path a window or the extension named, checked and normalized: `/`-rooted, no `.` or
/// `..` parts, no empty parts, NFC. `""` and `"/"` are the root.
pub fn drive_path(text: &str) -> Result<String, String> {
    let refuse = || Err(format!("“{text}” isn't a path in the drive."));
    if text.len() > 16 * 1024 || text.contains(['\\', '\0']) {
        return refuse();
    }
    let mut parts = Vec::new();
    for part in text.split('/').filter(|part| !part.is_empty()) {
        if part == "." || part == ".." {
            return refuse();
        }
        parts.push(nfc(part));
    }
    Ok(if parts.is_empty() {
        ROOT.to_owned()
    } else {
        format!("/{}", parts.join("/"))
    })
}

/// Converts a path relative to a mount into a drive path.
pub fn path_from_components(relative: &Path) -> Result<String, String> {
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => parts.push(nfc(
                part.to_str()
                    .ok_or_else(|| "File names must be valid Unicode.".to_owned())?,
            )),
            Component::CurDir => {}
            _ => return Err("Drive paths can't leave their drive.".to_owned()),
        }
    }
    Ok(if parts.is_empty() {
        ROOT.to_owned()
    } else {
        format!("/{}", parts.join("/"))
    })
}

pub fn local_path(mount: &Path, path: &str) -> PathBuf {
    let mut out = mount.to_path_buf();
    for part in path.split('/').filter(|part| !part.is_empty()) {
        out.push(part);
    }
    out
}

/// A name in NFC, as the server keeps names.
pub fn nfc(name: &str) -> String {
    name.nfc().collect()
}

/// Whether the server takes `name`: NFC, 1–255 bytes, no `/`, `\`, NUL or control characters, not
/// `.` or `..`.
pub fn server_accepts(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 255
        && name != "."
        && name != ".."
        && !name.chars().any(|c| c == '/' || c == '\\' || c.is_control())
        && nfc(name) == name
}

/// A local name made acceptable to the server: NFC, look-alikes for what it refuses, and
/// shortened to 255 bytes on a character boundary, keeping the extension.
pub fn server_name(local: &str) -> String {
    let mut out = String::with_capacity(local.len());
    for ch in nfc(local).chars() {
        out.push(match ch {
            '/' => '／',
            '\\' => '＼',
            c if c.is_control() => '_',
            c => c,
        });
    }
    if out.is_empty() || out == "." || out == ".." {
        out.insert(0, '_');
    }
    shorten(&out, 255)
}

fn shorten(name: &str, bytes: usize) -> String {
    if name.len() <= bytes {
        return name.to_owned();
    }
    let (stem, extension) = split_extension(name);
    let tail = extension.map(|ext| format!(".{ext}")).unwrap_or_default();
    let room = bytes.saturating_sub(tail.len());
    let mut cut = String::new();
    for ch in stem.chars() {
        if cut.len() + ch.len_utf8() > room {
            break;
        }
        cut.push(ch);
    }
    format!("{cut}{tail}")
}

/// Makes a server name usable as a local file name. Windows refuses several more characters than
/// the server does, so those become look-alikes.
pub fn safe_local_name(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for ch in name.chars() {
        let mapped = match ch {
            '/' => '／',
            '\\' => '＼',
            '\0'..='\u{1f}' => '_',
            ':' if cfg!(windows) => '：',
            '*' if cfg!(windows) => '＊',
            '?' if cfg!(windows) => '？',
            '"' if cfg!(windows) => '＂',
            '<' if cfg!(windows) => '＜',
            '>' if cfg!(windows) => '＞',
            '|' if cfg!(windows) => '｜',
            other => other,
        };
        out.push(mapped);
    }
    if out.is_empty() || out == "." || out == ".." {
        out.insert(0, '_');
    }
    if cfg!(windows) {
        if out.ends_with('.') || out.ends_with(' ') {
            out.push('_');
        }
        let stem = out
            .split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || ((stem.starts_with("COM") || stem.starts_with("LPT"))
                && stem.len() == 4
                && stem.as_bytes()[3].is_ascii_digit());
        if reserved {
            out.insert(0, '_');
        }
    }
    nfc(&out)
}

/// The key two names collide under: most local disks treat names that differ only in case as
/// one, and the server keeps names unique by `lower()`.
pub fn fold(name: &str) -> String {
    nfc(name).to_lowercase()
}

/// Gives every entry in one folder a distinct local name. Names that collide (names differing
/// only in case, or two that became the same look-alike) get ` (2)`, ` (3)`, … in the order of
/// `keys`, so the same listing always produces the same names.
pub fn unique_names(names: &[String], keys: &[String]) -> Vec<String> {
    let mut order: Vec<usize> = (0..names.len()).collect();
    order.sort_by(|&left, &right| {
        fold(&names[left])
            .cmp(&fold(&names[right]))
            .then_with(|| keys[left].cmp(&keys[right]))
    });
    let mut taken: HashSet<String> = HashSet::new();
    let mut result = vec![String::new(); names.len()];
    // Unique names keep their spelling even if a later suffix would collide.
    let mut counts = HashMap::<String, usize>::new();
    for name in names {
        *counts.entry(fold(name)).or_default() += 1;
    }
    for &index in &order {
        if counts[&fold(&names[index])] == 1 {
            taken.insert(fold(&names[index]));
            result[index] = names[index].clone();
        }
    }
    for &index in &order {
        if !result[index].is_empty() {
            continue;
        }
        let name = &names[index];
        let mut candidate = name.clone();
        let mut n = 1;
        while taken.contains(&fold(&candidate)) {
            n += 1;
            candidate = numbered(name, n);
        }
        taken.insert(fold(&candidate));
        result[index] = candidate;
    }
    result
}

/// `name` with ` (n)` before its extension.
pub fn numbered(name: &str, n: usize) -> String {
    let (stem, extension) = split_extension(name);
    match extension {
        Some(extension) => format!("{stem} ({n}).{extension}"),
        None => format!("{stem} ({n})"),
    }
}

/// `name` with ` (note)` before its extension: `Report (restored).pdf`.
pub fn noted(name: &str, note: &str) -> String {
    let (stem, extension) = split_extension(name);
    let out = match extension {
        Some(extension) => format!("{stem} ({note}).{extension}"),
        None => format!("{stem} ({note})"),
    };
    shorten(&out, 255)
}

pub fn split_extension(name: &str) -> (&str, Option<&str>) {
    match name.rfind('.') {
        Some(index) if index > 0 && index + 1 < name.len() => {
            (&name[..index], Some(&name[index + 1..]))
        }
        _ => (name, None),
    }
}

/// Files editors and the OS create next to documents. They are never uploaded.
pub fn is_scratch_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    name.starts_with("~$")
        || name.starts_with(".~lock.")
        || name.starts_with(".#")
        || name.ends_with('~')
        || matches!(
            lower.as_str(),
            ".ds_store" | "thumbs.db" | "desktop.ini" | ".localized"
        )
        || lower.starts_with("._")
        || [
            ".tmp",
            ".temp",
            ".swp",
            ".swo",
            ".swx",
            ".crdownload",
            ".part",
            ".partial",
            ".download",
        ]
        .iter()
        .any(|suffix| lower.ends_with(suffix))
        || lower.contains(".sb-") // macOS safe-save scratch files
}

// The checks shared folders make on paths a window or the server names, moved here from
// `spaces_folders/paths.rs`, which re-exports them.

/// A path inside a shared folder, as the server and the walker write it (`docs/notes.md`), turned
/// into a relative path. Refused: empty, absolute, `.` or `..` parts, backslashes, and any `.git`
/// part, so nothing reaches outside the folder or plants a repository's hooks in Misty's cache.
pub fn relative(text: &str) -> Result<PathBuf, String> {
    let refuse = || Err(format!("“{text}” isn't a path inside the folder."));
    if text.is_empty() || text.len() > 4096 || text.contains(['\\', '\0']) {
        return refuse();
    }
    let mut path = PathBuf::new();
    for part in text.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.eq_ignore_ascii_case(".git") {
            return refuse();
        }
        if cfg!(windows) && part.contains(':') {
            return refuse();
        }
        path.push(part);
    }
    if path.is_absolute() || path.components().any(|part| !matches!(part, Component::Normal(_))) {
        return refuse();
    }
    Ok(path)
}

/// A path relative to `root` as the server writes it, `/` between its parts. `None` for the root
/// itself, a path outside it, or a name that isn't UTF-8 (it couldn't be named on the server).
pub fn relative_text(root: &Path, path: &Path) -> Option<String> {
    let rest = path.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for part in rest.components() {
        match part {
            Component::Normal(name) => parts.push(name.to_str()?),
            _ => return None,
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// A 64-character SHA-256 in hex, lowercased.
pub fn sha256(text: &str) -> Result<String, String> {
    let fine = text.len() == 64 && text.bytes().all(|byte| byte.is_ascii_hexdigit());
    fine.then(|| text.to_ascii_lowercase())
        .ok_or_else(|| "The folder's file list has a bad checksum.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_and_splits_drive_paths() {
        assert_eq!(join(ROOT, "a"), "/a");
        assert_eq!(join("/a", "b.txt"), "/a/b.txt");
        assert_eq!(parent("/a/b.txt"), "/a");
        assert_eq!(parent("/a"), ROOT);
        assert_eq!(file_name("/a/b.txt"), "b.txt");
        assert!(is_within("/a/b", "/a"));
        assert!(!is_within("/ab", "/a"));
        assert!(is_within("/anything", ROOT));
        assert_eq!(rebase("/a/b/c", "/a/b", "/x"), "/x/c");
        assert_eq!(rebase("/a/b", "/a/b", "/x"), "/x");
        assert_eq!(rebase("/a/b", "/a", ROOT), "/b");
    }

    #[test]
    fn checks_paths_a_window_names() {
        assert_eq!(drive_path("").unwrap(), "/");
        assert_eq!(drive_path("/a//b/").unwrap(), "/a/b");
        assert!(drive_path("/a/../b").is_err());
        assert!(drive_path("a\\b").is_err());
        assert!(path_from_components(Path::new("a/../b")).is_err());
        assert_eq!(path_from_components(Path::new("a/b")).unwrap(), "/a/b");
    }

    #[test]
    fn keeps_names_in_nfc() {
        let decomposed = "Cafe\u{301}.txt";
        assert_eq!(nfc(decomposed), "Café.txt");
        assert!(!server_accepts(decomposed));
        assert!(server_accepts("Café.txt"));
        assert_eq!(server_name(decomposed), "Café.txt");
        assert_eq!(fold("CAFÉ.TXT"), fold(decomposed));
    }

    #[test]
    fn makes_names_safe() {
        assert_eq!(safe_local_name("a/b"), "a／b");
        assert_eq!(safe_local_name(".."), "_..");
        assert_eq!(safe_local_name(""), "_");
        assert_eq!(safe_local_name("ok.txt"), "ok.txt");
        assert!(server_name(&"x".repeat(300)).len() <= 255);
    }

    #[test]
    fn numbers_colliding_names_stably() {
        let names: Vec<String> = ["Report.pdf", "report.pdf", "Notes", "Report.pdf"]
            .map(String::from)
            .to_vec();
        let keys: Vec<String> = ["b", "a", "z", "c"].map(String::from).to_vec();
        let unique = unique_names(&names, &keys);
        assert_eq!(unique[1], "report.pdf");
        assert_eq!(unique[0], "Report (2).pdf");
        assert_eq!(unique[3], "Report (3).pdf");
        assert_eq!(unique[2], "Notes");
    }

    #[test]
    fn notes_go_before_the_extension() {
        assert_eq!(
            noted("Report.pdf", "Ben's conflicting copy 2026-11-20"),
            "Report (Ben's conflicting copy 2026-11-20).pdf"
        );
        assert_eq!(noted("Notes", "x"), "Notes (x)");
    }

    #[test]
    fn recognizes_scratch_files() {
        for name in ["~$report.docx", ".DS_Store", "a.txt.swp", "notes.tmp", "x~", "._a"] {
            assert!(is_scratch_name(name), "{name}");
        }
        for name in ["report.docx", ".gitignore", "temp.txt"] {
            assert!(!is_scratch_name(name), "{name}");
        }
    }
}
