//! The Netscape bookmarks HTML file: the one format Chrome, Edge, Firefox and
//! Safari all import and export. Real files are loose HTML, so the reader is
//! a tolerant tag scanner rather than a strict parser.
use super::model::{title, web_address, BookmarkNode, BookmarkRoots, Limits, MAX_DEPTH};
use std::collections::HashMap;

/// Toolbar folders named by browsers that do not mark them.
const BAR_NAMES: [&str; 7] = [
    "bookmarks bar",
    "bookmarks toolbar",
    "favorites bar",
    "favourites bar",
    "favorites",
    "favourites",
    "bookmarksbar",
];
const MOBILE_NAMES: [&str; 1] = ["mobile bookmarks"];

struct Frame {
    title: String,
    attrs: HashMap<String, String>,
    children: Vec<BookmarkNode>,
}

pub fn parse(html: &str) -> Result<(BookmarkRoots, usize), String> {
    if !html.to_ascii_uppercase().contains("<DL") {
        return Err("That file isn't a bookmarks file exported from a browser.".into());
    }
    let mut limits = Limits::default();
    let mut stack: Vec<Frame> = Vec::new();
    let mut top: Vec<(HashMap<String, String>, BookmarkNode)> = Vec::new();
    let mut pending: Option<(String, HashMap<String, String>)> = None;
    let mut rest = html;
    while let Some(start) = rest.find('<') {
        rest = &rest[start..];
        let Some(end) = rest.find('>') else { break };
        let tag = &rest[1..end];
        rest = &rest[end + 1..];
        let (name, attrs) = split_tag(tag);
        match name.as_str() {
            "H3" => {
                let (text, after) = text_until(rest, "</H3");
                rest = after;
                pending = Some((decode(text), attrs));
            }
            "DL" => {
                let (folder_title, folder_attrs) = pending.take().unwrap_or_default();
                stack.push(Frame {
                    title: folder_title,
                    attrs: folder_attrs,
                    children: Vec::new(),
                });
            }
            "/DL" => {
                let Some(frame) = stack.pop() else { continue };
                if stack.is_empty() {
                    // The file's outer list: its entries are the roots' contents.
                    top.extend(
                        frame
                            .children
                            .into_iter()
                            .map(|node| (HashMap::new(), node)),
                    );
                    continue;
                }
                let depth = stack.len();
                let folder = BookmarkNode::Folder {
                    title: title(&frame.title, "Folder"),
                    added_at: seconds(&frame.attrs, "ADD_DATE"),
                    children: frame.children,
                };
                if depth == 1 {
                    // Kept aside with its markers so the roots can be told apart,
                    // after the outer list's links so far (keeping their order).
                    let earlier = std::mem::take(&mut stack[0].children);
                    top.extend(earlier.into_iter().map(|node| (HashMap::new(), node)));
                    top.push((frame.attrs, folder));
                } else if depth > MAX_DEPTH {
                    if let BookmarkNode::Folder { children, .. } = folder {
                        stack.last_mut().unwrap().children.extend(children);
                    }
                } else if limits.admit() {
                    stack.last_mut().unwrap().children.push(folder);
                }
            }
            "A" => {
                let (text, after) = text_until(rest, "</A");
                rest = after;
                let Some(frame) = stack.last_mut() else {
                    continue;
                };
                let Some(url) = attrs
                    .get("HREF")
                    .and_then(|href| web_address(&decode(href)))
                else {
                    limits.skipped += 1;
                    continue;
                };
                if limits.admit() {
                    frame.children.push(BookmarkNode::Link {
                        title: title(&decode(text), &url),
                        url,
                        added_at: seconds(&attrs, "ADD_DATE"),
                    });
                }
            }
            _ => {}
        }
    }
    // An unclosed file still gives what it has.
    while let Some(frame) = stack.pop() {
        match stack.last_mut() {
            Some(parent) => parent.children.extend(frame.children),
            None => top.extend(
                frame
                    .children
                    .into_iter()
                    .map(|node| (HashMap::new(), node)),
            ),
        }
    }
    Ok((roots(top), limits.skipped))
}

