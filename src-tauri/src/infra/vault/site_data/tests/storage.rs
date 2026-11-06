use super::super::parts::*;
use super::super::skips::{storage_skips, SkipKind, OVER_CAP};
use misty_browser_sync::document::{entities::Kind, ViewRecord};
use std::collections::BTreeMap;

const ORIGIN: &str = "https://app.example.test";

fn items(pairs: &[(&str, &str)]) -> Items {
    pairs
        .iter()
        .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
        .collect()
}

fn records(items: &Items, edited_at: u64) -> Vec<ViewRecord> {
    split(ORIGIN, items, edited_at)
        .unwrap()
        .into_iter()
        .filter_map(|(_, record)| record)
        .collect()
}

fn round_trip(items: &Items) -> OriginCopy {
    assemble(&records(items, 7))
        .remove(ORIGIN)
        .expect("a whole copy")
}

#[test]
fn a_small_origin_is_one_part_with_the_decided_fields() {
    let parts = records(&items(&[("theme", "dark")]), 42);
    assert_eq!(parts.len(), 1);
    let part = &parts[0];
    assert_eq!(part.id, format!("{ORIGIN}#0"));
    assert!(matches!(part.kind, Kind::SiteStorage));
    assert_eq!(part.fields["origin"], ORIGIN);
    assert_eq!(part.fields["part"], 0);
    assert_eq!(part.fields["parts"], 1);
    assert_eq!(part.fields["edited_at"], 42);
    assert_eq!(part.fields["items"]["theme"], "dark");
}

#[test]
fn many_keys_split_across_parts_and_come_back() {
    let source: Items = (0..2_000)
        .map(|index| (format!("key-{index}"), "x".repeat(500)))
        .collect();
    let parts = records(&source, 7);
    assert!(parts.len() > 1);
    for (index, part) in parts.iter().enumerate() {
        assert_eq!(part.id, part_id(ORIGIN, index));
        assert_eq!(part.fields["part"], index);
        assert_eq!(part.fields["parts"], parts.len());
        let size = serde_json::to_vec(&part.fields["items"]).unwrap().len();
        assert!(size <= PART_BYTES, "{size}");
    }
    let copy = assemble(&parts).remove(ORIGIN).unwrap();
    assert_eq!(copy.items, source);
    assert_eq!(copy.parts, parts.len());
}

#[test]
fn one_value_bigger_than_a_part_travels_in_pieces() {
    let source = items(&[("state", &"y".repeat(PART_BYTES * 3)), ("small", "s")]);
    let parts = records(&source, 7);
    assert!(parts.len() >= 3);
    for part in &parts {
        assert!(serde_json::to_vec(&part.fields["items"]).unwrap().len() <= PART_BYTES);
    }
    assert_eq!(assemble(&parts).remove(ORIGIN).unwrap().items, source);
}

#[test]
fn unicode_survives_in_any_part_and_is_never_cut_mid_character() {
    // Multi-byte text, emoji, a key that isn't ASCII, and what JSON has to escape.
    let long = "日本語🙂é\"\\\n\t\u{1}".repeat(PART_BYTES / 4);
    let source = items(&[
        ("設定", "値"),
        ("🙂", "🙃"),
        ("quote\"key", "\u{0}nul"),
        ("big", &long),
    ]);
    let parts = records(&source, 7);
    assert!(parts.len() > 1);
    for part in &parts {
        // Sizes are counted as JSON, so escapes and multi-byte text don't overflow a part.
        assert!(serde_json::to_vec(&part.fields["items"]).unwrap().len() <= PART_BYTES);
    }
    assert_eq!(round_trip(&source).items, source);
}

#[test]
fn an_origin_over_the_cap_does_not_sync() {
    let source: Items = (0..9)
        .map(|index| (format!("key-{index}"), "z".repeat(1 << 20)))
        .collect();
    assert_eq!(split(ORIGIN, &source, 7).err(), Some(TooLarge));
    // Right up to the cap is fine.
    let source: Items = (0..7)
        .map(|index| (format!("key-{index}"), "z".repeat(1 << 20)))
        .collect();
    assert_eq!(round_trip(&source).items, source);
    // Multi-byte text counts for what it weighs, not how many characters it is.
    let source = items(&[("heavy", &"語".repeat(3 << 20))]);
    assert_eq!(split(ORIGIN, &source, 7).err(), Some(TooLarge));
}

