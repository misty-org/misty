// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
//! Finder tags, the system's own, so Finder and Files agree. macOS keeps a file's tags in the
//! `com.apple.metadata:_kMDItemUserTags` extended attribute: a binary property list holding an
//! array of strings like "Red\n6" (the name, a newline, Finder's color number). Files reads and
//! writes that attribute directly, and finds tagged items through Spotlight (`mdfind`). Off macOS
//! there are no tags: every list is empty and setting them does nothing.
use std::path::{Path, PathBuf};

use file_access::{disk::check_disk_link, Access};

use super::entry::{entry_for, FileEntry, FinderTag};
use super::{asked_path, blocking, failed, person_window};

mod plist;

/// Finder's own color tags, in its menu order.
pub const COLOR_TAGS: [(&str, u8); 7] = [
    ("Red", 6),
    ("Orange", 7),
    ("Yellow", 5),
    ("Green", 2),
    ("Blue", 4),
    ("Purple", 3),
    ("Gray", 1),
];

/// The most items a Spotlight query hands back.
const MOST_FOUND: usize = 2_000;

#[cfg(target_os = "macos")]
const TAGS_ATTRIBUTE: &[u8] = b"com.apple.metadata:_kMDItemUserTags\0";

/// The tags on `path`, read from the item itself (a link's own, not its target's). Empty when it
/// has none, when the gate refuses it, or off macOS.
pub fn read_tags(path: &Path) -> Vec<FinderTag> {
    if check_disk_link(path, Access::Read).is_err() {
        return Vec::new();
    }
    read_attribute(path)
        .and_then(|data| plist::parse_strings(&data))
        .unwrap_or_default()
        .iter()
        .map(|text| parse_tag(text))
        .collect()
}

/// Replaces the tags on `path` with `tags`; none removes the attribute. Does nothing off macOS.
pub fn write_tags(path: &Path, tags: &[FinderTag]) -> std::io::Result<()> {
    check_disk_link(path, Access::Write)?;
    if tags.is_empty() {
        return remove_attribute(path);
    }
    let texts: Vec<String> = tags.iter().map(tag_text).collect();
    write_attribute(path, &plist::write_strings(&texts))
}

fn tag_text(tag: &FinderTag) -> String {
    if tag.color == 0 {
        tag.name.clone()
    } else {
        format!("{}\n{}", tag.name, tag.color)
    }
}

fn parse_tag(text: &str) -> FinderTag {
    match text.rsplit_once('\n') {
        Some((name, color)) => FinderTag {
            name: name.to_owned(),
            color: color.trim().parse().unwrap_or(0),
        },
        None => FinderTag {
            color: COLOR_TAGS
                .iter()
                .find(|(standard, _)| *standard == text)
                .map(|(_, color)| *color)
                .unwrap_or(0),
            name: text.to_owned(),
        },
    }
}

#[cfg(target_os = "macos")]
fn c_path(path: &Path) -> std::io::Result<std::ffi::CString> {
    use std::os::unix::ffi::OsStrExt;
    std::ffi::CString::new(path.as_os_str().as_bytes())
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "That name can't be tagged."))
}

#[cfg(target_os = "macos")]
fn read_attribute(path: &Path) -> Option<Vec<u8>> {
    let c_path = c_path(path).ok()?;
    let name = TAGS_ATTRIBUTE.as_ptr().cast();
    // SAFETY: both strings are NUL-terminated; a null buffer asks for the size.
    let size = unsafe {
        libc::getxattr(c_path.as_ptr(), name, std::ptr::null_mut(), 0, 0, libc::XATTR_NOFOLLOW)
    };
    if size <= 0 {
        return None;
    }
    let mut buffer = vec![0u8; size as usize];
    // SAFETY: `buffer` has room for `size` bytes.
    let read = unsafe {
        libc::getxattr(
            c_path.as_ptr(),
            name,
            buffer.as_mut_ptr().cast(),
            buffer.len(),
            0,
            libc::XATTR_NOFOLLOW,
        )
    };
    if read <= 0 {
        return None;
    }
    buffer.truncate(read as usize);
    Some(buffer)
}

