use super::*;

#[test]
fn max_license_allows_local_use() {
    let license = CurrentLicense {
        tier: "max".to_string(),
        status: "active".to_string(),
        allows_use: true,
        expires_at: None,
        trial_started_at: None,
        license_device: None,
        verified_at: None,
        refresh_after: None,
        verified_until: None,
        needs_refresh: false,
        verification_expired: false,
    };

    assert!(license_allows_local_use(&license));
}

fn license(tier: &str) -> CurrentLicense {
    CurrentLicense {
        tier: tier.to_string(),
        status: "active".to_string(),
        allows_use: true,
        expires_at: None,
        trial_started_at: None,
        license_device: None,
        verified_at: None,
        refresh_after: None,
        verified_until: None,
        needs_refresh: false,
        verification_expired: false,
    }
}

#[test]
fn a_fresh_license_is_not_due_and_a_stale_one_stops_allowing_use() {
    let fresh = license_now(verified_license(&license("pro")));
    assert!(!fresh.needs_refresh && !fresh.verification_expired && fresh.allows_use);

    let mut stale = verified_license(&license("pro"));
    stale.refresh_after = Some("2020-01-01T00:00:00Z".to_string());
    stale.verified_until = Some("2020-01-15T00:00:00Z".to_string());
    let stale = license_now(stale);
    assert!(stale.needs_refresh && stale.verification_expired && !stale.allows_use);
}

#[test]
fn a_license_without_timestamps_is_rechecked() {
    assert!(license_now(license("pro")).needs_refresh);
}

#[test]
fn a_damaged_session_file_reads_as_signed_out() {
    let parsed: Option<StoredSession> = serde_json::from_slice(b"{ not json").ok();
    assert!(parsed.is_none());
    let stored = StoredSession {
        user: Some(CurrentUser {
            id: "a".into(),
            username: "a".into(),
            email: "a@example.test".into(),
        }),
        license: Some(verified_license(&license("pro"))),
    };
    let round: StoredSession =
        serde_json::from_slice(&serde_json::to_vec(&stored).unwrap()).unwrap();
    assert_eq!(round.user.unwrap().id, "a");
    assert!(round.license.unwrap().refresh_after.is_some());
}
