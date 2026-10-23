//! Tracks webview and window creations that are under way.
//!
//! On Windows, creating a webview waits for WebView2 while pumping Windows
//! messages, and Tauri holds a lock for that whole time. A page can ask for a
//! popup during that pump, and building the popup's window there takes the same
//! lock on the same thread: the UI thread waits on itself and the window stays
//! black. While a creation is in flight a new popup is not built inside the
//! pump; it opens as an ordinary tab instead (`on_new_window` falls back to that
//! when `provider_popup` declines).
use std::sync::atomic::{AtomicUsize, Ordering};

static IN_FLIGHT: AtomicUsize = AtomicUsize::new(0);

/// Marks a creation as under way until it is dropped.
pub(crate) struct Creating;

impl Creating {
    pub(crate) fn enter() -> Self {
        IN_FLIGHT.fetch_add(1, Ordering::AcqRel);
        Self
    }
}

impl Drop for Creating {
    fn drop(&mut self) {
        IN_FLIGHT.fetch_sub(1, Ordering::AcqRel);
    }
}

/// Whether some webview or window is being created right now.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn in_flight() -> bool {
    IN_FLIGHT.load(Ordering::Acquire) > 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_creation_is_in_flight_until_its_guard_drops() {
        // Other tests may hold a guard; compare against the count on entry.
        let before = IN_FLIGHT.load(Ordering::Acquire);
        let first = Creating::enter();
        let second = Creating::enter();
        assert!(in_flight());
        assert_eq!(IN_FLIGHT.load(Ordering::Acquire), before + 2);
        drop(first);
        assert!(in_flight());
        drop(second);
        assert_eq!(IN_FLIGHT.load(Ordering::Acquire), before);
    }
}