#[cfg(target_os = "macos")]
fn write_attribute(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let c_path = c_path(path)?;
    // SAFETY: the path and name are NUL-terminated and `data` is `data.len()` bytes long.
    let result = unsafe {
        libc::setxattr(
            c_path.as_ptr(),
            TAGS_ATTRIBUTE.as_ptr().cast(),
            data.as_ptr().cast(),
            data.len(),
            0,
            libc::XATTR_NOFOLLOW,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(target_os = "macos")]
fn remove_attribute(path: &Path) -> std::io::Result<()> {
    let c_path = c_path(path)?;
    // SAFETY: both strings are NUL-terminated.
    let result = unsafe {
        libc::removexattr(c_path.as_ptr(), TAGS_ATTRIBUTE.as_ptr().cast(), libc::XATTR_NOFOLLOW)
    };
    if result == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ENOATTR) {
        Ok(())
    } else {
        Err(error)
    }
}

#[cfg(not(target_os = "macos"))]
fn read_attribute(_path: &Path) -> Option<Vec<u8>> {
    None
}

#[cfg(not(target_os = "macos"))]
fn write_attribute(_path: &Path, _data: &[u8]) -> std::io::Result<()> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn remove_attribute(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

/// Spotlight's paths for `query` in the home folder, waiting at most `wait`. Nothing when it
/// can't be asked, takes too long, or this isn't macOS.
async fn spotlight(query: String, wait: std::time::Duration) -> Vec<PathBuf> {
    if !cfg!(target_os = "macos") {
        return Vec::new();
    }
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let mut command = tokio::process::Command::new("/usr/bin/mdfind");
    command
        .arg("-onlyin")
        .arg(&home)
        .arg(query)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    let Ok(Ok(output)) = tokio::time::timeout(wait, command.output()).await else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.is_empty())
        .take(MOST_FOUND)
        .map(PathBuf::from)
        .collect()
}

/// A tag's name as a Spotlight query value, with its quotes, wildcards and backslashes escaped.
fn quoted(name: &str) -> String {
    let mut quoted = String::with_capacity(name.len() + 2);
    quoted.push('"');
    for character in name.chars() {
        if matches!(character, '"' | '\\' | '*' | '?') {
            quoted.push('\\');
        }
        quoted.push(character);
    }
    quoted.push('"');
    quoted
}

/// Finder's seven color tags, then every other tag in use, by name, each once.
fn tag_list(found: impl IntoIterator<Item = FinderTag>) -> Vec<FinderTag> {
    let mut tags: Vec<FinderTag> = COLOR_TAGS
        .iter()
        .map(|(name, color)| FinderTag { name: (*name).to_owned(), color: *color })
        .collect();
    let mut others: Vec<FinderTag> = Vec::new();
    for tag in found {
        if tag.name.trim().is_empty() {
            continue;
        }
        let same = |known: &FinderTag| known.name.to_lowercase() == tag.name.to_lowercase();
        if tags.iter().any(same) {
            continue;
        }
        match others.iter_mut().find(|known| same(known)) {
            Some(known) if known.color == 0 => known.color = tag.color,
            Some(_) => {}
            None => others.push(tag),
        }
    }
    others.sort_by_key(|tag| tag.name.to_lowercase());
    tags.extend(others);
    tags
}

/// Every tag in use in the home folder, after Finder's own, for the sidebar and the tag menu.
#[tauri::command]
pub async fn files_tags(webview: tauri::Webview) -> Result<Vec<FinderTag>, String> {
    person_window(&webview)?;
    if !cfg!(target_os = "macos") {
        return Ok(Vec::new());
    }
    let paths = spotlight("kMDItemUserTags == *".to_owned(), std::time::Duration::from_secs(2)).await;
    blocking(move || Ok(tag_list(paths.iter().flat_map(|path| read_tags(path))))).await
}

/// Sets exactly `tags` on each item.
#[tauri::command]
pub async fn files_set_tags(
    webview: tauri::Webview,
    paths: Vec<String>,
    tags: Vec<FinderTag>,
) -> Result<(), String> {
    person_window(&webview)?;
    let paths = paths.iter().map(|path| asked_path(path)).collect::<Result<Vec<_>, _>>()?;
    blocking(move || {
        let mut first_failure = None;
        for path in &paths {
            if let Err(error) = write_tags(path, &tags) {
                first_failure.get_or_insert_with(|| failed(path, error));
            }
        }
        first_failure.map_or(Ok(()), Err)
    })
    .await
}

/// The items in the home folder with the tag `name`.
#[tauri::command]
pub async fn files_tagged(webview: tauri::Webview, name: String) -> Result<Vec<FileEntry>, String> {
    person_window(&webview)?;
    if !cfg!(target_os = "macos") || name.trim().is_empty() {
        return Ok(Vec::new());
    }
    let query = format!("kMDItemUserTags == {}", quoted(&name));
    let paths = spotlight(query, std::time::Duration::from_secs(5)).await;
    blocking(move || {
        Ok(paths
            .iter()
            .filter(|path| file_access::disk::check_disk(path, Access::Read).is_ok())
            .filter_map(|path| entry_for(path).ok())
            .filter(|entry| entry.tags.iter().any(|tag| tag.name == name))
            .collect())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_read_back_as_written() {
        let tags = vec![
            FinderTag { name: "Red".into(), color: 6 },
            FinderTag { name: "Projects".into(), color: 0 },
            FinderTag { name: "A rather long tag name".into(), color: 4 },
            FinderTag { name: "Café ☕".into(), color: 2 },
        ];
        let data = plist::write_strings(&tags.iter().map(tag_text).collect::<Vec<_>>());
        let read: Vec<FinderTag> = plist::parse_strings(&data)
            .expect("parse")
            .iter()
            .map(|text| parse_tag(text))
            .collect();
        assert_eq!(read, tags);
    }

    #[test]
    fn a_bare_color_name_takes_finders_color() {
        assert_eq!(parse_tag("Orange"), FinderTag { name: "Orange".into(), color: 7 });
        assert_eq!(parse_tag("Mine\n3"), FinderTag { name: "Mine".into(), color: 3 });
    }

    #[test]
    fn spotlight_values_are_escaped() {
        assert_eq!(quoted(r#"a "b" *c?\"#), r#""a \"b\" \*c\?\\""#);
    }

    #[test]
    fn the_tag_list_puts_finders_first_and_names_each_once() {
        let found = vec![
            FinderTag { name: "zeta".into(), color: 0 },
            FinderTag { name: "red".into(), color: 6 },
            FinderTag { name: "Zeta".into(), color: 3 },
            FinderTag { name: "alpha".into(), color: 0 },
        ];
        let names: Vec<String> = tag_list(found).into_iter().map(|tag| tag.name).collect();
        assert_eq!(
            names,
            ["Red", "Orange", "Yellow", "Green", "Blue", "Purple", "Gray", "alpha", "zeta"]
        );
    }
}
