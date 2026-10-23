use super::*;
use misty_browser_sync::document::credentials::SameSite;

pub(crate) fn cookie(name: &str, domain: &str) -> Cookie {
    Cookie {
        name: name.into(),
        value: "synthetic".into(),
        domain: domain.into(),
        path: "/".into(),
        host_only: !domain.starts_with('.'),
        secure: false,
        http_only: false,
        same_site: None,
        expires_unix_seconds: None,
        partition_key: None,
    }
}

#[test]
fn one_bad_cookie_is_skipped_without_failing_the_read() {
    let mut invalid = cookie("bad name", "example.test");
    invalid.value = "x".into();
    let mut insecure_none = cookie("legacy", "example.test");
    insecure_none.same_site = Some(SameSite::None);
    let read = CookieRead::accept(
        [
            Ok(cookie("a", "example.test")),
            Ok(invalid),
            Ok(insecure_none),
            Ok(cookie("a", "example.test")),
            Err(("chips.test".into(), SkipReason::Partitioned)),
            Ok(cookie("b", ".example.test")),
        ],
        20_000,
    );
    let names: Vec<_> = read.cookies.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["a", "b"]);
    assert_eq!(
        read.skipped,
        [
            ("example.test".into(), SkipReason::Malformed),
            ("example.test".into(), SkipReason::Malformed),
            ("example.test".into(), SkipReason::Duplicate),
            ("chips.test".into(), SkipReason::Partitioned),
        ]
    );
    // Whatever is accepted must pass the shared model's payload validation.
    assert!(Area::Cookies
        .validate_payload(&serde_json::to_value(&read.cookies).unwrap())
        .is_ok());
}

#[test]
fn cookies_this_device_cannot_store_are_carried_not_deleted() {
    let mut read = CookieRead::accept([Ok(cookie("local", "example.test"))], 10);
    let foreign = cookie("foreign", "example.test");
    let replaced = cookie("local", "example.test");
    read.carry(
        &[foreign.clone(), replaced, cookie("stored", "example.test")],
        |c| c.name == "stored",
    );
    let names: Vec<_> = read.cookies.iter().map(|c| c.name.as_str()).collect();
    // The local observation wins; a cookie this engine could store but no
    // longer holds is a real deletion and is not resurrected.
    assert_eq!(names, ["local", "foreign"]);
    assert_eq!(
        read.skipped,
        [("example.test".into(), SkipReason::NotSupportedHere)]
    );
}

#[test]
fn restore_splits_cookies_the_engine_can_store() {
    let (stored, kept) =
        partition_restorable(vec![cookie("a", "a.test"), cookie("b", "b.test")], |c| {
            c.name == "a"
        });
    assert_eq!(stored[0].name, "a");
    assert_eq!(kept[0].name, "b");
}

#[test]
fn report_lists_sites_with_skipped_data_first_and_never_values() {
    let mut coverage = Coverage::default();
    coverage.synced("a.test", DataKind::Cookies, 3);
    coverage.synced("b.test", DataKind::LocalStorage, 2);
    coverage.skipped("b.test", DataKind::IndexedDb, SkipReason::TooLarge, 1);
    coverage.skipped("b.test", DataKind::IndexedDb, SkipReason::TooLarge, 2);
    let report = coverage.report();
    assert_eq!(report[0].site, "b.test");
    assert_eq!(
        report[0].skipped,
        [Skipped {
            kind: DataKind::IndexedDb,
            reason: SkipReason::TooLarge,
            count: 3
        }]
    );
    assert_eq!(report[1].site, "a.test");
    assert_eq!(
        serde_json::to_value(&report[1]).unwrap(),
        serde_json::json!({"site": "a.test", "synced": [{"kind": "cookies", "count": 3}], "skipped": []})
    );
}

#[test]
fn sites_come_from_cookie_domains_and_origins() {
    assert_eq!(site(".Example.test"), "example.test");
    assert_eq!(site("https://mail.example.test"), "mail.example.test");
    assert_eq!(site("http://localhost:3000"), "localhost");
}

#[test]
fn engines_that_report_none_as_unset_keep_the_synced_explicit_none() {
    let mut synced = cookie("sid", "example.test");
    synced.secure = true;
    synced.same_site = Some(SameSite::None);
    let mut observed = synced.clone();
    observed.same_site = None;
    observed.value = "refreshed".into();
    let mut read = CookieRead::accept([Ok(observed.clone())], 10);
    read.align_same_site(std::slice::from_ref(&synced), false);
    assert!(read.cookies[0].same_site.is_none());
    read.align_same_site(std::slice::from_ref(&synced), true);
    assert!(matches!(read.cookies[0].same_site, Some(SameSite::None)));
    assert_eq!(read.cookies[0].value, "refreshed");
}
