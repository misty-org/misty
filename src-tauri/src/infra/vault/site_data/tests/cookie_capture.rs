use super::super::baseline::{Applied, Baseline, Pass};
use super::super::entries::*;
use super::support::*;
use crate::infra::website_data::coverage::{CookieRead, SkipReason};
use misty_browser_sync::document::credentials::{Cookie, SameSite};
use std::collections::BTreeMap;

// This computer's changes.

#[test]
fn a_pass_that_finds_nothing_changed_writes_nothing() {
    let mut baseline = settled(&[("sid", entry(Some("v"), 100, false))]);
    let ops = baseline.observe(read(vec![cookie("sid", "v")]), &pass());
    assert!(ops.is_empty());
    assert!(baseline.unsaved.is_empty());
    assert!(!baseline.settle());
}

#[test]
fn a_change_is_stamped_with_the_clock_and_marked_idle_or_not() {
    let mut baseline = settled(&[("sid", entry(Some("v"), 100, false))]);
    let idle = Pass {
        idle: true,
        ..pass()
    };
    assert!(baseline
        .observe(read(vec![cookie("sid", "new")]), &idle)
        .is_empty());
    let stored = baseline.entry(SITE, &key("sid")).unwrap();
    assert_eq!(stored.edited_at, NOW);
    assert!(stored.idle);
    assert!(baseline.unsaved.contains(SITE));
}

#[test]
fn a_change_is_never_stamped_behind_what_the_record_has() {
    let ahead = NOW + 5_000;
    let mut baseline = settled(&[("sid", entry(Some("v"), ahead, false))]);
    baseline.observe(read(vec![cookie("sid", "new")]), &pass());
    assert_eq!(
        baseline.entry(SITE, &key("sid")).unwrap().edited_at,
        ahead + 1
    );
    // A deletion too.
    baseline.observe(read(vec![cookie("other", "x")]), &pass());
    let deleted = baseline.entry(SITE, &key("sid")).unwrap();
    assert!(deleted.cookie.is_none());
    assert_eq!(deleted.edited_at, ahead + 2);
}

#[test]
fn a_new_cookie_after_the_first_read_is_this_computers_change() {
    let mut baseline = settled(&[("sid", entry(Some("v"), 100, false))]);
    baseline.observe(read(vec![cookie("sid", "v"), cookie("new", "n")]), &pass());
    assert_eq!(baseline.entry(SITE, &key("new")).unwrap().edited_at, NOW);
}

// The first read after a restart.

fn restarted(entries: &[(&str, Entry)], seen: u64) -> Baseline {
    let cookies = entries.iter().map(|(name, _)| (key(name), seen)).collect();
    Baseline::load(
        &records(entries),
        BTreeMap::from([(SITE.to_owned(), cookies)]),
    )
}

#[test]
fn a_change_that_arrived_while_closed_goes_into_the_engine() {
    let mut baseline = restarted(&[("sid", entry(Some("remote"), 500, false))], 400);
    let ops = baseline.observe(read(vec![cookie("sid", "local")]), &pass());
    assert_eq!(sets(&ops), [("sid", "remote")]);
    assert!(baseline.unsaved.is_empty());
    let deleted = restarted(&[("sid", entry(None, 500, false))], 400);
    let mut baseline = deleted;
    let ops = baseline.observe(read(vec![cookie("sid", "local")]), &pass());
    assert_eq!(deletes(&ops), ["sid"]);
}

#[test]
fn a_change_the_engine_made_just_before_quitting_is_not_lost() {
    let mut baseline = restarted(&[("sid", entry(Some("stale"), 300, false))], 400);
    let ops = baseline.observe(read(vec![cookie("sid", "rotated")]), &pass());
    assert!(ops.is_empty());
    assert_eq!(value_of(&baseline, "sid").as_deref(), Some("rotated"));
    assert_eq!(baseline.entry(SITE, &key("sid")).unwrap().edited_at, NOW);
    assert!(baseline.unsaved.contains(SITE));
}