fn roots(top: Vec<(HashMap<String, String>, BookmarkNode)>) -> BookmarkRoots {
    let marked = top
        .iter()
        .any(|(attrs, _)| attrs.contains_key("PERSONAL_TOOLBAR_FOLDER"));
    let mut roots = BookmarkRoots::default();
    for (attrs, node) in top {
        let name = match &node {
            BookmarkNode::Folder { title, .. } => title.to_lowercase(),
            BookmarkNode::Link { .. } => String::new(),
        };
        let flag = |key: &str| {
            attrs
                .get(key)
                .is_some_and(|v| v.eq_ignore_ascii_case("true"))
        };
        let target =
            if flag("PERSONAL_TOOLBAR_FOLDER") || (!marked && BAR_NAMES.contains(&name.as_str())) {
                &mut roots.bar
            } else if MOBILE_NAMES.contains(&name.as_str()) {
                &mut roots.mobile
            } else if flag("UNFILED_FOLDER") {
                &mut roots.other
            } else {
                roots.other.push(node);
                continue;
            };
        match node {
            BookmarkNode::Folder { children, .. } => target.extend(children),
            link => target.push(link),
        }
    }
    roots
}

fn split_tag(tag: &str) -> (String, HashMap<String, String>) {
    let tag = tag.trim();
    let (name, mut rest) = tag.split_once(char::is_whitespace).unwrap_or((tag, ""));
    let mut attrs = HashMap::new();
    while !rest.trim().is_empty() {
        rest = rest.trim_start();
        let key_end = rest
            .find(|c: char| c == '=' || c.is_whitespace())
            .unwrap_or(rest.len());
        let key = rest[..key_end].to_ascii_uppercase();
        rest = rest[key_end..].trim_start();
        let value = if let Some(after) = rest.strip_prefix('=') {
            let after = after.trim_start();
            let (value, remaining) = match after.chars().next() {
                Some(quote @ ('"' | '\'')) => {
                    let body = &after[1..];
                    let close = body.find(quote).unwrap_or(body.len());
                    (&body[..close], body.get(close + 1..).unwrap_or(""))
                }
                _ => {
                    let close = after.find(char::is_whitespace).unwrap_or(after.len());
                    (&after[..close], &after[close..])
                }
            };
            rest = remaining;
            value.to_owned()
        } else {
            String::new()
        };
        if !key.is_empty() {
            attrs.insert(key, value);
        }
    }
    (name.to_ascii_uppercase(), attrs)
}

fn text_until<'a>(rest: &'a str, close: &str) -> (&'a str, &'a str) {
    let (bytes, needle) = (rest.as_bytes(), close.as_bytes());
    let found = (0..bytes.len().saturating_sub(needle.len() - 1))
        .find(|&at| bytes[at] == b'<' && bytes[at..at + needle.len()].eq_ignore_ascii_case(needle));
    match found {
        Some(at) => (&rest[..at], &rest[at..]),
        None => (rest, ""),
    }
}

fn seconds(attrs: &HashMap<String, String>, key: &str) -> Option<i64> {
    let value = attrs.get(key)?.parse::<i64>().ok().filter(|s| *s > 0)?;
    // Some exporters write microseconds or milliseconds.
    Some(match value {
        v if v > 10_000_000_000_000 => v / 1000,
        v if v > 10_000_000_000 => v,
        v => v * 1000,
    })
}

fn decode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let Some(end) = rest.bytes().take(12).position(|b| b == b';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "nbsp" => Some(' '),
            _ => entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|n| n.parse().ok()))
                .and_then(char::from_u32),
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out.trim().to_owned()
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Writes the file the way Chrome does, so every browser reads it back:
/// the bar as the marked toolbar folder, Other bookmarks at the top level and
/// Mobile bookmarks as a folder.
pub fn write(roots: &BookmarkRoots) -> String {
    let mut out = String::from(
        "<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<!-- This is an automatically generated file.\n     It will be read and overwritten.\n     DO NOT EDIT! -->\n<META HTTP-EQUIV=\"Content-Type\" CONTENT=\"text/html; charset=UTF-8\">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n",
    );
    folder(
        &mut out,
        1,
        "Bookmarks bar",
        None,
        " PERSONAL_TOOLBAR_FOLDER=\"true\"",
        &roots.bar,
    );
    nodes(&mut out, 1, &roots.other);
    if !roots.mobile.is_empty() {
        folder(&mut out, 1, "Mobile bookmarks", None, "", &roots.mobile);
    }
    out.push_str("</DL><p>\n");
    out
}

