//! Safari's bookmarks (`Bookmarks.plist`). Its history is read in `history`.
//! macOS lets an app read these only with Full Disk Access.
use super::model::{title, web_address, BookmarkNode, BookmarkRoots, Limits, MAX_DEPTH};
use plist::Value;
use std::path::Path;

pub fn bookmarks(profile: &Path) -> Result<(BookmarkRoots, usize), String> {
    let bytes = std::fs::read(profile.join("Bookmarks.plist")).map_err(|error| {
        if error.kind() == std::io::ErrorKind::PermissionDenied {
            "Allow Misty under Privacy & Security > Full Disk Access to import from Safari."
                .to_owned()
        } else {
            "Safari's bookmarks could not be read.".to_owned()
        }
    })?;
    let root = Value::from_reader(std::io::Cursor::new(bytes))
        .map_err(|_| "Safari's bookmarks could not be read.".to_owned())?;
    Ok(parse(&root))
}

fn string<'a>(dict: &'a plist::Dictionary, key: &str) -> Option<&'a str> {
    dict.get(key).and_then(Value::as_string)
}

pub fn parse(root: &Value) -> (BookmarkRoots, usize) {
    let mut limits = Limits::default();
    let mut roots = BookmarkRoots::default();
    let children = |value: &Value| -> Vec<Value> {
        value
            .as_dictionary()
            .and_then(|d| d.get("Children"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    for list in children(root) {
        let Some(dict) = list.as_dictionary() else {
            continue;
        };
        let nodes = tree(&children(&list), 0, &mut limits);
        match string(dict, "Title") {
            Some("BookmarksBar") => roots.bar.extend(nodes),
            Some("BookmarksMenu") => roots.other.extend(nodes),
            Some("com.apple.ReadingList") if !nodes.is_empty() => {
                roots.other.push(BookmarkNode::Folder {
                    title: "Reading List".into(),
                    added_at: None,
                    children: nodes,
                })
            }
            _ if string(dict, "WebBookmarkType") == Some("WebBookmarkTypeList")
                && string(dict, "Title").is_some() =>
            {
                let name = string(dict, "Title").unwrap_or_default();
                if name != "com.apple.ReadingList" && !nodes.is_empty() {
                    roots.other.push(BookmarkNode::Folder {
                        title: title(name, "Folder"),
                        added_at: None,
                        children: nodes,
                    });
                }
            }
            _ => {}
        }
    }
    (roots, limits.skipped)
}

fn tree(items: &[Value], depth: usize, limits: &mut Limits) -> Vec<BookmarkNode> {
    let mut out = Vec::new();
    for item in items {
        let Some(dict) = item.as_dictionary() else {
            continue;
        };
        match string(dict, "WebBookmarkType") {
            Some("WebBookmarkTypeLeaf") => {
                let Some(url) = string(dict, "URLString").and_then(web_address) else {
                    limits.skipped += 1;
                    continue;
                };
                let name = dict
                    .get("URIDictionary")
                    .and_then(Value::as_dictionary)
                    .and_then(|d| string(d, "title"))
                    .unwrap_or_default();
                if limits.admit() {
                    out.push(BookmarkNode::Link {
                        title: title(name, &url),
                        url,
                        added_at: None,
                    });
                }
            }
            Some("WebBookmarkTypeList") => {
                let children = dict
                    .get("Children")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let nested = tree(&children, depth + 1, limits);
                if depth + 1 >= MAX_DEPTH {
                    out.extend(nested);
                } else if limits.admit() {
                    out.push(BookmarkNode::Folder {
                        title: title(string(dict, "Title").unwrap_or_default(), "Folder"),
                        added_at: None,
                        children: nested,
                    });
                }
            }
            _ => {}
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_safari_lists_to_the_roots() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>WebBookmarkType</key><string>WebBookmarkTypeList</string><key>Children</key><array>
  <dict><key>WebBookmarkType</key><string>WebBookmarkTypeProxy</string><key>Title</key><string>History</string></dict>
  <dict><key>WebBookmarkType</key><string>WebBookmarkTypeList</string><key>Title</key><string>BookmarksBar</string><key>Children</key><array>
    <dict><key>WebBookmarkType</key><string>WebBookmarkTypeLeaf</string><key>URLString</key><string>https://apple.com/</string>
      <key>URIDictionary</key><dict><key>title</key><string>Apple</string></dict></dict>
    <dict><key>WebBookmarkType</key><string>WebBookmarkTypeList</string><key>Title</key><string>News</string><key>Children</key><array>
      <dict><key>WebBookmarkType</key><string>WebBookmarkTypeLeaf</string><key>URLString</key><string>https://news.example/</string></dict>
    </array></dict>
  </array></dict>
  <dict><key>WebBookmarkType</key><string>WebBookmarkTypeList</string><key>Title</key><string>BookmarksMenu</string><key>Children</key><array>
    <dict><key>WebBookmarkType</key><string>WebBookmarkTypeLeaf</string><key>URLString</key><string>https://menu.example/</string></dict>
  </array></dict>
  <dict><key>WebBookmarkType</key><string>WebBookmarkTypeList</string><key>Title</key><string>com.apple.ReadingList</string><key>Children</key><array>
    <dict><key>WebBookmarkType</key><string>WebBookmarkTypeLeaf</string><key>URLString</key><string>https://read.example/</string></dict>
  </array></dict>
</array></dict></plist>"#;
        let root = Value::from_reader(std::io::Cursor::new(&xml[..])).unwrap();
        let (roots, skipped) = parse(&root);
        assert_eq!(skipped, 0);
        assert_eq!(roots.bar.len(), 2);
        assert_eq!(roots.other.len(), 2);
        assert!(
            matches!(&roots.other[1], BookmarkNode::Folder { title, .. } if title == "Reading List")
        );
    }
}
