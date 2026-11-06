use super::super::baseline::Applied;
use super::super::cookie_records::parse_records;
use super::super::entries::*;
use super::super::skips::{cookie_skips, SkipKind};
use super::support::*;

// Deletions.

#[test]
fn a_sign_out_here_becomes_a_deletion_that_goes_out() {
    let mut baseline = settled(&[
        ("sid", entry(Some("v"), 100, false)),
        (
            "kept",
            Entry {
                cookie: Some(cookie("kept", "k")),
                edited_at: 100,
                idle: false,
                base: 0,
            },
        ),
    ]);
    let ops = baseline.observe(read(vec![cookie("kept", "k")]), &pass());
    assert!(ops.is_empty());
    let deleted = baseline.entry(SITE, &key("sid")).unwrap();
    assert!(deleted.cookie.is_none());
    assert!(baseline.unsaved.contains(SITE));
}

#[test]
fn a_sign_out_elsewhere_comes_off_the_engine_and_does_not_come_back() {
    let mut baseline = settled(&[("sid", entry(Some("v"), 100, false))]);
    let signed_out = NOW - 1_000;
    let ops = baseline.absorb(
        &records(&[("sid", entry(None, signed_out, false))]),
        &pass(),
    );
    assert_eq!(deletes(&ops), ["sid"]);
    // The record says the same as the merge, so nothing goes back.
    assert!(baseline.unsaved.is_empty());
    for op in &ops {
        baseline.applied(op, Applied::Stored);
    }
    // The engine no longer has it, which is no news. No second deletion, no write.
    assert!(baseline.observe(read(vec![]), &pass()).is_empty());
    assert!(baseline.observe(read(vec![]), &pass()).is_empty());
    assert!(baseline.unsaved.is_empty());
    assert_eq!(
        baseline.entry(SITE, &key("sid")).unwrap().edited_at,
        signed_out
    );
}

#[test]
fn a_deletion_older_than_what_is_kept_does_not_come_back_to_life_or_delete() {
    let mut baseline = settled(&[("sid", entry(Some("v"), 100, false))]);
    // Past the 90 days: the cookie stands, and the record loses the stale deletion.
    let ops = baseline.absorb(&records(&[("sid", entry(None, 200, false))]), &pass());
    assert!(ops.is_empty());
    assert_eq!(value_of(&baseline, "sid").as_deref(), Some("v"));
    assert!(baseline.unsaved.contains(SITE));
}

#[test]
fn signing_back_in_after_a_deletion_is_a_new_change() {
    let mut baseline = settled(&[("sid", entry(None, 200, false))]);
    baseline.observe(read(vec![cookie("sid", "again")]), &pass());
    let stored = baseline.entry(SITE, &key("sid")).unwrap();
    assert_eq!(stored.cookie.as_ref().unwrap().value, "again");
    assert_eq!(stored.edited_at, NOW);
}

#[test]
fn deletions_age_out_when_a_record_is_rewritten() {
    let k = key("sid");
    let old = NOW - 91 * DAY;
    let recent = NOW - 89 * DAY;
    let mut baseline = settled(&[
        ("sid", entry(None, old, false)),
        (
            "keep",
            Entry {
                cookie: None,
                edited_at: recent,
                idle: false,
                base: 0,
            },
        ),
    ]);
    let writes = baseline.writes_for(SITE, NOW);
    assert!(baseline.entry(SITE, &k).is_none());
    assert!(baseline.entry(SITE, &key("keep")).is_some());
    let parsed = parse_records(&[writes[0].1.clone().unwrap()]);
    assert!(!parsed[SITE].0.contains_key(&k));
    assert!(parsed[SITE].0.contains_key(&key("keep")));
}

#[test]
fn cookies_long_past_their_expiry_age_out_too() {
    let mut entries = SiteCookies::new();
    let mut gone = cookie("gone", "x");
    gone.expires_unix_seconds = Some(((NOW - 91 * DAY) / 1000) as i64);
    let mut recent = cookie("recent", "x");
    recent.expires_unix_seconds = Some(((NOW - DAY) / 1000) as i64);
    for cookie in [gone, recent] {
        entries.insert(
            cookie_key(&cookie),
            Entry {
                cookie: Some(cookie),
                edited_at: 5,
                idle: false,
                base: 0,
            },
        );
    }
    age_out(&mut entries, NOW);
    assert_eq!(entries.len(), 1);
    assert!(entries.contains_key(&key("recent")));
}

// Records from elsewhere.

#[test]
fn a_merge_that_keeps_this_computers_copy_rewrites_the_record_so_the_other_side_learns() {
    let mut baseline = settled(&[("sid", entry(Some("ours"), 500, false))]);
    let ops = baseline.absorb(
        &records(&[("sid", entry(Some("old"), 100, false))]),
        &pass(),
    );
    assert!(ops.is_empty());
    assert!(baseline.unsaved.contains(SITE));
    // The other side gets the winner and has nothing further to say.
    let sent: Vec<_> = baseline
        .writes_for(SITE, NOW)
        .into_iter()
        .filter_map(|(_, record)| record)
        .collect();
    let mut other = settled(&[("sid", entry(Some("old"), 100, false))]);
    let ops = other.absorb(&sent, &pass());
    assert_eq!(sets(&ops), [("sid", "ours")]);
    assert!(other.unsaved.is_empty());
    baseline.unsaved.clear();
    baseline.absorb(&sent, &pass());
    assert!(baseline.unsaved.is_empty());
}