#[test]
fn a_session_cookie_that_went_with_the_last_quit_is_not_a_sign_out() {
    let mut baseline = restarted(&[("sid", entry(Some("v"), 300, false))], 400);
    let ops = baseline.observe(read(vec![cookie("other", "x")]), &pass());
    assert_eq!(sets(&ops), [("sid", "v")]);
    assert!(baseline.entry(SITE, &key("sid")).unwrap().cookie.is_some());
}

#[test]
fn a_lasting_cookie_deleted_just_before_quitting_is_a_sign_out() {
    let stored = Entry {
        cookie: Some(lasting("sid", "v")),
        edited_at: 300,
        idle: false,
        base: 0,
    };
    let mut baseline = restarted(&[("sid", stored)], 400);
    let ops = baseline.observe(read(vec![cookie("other", "x")]), &pass());
    assert!(ops.is_empty());
    assert!(baseline.entry(SITE, &key("sid")).unwrap().cookie.is_none());
}

#[test]
fn a_cookie_from_elsewhere_older_than_the_sites_newest_lands_and_is_not_a_sign_out() {
    let theirs = Entry {
        cookie: Some(lasting("sid", "theirs")),
        edited_at: 0,
        idle: true,
        base: 0,
    };
    let ours = Entry {
        cookie: Some(lasting("other", "x")),
        edited_at: 400,
        idle: false,
        base: 0,
    };
    // This store has only ever seen `other`; `sid` arrived while it was closed.
    let seen = BTreeMap::from([(key("other"), 400)]);
    let mut baseline = Baseline::load(
        &records(&[("sid", theirs), ("other", ours)]),
        BTreeMap::from([(SITE.to_owned(), seen)]),
    );
    let ops = baseline.observe(read(vec![lasting("other", "x")]), &pass());
    assert_eq!(sets(&ops), [("sid", "theirs")]);
    assert!(baseline.entry(SITE, &key("sid")).unwrap().cookie.is_some());
}

#[test]
fn a_store_that_comes_up_empty_is_not_read_as_new_or_signed_out_when_it_loads() {
    let mut baseline = Baseline::load(&[], BTreeMap::new());
    assert!(baseline.observe(read(vec![]), &pass()).is_empty());
    // Still loading, however many times it's asked.
    assert!(baseline.observe(read(vec![]), &pass()).is_empty());
    assert!(baseline.observe(read(vec![]), &pass()).is_empty());
    // Its file has loaded: these were here all along, so anything elsewhere wins over them.
    baseline.observe(read(vec![cookie("sid", "old")]), &pass());
    let stored = baseline.entry(SITE, &key("sid")).unwrap();
    assert_eq!(stored.edited_at, 0);
    assert!(stored.idle);
    // From here, something new is this computer's change.
    baseline.observe(read(vec![cookie("sid", "old"), cookie("new", "n")]), &pass());
    assert_eq!(baseline.entry(SITE, &key("new")).unwrap().edited_at, NOW);
}

#[test]
fn a_store_that_comes_up_empty_is_filled_not_signed_out() {
    let stored = Entry {
        cookie: Some(lasting("sid", "v")),
        edited_at: 300,
        idle: false,
        base: 0,
    };
    let mut baseline = restarted(&[("sid", stored)], 400);
    let ops = baseline.observe(read(vec![]), &pass());
    assert_eq!(sets(&ops), [("sid", "v")]);
    assert!(baseline.entry(SITE, &key("sid")).unwrap().cookie.is_some());
}

