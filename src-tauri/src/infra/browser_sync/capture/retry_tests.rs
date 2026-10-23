use super::*;
#[test]
fn repeated_restore_failures_back_off_and_success_resets_capture() {
    let mut retry = CaptureRetry::default();
    let mut now = std::time::Instant::now();
    for seconds in [30, 60, 120, 240, 300, 300] {
        assert!(retry.ready(now));
        retry.finished(false, now);
        assert!(!retry.ready(now + std::time::Duration::from_millis(1)));
        now += std::time::Duration::from_secs(seconds);
        assert!(retry.ready(now));
    }
    retry.finished(true, now);
    assert!(retry.ready(now));
    retry.finished(false, now);
    assert!(retry.ready(now + std::time::Duration::from_secs(30)));
}

#[test]
fn cookie_failures_name_the_step_that_failed() {
    let timeout = capture_issue(format!("{}: Timeout", collect::COOKIES_UNREADABLE));
    assert!(timeout.contains("timed out"));
    let profile = capture_issue(format!("{}: Profile", collect::COOKIES_UNREADABLE));
    assert!(profile.contains("browser profile"));
    let other = capture_issue(format!("{}: Unavailable", collect::COOKIES_UNREADABLE));
    assert!(other.starts_with("Website cookies could not be read"));
}
