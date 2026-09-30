use super::*;

#[test]
fn digests_round_trip_through_their_stored_hex_form() {
    let digest = signin::digest(b"shard");
    assert_eq!(parse_digest(&signin_digest_hex(&digest)), Some(digest));
    assert_eq!(parse_digest("zz"), None);
    assert_eq!(parse_digest(&"a".repeat(62)), None);
}

#[test]
fn units_the_shard_packer_drops_are_reported_as_not_synced() {
    use misty_browser_sync::document::credentials::Area;
    let observations = vec![
        BrowserObservation {
            area: Area::Cookies,
            payload: serde_json::json!([{
                "name": "a", "value": "v", "domain": "example.test", "path": "/", "host_only": true,
                "secure": true, "http_only": true, "same_site": "lax", "expires_unix_seconds": null, "partition_key": null
            }]),
        },
        BrowserObservation {
            area: Area::LocalStorage {
                origin: "https://big.test".into(),
            },
            payload: serde_json::json!({ "a": "1", "b": "2" }),
        },
    ];
    let mut coverage = Coverage::default();
    coverage.synced("example.test", DataKind::Cookies, 1);
    coverage.synced("big.test", DataKind::LocalStorage, 2);
    // The packer could not fit big.test's local storage anywhere.
    let packed = signin::Packed {
        shards: BTreeMap::new(),
        digests: BTreeMap::new(),
        skipped: vec![signin::PackSkip {
            area: observations[1].area.clone(),
            cookie_domain: None,
            count: 1,
            reason: PackReason::TooLarge,
        }],
    };
    report_pack_skips(&mut coverage, &packed, &observations);
    let report = coverage.report();
    let big = report.iter().find(|site| site.site == "big.test").unwrap();
    assert!(big.synced.is_empty());
    assert_eq!(big.skipped[0].count, 2);
    assert_eq!(big.skipped[0].reason, SkipReason::TooLarge);
    assert_eq!(
        report
            .iter()
            .find(|site| site.site == "example.test")
            .unwrap()
            .synced[0]
            .count,
        1
    );
}
