use super::*;
use serde_json::json;

fn url(value: &str) -> url::Url {
    url::Url::parse(value).unwrap()
}
fn page(path: &str) -> url::Url {
    url(&format!("{EXTENSION_SCHEME}://fixture-host/{path}"))
}

#[test]
fn globs_match_like_the_manifest_means() {
    assert!(glob("*", "a/b.png"));
    assert!(glob("images/*", "images/a/b.png"));
    assert!(glob("*.png", "a/b.png"));
    assert!(glob("a*c*e", "abcde"));
    assert!(glob("page.html", "page.html"));
    assert!(!glob("page.html", "page.html.js"));
    assert!(!glob("images/*", "secret/images/a"));
    assert!(!glob("*.png", "a.png.js"));
    assert!(!glob("a*c", "ab"));
}

#[test]
fn match_patterns_read_scheme_host_and_path() {
    let site = url("https://app.example.org/deep/page?x=1");
    for pattern in [
        "<all_urls>",
        "*://*/*",
        "https://*/*",
        "https://app.example.org/*",
        "*://*.example.org/*",
    ] {
        assert!(matches_page(pattern, &site), "{pattern}");
    }
    for pattern in [
        "http://*/*",
        "https://other.example/*",
        "https://*.org.evil/*",
        "https://app.example.org/other/*",
        "not a pattern",
    ] {
        assert!(!matches_page(pattern, &site), "{pattern}");
    }
    assert!(!matches_page("<all_urls>", &page("a")));
}

#[test]
fn a_manifest_v3_entry_says_which_pages_reach_which_files() {
    let site = url("https://site.test/");
    let listed = json!([
        {"resources": ["public/*"], "matches": ["https://site.test/*"]},
        {"resources": ["shared.html"], "extension_ids": ["*"]},
    ]);
    assert!(web_accessible(&listed, "/public/a.html", &site));
    assert!(!web_accessible(&listed, "/options.html", &site));
    assert!(!web_accessible(
        &listed,
        "/public/a.html",
        &url("https://other.test/")
    ));
    assert!(!web_accessible(&listed, "/shared.html", &site));
    // Other extensions only through the entry open to them.
    assert!(web_accessible(
        &listed,
        "/shared.html",
        &url(&format!("{EXTENSION_SCHEME}://other/x"))
    ));
    assert!(!web_accessible(
        &listed,
        "/public/a.html",
        &url(&format!("{EXTENSION_SCHEME}://other/x"))
    ));
}

#[test]
fn a_manifest_v2_list_opens_to_every_page_and_no_list_to_none() {
    let site = url("https://site.test/");
    assert!(web_accessible(
        &json!(["blocked.html", "img/*"]),
        "/img/a.png",
        &site
    ));
    assert!(!web_accessible(
        &json!(["blocked.html"]),
        "/options.html",
        &site
    ));
    assert!(!web_accessible(&Value::Null, "/options.html", &site));
    assert!(!web_accessible(
        &json!([{"resources": ["*"]}]),
        "/options.html",
        &site
    ));
}

#[test]
fn a_website_cannot_open_an_extension_page_it_was_not_given() {
    resources().write().unwrap().insert(
        "fixture-host".into(),
        json!([{"resources": ["strictblock.html"], "matches": ["<all_urls>"]}]),
    );
    let site = url("https://evil.test/");
    assert!(!page_may_open(&page("options.html?do=harm"), Some(&site)));
    assert!(!page_may_open(&page("options.html"), None));
    assert!(page_may_open(&page("strictblock.html"), Some(&site)));
    // Its own pages, and every ordinary page, are unaffected.
    assert!(page_may_open(
        &page("options.html"),
        Some(&page("popup.html"))
    ));
    assert!(page_may_open(&url("https://any.test/"), Some(&site)));
    // A host Misty knows nothing about stays closed.
    let other = url(&format!("{EXTENSION_SCHEME}://unknown-host/options.html"));
    assert!(!page_may_open(&other, Some(&site)));
}

#[test]
fn only_a_navigation_misty_asked_for_gets_past_the_rule_and_only_once() {
    let site = url("https://site.test/");
    let target = page("options.html");
    assert!(!navigation_allowed(Some("tab-a"), &target, Some(&site)));
    trust_navigation("tab-a", &target);
    // Another tab, another address, or no tab at all gets nothing from it.
    assert!(!navigation_allowed(Some("tab-b"), &target, Some(&site)));
    assert!(!navigation_allowed(
        Some("tab-a"),
        &page("other.html"),
        Some(&site)
    ));
    assert!(!navigation_allowed(None, &target, Some(&site)));
    assert!(navigation_allowed(Some("tab-a"), &target, Some(&site)));
    assert!(!navigation_allowed(Some("tab-a"), &target, Some(&site)));
}
