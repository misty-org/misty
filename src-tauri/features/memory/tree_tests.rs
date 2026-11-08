use serde_json::json;

use super::events::MemoryEvent;
use super::forget;
use super::prefs::{self, Remember};
use super::summaries::{self, RecapOutline, RecapThread};
use super::tests::{axis, database, embed_all, keep, page, LATER, NOW};
use super::tree::{self, TreeQuery};
use super::MemoryError;

fn children(connection: &rusqlite::Connection, space: &str, parent: &str) -> Vec<tree::MemoryNode> {
    let query = TreeQuery {
        space_id: space.into(),
        parent: parent.into(),
        ..TreeQuery::default()
    };
    tree::children(connection, "me", &query, LATER).unwrap()
}

fn fact(connection: &mut rusqlite::Connection, content: &str) -> prefs::MemoryFact {
    let input = Remember {
        kind: "fact".into(),
        content: content.into(),
        ..Remember::default()
    };
    prefs::remember(connection, "me", input, NOW).unwrap()
}

#[test]
fn the_tree_opens_from_branches_to_groups_to_moments() {
    let (_directory, mut connection) = database();
    keep(&mut connection, page("https://github.com/a", ""));
    let mut screen = page("https://example.com/", "");
    screen.kind = "screen".into();
    screen.url = String::new();
    screen.session_id = "session-1".into();
    screen.app = "Notes".into();
    keep(&mut connection, screen);
    keep(
        &mut connection,
        MemoryEvent {
            kind: "voice".into(),
            title: "Said".into(),
            occurred_at: super::rfc3339(NOW),
            ..MemoryEvent::default()
        },
    );
    let branches = children(&connection, "", "");
    let ids: Vec<&str> = branches.iter().map(|node| node.id.as_str()).collect();
    assert_eq!(ids, ["moments", "summaries", "facts", "workflows"]);
    assert_eq!(branches[0].count, 3);
    assert!(branches[0].expandable);
    assert!(!branches[0].searchable);
    assert!(branches[0].first_at.is_some());
    assert!(!branches[1].expandable);
    let groups = children(&connection, "", "moments");
    let mut group_ids: Vec<String> = groups.iter().map(|node| node.id.clone()).collect();
    group_ids.sort();
    assert_eq!(
        group_ids,
        [
            "moments:kind:voice",
            "moments:session:session-1",
            "moments:site:github.com"
        ]
    );
    let site = groups
        .iter()
        .find(|node| node.id == "moments:site:github.com")
        .unwrap();
    assert_eq!(site.label, "github.com");
    assert_eq!(site.source, "page");
    let voice = groups
        .iter()
        .find(|node| node.id == "moments:kind:voice")
        .unwrap();
    assert_eq!(voice.label, "Dictation");
    let leaves = children(&connection, "", "moments:site:github.com");
    assert_eq!(leaves.len(), 1);
    assert_eq!(leaves[0].node_type, "moment");
    assert_eq!(leaves[0].label, "A page");
    assert_eq!(leaves[0].text, "What the page said.");
    assert_eq!(leaves[0].url, "https://github.com/a");
    assert_eq!(
        children(&connection, "", "moments:session:session-1")[0].app,
        "Notes"
    );
    embed_all(&mut connection, "me", &axis(0));
    assert!(children(&connection, "", "")[0].searchable);
    assert!(children(&connection, "", "moments:site:github.com")[0].searchable);
}

#[test]
fn the_tree_reads_one_space_and_a_time_range() {
    let (_directory, mut connection) = database();
    keep(&mut connection, page("https://example.com/", ""));
    assert_eq!(children(&connection, "work", "")[0].count, 0);
    let before = TreeQuery {
        from: Some(super::rfc3339(NOW - 2000)),
        to: Some(super::rfc3339(NOW - 1000)),
        ..TreeQuery::default()
    };
    assert_eq!(
        tree::children(&connection, "me", &before, LATER).unwrap()[0].count,
        0
    );
    let bad = TreeQuery {
        from: Some("yesterday".into()),
        ..TreeQuery::default()
    };
    assert_eq!(
        tree::children(&connection, "me", &bad, LATER).unwrap_err(),
        MemoryError::Invalid("invalid_memory_query")
    );
    let unknown = TreeQuery {
        parent: "elsewhere".into(),
        ..TreeQuery::default()
    };
    assert!(tree::children(&connection, "me", &unknown, LATER).is_err());
}