#[test]
fn a_forgotten_laptop_never_overwrites_the_cookie_in_use() {
    let mut in_use = settled(&[("sid", entry(Some("in-use"), 100, false))]);
    let ops = in_use.absorb(
        &records(&[("sid", entry(Some("refreshed"), 99_999, true))]),
        &pass(),
    );
    assert!(ops.is_empty());
    assert_eq!(value_of(&in_use, "sid").as_deref(), Some("in-use"));
    assert!(in_use.unsaved.contains(SITE));
    // The laptop gets it back.
    let mut laptop = settled(&[("sid", entry(Some("refreshed"), 99_999, true))]);
    let ops = laptop.absorb(
        &records(&[("sid", entry(Some("in-use"), 100, false))]),
        &pass(),
    );
    assert_eq!(sets(&ops), [("sid", "in-use")]);
}

/// A site rotating a token on a computer nobody is looking at: the copy it replaced mustn't undo it.
#[test]
fn an_idle_refresh_replaces_a_copy_nobody_has_used_for_a_while() {
    let mut other = settled(&[("sid", entry(Some("v1"), 100, false))]);
    let mut refreshed = entry(Some("v2"), 100 + 2 * HOUR, true);
    refreshed.base = 100;
    let ops = other.absorb(&records(&[("sid", refreshed)]), &pass());
    assert_eq!(sets(&ops), [("sid", "v2")]);
    assert_eq!(value_of(&other, "sid").as_deref(), Some("v2"));
}

/// A background tab on the computer nobody is at must not undo the one in use, or a site like
/// Google ends up half signed in.
#[test]
fn an_idle_refresh_does_not_replace_a_recent_copy_from_the_computer_in_use() {
    let mut in_use = settled(&[("sid", entry(Some("in-use"), 1_000, false))]);
    let mut refreshed = entry(Some("background"), 1_000 + 10 * 60_000, true);
    refreshed.base = 1_000;
    let ops = in_use.absorb(&records(&[("sid", refreshed)]), &pass());
    assert!(ops.is_empty());
    assert_eq!(value_of(&in_use, "sid").as_deref(), Some("in-use"));
    // The record is rewritten, which is how the idle computer learns.
    assert!(in_use.unsaved.contains(SITE));
}

#[test]
fn the_computer_in_use_takes_over_and_the_idle_one_follows() {
    // Left idle, it refreshed on top of the other's copy, and lost.
    let mut idle = settled(&[("sid", entry(Some("background"), 2_000, true))]);
    let mut in_use = entry(Some("in-use"), 1_000, false);
    in_use.base = 0;
    let ops = idle.absorb(&records(&[("sid", in_use)]), &pass());
    assert_eq!(sets(&ops), [("sid", "in-use")]);
}

/// Both in use, the newest still wins: there's no telling which the person means.
#[test]
fn a_change_in_use_on_top_of_another_replaces_it() {
    let mut other = settled(&[("sid", entry(Some("v1"), 100, false))]);
    let mut next = entry(Some("v2"), 200, false);
    next.base = 100;
    let ops = other.absorb(&records(&[("sid", next)]), &pass());
    assert_eq!(sets(&ops), [("sid", "v2")]);
}

/// What the idle rule is for: a forgotten laptop refreshing an old token over the one in use.
#[test]
fn an_idle_change_made_apart_still_loses_to_one_in_use() {
    let mut other = settled(&[("sid", entry(Some("in-use"), 150, false))]);
    let mut forgotten = entry(Some("old"), 200, true);
    forgotten.base = 100;
    let ops = other.absorb(&records(&[("sid", forgotten)]), &pass());
    assert!(ops.is_empty());
    assert_eq!(value_of(&other, "sid").as_deref(), Some("in-use"));
}

#[test]
fn nothing_written_from_elsewhere_echoes_back_as_a_local_change() {
    let mut baseline = settled(&[("sid", entry(Some("v"), 100, false))]);
    let ops = baseline.absorb(
        &records(&[("sid", entry(Some("new"), 200, false))]),
        &pass(),
    );
    assert_eq!(sets(&ops), [("sid", "new")]);
    assert_eq!(value_of(&baseline, "sid").as_deref(), Some("new"));
    baseline.applied(&ops[0], Applied::Stored);
    assert!(baseline
        .observe(read(vec![cookie("sid", "new")]), &pass())
        .is_empty());
    assert!(baseline.unsaved.is_empty());
    assert_eq!(baseline.entry(SITE, &key("sid")).unwrap().edited_at, 200);
}

