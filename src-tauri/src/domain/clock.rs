use std::time::{SystemTime, UNIX_EPOCH};

/// Milliseconds since the Unix epoch, saturating at `i64::MAX`.
pub fn now_epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
