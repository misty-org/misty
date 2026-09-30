use super::super::browser_data_coverage::SiteCoverage;
use super::*;
use serde_json::json;

fn local(origin: &str) -> Area {
    Area::LocalStorage {
        origin: origin.into(),
    }
}

fn cookie(name: &str, value_len: usize) -> Cookie {
    Cookie {
        name: name.into(),
        value: "v".repeat(value_len),
        domain: "example.test".into(),
        path: "/".into(),
        host_only: true,
        secure: true,
        http_only: true,
        same_site: None,
        expires_unix_seconds: None,
        partition_key: None,
    }
}

fn skipped(report: &[SiteCoverage], site: &str) -> Vec<(DataKind, SkipReason)> {
    report
        .iter()
        .filter(|entry| entry.site == site)
        .flat_map(|entry| entry.skipped.iter().map(|skip| (skip.kind, skip.reason)))
        .collect()
}

#[test]
fn oversized_new_areas_are_skipped_and_small_ones_still_sync() {
    let mut coverage = Coverage::default();
    let big = json!({ "blob": "x".repeat(BUDGET) });
    let fitted = fit(
        vec![cookie("session", 10)],
        &BTreeSet::new(),
        vec![
            Candidate {
                area: local("https://big.test"),
                fresh: Some(big),
                previous: None,
            },
            Candidate {
                area: local("https://small.test"),
                fresh: Some(json!({"k": "v"})),
                previous: None,
            },
        ],
        &mut coverage,
        Limit::SingleEvent,
    )
    .unwrap();
    let areas: Vec<_> = fitted
        .observations
        .iter()
        .map(|o| Held::key(&o.area))
        .collect();
    assert_eq!(
        areas,
        [
            Held::key(&Area::Cookies),
            Held::key(&local("https://small.test"))
        ]
    );
    let report = coverage.report();
    assert_eq!(
        skipped(&report, "big.test"),
        [(DataKind::LocalStorage, SkipReason::SyncLimit)]
    );
    assert!(fitted.held.areas.is_empty());
}

#[test]
fn previously_synced_areas_keep_their_last_copy_and_are_held() {
    let mut coverage = Coverage::default();
    let area = local("https://grown.test");
    let fitted = fit(
        vec![],
        &BTreeSet::new(),
        vec![
            // Grew past the limit since the last sync.
            Candidate {
                area: area.clone(),
                fresh: Some(json!({ "blob": "x".repeat(BUDGET) })),
                previous: Some(json!({"k": "old"})),
            },
            // Could not be read this time.
            Candidate {
                area: local("https://gone.test"),
                fresh: None,
                previous: Some(json!({"k": "kept"})),
            },
        ],
        &mut coverage,
        Limit::SingleEvent,
    )
    .unwrap();
    assert_eq!(fitted.observations.len(), 3);
    assert_eq!(fitted.observations[1].payload, json!({"k": "old"}));
    assert!(fitted.held.holds(&area));
    assert!(fitted.held.holds(&local("https://gone.test")));
    assert_eq!(
        skipped(&coverage.report(), "grown.test"),
        [(DataKind::LocalStorage, SkipReason::SyncLimit)]
    );
}

#[test]
fn every_fitted_observation_fits_one_sync_event() {
    let mut coverage = Coverage::default();
    let cookies: Vec<_> = (0..4000).map(|i| cookie(&format!("c{i}"), 200)).collect();
    let candidates = (0..300)
        .map(|i| Candidate {
            area: local(&format!("https://site{i}.test")),
            fresh: Some(json!({ "k": "x".repeat(2000) })),
            previous: None,
        })
        .collect();
    let fitted = fit(
        cookies,
        &BTreeSet::new(),
        candidates,
        &mut coverage,
        Limit::SingleEvent,
    )
    .unwrap();
    assert!(fitted.observations.len() <= MAX_AREAS);
    let batch = misty_browser_sync::document::credentials::Batch {
        profile_id: "a".repeat(64),
        updates: fitted
            .observations
            .iter()
            .map(|o| misty_browser_sync::document::credentials::AreaUpdate {
                area: o.area.clone(),
                base_sequence: misty_browser_sync::protocol::MAX_COUNTER,
                payload: o.payload.clone(),
            })
            .collect(),
    };
    batch.validate().unwrap();
    let event = misty_browser_sync::document::Payload::Credentials { version: 1, batch };
    assert!(serde_json::to_vec(&event).unwrap().len() <= MAX_EVENT_BYTES - 16);
    let report = coverage.report();
    assert!(skipped(&report, "example.test").contains(&(DataKind::Cookies, SkipReason::SyncLimit)));
}

#[test]
fn databases_that_could_not_export_keep_their_synced_version() {
    let mut fresh =
        json!({"codec_version": 1, "databases": [{"name": "b", "version": 1, "stores": []}]});
    let previous = json!({"codec_version": 1, "databases": [
        {"name": "a", "version": 3, "stores": []},
        {"name": "c", "version": 1, "stores": []}
    ]});
    let held = carry_databases(
        &mut fresh,
        Some(&previous),
        &BTreeSet::from(["a".to_owned()]),
    );
    assert_eq!(held, BTreeSet::from(["a".to_owned()]));
    let names: Vec<_> = fresh["databases"]
        .as_array()
        .unwrap()
        .iter()
        .map(|db| db["name"].as_str().unwrap())
        .collect();
    // "c" was deleted locally (exported fine, now absent): not resurrected.
    assert_eq!(names, ["a", "b"]);
}

#[test]
fn device_workspaces_keep_every_area_and_leave_limits_to_the_shard_packer() {
    let mut coverage = Coverage::default();
    let cookies: Vec<_> = (0..4000).map(|i| cookie(&format!("c{i}"), 200)).collect();
    let candidates = (0..300)
        .map(|i| Candidate {
            area: local(&format!("https://site{i}.test")),
            fresh: Some(json!({ "k": "x".repeat(2000) })),
            previous: None,
        })
        .collect();
    let fitted = fit(
        cookies,
        &BTreeSet::new(),
        candidates,
        &mut coverage,
        Limit::Shards,
    )
    .unwrap();
    assert_eq!(fitted.observations.len(), 301);
    assert_eq!(
        fitted.observations[0].payload.as_array().unwrap().len(),
        4000
    );
    assert!(coverage.report().iter().all(|site| site.skipped.is_empty()));
}