#[test]
fn removed_keys_are_gone_from_the_new_copy() {
    let old = records(&items(&[("a", "1"), ("b", "2")]), 100);
    let new = records(&items(&[("a", "1")]), 200);
    // Replaced part by part, as the records do: only the new copy's part remains.
    let copy = assemble(&new).remove(ORIGIN).unwrap();
    assert_eq!(copy.items, items(&[("a", "1")]));
    assert_eq!(copy.edited_at, 200);
    // Both present while parts are on their way: the newest whole one wins.
    let mixed: Vec<_> = old.into_iter().chain(new).collect();
    let copy = assemble(&mixed).remove(ORIGIN).unwrap();
    assert_eq!(copy.items, items(&[("a", "1")]));
}

#[test]
fn an_emptied_origin_still_says_so() {
    let parts = records(&Items::new(), 100);
    assert_eq!(parts.len(), 1);
    let copy = assemble(&parts).remove(ORIGIN).unwrap();
    assert!(copy.items.is_empty());
}

#[test]
fn a_copy_missing_a_part_waits_while_an_older_whole_one_stands() {
    let source: Items = (0..2_000)
        .map(|index| (format!("key-{index}"), "x".repeat(500)))
        .collect();
    let mut newer = records(&source, 200);
    newer.remove(1);
    assert!(assemble(&newer).is_empty());
    let older = records(&items(&[("a", "1")]), 100);
    let copy = assemble(&newer.into_iter().chain(older).collect::<Vec<_>>())
        .remove(ORIGIN)
        .unwrap();
    assert_eq!(copy.edited_at, 100);
}

#[test]
fn a_copy_missing_a_piece_of_a_value_waits() {
    let source = items(&[("state", &"y".repeat(PART_BYTES * 3))]);
    let mut parts = records(&source, 7);
    // The part still claims the same count, but a piece is gone from inside it.
    let inside = parts[0]
        .fields
        .get_mut("items")
        .unwrap()
        .as_object_mut()
        .unwrap();
    let first = inside.keys().next().unwrap().clone();
    inside.remove(&first);
    assert!(assemble(&parts).is_empty());
}

#[test]
fn a_record_that_does_not_add_up_is_ignored_by_itself() {
    let mut wrong_id = records(&items(&[("a", "1")]), 7).remove(0);
    wrong_id.id = format!("https://other.test#0");
    let mut no_items = records(&items(&[("a", "1")]), 7).remove(0);
    no_items.fields.remove("items");
    let mut part_past_end = records(&items(&[("a", "1")]), 7).remove(0);
    part_past_end.fields.insert("part".to_owned(), 5.into());
    let other_kind = ViewRecord {
        kind: Kind::SiteCookies,
        id: format!("{ORIGIN}#0"),
        fields: BTreeMap::new(),
    };
    assert!(assemble(&[wrong_id, no_items, part_past_end, other_kind]).is_empty());
}

#[test]
fn a_real_key_that_looks_like_a_piece_is_refused_rather_than_mistaken() {
    let source = items(&[("\u{0}misty-piece\u{0}0\u{0}1\u{0}x", "v")]);
    assert_eq!(split(ORIGIN, &source, 7).err(), Some(TooLarge));
}

#[test]
fn origins_stay_apart() {
    let first = records(&items(&[("a", "1")]), 7);
    let second: Vec<_> = split("https://other.test", &items(&[("b", "2")]), 9)
        .unwrap()
        .into_iter()
        .filter_map(|(_, record)| record)
        .collect();
    let copies = assemble(&first.into_iter().chain(second).collect::<Vec<_>>());
    assert_eq!(copies.len(), 2);
    assert_eq!(copies["https://other.test"].edited_at, 9);
}

#[test]
fn the_hash_is_about_what_an_origin_holds() {
    let a = items(&[("a", "1"), ("b", "2")]);
    assert_eq!(items_hash(&a), items_hash(&a.clone()));
    assert_ne!(
        items_hash(&a),
        items_hash(&items(&[("a", "1"), ("b", "3")]))
    );
    // Where one entry ends and the next begins matters.
    assert_ne!(
        items_hash(&items(&[("ab", "c")])),
        items_hash(&items(&[("a", "bc")]))
    );
}