#[test]
fn a_store_that_reads_empty_mid_session_is_only_believed_the_second_time() {
    let mut baseline = settled(&[("sid", entry(Some("v"), 100, false))]);
    assert!(baseline.observe(read(vec![]), &pass()).is_empty());
    assert!(baseline.entry(SITE, &key("sid")).unwrap().cookie.is_some());
    assert!(baseline.unsaved.is_empty());
    // A good read in between starts the count again.
    baseline.observe(read(vec![cookie("sid", "v")]), &pass());
    baseline.observe(read(vec![]), &pass());
    assert!(baseline.entry(SITE, &key("sid")).unwrap().cookie.is_some());
    baseline.observe(read(vec![]), &pass());
    assert!(baseline.entry(SITE, &key("sid")).unwrap().cookie.is_none());
}

#[test]
fn an_expired_cookie_going_away_is_not_a_change() {
    let stale = Cookie {
        expires_unix_seconds: Some((NOW / 1000) as i64 - 10),
        ..cookie("old", "v")
    };
    let mut baseline = settled(&[
        ("sid", entry(Some("v"), 100, false)),
        (
            "old",
            Entry {
                cookie: Some(stale),
                edited_at: 100,
                idle: false,
                base: 0,
            },
        ),
    ]);
    assert!(baseline
        .observe(read(vec![cookie("sid", "v")]), &pass())
        .is_empty());
    assert!(baseline.unsaved.is_empty());
    assert!(baseline.entry(SITE, &key("old")).unwrap().cookie.is_some());
}

// What a read couldn't report.

#[test]
fn a_site_with_cookies_the_read_could_not_report_keeps_its_deletions_waiting() {
    for reason in [SkipReason::Malformed, SkipReason::UnsupportedAttributes] {
        let mut baseline = settled(&[("sid", entry(Some("v"), 100, false))]);
        let partial = CookieRead {
            cookies: vec![cookie("other", "x")],
            skipped: vec![(SITE.to_owned(), reason)],
        };
        baseline.observe(partial, &pass());
        assert!(baseline.entry(SITE, &key("sid")).unwrap().cookie.is_some());
    }
}

#[test]
fn a_read_cut_off_at_the_limit_deletes_nothing_anywhere() {
    let mut baseline = settled(&[("sid", entry(Some("v"), 100, false))]);
    let partial = CookieRead {
        cookies: vec![cookie("other", "x")],
        skipped: vec![("elsewhere.test".to_owned(), SkipReason::TooLarge)],
    };
    baseline.observe(partial, &pass());
    assert!(baseline.entry(SITE, &key("sid")).unwrap().cookie.is_some());
}

#[test]
fn partitioned_cookies_do_not_hold_up_a_real_sign_out() {
    let mut baseline = settled(&[("sid", entry(Some("v"), 100, false))]);
    let partial = CookieRead {
        cookies: vec![cookie("other", "x")],
        skipped: vec![(SITE.to_owned(), SkipReason::Partitioned)],
    };
    baseline.observe(partial, &pass());
    assert!(baseline.entry(SITE, &key("sid")).unwrap().cookie.is_none());
}

// SameSite.

#[test]
fn same_site_none_survives_an_engine_that_reads_it_as_unspecified() {
    let mut synced = cookie("sid", "v");
    synced.same_site = Some(SameSite::None);
    let stored = Entry {
        cookie: Some(synced.clone()),
        edited_at: 100,
        idle: false,
        base: 0,
    };
    let mut baseline = Baseline::load(&records(&[("sid", stored)]), BTreeMap::new());
    baseline.observe(read(vec![synced]), &pass());
    baseline.unsaved.clear();
    baseline.settle();
    // The same cookie read back unspecified is no change at all.
    let ops = baseline.observe(read(vec![cookie("sid", "v")]), &pass());
    assert!(ops.is_empty());
    assert!(baseline.unsaved.is_empty());
    // Rotated, it keeps the policy, so another engine isn't handed a downgraded cookie.
    baseline.observe(read(vec![cookie("sid", "rotated")]), &pass());
    let stored = baseline.entry(SITE, &key("sid")).unwrap();
    let cookie = stored.cookie.as_ref().unwrap();
    assert_eq!(cookie.value, "rotated");
    assert!(matches!(cookie.same_site, Some(SameSite::None)));
}

