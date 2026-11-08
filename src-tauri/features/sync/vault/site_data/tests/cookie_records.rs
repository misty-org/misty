use super::super::cookie_records::{parse_records, site_writes, COOKIES, RECORD_BYTES};
use super::super::entries::*;
use super::super::skips::cookie_skips;
use super::support::*;
use crate::browser::site_data::website_data::coverage::SkipReason;
use browser_data::document::credentials::Cookie;
use browser_data::document::{entities::Kind, ViewRecord};
use std::collections::BTreeMap;

// Records.

#[test]
fn a_host_cookie_and_a_domain_cookie_are_two_cookies() {
    let host = cookie("sid", "v");
    let domain = Cookie {
        domain: format!(".{SITE}"),
        host_only: false,
        ..cookie("sid", "v")
    };
    assert_ne!(cookie_key(&host), cookie_key(&domain));
    assert_eq!(cookie_key(&host), format!("sid|{SITE}|/"));
    assert_eq!(cookie_key(&domain), format!("sid|.{SITE}|/"));
}

#[test]
fn a_site_too_big_for_one_record_splits_and_comes_back_whole() {
    let mut entries = SiteCookies::new();
    for index in 0..300 {
        let cookie = cookie(&format!("c{index}"), &"x".repeat(2_000));
        entries.insert(
            cookie_key(&cookie),
            Entry {
                cookie: Some(cookie),
                edited_at: index,
                idle: false,
                base: 0,
            },
        );
    }
    let writes = site_writes(SITE, &entries, 0);
    assert!(writes.len() > 1);
    assert_eq!(writes[0].0, SITE);
    assert_eq!(writes[1].0, format!("{SITE}#1"));
    let records: Vec<_> = writes
        .into_iter()
        .filter_map(|(_, record)| record)
        .collect();
    for record in &records {
        assert!(serde_json::to_vec(record).unwrap().len() < RECORD_BYTES + 1024);
    }
    let parsed = parse_records(&records);
    assert_eq!(parsed[SITE].1, records.len());
    assert!(same_entries(&parsed[SITE].0, &entries));
}

#[test]
fn parts_a_site_no_longer_needs_are_removed() {
    let mut entries = SiteCookies::new();
    entries.insert(key("sid"), entry(Some("v"), 1, false));
    let writes = site_writes(SITE, &entries, 3);
    assert_eq!(writes.len(), 3);
    assert!(writes[0].1.is_some());
    assert_eq!(writes[1].0, format!("{SITE}#1"));
    assert!(writes[1].1.is_none());
    assert!(writes[2].1.is_none());
}

#[test]
fn an_entry_that_does_not_belong_is_left_out_by_itself() {
    let mut record = records(&[("sid", entry(Some("v"), 1, false))]).remove(0);
    let cookies = record.fields.get_mut(COOKIES).unwrap();
    // Under the wrong key.
    cookies[key("wrong")] = serde_json::to_value(entry(Some("v"), 1, false)).unwrap();
    // Not an entry at all.
    cookies["garbage"] = serde_json::json!({"nope": true});
    // Another site's cookie in this site's record.
    let mut foreign = cookie("x", "v");
    foreign.domain = "elsewhere.test".into();
    let foreign_key = cookie_key(&foreign);
    cookies[foreign_key] = serde_json::json!({"cookie": foreign, "edited_at": 1, "idle": false});
    // A cookie the shared model refuses.
    let mut invalid = cookie("x", "v");
    invalid.name = "bad name".into();
    let invalid_key = cookie_key(&invalid);
    cookies[invalid_key] = serde_json::json!({"cookie": invalid, "edited_at": 1, "idle": false});
    let parsed = parse_records(&[record]);
    assert_eq!(parsed[SITE].0.len(), 1);
    assert!(parsed[SITE].0.contains_key(&key("sid")));
}

#[test]
fn records_of_another_kind_are_ignored() {
    let record = ViewRecord {
        kind: Kind::SiteStorage,
        id: SITE.into(),
        fields: BTreeMap::new(),
    };
    assert!(parse_records(&[record]).is_empty());
}

#[test]
fn a_deletion_travels_as_a_null_cookie() {
    let value = serde_json::to_value(entry(None, 7, true)).unwrap();
    assert_eq!(
        value,
        serde_json::json!({"cookie": null, "edited_at": 7, "idle": true})
    );
}

// `seen` after a pass.

#[test]
fn seen_moves_only_when_there_is_something_new() {
    let mut baseline = settled(&[("sid", entry(Some("v"), 100, false))]);
    assert_eq!(baseline.seen[SITE][&key("sid")], 100);
    assert!(!baseline.settle());
    baseline.observe(read(vec![cookie("sid", "new")]), &pass());
    assert!(baseline.settle());
    assert_eq!(baseline.seen[SITE][&key("sid")], NOW);
}

// The skip list.

#[test]
fn the_skip_list_names_each_site_once_in_plain_words() {
    let read = vec![
        ("chips.test".to_owned(), SkipReason::Partitioned),
        ("chips.test".to_owned(), SkipReason::Partitioned),
        ("alias.test".to_owned(), SkipReason::Duplicate),
        ("odd.test".to_owned(), SkipReason::UnsupportedAttributes),
    ];
    let refused = BTreeMap::from([
        ("a|chips.test|/".to_owned(), "chips.test".to_owned()),
        ("b|here.test|/".to_owned(), "here.test".to_owned()),
    ]);
    let skips = cookie_skips(&read, refused.values());
    let sites: Vec<_> = skips.iter().map(|skip| skip.site.as_str()).collect();
    // An engine's alias of a cookie that did sync isn't worth mentioning.
    assert_eq!(sites, ["chips.test", "here.test", "odd.test"]);
    for skip in &skips {
        assert!(!skip.reason.is_empty());
        // Nothing about a cookie: not its name, value or key.
        assert!(!skip.reason.contains('|'));
    }
    let text = serde_json::to_string(&skips).unwrap();
    assert!(!text.contains("a|chips"));
}
