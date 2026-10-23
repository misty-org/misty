use super::*;
#[test]
fn restricts_resources_to_store_origins() {
    for value in [
        "https://addons.mozilla.org/file.xpi",
        "https://addons.cdn.mozilla.net/x",
        "https://clients2.google.com/service/update2/crx",
        "https://clients2.googleusercontent.com/crx/blobs/x.crx",
        "https://edgedl.me.gvt1.com/edgedl/x.crx",
    ] {
        assert!(trusted_url(&url::Url::parse(value).unwrap()), "{value}");
    }
    for value in [
        "http://addons.mozilla.org/x",
        "https://addons.mozilla.org.evil.test/x",
        "https://user@addons.mozilla.org/x",
        "https://addons.mozilla.org:8443/x",
        "https://gvt1.com.evil.test/x",
        "https://evilgvt1.com/x",
        "https://googleusercontent.com/x",
    ] {
        assert!(!trusted_url(&url::Url::parse(value).unwrap()), "{value}");
    }
}

#[test]
fn extension_ids_name_their_store() {
    assert_eq!(Store::of("607454"), Some(Store::Firefox));
    assert_eq!(
        Store::of("ddkjiahejlhfcafbddmgiahcphecmpfh"),
        Some(Store::Chrome)
    );
    for id in [
        "",
        "0",
        "0123",
        "ublock-origin",
        "ddkjiahejlhfcafbddmgiahcphecmpfz",
        "99999999999999999999999",
    ] {
        assert_eq!(Store::of(id), None, "{id}");
    }
    assert!(is_slug("ublock-origin") && is_slug("{abc-123}") && !is_slug("a/b"));
}