#[test]
fn a_new_secure_cookie_on_an_engine_that_hides_none_is_recorded_as_none() {
    let mut baseline = Baseline::load(&[], BTreeMap::new());
    baseline.observe(read(vec![cookie("sid", "v")]), &pass());
    let stored = baseline.entry(SITE, &key("sid")).unwrap();
    assert!(matches!(
        stored.cookie.as_ref().unwrap().same_site,
        Some(SameSite::None)
    ));
    // Read back unspecified again, it's settled.
    baseline.unsaved.clear();
    baseline.settle();
    assert!(baseline
        .observe(read(vec![cookie("sid", "v")]), &pass())
        .is_empty());
    assert!(baseline.unsaved.is_empty());
}

#[test]
fn an_insecure_cookie_is_never_recorded_as_none() {
    let insecure = Cookie {
        secure: false,
        ..cookie("sid", "v")
    };
    assert!(aligned(insecure, true).same_site.is_none());
}

#[test]
fn an_engine_that_reports_same_site_exactly_sees_a_real_change() {
    let mut stored = cookie("sid", "v");
    stored.same_site = Some(SameSite::None);
    let engine = cookie("sid", "v");
    assert!(same_cookie(&stored, &engine, true));
    assert!(!same_cookie(&stored, &engine, false));
    assert!(aligned(cookie("sid", "x"), false).same_site.is_none());
    // Other policies are never assumed.
    let mut lax = cookie("sid", "v");
    lax.same_site = Some(SameSite::Lax);
    assert!(!same_cookie(&lax, &engine, true));
    // Foundation can only be hiding None on a secure cookie.
    let insecure = Cookie {
        secure: false,
        ..cookie("sid", "v")
    };
    assert!(!same_cookie(&stored, &insecure, true));
}

// Expiry.

#[test]
fn a_clamped_expiry_read_back_is_no_change_and_does_not_loop() {
    let far = Cookie {
        expires_unix_seconds: Some((NOW / 1000) as i64 + 400 * 86_400),
        ..cookie("sid", "v")
    };
    let clamped = Cookie {
        expires_unix_seconds: Some((NOW / 1000) as i64 + 7 * 86_400),
        ..cookie("sid", "v")
    };
    let incoming = Entry {
        cookie: Some(far),
        edited_at: 100,
        idle: false,
        base: 0,
    };
    let mut baseline = settled(&[("sid", entry(Some("older"), 50, false))]);
    let ops = baseline.absorb(&records(&[("sid", incoming)]), &pass());
    assert_eq!(ops.len(), 1);
    baseline.applied(&ops[0], Applied::Stored);
    baseline.unsaved.clear();
    for _ in 0..3 {
        assert!(baseline
            .observe(read(vec![clamped.clone()]), &pass())
            .is_empty());
        assert!(baseline.unsaved.is_empty());
    }
    assert_eq!(baseline.entry(SITE, &key("sid")).unwrap().edited_at, 100);
}

#[test]
fn a_site_nudging_an_expiry_forward_writes_only_when_it_moves_far() {
    let at = |seconds: i64| Cookie {
        expires_unix_seconds: Some((NOW / 1000) as i64 + seconds),
        ..cookie("sid", "v")
    };
    let stored = at(1_000);
    assert!(same_cookie(&stored, &at(1_000), true));
    assert!(same_cookie(&stored, &at(1_030), true));
    assert!(same_cookie(&stored, &at(500), true));
    assert!(!same_cookie(&stored, &at(1_000 + 7_200), true));
    // Session and lasting aren't one cookie with a different date.
    assert!(!same_cookie(&stored, &cookie("sid", "v"), true));
    assert!(!same_cookie(&cookie("sid", "v"), &stored, true));
}
