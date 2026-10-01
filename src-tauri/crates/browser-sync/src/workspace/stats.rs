//! Process-wide counters for workspace publication, so a report of an
//! unchanged workspace being resent can be traced to its layer: renderer edit
//! batches arriving here, records the op builder skipped as unchanged, ops it
//! suppressed as empty, and ops actually published. Counts only; no content.
use std::sync::atomic::{AtomicU64, Ordering};

pub(crate) static EDIT_BATCHES: AtomicU64 = AtomicU64::new(0);
pub(crate) static RECORDS_UNCHANGED: AtomicU64 = AtomicU64::new(0);
pub(crate) static RECORDS_WRITTEN: AtomicU64 = AtomicU64::new(0);
pub(crate) static OPS_SUPPRESSED: AtomicU64 = AtomicU64::new(0);
pub(crate) static OPS_BUILT: AtomicU64 = AtomicU64::new(0);

pub(crate) fn add(counter: &AtomicU64, n: u64) {
    counter.fetch_add(n, Ordering::Relaxed);
}

pub(crate) fn read(counter: &AtomicU64) -> u64 {
    counter.load(Ordering::Relaxed)
}