#[test]
fn summaries_and_facts_show_in_their_branches() {
    let (_directory, mut connection) = database();
    let outline = RecapOutline {
        threads: vec![RecapThread {
            title: "Reading".into(),
            from: "09:00".into(),
            to: "10:30".into(),
        }],
        next: vec!["Finish it".into()],
    };
    let recap = summaries::save_recap(
        &mut connection,
        "me",
        "",
        "2026-10-14",
        "A good day.",
        &outline,
        NOW,
    )
    .unwrap();
    assert_eq!(recap, "summary:recap-2026-10-14");
    let manual = summaries::add_manual(
        &mut connection,
        "me",
        "",
        "My week",
        "It went well.",
        NOW + 1,
    )
    .unwrap();
    fact(&mut connection, "Tea, no sugar");
    let nodes = children(&connection, "", "summaries");
    assert_eq!(nodes.len(), 2);
    assert_eq!(nodes[0].id, manual);
    assert_eq!(nodes[0].label, "My week");
    assert_eq!(nodes[0].detail, "Added by you");
    assert_eq!(nodes[1].label, "Wednesday, October 14");
    assert_eq!(nodes[1].source, "recap");
    assert_eq!(nodes[1].outline.as_ref().unwrap(), &outline);
    let facts = children(&connection, "", "facts");
    assert_eq!(facts[0].label, "Tea, no sugar");
    assert_eq!(facts[0].detail, "fact");
    assert_eq!(children(&connection, "", "")[2].count, 1);
    // A day has one recap, and writing it again replaces it.
    summaries::save_recap(
        &mut connection,
        "me",
        "",
        "2026-10-14",
        "Better.",
        &outline,
        NOW + 2,
    )
    .unwrap();
    assert_eq!(children(&connection, "", "summaries").len(), 2);
    assert_eq!(children(&connection, "", "summaries")[0].text, "Better.");
    let bad = RecapOutline {
        threads: vec![RecapThread {
            title: "x".into(),
            from: "9:00".into(),
            to: "25:00".into(),
        }],
        next: vec![],
    };
    assert!(
        summaries::save_recap(&mut connection, "me", "", "2026-10-14", "x", &bad, NOW).is_err()
    );
    assert!(
        summaries::save_recap(&mut connection, "me", "", "someday", "x", &outline, NOW).is_err()
    );
}

#[test]
fn the_nodes_keep_the_names_the_page_and_agents_read() {
    let (_directory, mut connection) = database();
    keep(&mut connection, page("https://example.com/", ""));
    let value =
        serde_json::to_value(&children(&connection, "", "moments:site:example.com")[0]).unwrap();
    assert_eq!(value["type"], json!("moment"));
    assert_eq!(value["branch"], json!("moments"));
    assert!(value["id"].as_str().unwrap().starts_with("moment:"));
    assert_eq!(value["count"], json!(0));
    assert_eq!(value["expandable"], json!(false));
    assert!(value.get("first_at").is_none());
    assert!(value.get("outline").is_none());
    assert!(value["last_at"].is_string());
}

#[test]
fn forgetting_a_node_counts_first_and_takes_what_is_under_it() {
    let (_directory, mut connection) = database();
    keep(&mut connection, page("https://example.com/", ""));
    keep(&mut connection, page("https://sub.example.com/", ""));
    keep(&mut connection, page("https://other.example/", ""));
    let kept = fact(&mut connection, "Tea, no sugar");
    fact(&mut connection, "Window seat");
    let summary = summaries::add_manual(&mut connection, "me", "", "", "Week", NOW).unwrap();
    let node = |connection: &mut rusqlite::Connection, id: &str, dry| {
        forget::node(connection, "me", "", id, None, None, dry, NOW).unwrap()
    };
    let would = node(&mut connection, "moments:site:example.com", true);
    assert_eq!(would.moments, 2);
    assert_eq!(children(&connection, "", "")[0].count, 3);
    assert_eq!(
        node(&mut connection, "moments:site:example.com", false).moments,
        2
    );
    assert_eq!(children(&connection, "", "")[0].count, 1);
    assert_eq!(
        node(&mut connection, &format!("fact:{}", kept.id), false).facts,
        1
    );
    assert_eq!(children(&connection, "", "")[2].count, 1);
    assert_eq!(node(&mut connection, &summary, false).summaries, 1);
    let everything = node(&mut connection, "space", false);
    assert_eq!(everything.total(), 2);
    assert_eq!(children(&connection, "", "")[0].count, 0);
    for bad in [
        "",
        "moments:site:",
        "moments:weather:x",
        "fact:",
        "somewhere",
    ] {
        assert!(
            forget::node(&mut connection, "me", "", bad, None, None, true, NOW).is_err(),
            "{bad}"
        );
    }
}

#[test]
fn a_time_range_limits_only_the_moments_a_node_forgets() {
    let (_directory, mut connection) = database();
    keep(&mut connection, page("https://example.com/", ""));
    fact(&mut connection, "Tea, no sugar");
    let counts = forget::node(
        &mut connection,
        "me",
        "",
        "space",
        Some(NOW - 2000),
        Some(NOW - 1000),
        false,
        NOW,
    )
    .unwrap();
    assert_eq!(counts.moments, 0);
    assert_eq!(counts.facts, 1);
    assert_eq!(children(&connection, "", "")[0].count, 1);
}
