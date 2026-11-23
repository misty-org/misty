use std::sync::atomic::{AtomicUsize, Ordering};

static IN_FLIGHT: AtomicUsize = AtomicUsize::new(0);

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

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn in_flight() -> bool {
    IN_FLIGHT.load(Ordering::Acquire) > 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_creation_is_in_flight_until_its_guard_drops() {
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