fn date(added_at: Option<i64>) -> String {
    added_at
        .map(|ms| format!(" ADD_DATE=\"{}\"", ms / 1000))
        .unwrap_or_default()
}

fn folder(
    out: &mut String,
    depth: usize,
    name: &str,
    added_at: Option<i64>,
    marker: &str,
    children: &[BookmarkNode],
) {
    let pad = "    ".repeat(depth);
    out.push_str(&format!(
        "{pad}<DT><H3{}{marker}>{}</H3>\n{pad}<DL><p>\n",
        date(added_at),
        escape(name)
    ));
    nodes(out, depth + 1, children);
    out.push_str(&format!("{pad}</DL><p>\n"));
}

fn nodes(out: &mut String, depth: usize, children: &[BookmarkNode]) {
    let pad = "    ".repeat(depth);
    for node in children {
        match node {
            BookmarkNode::Folder {
                title,
                added_at,
                children,
            } => folder(out, depth, title, *added_at, "", children),
            BookmarkNode::Link {
                title,
                url,
                added_at,
            } => out.push_str(&format!(
                "{pad}<DT><A HREF=\"{}\"{}>{}</A>\n",
                escape(url),
                date(*added_at),
                escape(title)
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIREFOX: &str = r#"<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks Menu</H1>
<DL><p>
    <DT><A HREF="https://menu.example/" ADD_DATE="1700000000">Menu &amp; more</A>
    <HR>
    <DT><H3 ADD_DATE="1700000000" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks Toolbar</H3>
    <DL><p>
        <DT><A HREF="https://bar.example/">Bar</A>
        <DT><H3>Work</H3>
        <DL><p>
            <DT><A HREF="https://work.example/?a=1&amp;b=2" ICON="data:image/png;base64,AA">Work</A>
            <DT><A HREF="javascript:alert(1)">Bookmarklet</A>
        </DL><p>
    </DL><p>
    <DT><H3 UNFILED_FOLDER="true">Other Bookmarks</H3>
    <DL><p>
        <DT><A HREF="https://other.example/">Other</A>
    </DL><p>
</DL>"#;

    #[test]
    fn reads_firefox_exports_into_the_three_roots() {
        let (roots, skipped) = parse(FIREFOX).unwrap();
        assert_eq!(skipped, 1);
        assert_eq!(roots.bar.len(), 2);
        assert_eq!(roots.other.len(), 2);
        assert!(
            matches!(&roots.other[0], BookmarkNode::Link { title, added_at: Some(1_700_000_000_000), .. } if title == "Menu & more")
        );
        let BookmarkNode::Folder { children, .. } = &roots.bar[1] else {
            panic!()
        };
        assert!(
            matches!(&children[0], BookmarkNode::Link { url, .. } if url == "https://work.example/?a=1&b=2")
        );
    }

    #[test]
    fn round_trips_through_its_own_export() {
        let (roots, _) = parse(FIREFOX).unwrap();
        let mut with_mobile = roots.clone();
        with_mobile.mobile.push(BookmarkNode::Link {
            title: "Phone \"quoted\" <tag>".into(),
            url: "https://phone.example/".into(),
            added_at: Some(1_700_000_000_000),
        });
        let (again, skipped) = parse(&write(&with_mobile)).unwrap();
        assert_eq!(skipped, 0);
        assert_eq!(again, with_mobile);
    }

    #[test]
    fn rejects_files_that_are_not_bookmarks() {
        assert!(parse("<html><body>Hello</body></html>").is_err());
    }
}
