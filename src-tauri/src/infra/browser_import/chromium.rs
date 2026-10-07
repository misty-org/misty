//! Chrome, Edge, Brave, Arc, Vivaldi, Opera and Chromium share one profile
//! format: a `Bookmarks` JSON file and SQLite databases.
use super::model::{
    chromium_time_ms, title, web_address, BookmarkNode, BookmarkRoots, Limits, MAX_DEPTH,
};
use serde_json::Value;
use std::path::Path;

pub fn bookmarks(profile: &Path) -> Result<(BookmarkRoots, usize), String> {
    let bytes = std::fs::read(profile.join("Bookmarks"))
        .map_err(|_| "This profile has no bookmarks to import.".to_owned())?;
    parse_bookmarks(&bytes)
}

pub fn parse_bookmarks(bytes: &[u8]) -> Result<(BookmarkRoots, usize), String> {
    let file: Value = serde_json::from_slice(bytes)
        .map_err(|_| "The bookmarks file could not be read.".to_owned())?;
    let roots = &file["roots"];
    let mut limits = Limits::default();
    let mut root = |name: &str| children(&roots[name], 0, &mut limits);
    let result = BookmarkRoots {
        bar: root("bookmark_bar"),
        other: root("other"),
        mobile: root("synced"),
    };
    Ok((result, limits.skipped))
}

fn added(node: &Value) -> Option<i64> {
    node["date_added"]
        .as_str()?
        .parse::<i64>()
        .ok()
        .and_then(chromium_time_ms)
}

fn children(folder: &Value, depth: usize, limits: &mut Limits) -> Vec<BookmarkNode> {
    let mut out = Vec::new();
    for node in folder["children"].as_array().into_iter().flatten() {
        match node["type"].as_str() {
            Some("url") => {
                let Some(url) = node["url"].as_str().and_then(web_address) else {
                    limits.skipped += 1;
                    continue;
                };
                if limits.admit() {
                    out.push(BookmarkNode::Link {
                        title: title(node["name"].as_str().unwrap_or_default(), &url),
                        url,
                        added_at: added(node),
                    });
                }
            }
            Some("folder") => {
                let nested = children(node, depth + 1, limits);
                // Deeper than Misty keeps: its contents join this level.
                if depth + 1 >= MAX_DEPTH {
                    out.extend(nested);
                } else if limits.admit() {
                    out.push(BookmarkNode::Folder {
                        title: title(node["name"].as_str().unwrap_or_default(), "Folder"),
                        added_at: added(node),
                        children: nested,
                    });
                }
            }
            _ => limits.skipped += 1,
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_three_roots_with_nesting_and_dates() {
        let file = br#"{"roots":{
          "bookmark_bar":{"type":"folder","children":[
            {"type":"url","name":"GitHub","url":"https://github.com/","date_added":"13300000000000000"},
            {"type":"folder","name":"Work","children":[
              {"type":"folder","name":"Clients","children":[
                {"type":"url","name":"Acme","url":"https://acme.example/"}]}]},
            {"type":"url","name":"Bookmarklet","url":"javascript:void(0)"}]},
          "other":{"type":"folder","children":[{"type":"url","name":"","url":"https://other.example/"}]},
          "synced":{"type":"folder","children":[]}}}"#;
        let (roots, skipped) = parse_bookmarks(file).unwrap();
        assert_eq!(skipped, 1);
        assert_eq!(roots.counts(), (3, 2));
        assert_eq!(
            roots.bar[0],
            BookmarkNode::Link {
                title: "GitHub".into(),
                url: "https://github.com/".into(),
                added_at: Some(1_655_526_400_000)
            }
        );
        let BookmarkNode::Folder { children, .. } = &roots.bar[1] else {
            panic!()
        };
        assert!(matches!(&children[0], BookmarkNode::Folder { title, .. } if title == "Clients"));
        assert!(
            matches!(&roots.other[0], BookmarkNode::Link { title, .. } if title == "https://other.example/")
        );
    }
}
