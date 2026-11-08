use super::super::baseline::Baseline;
use super::super::cookie_records::site_writes;
use super::super::entries::*;
use super::support::*;
use std::cmp::Ordering;
use std::collections::BTreeMap;

// Which copy wins.

#[test]
fn the_newest_edit_wins() {
    let older = entry(Some("old"), 100, false);
    let newer = entry(Some("new"), 200, false);
    assert_eq!(rank(&newer, &older), Ordering::Greater);
    assert_eq!(rank(&older, &newer), Ordering::Less);
    let (idle_older, idle_newer) = (entry(Some("old"), 100, true), entry(Some("new"), 200, true));
    assert_eq!(rank(&idle_newer, &idle_older), Ordering::Greater);
}

#[test]
fn a_change_in_use_beats_an_idle_one_whatever_the_clocks_say() {
    let in_use = entry(Some("in-use"), 100, false);
    let forgotten_laptop = entry(Some("refreshed"), 9_999_999, true);
    assert_eq!(rank(&in_use, &forgotten_laptop), Ordering::Greater);
    assert_eq!(rank(&forgotten_laptop, &in_use), Ordering::Less);
}

#[test]
fn ties_go_the_same_way_from_both_sides() {
    let (a, b) = (entry(Some("a"), 100, false), entry(Some("b"), 100, false));
    assert_eq!(rank(&a, &b), Ordering::Less);
    assert_eq!(rank(&b, &a), Ordering::Greater);
    // A deletion takes a tie, so a sign-out isn't lost to a clock that agreed with it.
    let deleted = entry(None, 100, false);
    assert_eq!(rank(&deleted, &b), Ordering::Greater);
    assert_eq!(rank(&b, &deleted), Ordering::Less);
    assert_eq!(rank(&a, &a.clone()), Ordering::Equal);
}

#[test]
fn any_order_of_merging_ends_in_the_same_place() {
    let copies = [
        entry(Some("a"), 100, false),
        entry(Some("b"), 100, false),
        entry(None, 100, false),
        entry(Some("c"), 500, true),
        entry(Some("d"), 50, false),
        entry(Some("e"), 0, true),
    ];
    let k = key("sid");
    let mut results = Vec::new();
    // Every rotation, forwards and backwards, starting from each copy.
    for start in 0..copies.len() {
        for reverse in [false, true] {
            let mut order: Vec<_> = (0..copies.len())
                .map(|at| copies[(start + at) % copies.len()].clone())
                .collect();
            if reverse {
                order.reverse();
            }
            let mut merged = SiteCookies::new();
            for copy in order {
                merge_into(
                    &mut merged,
                    &BTreeMap::from([(k.clone(), copy)]),
                    |_, _, _| {},
                );
            }
            results.push(merged);
        }
    }
    assert!(results
        .windows(2)
        .all(|pair| same_entries(&pair[0], &pair[1])));
    // A deletion at the top rank: in use, at the newest in-use time, tied, and a deletion.
    assert!(results[0][&k].cookie.is_none());
}

#[test]
fn merging_reports_only_what_changed_with_what_it_replaced() {
    let k = key("sid");
    let mut ours = BTreeMap::from([(k.clone(), entry(Some("ours"), 200, false))]);
    let theirs = BTreeMap::from([(k.clone(), entry(Some("old"), 100, false))]);
    let mut changes = 0;
    merge_into(&mut ours, &theirs, |_, _, _| changes += 1);
    assert_eq!(changes, 0);
    let theirs = BTreeMap::from([(k.clone(), entry(Some("new"), 300, false))]);
    merge_into(&mut ours, &theirs, |key, old, new| {
        changes += 1;
        assert_eq!(key, k);
        assert_eq!(old.unwrap().edited_at, 200);
        assert_eq!(new.edited_at, 300);
    });
    assert_eq!(changes, 1);
}

// Joining.

#[test]
fn a_first_read_with_no_records_keeps_everything_at_edit_time_zero() {
    let mut baseline = Baseline::load(&[], BTreeMap::new());
    let ops = baseline.observe(read(vec![cookie("sid", "local")]), &pass());
    assert!(ops.is_empty());
    let stored = baseline.entry(SITE, &key("sid")).unwrap();
    assert_eq!(stored.edited_at, 0);
    assert!(stored.idle);
    // A new vault's first computer uploads what it has.
    assert!(baseline.unsaved.contains(SITE));
}

#[test]
fn a_second_computer_takes_the_vaults_copy_and_adds_what_it_lacks() {
    let vault = records(&[("sid", entry(Some("vault"), 100, true))]);
    let mut baseline = Baseline::load(&vault, BTreeMap::new());
    let local = vec![cookie("sid", "local"), cookie("local-only", "x")];
    let ops = baseline.observe(read(local), &pass());
    assert_eq!(sets(&ops), [("sid", "vault")]);
    assert_eq!(value_of(&baseline, "sid").as_deref(), Some("vault"));
    let added = baseline.entry(SITE, &key("local-only")).unwrap();
    assert_eq!(added.edited_at, 0);
    assert!(baseline.unsaved.contains(SITE));
}

#[test]
fn a_vault_opening_on_a_store_in_use_gives_way_to_the_vault() {
    // Weeks of browsing with no vault: every stamp here is real, and newer than the vault's.
    let mut baseline = settled(&[
        ("sid", entry(Some("local"), NOW - 10, false)),
        (
            "gone",
            Entry {
                cookie: None,
                edited_at: NOW - 10,
                idle: false,
                base: 0,
            },
        ),
    ]);
    baseline.rejoin();
    let stored = baseline.entry(SITE, &key("sid")).unwrap();
    assert_eq!(stored.edited_at, 0);
    assert!(stored.idle);
    // A local deletion must not erase what the vault has.
    assert!(baseline.entry(SITE, &key("gone")).is_none());
    baseline.absorb(&records(&[("sid", entry(Some("vault"), 5, true))]), &pass());
    assert_eq!(value_of(&baseline, "sid").as_deref(), Some("vault"));
    // The first read then writes the vault's copy into the engine.
    let ops = baseline.observe(read(vec![cookie("sid", "local")]), &pass());
    assert_eq!(sets(&ops), [("sid", "vault")]);
}

#[test]
fn two_computers_joining_end_up_the_same() {
    let shared = |value: &str| vec![cookie("sid", value)];
    let mut first = Baseline::load(&[], BTreeMap::new());
    first.observe(read(shared("from-a")), &pass());
    let mut second = Baseline::load(&[], BTreeMap::new());
    second.observe(read(shared("from-b")), &pass());
    let sent_a = site_writes(SITE, &first.sites[SITE], 0);
    let sent_b = site_writes(SITE, &second.sites[SITE], 0);
    let a: Vec<_> = sent_a
        .into_iter()
        .filter_map(|(_, record)| record)
        .collect();
    let b: Vec<_> = sent_b
        .into_iter()
        .filter_map(|(_, record)| record)
        .collect();
    first.absorb(&b, &pass());
    second.absorb(&a, &pass());
    assert!(same_entries(&first.sites[SITE], &second.sites[SITE]));
}
