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