#[test]
fn a_cookie_that_arrives_expired_comes_off_the_engine() {
    let mut baseline = settled(&[("sid", entry(Some("v"), 100, false))]);
    let mut stale = cookie("sid", "new");
    stale.expires_unix_seconds = Some((NOW / 1000) as i64 - 10);
    let incoming = Entry {
        cookie: Some(stale),
        edited_at: 200,
        idle: false,
        base: 0,
    };
    let ops = baseline.absorb(&records(&[("sid", incoming)]), &pass());
    assert_eq!(deletes(&ops), ["sid"]);
}

// Refusal.

#[test]
fn a_cookie_the_engine_refuses_is_counted_and_never_deleted() {
    let mut baseline = settled(&[(
        "kept",
        Entry {
            cookie: Some(cookie("kept", "k")),
            edited_at: 100,
            idle: false,
            base: 0,
        },
    )]);
    let ops = baseline.absorb(
        &records(&[
            ("sid", entry(Some("new"), 200, false)),
            (
                "kept",
                Entry {
                    cookie: Some(cookie("kept", "k")),
                    edited_at: 100,
                    idle: false,
                    base: 0,
                },
            ),
        ]),
        &pass(),
    );
    assert_eq!(ops.len(), 1);
    baseline.applied(&ops[0], Applied::Refused);
    let stamp = baseline.entry(SITE, &key("sid")).unwrap().edited_at;
    // The engine never has it, and nothing is deleted on any read.
    for _ in 0..3 {
        assert!(baseline
            .observe(read(vec![cookie("kept", "k")]), &pass())
            .is_empty());
    }
    let entry = baseline.entry(SITE, &key("sid")).unwrap();
    assert!(entry.cookie.is_some());
    assert_eq!(entry.edited_at, stamp);
    assert!(baseline.unsaved.is_empty());
    let skips = cookie_skips(&baseline.skipped, baseline.refused.values());
    assert_eq!(skips.len(), 1);
    assert_eq!(skips[0].site, SITE);
    assert_eq!(skips[0].kind, SkipKind::Cookies);
}

#[test]
fn a_cookie_the_engine_silently_drops_counts_as_refused_too() {
    let mut baseline = settled(&[(
        "kept",
        Entry {
            cookie: Some(cookie("kept", "k")),
            edited_at: 100,
            idle: false,
            base: 0,
        },
    )]);
    let ops = baseline.absorb(
        &records(&[("sid", entry(Some("new"), 200, false))]),
        &pass(),
    );
    // The engine said it stored it, but the next read says otherwise.
    baseline.applied(&ops[0], Applied::Stored);
    assert!(baseline.awaiting_read());
    baseline.unsaved.clear();
    assert!(baseline
        .observe(read(vec![cookie("kept", "k")]), &pass())
        .is_empty());
    assert!(baseline.entry(SITE, &key("sid")).unwrap().cookie.is_some());
    assert!(baseline.refused.contains_key(&key("sid")));
    assert!(baseline.unsaved.is_empty());
}

#[test]
fn one_refused_cookie_does_not_stop_the_others() {
    let mut baseline = settled(&[]);
    let ops = baseline.absorb(
        &records(&[
            (
                "a",
                Entry {
                    cookie: Some(cookie("a", "1")),
                    edited_at: 1,
                    idle: false,
                    base: 0,
                },
            ),
            (
                "b",
                Entry {
                    cookie: Some(cookie("b", "2")),
                    edited_at: 1,
                    idle: false,
                    base: 0,
                },
            ),
        ]),
        &pass(),
    );
    assert_eq!(ops.len(), 2);
    baseline.applied(&ops[0], Applied::Refused);
    baseline.applied(&ops[1], Applied::Stored);
    assert!(baseline
        .observe(read(vec![cookie("b", "2")]), &pass())
        .is_empty());
    assert_eq!(baseline.refused.len(), 1);
}

#[test]
fn a_write_that_did_not_get_there_is_tried_again_not_taken_for_a_local_change() {
    let mut baseline = settled(&[("sid", entry(Some("old"), 100, false))]);
    let ops = baseline.absorb(
        &records(&[("sid", entry(Some("new"), 200, false))]),
        &pass(),
    );
    baseline.applied(&ops[0], Applied::Later);
    assert!(baseline.awaiting_read());
    let again = baseline.observe(read(vec![cookie("sid", "old")]), &pass());
    assert_eq!(sets(&again), [("sid", "new")]);
    assert_eq!(baseline.entry(SITE, &key("sid")).unwrap().edited_at, 200);
    // `seen` doesn't move until it lands, so a restart still knows it's owed.
    assert!(!baseline.settle());
    baseline.applied(&again[0], Applied::Stored);
    assert!(baseline
        .observe(read(vec![cookie("sid", "new")]), &pass())
        .is_empty());
    assert!(!baseline.awaiting_read());
    assert!(baseline.settle());
}

#[test]
fn a_cookie_refused_before_gets_another_try_when_it_changes() {
    let mut baseline = settled(&[]);
    let ops = baseline.absorb(&records(&[("sid", entry(Some("v1"), 100, false))]), &pass());
    baseline.applied(&ops[0], Applied::Refused);
    let ops = baseline.absorb(&records(&[("sid", entry(Some("v2"), 200, false))]), &pass());
    assert_eq!(sets(&ops), [("sid", "v2")]);
    assert!(baseline.refused.is_empty());
}
