use super::*;

const W: &str = "workspace";

fn at(start: Instant, ms: u64) -> Instant {
    start + Duration::from_millis(ms)
}

#[test]
fn a_burst_waits_for_quiet() {
    let start = Instant::now();
    let mut b = Batcher::default();
    for ms in (0..900).step_by(100) {
        b.edited(W, 1, at(start, ms));
        assert!(!b.due(W, Lane::Workspace, at(start, ms + 50)));
    }
    assert!(!b.due(W, Lane::Workspace, at(start, 1_700)));
    assert!(b.due(W, Lane::Workspace, at(start, 1_800)));
}

#[test]
fn continuous_edits_publish_at_max_wait() {
    let start = Instant::now();
    let mut b = Batcher::default();
    let mut sent = Vec::new();
    for ms in (0..12_000).step_by(500) {
        b.edited(W, 1, at(start, ms));
        let probe = at(start, ms + 250);
        if b.due(W, Lane::Workspace, probe) {
            sent.push(ms + 250);
            b.published(W);
        }
    }
    // Edits arrive every 500 ms, never 1 s apart: only max_wait (5 s) fires.
    assert_eq!(sent, vec![5_250, 10_750]);
}

#[test]
fn max_edits_publishes_early() {
    let start = Instant::now();
    let mut b = Batcher::default();
    b.edited(W, 49, start);
    assert!(!b.due(W, Lane::Workspace, at(start, 10)));
    b.edited(W, 1, at(start, 20));
    assert!(b.due(W, Lane::Workspace, at(start, 30)));
}

#[test]
fn another_machine_editing_switches_to_near_live() {
    let start = Instant::now();
    let mut b = Batcher::default();
    b.contend(W, start);
    b.edited(W, 1, start);
    assert!(!b.due(W, Lane::Workspace, at(start, 200)));
    assert!(b.due(W, Lane::Workspace, at(start, 300)));
    b.published(W);
    // The override lapses 30 s after the other machine's last change.
    b.edited(W, 1, at(start, 31_000));
    assert!(!b.due(W, Lane::Workspace, at(start, 31_300)));
    assert!(b.due(W, Lane::Workspace, at(start, 32_000)));
}

#[test]
fn a_restored_queue_waits_one_quiet_period() {
    let start = Instant::now();
    let mut b = Batcher::default();
    assert!(!b.due(W, Lane::Workspace, start));
    assert!(b.due(W, Lane::Workspace, at(start, 1_000)));
}

#[test]
fn flush_and_retry_skip_the_wait_but_a_hold_does_not() {
    let start = Instant::now();
    let mut b = Batcher::default();
    b.edited(W, 1, start);
    b.retry(W);
    assert!(b.due(W, Lane::Workspace, start));
    b.published(W);
    b.edited(W, 1, start);
    b.flush();
    assert!(b.due(W, Lane::Workspace, start));
    b.hold(W, Duration::from_secs(10), start);
    assert!(!b.due(W, Lane::Workspace, at(start, 9_000)));
    assert!(b.due(W, Lane::Workspace, at(start, 10_000)));
    b.settled();
    assert!(!b.flushing());
}

#[test]
fn server_values_are_clamped_and_never_go_backwards() {
    let wire: WirePolicy = serde_json::from_value(serde_json::json!({
        "revision": 2,
        "lanes": {
            "workspace": {"quiet_ms": 0, "max_wait_ms": 10_000_000, "max_edits": 0},
            "history": {"quiet_ms": 90_000, "max_wait_ms": 1_000, "max_edits": 5},
            "unknown": {"quiet_ms": 1, "max_wait_ms": 1, "max_edits": 1}
        }
    }))
    .unwrap();
    let policy = BatchPolicy::from_wire(&wire);
    assert_eq!(policy.workspace, LanePolicy::ms(100, 300_000, 1));
    assert_eq!(policy.history, LanePolicy::ms(60_000, 60_000, 5));
    assert_eq!(policy.slots, BatchPolicy::default().slots);
    let mut b = Batcher::default();
    assert!(b.set_policy(policy.clone()));
    let older = BatchPolicy {
        revision: 1,
        ..BatchPolicy::default()
    };
    assert!(!b.set_policy(older));
    assert_eq!(b.policy(), &policy);
}

#[test]
fn a_devices_frequency_scales_a_lane_within_the_accepted_range() {
    let base = LanePolicy::ms(1_000, 5_000, 50);
    assert_eq!(base.scaled(Frequency::Balanced), base);
    assert_eq!(base.scaled(Frequency::Live), LanePolicy::ms(250, 1_000, 25));
    assert_eq!(
        base.scaled(Frequency::Saver),
        LanePolicy::ms(4_000, 30_000, 100)
    );
    // Scaling never leaves what clients accept, nor makes the wait shorter than the quiet.
    let tiny = LanePolicy::ms(100, 250, 1);
    assert_eq!(tiny.scaled(Frequency::Live), LanePolicy::ms(100, 250, 1));
    let huge = LanePolicy::ms(60_000, 300_000, 1_000);
    assert_eq!(
        huge.scaled(Frequency::Saver),
        LanePolicy::ms(60_000, 300_000, 1_000)
    );
}

#[test]
fn only_known_frequencies_parse() {
    assert_eq!(Frequency::parse("live"), Some(Frequency::Live));
    assert_eq!(Frequency::parse("saver"), Some(Frequency::Saver));
    assert_eq!(Frequency::parse("balanced"), Some(Frequency::Balanced));
    assert_eq!(Frequency::parse("turbo"), None);
}
