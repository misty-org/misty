//! Firefox keeps bookmarks and history together in `places.sqlite`.
use super::model::{title, web_address, BookmarkNode, BookmarkRoots, Limits, MAX_DEPTH};
use super::snapshot::Snapshot;
use rusqlite::Connection;
use std::{collections::HashMap, path::Path};

struct Row {
    kind: i64,
    title: String,
    added_us: Option<i64>,
    url: Option<String>,
}

pub fn bookmarks(profile: &Path) -> Result<(BookmarkRoots, usize), String> {
    let snapshot = Snapshot::sqlite(&profile.join("places.sqlite"))?;
    read_bookmarks(&snapshot.open()?)
}

pub fn read_bookmarks(db: &Connection) -> Result<(BookmarkRoots, usize), String> {
    let mut statement = db
        .prepare(
            "SELECT b.id, b.type, b.parent, COALESCE(b.title, ''), b.dateAdded, b.guid, p.url
             FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk
             ORDER BY b.parent, b.position",
        )
        .map_err(|_| "Firefox's bookmarks could not be read.".to_owned())?;
    let mut rows: HashMap<i64, Row> = HashMap::new();
    let mut children: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut roots: HashMap<String, i64> = HashMap::new();
    let mapped = statement
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<i64>>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, Option<String>>(6)?,
            ))
        })
        .map_err(|_| "Firefox's bookmarks could not be read.".to_owned())?;
    for row in mapped.flatten() {
        let (id, kind, parent, name, added_us, guid, url) = row;
        roots.insert(guid, id);
        children.entry(parent).or_default().push(id);
        rows.insert(
            id,
            Row {
                kind,
                title: name,
                added_us,
                url,
            },
        );
    }
    let mut limits = Limits::default();
    let mut root = |guid: &str| match roots.get(guid) {
        Some(id) => tree(*id, &rows, &children, 0, &mut limits),
        None => Vec::new(),
    };
    let bar = root("toolbar_____");
    let menu = root("menu________");
    let mut other = root("unfiled_____");
    let mobile = root("mobile______");
    // As Chrome does: the Bookmarks Menu becomes a folder in Other bookmarks.
    if !menu.is_empty() {
        other.insert(
            0,
            BookmarkNode::Folder {
                title: "Bookmarks Menu".into(),
                added_at: None,
                children: menu,
            },
        );
    }
    Ok((BookmarkRoots { bar, other, mobile }, limits.skipped))
}

fn tree(
    folder: i64,
    rows: &HashMap<i64, Row>,
    children: &HashMap<i64, Vec<i64>>,
    depth: usize,
    limits: &mut Limits,
) -> Vec<BookmarkNode> {
    let mut out = Vec::new();
    for id in children.get(&folder).into_iter().flatten() {
        let Some(row) = rows.get(id) else { continue };
        let added_at = row.added_us.map(|us| us / 1000);
        match row.kind {
            1 => {
                let Some(url) = row.url.as_deref().and_then(web_address) else {
                    limits.skipped += 1;
                    continue;
                };
                if limits.admit() {
                    out.push(BookmarkNode::Link {
                        title: title(&row.title, &url),
                        url,
                        added_at,
                    });
                }
            }
            2 => {
                let nested = tree(*id, rows, children, depth + 1, limits);
                if depth + 1 >= MAX_DEPTH {
                    out.extend(nested);
                } else if limits.admit() {
                    out.push(BookmarkNode::Folder {
                        title: title(&row.title, "Folder"),
                        added_at,
                        children: nested,
                    });
                }
            }
            // Separators: Chrome drops them on import too.
            _ => {}
        }
    }
    out
}

#[cfg(test)]
pub(super) fn places_fixture() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch(
        "CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER DEFAULT 0,
           last_visit_date INTEGER, typed INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0);
         CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER,
           position INTEGER, title TEXT, dateAdded INTEGER, guid TEXT);
         CREATE TABLE moz_historyvisits (id INTEGER PRIMARY KEY, place_id INTEGER, visit_date INTEGER, visit_type INTEGER);
         INSERT INTO moz_places (id, url, title, visit_count, last_visit_date, typed) VALUES
           (1, 'https://mozilla.org/', 'Mozilla', 3, 1700000000000000, 1),
           (2, 'https://acme.example/', 'Acme', 1, 1700000100000000, 0),
           (3, 'place:sort=8', NULL, 0, NULL, 0);
         INSERT INTO moz_bookmarks VALUES
           (1, 2, NULL, 0, 0, '', 0, 'root________'),
           (2, 2, NULL, 1, 0, 'menu', 0, 'menu________'),
           (3, 2, NULL, 1, 1, 'toolbar', 0, 'toolbar_____'),
           (4, 2, NULL, 1, 2, 'tags', 0, 'tags________'),
           (5, 2, NULL, 1, 3, 'unfiled', 0, 'unfiled_____'),
           (6, 2, NULL, 1, 4, 'mobile', 0, 'mobile______'),
           (10, 1, 1, 3, 0, 'Mozilla', 1700000000000000, 'aaaaaaaaaaaa'),
           (11, 2, NULL, 3, 1, 'Work', 1700000000000000, 'bbbbbbbbbbbb'),
           (12, 1, 2, 11, 0, NULL, 1700000000000000, 'cccccccccccc'),
           (13, 3, NULL, 3, 2, NULL, 0, 'dddddddddddd'),
           (14, 1, 3, 2, 0, 'Recent tags', 0, 'eeeeeeeeeeee'),
           (15, 1, 1, 2, 1, 'Menu link', 0, 'ffffffffffff');
         INSERT INTO moz_historyvisits (place_id, visit_date, visit_type) VALUES
           (1, 1699999000000000, 2), (1, 1700000000000000, 1), (2, 1700000100000000, 1);",
    )
    .unwrap();
    db
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_firefox_roots_like_chrome_and_drops_separators_and_queries() {
        let (roots, skipped) = read_bookmarks(&places_fixture()).unwrap();
        assert_eq!(skipped, 1);
        assert_eq!(roots.bar.len(), 2);
        let BookmarkNode::Folder { children, .. } = &roots.bar[1] else {
            panic!()
        };
        assert!(
            matches!(&children[0], BookmarkNode::Link { title, .. } if title == "https://acme.example/")
        );
        let BookmarkNode::Folder {
            title, children, ..
        } = &roots.other[0]
        else {
            panic!()
        };
        assert_eq!((title.as_str(), children.len()), ("Bookmarks Menu", 1));
    }
}
