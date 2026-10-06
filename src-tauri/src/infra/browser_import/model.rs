//! One neutral shape that every source browser and the bookmarks HTML file
//! read into, and that export writes from.
use serde::{Deserialize, Serialize};

/// Bookmarks and folders at most this deep below a root; deeper folders are
/// flattened into the last allowed level (Misty and native sync share this).
pub const MAX_DEPTH: usize = 64;
/// More than this many bookmarks and folders in one import is not a library.
pub const MAX_NODES: usize = 100_000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum BookmarkNode {
    Folder {
        title: String,
        #[serde(rename = "addedAt", default, skip_serializing_if = "Option::is_none")]
        added_at: Option<i64>,
        children: Vec<BookmarkNode>,
    },
    Link {
        title: String,
        url: String,
        #[serde(rename = "addedAt", default, skip_serializing_if = "Option::is_none")]
        added_at: Option<i64>,
    },
}

/// The roots every major browser has. Sources with other roots fold them in
/// (Firefox's Bookmarks Menu becomes a folder in `other`, as Chrome does).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct BookmarkRoots {
    pub bar: Vec<BookmarkNode>,
    pub other: Vec<BookmarkNode>,
    pub mobile: Vec<BookmarkNode>,
}

impl BookmarkRoots {
    pub fn counts(&self) -> (usize, usize) {
        fn walk(nodes: &[BookmarkNode], links: &mut usize, folders: &mut usize) {
            for node in nodes {
                match node {
                    BookmarkNode::Link { .. } => *links += 1,
                    BookmarkNode::Folder { children, .. } => {
                        *folders += 1;
                        walk(children, links, folders);
                    }
                }
            }
        }
        let (mut links, mut folders) = (0, 0);
        for root in [&self.bar, &self.other, &self.mobile] {
            walk(root, &mut links, &mut folders);
        }
        (links, folders)
    }
}

/// Addresses Misty keeps: ordinary web pages without credentials. Bookmarklets,
/// browser-internal pages and saved searches are left behind.
pub fn web_address(value: &str) -> Option<String> {
    let url = url::Url::parse(value.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || value.len() > 16_384
    {
        return None;
    }
    Some(url.to_string())
}

/// A title as Misty stores it: trimmed, bounded, never empty for folders.
pub fn title(value: &str, fallback: &str) -> String {
    let value: String = value.trim().replace('\0', "").chars().take(160).collect();
    if value.is_empty() {
        fallback.chars().take(160).collect()
    } else {
        value
    }
}

/// Builds a tree within the limits, counting what it leaves out.
#[derive(Default)]
pub struct Limits {
    pub nodes: usize,
    pub skipped: usize,
}

impl Limits {
    pub fn admit(&mut self) -> bool {
        if self.nodes >= MAX_NODES {
            self.skipped += 1;
            return false;
        }
        self.nodes += 1;
        true
    }
}

/// Chromium stores times as microseconds since 1601-01-01 UTC.
pub fn chromium_time_ms(value: i64) -> Option<i64> {
    const EPOCH_OFFSET_US: i64 = 11_644_473_600_000_000;
    (value > EPOCH_OFFSET_US).then(|| (value - EPOCH_OFFSET_US) / 1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_plain_web_addresses() {
        assert_eq!(
            web_address("https://a.example/x"),
            Some("https://a.example/x".into())
        );
        assert_eq!(web_address("javascript:alert(1)"), None);
        assert_eq!(web_address("chrome://settings"), None);
        assert_eq!(web_address("https://u:p@a.example/"), None);
        assert_eq!(web_address("place:sort=8"), None);
    }

    #[test]
    fn converts_chromium_times() {
        assert_eq!(
            chromium_time_ms(13_300_000_000_000_000),
            Some(1_655_526_400_000)
        );
        assert_eq!(chromium_time_ms(0), None);
    }
}