fn known(edited_at: u64, items: &Items) -> Known {
    Known {
        edited_at,
        hash: items_hash(items),
        stamp: "stamp".into(),
        over: false,
    }
}

fn copy(edited_at: u64, items: &Items) -> OriginCopy {
    OriginCopy {
        edited_at,
        parts: 1,
        items: items.clone(),
    }
}

#[test]
fn the_newest_whole_copy_is_what_a_store_needs() {
    let (mine, theirs) = (items(&[("a", "1")]), items(&[("a", "2")]));
    assert!(is_pending(None, &copy(5, &theirs)));
    assert!(is_pending(Some(&known(5, &mine)), &copy(6, &theirs)));
    assert!(!is_pending(Some(&known(6, &mine)), &copy(5, &theirs)));
    assert!(!is_pending(Some(&known(6, &theirs)), &copy(6, &theirs)));
    // Two computers read an origin first at once: the record they share settles it.
    assert!(is_pending(Some(&known(0, &mine)), &copy(0, &theirs)));
    // Over the cap here, it doesn't sync in either direction.
    let over = Known {
        over: true,
        ..known(0, &mine)
    };
    assert!(!is_pending(Some(&over), &copy(99, &theirs)));
}

#[test]
fn a_first_read_gives_way_to_anything_in_the_records() {
    // Nothing here, nothing there: no record for it at all.
    assert_eq!(decide(None, None, "h", true, 1_000), Decision::Same);
    // What it already held goes up at time zero, so anything elsewhere wins.
    assert_eq!(decide(None, None, "h", false, 1_000), Decision::Upload(0));
    assert_eq!(
        decide(None, Some((50, "other")), "h", false, 1_000),
        Decision::Yield
    );
    assert_eq!(
        decide(None, Some((50, "h")), "h", false, 1_000),
        Decision::Adopt(50)
    );
}

#[test]
fn a_later_change_is_stamped_ahead_of_everything_seen() {
    let k = Known {
        edited_at: 500,
        hash: "old".into(),
        stamp: "s".into(),
        over: false,
    };
    assert_eq!(decide(Some(&k), None, "old", false, 1_000), Decision::Same);
    assert_eq!(
        decide(Some(&k), None, "new", false, 1_000),
        Decision::Upload(1_000)
    );
    // A clock behind what's been seen still moves forward.
    assert_eq!(
        decide(Some(&k), None, "new", false, 100),
        Decision::Upload(501)
    );
    assert_eq!(
        decide(Some(&k), Some((900, "x")), "new", false, 100),
        Decision::Upload(901)
    );
    // Emptying a site that has a copy is a change like any other, or removals wouldn't spread.
    assert_eq!(
        decide(Some(&k), Some((500, "old")), "empty", true, 1_000),
        Decision::Upload(1_000)
    );
}

#[test]
fn a_site_back_under_the_cap_syncs_again() {
    let over = Known {
        stamp: "s".into(),
        over: true,
        ..Known::default()
    };
    assert_eq!(
        decide(Some(&over), None, "h", false, 1_000),
        Decision::Upload(1_000)
    );
    // Even if its hash happens to be what's noted, which for a site over the cap is nothing.
    assert_eq!(
        decide(Some(&over), None, "", false, 1_000),
        Decision::Upload(1_000)
    );
}

#[test]
fn the_skip_list_names_a_site_over_the_cap_once() {
    let origins = [
        "https://big.example.test".to_owned(),
        "http://big.example.test".to_owned(),
        "https://other.example.test".to_owned(),
    ];
    let skips = storage_skips(&origins);
    assert_eq!(skips.len(), 2);
    assert_eq!(skips[0].site, "big.example.test");
    assert_eq!(skips[0].kind, SkipKind::LocalStorage);
    assert_eq!(skips[0].reason, OVER_CAP);
    assert_eq!(
        serde_json::to_value(&skips[1]).unwrap(),
        serde_json::json!({
            "site": "other.example.test",
            "kind": "local_storage",
            "reason": OVER_CAP,
        })
    );
}
