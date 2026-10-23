//! Writing bookmarks as a Netscape bookmarks file, the way Chrome does.
use super::*;

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
