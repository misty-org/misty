use super::*;
use browser_data::document::credentials::SameSite;

fn cookie(name: &str, domain: &str) -> Cookie {
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
    // Whatever is accepted must pass the shared model's validation.
    assert!(read.cookies.iter().all(|cookie| cookie.validate().is_ok()));
}

#[test]
fn a_read_past_the_limit_reports_what_it_left_out() {
    let read = CookieRead::accept([Ok(cookie("a", "a.test")), Ok(cookie("b", "b.test"))], 1);
    assert_eq!(read.cookies.len(), 1);
    assert_eq!(read.skipped, [("b.test".into(), SkipReason::TooLarge)]);
}

#[test]
fn sites_come_from_cookie_domains_and_origins() {
    assert_eq!(site(".Example.test"), "example.test");
    assert_eq!(site("https://mail.example.test"), "mail.example.test");
    assert_eq!(site("http://localhost:3000"), "localhost");
}
